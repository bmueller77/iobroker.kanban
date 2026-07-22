'use strict';

/**
 * Dispatcher für Benachrichtigungen: hört auf den Event-Bus und verteilt an
 *  - kanban.0.lastEvent (State, für Skript-Trigger)
 *  - E-Mail via sendTo(<emailInstance>, 'send', ...)
 *  - ausgehende Webhooks (HTTP POST, natives fetch, 5 s Timeout, 1 Retry)
 */

const { serverT } = require('./i18n-server');

const EVENT_TO_CONFIG = {
    cardAssigned: 'notifyAssigned',
    cardDue: 'notifyDue',
    cardCreated: 'notifyCreated',
    cardUpdated: 'notifyUpdated',
    cardMoved: 'notifyMoved',
    cardDone: 'notifyDone',
};

// ------------------------------------------------------------ iCalendar (.ics)
const icsEsc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const pad2 = n => String(n).padStart(2, '0');
function icsStampUTC(dt) {
    return `${dt.getUTCFullYear()}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}T${pad2(dt.getUTCHours())}${pad2(dt.getUTCMinutes())}${pad2(dt.getUTCSeconds())}Z`;
}
function ymd(d) { return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`; }

/**
 * Wandelt eine Wanduhr-Zeit in Zeitzone `tz` nach UTC – unabhängig davon, in
 * welcher Zeitzone der Node-Prozess läuft. Berücksichtigt DST, da Intl die
 * Zonenregeln kennt. (Kein externes date-fns/luxon nötig.)
 */
function zonedTimeToUtc(y, mo, d, hh, mm, tz) {
    const guessUtc = Date.UTC(y, mo - 1, d, hh, mm, 0);
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const map = {};
    for (const p of dtf.formatToParts(new Date(guessUtc))) if (p.type !== 'literal') map[p.type] = Number(p.value);
    const asUtc = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
    return new Date(guessUtc - (asUtc - guessUtc));
}

/** VEVENT aus einer Karte. dueTime → Termin mit Uhrzeit (1 h), sonst ganztägig. */
function buildIcs(card, tz) {
    const zone = tz || 'Europe/Berlin';
    const [y, m, d] = card.due.split('-');
    let dtStart, dtEnd;
    if (card.dueTime) {
        // Termin mit Uhrzeit: als Wanduhr-Zeit in der ermittelten Zeitzone
        // interpretieren und nach UTC (…Z) umrechnen → für jeden Empfänger eindeutig.
        const [hh, mm] = card.dueTime.split(':');
        const startUtc = zonedTimeToUtc(Number(y), Number(m), Number(d), Number(hh), Number(mm), zone);
        const endUtc = new Date(startUtc.getTime() + 60 * 60 * 1000);
        dtStart = `DTSTART:${icsStampUTC(startUtc)}`;
        dtEnd = `DTEND:${icsStampUTC(endUtc)}`;
    } else {
        // Ganztägig: VALUE=DATE ist bewusst zeitzonenlos (Ende exklusiv = Folgetag)
        const next = new Date(Number(y), Number(m) - 1, Number(d) + 1);
        dtStart = `DTSTART;VALUE=DATE:${y}${m}${d}`;
        dtEnd = `DTEND;VALUE=DATE:${ymd(next)}`;
    }
    const lines = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ioBroker//Kanban//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${card.id}@kanban.iobroker`,
        `DTSTAMP:${icsStampUTC(new Date())}`,
        dtStart, dtEnd,
        `SUMMARY:${icsEsc(card.title)}`,
    ];
    if (card.description) lines.push(`DESCRIPTION:${icsEsc(card.description)}`);
    if (card.location) lines.push(`LOCATION:${icsEsc(card.location)}`);
    if (card.link) lines.push(`URL:${icsEsc(card.link)}`);
    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.join('\r\n');
}

class Notifier {
    constructor(adapter, getBaseUrl, getTimezone) {
        this.adapter = adapter;
        this.getBaseUrl = getBaseUrl; // () => 'http://host:8095'
        this.getTimezone = getTimezone || (() => 'Europe/Berlin');
    }

    attach(bus) {
        bus.on('event', event => {
            this._dispatch(event).catch(e =>
                this.adapter.log.error(`Benachrichtigung fehlgeschlagen (${event.event}): ${e.message}`));
        });
    }

    async _dispatch(event) {
        await this.adapter.setStateAsync('lastEvent', JSON.stringify(event), true);
        await Promise.allSettled([
            this._sendEmails(event),
            this._sendWebhooks(event),
        ]);
    }

    // ------------------------------------------------------------ E-Mail

    _userByName(name) {
        return (this.adapter.config.users || []).find(u => u.name === name);
    }

    // Will dieser Benutzer bei diesem Event-Typ benachrichtigt werden?
    // Eigene Einstellung sticht; ist sie nicht gesetzt, greift die globale Vorgabe.
    _userWants(u, flag) {
        if (!flag) return false;
        const v = u[flag];
        if (v === undefined || v === null || v === '') return !!this.adapter.config[flag];
        return !!v;
    }

    _recipientUsers(event) {
        // Bei Zuweisung nur der neu Zugewiesene, sonst alle Zuständigen der Karte
        const names = event.event === 'cardAssigned'
            ? [event.detail && event.detail.assignee].filter(Boolean)
            : (event.card && event.card.assignees) || [];
        const seen = new Set();
        const users = [];
        for (const n of names) {
            const u = this._userByName(n);
            if (u && u.email && !seen.has(u.email)) { seen.add(u.email); users.push(u); }
        }
        return users;
    }

    async _sendEmails(event) {
        const cfg = this.adapter.config;
        const flag = EVENT_TO_CONFIG[event.event];
        if (!flag || !cfg.emailInstance) return;
        // Auslöser der Änderung nicht sich selbst benachrichtigen
        const by = (event.detail && event.detail.by) || null;
        const users = this._recipientUsers(event)
            .filter(u => u.name !== by)
            .filter(u => this._userWants(u, flag));
        if (!users.length) return;

        const lang = this.adapter._language;
        const label = serverT(lang, 'ev.' + event.event);
        const card = event.card || {};
        const subject = `${serverT(lang, 'mail.subjectPrefix')} ${label}: ${card.title || ''}`;
        const html = this._renderHtml(event, label);

        // Optionaler Kalender-Anhang (.ics), wenn an der Karte aktiviert + Datum vorhanden
        let attachments;
        if (card.calendarInvite && card.due) {
            attachments = [{
                filename: 'termin.ics',
                content: buildIcs(card, this.getTimezone()),
                contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
            }];
        }

        for (const u of users) {
            this.adapter.sendTo(cfg.emailInstance, 'send', {
                to: u.email,
                from: cfg.emailFrom || undefined,
                subject,
                html,
                ...(attachments ? { attachments } : {}),
            });
        }
        this.adapter.log.debug(`E-Mail '${subject}' an ${users.map(u => u.email).join(', ')}${attachments ? ' (+ .ics)' : ''}`);
    }

    _renderHtml(event, label) {
        const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const card = event.card || {};
        const board = event.board || {};
        const accent = this.adapter.config.accentColor || '#7E57C2';
        const lang = this.adapter._language;
        const rows = [];
        rows.push([serverT(lang, 'mail.board'), esc(board.title)]);
        if (event.detail && event.detail.fromColumn && event.detail.toColumn) {
            rows.push([serverT(lang, 'mail.moved'), `${esc(event.detail.fromColumn)} → ${esc(event.detail.toColumn)}`]);
        }
        if (card.due) rows.push([serverT(lang, 'mail.due'), esc(card.due)]);
        if (card.assignees && card.assignees.length) {
            const names = card.assignees.map(n => {
                const u = this._userByName(n);
                return esc(u ? u.displayName : n);
            });
            rows.push([serverT(lang, 'mail.assignees'), names.join(', ')]);
        }
        if (event.detail && event.detail.by) rows.push([serverT(lang, 'mail.by'), esc(event.detail.by)]);
        if (card.description) rows.push([serverT(lang, 'mail.description'), esc(card.description).slice(0, 500)]);

        const base = this.getBaseUrl();
        // Link-Ziel je Board: 'url' = feste eigene Adresse, 'edit' = Karten-Editor, sonst Board-Ansicht (Karte hervorgehoben)
        const attr = s => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        let href = '';
        if (board.linkTarget === 'url' && board.linkUrl) {
            href = board.linkUrl;
        } else if (base && board.id && card.id) {
            const key = board.linkTarget === 'edit' ? 'card' : 'focus';
            href = `${base}/?board=${encodeURIComponent(board.id)}&${key}=${encodeURIComponent(card.id)}`;
        }
        const link = href
            ? `<p><a href="${attr(href)}" style="color:${accent}">${serverT(lang, 'mail.openCard')}</a></p>`
            : '';

        return `<div style="font-family:sans-serif;max-width:560px">
<h2 style="color:${accent};margin-bottom:4px">${esc(label)}</h2>
<h3 style="margin-top:0">${esc(card.title)}</h3>
<table style="border-collapse:collapse">${rows.map(([k, v]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#777">${k}</td><td style="padding:2px 0">${v}</td></tr>`).join('')}
</table>
${link}
<p style="color:#999;font-size:12px">ioBroker Kanban · ${esc(event.ts)}</p>
</div>`;
    }

    // ------------------------------------------------------------ Webhooks ausgehend

    async _sendWebhooks(event) {
        const hooks = (this.adapter.config.outboundWebhooks || []).filter(h =>
            h && h.enabled !== false && h.url && this._matchesEvents(h.events, event.event));
        for (const hook of hooks) {
            this._post(hook, event).catch(e =>
                this.adapter.log.warn(`Webhook '${hook.name || hook.url}' fehlgeschlagen: ${e.message}`));
        }
    }

    _matchesEvents(eventsCfg, type) {
        const s = String(eventsCfg || '*').trim();
        if (!s || s === '*') return true;
        return s.split(/[\s,;]+/).includes(type);
    }

    async _post(hook, event, isRetry) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
            const res = await fetch(hook.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(event),
                signal: controller.signal,
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.adapter.log.debug(`Webhook '${hook.name || hook.url}' → ${event.event} OK`);
        } catch (e) {
            if (!isRetry) {
                await new Promise(r => setTimeout(r, 2000));
                return this._post(hook, event, true);
            }
            throw e;
        } finally {
            clearTimeout(timer);
        }
    }
}

module.exports = { Notifier };
