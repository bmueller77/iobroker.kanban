// Board-Rendering + SortableJS-Drag&Drop

import { t, currentLang } from './i18n.js';

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

// MDI-Icons (offizielle Pfaddaten) als Inline-SVG, faerbt sich per currentColor
const MDI_EYE = 'M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17M12,4.5C7,4.5 2.73,7.61 1,12C2.73,16.39 7,19.5 12,19.5C17,19.5 21.27,16.39 23,12C21.27,7.61 17,4.5 12,4.5Z';
const MDI_EYE_CLOSED = 'M12 17.5C8.2 17.5 4.8 15.4 3.2 12H1C2.7 16.4 7 19.5 12 19.5S21.3 16.4 23 12H20.8C19.2 15.4 15.8 17.5 12 17.5Z';
const MDI_NOTE = 'M15 3H5A2 2 0 0 0 3 5V19A2 2 0 0 0 5 21H19A2 2 0 0 0 21 19V9L15 3M19 19H5V5H14V10H19M17 14H7V12H17M14 17H7V15H14';
const MDI = {
    calendar: 'M19,19H5V8H19M16,1V3H8V1H6V3H5C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3H18V1M17,12H12V17H17V12Z',
    check: 'M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z',
    sync: 'M12,18A6,6 0 0,1 6,12C6,11 6.25,10.03 6.7,9.2L5.24,7.74C4.46,8.97 4,10.43 4,12A8,8 0 0,0 12,20V23L16,19L12,15M12,4V1L8,5L12,9V6A6,6 0 0,1 18,12C18,13 17.75,13.97 17.3,14.8L18.76,16.26C19.54,15.03 20,13.57 20,12A8,8 0 0,0 12,4Z',
    mapMarker: 'M12,11.5A2.5,2.5 0 0,1 9.5,9A2.5,2.5 0 0,1 12,6.5A2.5,2.5 0 0,1 14.5,9A2.5,2.5 0 0,1 12,11.5M12,2A7,7 0 0,0 5,9C5,14.25 12,22 12,22C12,22 19,14.25 19,9A7,7 0 0,0 12,2Z',
    email: 'M20,8L12,13L4,8V6L12,11L20,6M20,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V6C22,4.89 21.1,4 20,4Z',
    phone: 'M6.62,10.79C8.06,13.62 10.38,15.94 13.21,17.38L15.41,15.18C15.69,14.9 16.08,14.82 16.43,14.93C17.55,15.3 18.75,15.5 20,15.5A1,1 0 0,1 21,16.5V20A1,1 0 0,1 20,21A17,17 0 0,1 3,4A1,1 0 0,1 4,3H7.5A1,1 0 0,1 8.5,4C8.5,5.25 8.7,6.45 9.07,7.57C9.18,7.92 9.1,8.31 8.82,8.59L6.62,10.79Z',
    youtube: 'M10,15L15.19,12L10,9V15M21.56,7.17C21.69,7.64 21.78,8.27 21.84,9.07C21.91,9.87 21.94,10.56 21.94,11.16L22,12C22,14.19 21.84,15.8 21.56,16.83C21.31,17.73 20.73,18.31 19.83,18.56C19.36,18.69 18.5,18.78 17.18,18.84C15.88,18.91 14.69,18.94 13.59,18.94L12,19C7.81,19 5.2,18.84 4.17,18.56C3.27,18.31 2.69,17.73 2.44,16.83C2.31,16.36 2.22,15.73 2.16,14.93C2.09,14.13 2.06,13.44 2.06,12.84L2,12C2,9.81 2.16,8.2 2.44,7.17C2.69,6.27 3.27,5.69 4.17,5.44C4.64,5.31 5.5,5.22 6.82,5.16C8.12,5.09 9.31,5.06 10.41,5.06L12,5C16.19,5 18.8,5.16 19.83,5.44C20.73,5.69 21.31,6.27 21.56,7.17Z',
    pdf: 'M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3M9.5 11.5C9.5 12.3 8.8 13 8 13H7V15H5.5V9H8C8.8 9 9.5 9.7 9.5 10.5V11.5M14.5 13.5C14.5 14.3 13.8 15 13 15H10.5V9H13C13.8 9 14.5 9.7 14.5 10.5V13.5M18.5 10.5H17V11.5H18.5V13H17V15H15.5V9H18.5V10.5M12 10.5H13V13.5H12V10.5M7 10.5H8V11.5H7V10.5Z',
    image: 'M8.5,13.5L11,16.5L14.5,12L19,18H5M21,19V5C21,3.89 20.1,3 19,3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19Z',
    navigation: 'M21 3L3 10.53V11.5L9.84 14.16L12.5 21H13.46L21 3Z',
    link: 'M10.59,13.41C11,13.8 11,14.44 10.59,14.83C10.2,15.22 9.56,15.22 9.17,14.83C7.22,12.88 7.22,9.71 9.17,7.76V7.76L12.71,4.22C14.66,2.27 17.83,2.27 19.78,4.22C21.73,6.17 21.73,9.34 19.78,11.29L18.29,12.78C18.3,11.96 18.17,11.14 17.89,10.36L18.36,9.88C19.54,8.71 19.54,6.81 18.36,5.64C17.19,4.46 15.29,4.46 14.12,5.64L10.59,9.17C9.41,10.34 9.41,12.24 10.59,13.41M13.41,9.17C13.8,8.78 14.44,8.78 14.83,9.17C16.78,11.12 16.78,14.29 14.83,16.24V16.24L11.29,19.78C9.34,21.73 6.17,21.73 4.22,19.78C2.27,17.83 2.27,14.66 4.22,12.71L5.71,11.22C5.7,12.04 5.83,12.86 6.11,13.65L5.64,14.12C4.46,15.29 4.46,17.19 5.64,18.36C6.81,19.54 8.71,19.54 9.88,18.36L13.41,14.83C14.59,13.66 14.59,11.76 13.41,10.59C13,10.2 13,9.56 13.41,9.17Z',
    web: 'M16.36,14C16.44,13.34 16.5,12.68 16.5,12C16.5,11.32 16.44,10.66 16.36,10H19.74C19.9,10.64 20,11.31 20,12C20,12.69 19.9,13.36 19.74,14M14.59,19.56C15.19,18.45 15.65,17.25 15.97,16H18.92C17.96,17.65 16.43,18.93 14.59,19.56M14.34,14H9.66C9.56,13.34 9.5,12.68 9.5,12C9.5,11.32 9.56,10.65 9.66,10H14.34C14.43,10.65 14.5,11.32 14.5,12C14.5,12.68 14.43,13.34 14.34,14M12,19.96C11.17,18.76 10.5,17.43 10.09,16H13.91C13.5,17.43 12.83,18.76 12,19.96M8,8H5.08C6.03,6.34 7.57,5.06 9.4,4.44C8.8,5.55 8.35,6.75 8,8M5.08,16H8C8.35,17.25 8.8,18.45 9.4,19.56C7.57,18.93 6.03,17.65 5.08,16M4.26,14C4.1,13.36 4,12.69 4,12C4,11.31 4.1,10.64 4.26,10H7.64C7.56,10.66 7.5,11.32 7.5,12C7.5,12.68 7.56,13.34 7.64,14M12,4.03C12.83,5.23 13.5,6.57 13.91,8H10.09C10.5,6.57 11.17,5.23 12,4.03M18.92,8H15.97C15.65,6.75 15.19,5.55 14.59,4.44C16.43,5.07 17.96,6.34 18.92,8M12,2C6.47,2 2,6.5 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z',
    chevronUp: 'M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z',
    chevronDown: 'M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z',
    chevronRight: 'M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z',
};


export function mdiIcon(pathData) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    return svg;
}

// ---- Schnellablage-Ziele beim Ziehen (v.a. schmale Screens) --------------
// Beim Aufnehmen einer Karte erscheinen direkt darunter die übrigen Spalten
// als Drop-Zonen mit gestricheltem Rand, damit man ohne Quer-Scrollen ablegen
// kann. Jede Zone ist eine eigene SortableJS-Liste (group 'cards').
let quickMoveEl = null;
const checkExpanded = new Set();   // Karten-IDs mit aufgeklappter Checkliste (bleibt über Re-Renders)

function isNarrow() {
    return window.matchMedia('(max-width: 820px)').matches;
}

function buildQuickMove(evt, sourceCol, board) {
    removeQuickMove();
    const others = board.columns.filter(c => c.id !== sourceCol.id);
    if (!others.length) return;

    const rect = evt.item.getBoundingClientRect();
    const bar = el('div', 'quick-move');
    const estH = others.length * 82 + 8;
    const top = Math.min(rect.bottom + 6, window.innerHeight - estH - 8);
    bar.style.left = Math.max(4, rect.left) + 'px';
    bar.style.top = Math.max(4, top) + 'px';
    bar.style.width = rect.width + 'px';

    for (const c of others) {
        const t = el('div', 'quick-target', c.title);
        t.dataset.colId = c.id;
        bar.appendChild(t);
    }
    document.body.appendChild(bar);

    // eslint-disable-next-line no-undef
    for (const t of Array.from(bar.children)) {
        // eslint-disable-next-line no-undef
        Sortable.create(t, { group: 'cards', sort: false });
    }
    quickMoveEl = bar;
}

function removeQuickMove() {
    if (quickMoveEl) { quickMoveEl.remove(); quickMoveEl = null; }
}

function initials(name) {
    return String(name || '?').split(/[\s_-]+/).map(p => p[0] || '').join('').slice(0, 2).toUpperCase();
}

export function userAvatar(state, name) {
    const u = state.users.find(x => x.name === name);
    const label = u ? u.displayName : name;
    if (u && u.avatar) {
        const img = el('img', 'avatar avatar-img');
        img.src = `avatars/${encodeURIComponent(u.name)}?v=${state.avatarVer || 0}`;
        img.alt = label;
        img.title = label;
        if (u.color) img.style.setProperty('--uc', u.color);
        return img;
    }
    const a = el('span', 'avatar', initials(label));
    a.style.background = (u && u.color) || '#888';
    a.style.color = contrastText((u && u.color) || '#888');
    if (u && u.color) a.style.setProperty('--uc', u.color);
    a.title = label;
    return a;
}

function todayStr(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(iso, fmt) {
    const [Y, M, D] = String(iso).split('-');
    if (!Y || !M || !D) return String(iso);
    const dt = new Date(+Y, +M - 1, +D);
    const loc = currentLang() || 'en';
    const nm = (opt) => { try { return dt.toLocaleDateString(loc, opt); } catch (e) { return dt.toLocaleDateString('en', opt); } };
    const map = {
        YYYY: Y, YY: Y.slice(-2),
        MMMM: nm({ month: 'long' }), MMM: nm({ month: 'short' }), MM: M, M: String(+M),
        DD: D, D: String(+D),
        dddd: nm({ weekday: 'long' }), ddd: nm({ weekday: 'short' }),
    };
    // Moment/Day.js-Tokens, laengste Alternative zuerst; .replace scannt Ersetztes nicht erneut
    return String(fmt || 'DD.MM.').replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd/g, (tok) => map[tok]);
}
function fmtTime(hhmm, fmt) {
    if (fmt !== '12h') return String(hhmm);
    const parts = String(hhmm).split(':'); let h = +parts[0]; const m = parts[1] || '00';
    const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12;
    return `${h}:${m} ${ap}`;
}
function dueBadge(due, dueTime, done, cfg) {
    const b = el('span', 'badge date-badge');
    b.appendChild(mdiIcon(MDI.calendar));
    b.appendChild(document.createTextNode(' ' + fmtDate(due, cfg && cfg.dateFormat) + (dueTime ? ' ' + fmtTime(dueTime, cfg && cfg.timeFormat) : '')));
    if (done) b.classList.add('due-done');            // erledigt → grün, keine Überfällig-Warnung
    else if (due < todayStr()) b.classList.add('due-overdue');
    else if (due <= todayStr(1)) b.classList.add('due-soon');
    return b;
}

/** Icon je Linkart (Muster: Link-Button der Lovelace-ToDo-Karte,
 *  hier mit typabhängigen Icons im Emoji-Stil der App) */
function linkIcon(url) {
    const u = String(url || '').toLowerCase();
    if (u.startsWith('mailto:')) return MDI.email;
    if (u.startsWith('tel:')) return MDI.phone;
    if (/youtube\.com|youtu\.be/.test(u)) return MDI.youtube;
    if (/\.pdf(\?|#|$)/.test(u)) return MDI.pdf;
    if (/\.(jpe?g|png|gif|webp|svg)(\?|#|$)/.test(u)) return MDI.image;
    if (/waze\.com|\/maps\/dir\/|[?&]daddr=/.test(u)) return MDI.navigation;
    if (/maps\.google|google\.[a-z.]+\/maps|maps\.apple\.com|openstreetmap|^geo:/.test(u)) return MDI.mapMarker;
    // LAN: private Bereiche (RFC1918), Loopback, Link-Local und typische lokale Hostnamen
    if (/^https?:\/\/(10\.\d|127\.\d|169\.254\.\d|192\.168\.\d|172\.(1[6-9]|2\d|3[01])\.\d|(localhost|fritz\.box|[\w-]+\.(local|lan|home|internal|fritz\.box))([:/]|$))/.test(u)) return MDI.link;
    return MDI.web;
}

/** Nur sichere Schemata als klickbaren Link zulassen. Wehrt javascript:/data: u.ä. ab
 *  (Karten sind auch über die API beschreibbar → Link-Inhalt ist nicht vertrauenswürdig). */
function safeHref(url) {
    const u = String(url || '').trim();
    if (/^(https?:|mailto:|tel:|geo:)/i.test(u)) return u;               // erlaubte Schemata
    if (/^(\/|\.\/|\.\.\/)/.test(u)) return u;                            // relative Pfade
    if (/^[\w.-]+\.[a-z]{2,}([/:?#]|$)/i.test(u)) return 'https://' + u;  // host.tld ohne Schema
    return null;                                                          // z.B. javascript:, data:, file: verwerfen
}

function renderCard(state, board, card, actions) {
    const c = el('div', 'card');
    c.dataset.cardId = card.id;
    if (card.color) c.style.setProperty('--card-color', card.color);
    c.appendChild(el('div', 'title', card.title));

    const col = (board.columns || []).find(x => x.id === card.columnId);
    const isDone = !!(col && col.isDone);

    const badges = el('div', 'badges');
    if (card.priority > 0) {
        badges.appendChild(el('span', `badge prio-${card.priority}`, card.priority === 2 ? '!!' : '!'));
    }
    if (card.due) badges.appendChild(dueBadge(card.due, card.dueTime, isDone, state.cfg));
    if (card.checklist && card.checklist.length) {
        const done = card.checklist.filter(i => i.done).length;
        const cb = el('span', 'badge');
        cb.appendChild(mdiIcon(MDI.check));
        cb.appendChild(document.createTextNode(` ${done}/${card.checklist.length}`));
        badges.appendChild(cb);
    }
    if (card.description) {
        const nb = el('span', 'badge');
        nb.appendChild(mdiIcon(MDI_NOTE));
        nb.title = t('badge.description');
        badges.appendChild(nb);
    }
    if (card.recurrence && card.recurrence.type && card.recurrence.type !== 'none') {
        const rb = el('span', 'badge'); rb.appendChild(mdiIcon(MDI.sync));   // wiederkehrend
        rb.title = t('badge.recurring');
        badges.appendChild(rb);
    }
    if (card.link) {
        const href = safeHref(card.link);
        // klickbares Link-Badge nur bei sicherem Schema; sonst nicht-klickbarer Hinweis
        const lb = href ? el('a', 'badge link-badge') : el('span', 'badge link-badge');
        lb.appendChild(mdiIcon(linkIcon(card.link)));
        if (href) {
            lb.href = href;
            if (!/^(mailto:|tel:)/i.test(href)) { lb.target = '_blank'; lb.rel = 'noopener'; }
        }
        lb.title = card.link;
        lb.addEventListener('click', e => e.stopPropagation());
        for (const ev of ['pointerdown', 'mousedown', 'touchstart']) {
            lb.addEventListener(ev, e => e.stopPropagation());   // Drag nicht auslösen
        }
        badges.appendChild(lb);
    }
    if (card.location) {
        const short = card.location.length > 24 ? card.location.slice(0, 23) + '…' : card.location;
        const loc = el('span', 'badge');
        loc.appendChild(mdiIcon(MDI.mapMarker));
        loc.appendChild(document.createTextNode(' ' + short));
        loc.title = card.location;
        badges.appendChild(loc);
    }
    for (const lid of card.labels || []) {
        const label = (board.labels || []).find(l => l.id === lid);
        if (!label) continue;
        const pill = el('span', 'label-pill', label.title);
        pill.style.background = label.color || '#888';
        pill.style.color = contrastText(label.color || '#888');
        badges.appendChild(pill);
    }
    if (card.assignees && card.assignees.length) {
        const av = el('span', 'avatars');
        for (const a of card.assignees) av.appendChild(userAvatar(state, a));
        badges.appendChild(av);
    }
    if (badges.children.length) c.appendChild(badges);

    // Checkliste aufklappbar (nur wenn Punkte vorhanden), Chevron oben rechts
    if (card.checklist && card.checklist.length) {
        c.classList.add('has-check');
        const clist = el('div', 'card-checklist');
        clist.hidden = !checkExpanded.has(card.id);
        for (const item of card.checklist) {
            const row = el('label', 'card-check-item' + (item.done ? ' done' : ''));
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!item.done;
            cb.addEventListener('change', async ev => {
                ev.stopPropagation();
                const updated = card.checklist.map(i => (i === item ? { ...i, done: cb.checked } : i));
                await actions.updateCard(card.id, { checklist: updated });
            });
            row.append(cb, el('span', 'card-check-text', item.text));
            row.addEventListener('click', ev => ev.stopPropagation());   // Editor nicht öffnen
            clist.appendChild(row);
        }
        const toggle = el('button', 'card-check-toggle');
        const setChkIcon = (open) => { toggle.textContent = ''; toggle.appendChild(mdiIcon(open ? MDI.chevronUp : MDI.chevronDown)); };
        setChkIcon(checkExpanded.has(card.id));
        toggle.type = 'button';
        toggle.title = t('card.checklistToggle');
        toggle.addEventListener('click', ev => {
            ev.stopPropagation();
            const expand = clist.hidden;
            clist.hidden = !expand;
            setChkIcon(expand);
            if (expand) checkExpanded.add(card.id); else checkExpanded.delete(card.id);
        });
        c.appendChild(toggle);
        c.appendChild(clist);
    }

    c.addEventListener('click', () => actions.openCard(card.id));
    return c;
}

// Lesbare Schriftfarbe je nach Hintergrundhelligkeit (YIQ): hell -> schwarz, dunkel -> weiss
export function contrastText(bg) {
    const c = String(bg || '').trim();
    let r, g, b, m;
    if ((m = /^#([0-9a-f]{3})$/i.exec(c))) { r = parseInt(m[1][0] + m[1][0], 16); g = parseInt(m[1][1] + m[1][1], 16); b = parseInt(m[1][2] + m[1][2], 16); }
    else if ((m = /^#([0-9a-f]{6})$/i.exec(c))) { const n = parseInt(m[1], 16); r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255; }
    else return '#fff';
    const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);   // WCAG relative Luminanz
    return L > 0.31 ? '#000' : '#fff';
}

// Zuweisbare Benutzer des aktiven Boards: Mitglieder, sonst (leer) alle.
export function boardUsers(state) {
    const m = state.board && Array.isArray(state.board.members) ? state.board.members : [];
    return m.length ? (state.users || []).filter(u => m.includes(u.name)) : (state.users || []);
}

export function renderBoard(container, state, actions) {
    container.textContent = '';
    const board = state.board;
    if (!board) {
        container.appendChild(el('div', 'empty', t('board.empty')));
        return;
    }

    // Personen-Filter (Kopf-Chips) greift nur bei Teilauswahl:
    // alle aktiv (Standard) oder keiner aktiv => alle Karten sichtbar.
    const _allMembers = boardUsers(state).map(u => u.name);
    const _sel = (state.usersFilter || []).filter(n => _allMembers.includes(n));
    const userSel = (_sel.length > 0 && _sel.length < _allMembers.length) ? _sel : null;

    for (const col of board.columns) {
        if (state.columnsFilter && !state.columnsFilter.includes(col.id)) continue;
        const colEl = el('div', 'column');
        colEl.dataset.colId = col.id;

        let cards = board.cards
            .filter(c => c.columnId === col.id)
            .sort((a, b) => a.order - b.order);
        if (userSel) {
            cards = cards.filter(c => (c.assignees || []).some(a => userSel.includes(a)));
        }
        if (state.labelFilter && state.labelFilter.length) {
            // Blacklist: Karten mit einem dieser Labels ausblenden (neue Labels bleiben sichtbar)
            cards = cards.filter(c => !(c.labels || []).some(l => state.labelFilter.includes(l)));
        }
        // Zähler = sichtbare Karten des aktiven Filters (vor der doneLimit-Kürzung)
        const matchedCount = cards.length;
        // In Erledigt-Spalten optional nur die zuletzt erledigten N Karten zeigen
        if (col.isDone && state.doneLimit != null && cards.length > state.doneLimit) {
            cards = cards.slice()
                .sort((a, b) => (b.doneAt || b.movedAt || '').localeCompare(a.doneAt || a.movedAt || ''))
                .slice(0, state.doneLimit);
        }
        // Optionales Anzeige-Limit je Spalte (0 = alle)
        let hiddenByMax = 0;
        if (col.maxVisible > 0 && cards.length > col.maxVisible) {
            hiddenByMax = cards.length - col.maxVisible;
            cards = cards.slice(0, col.maxVisible);
        }

        const collapsed = state.collapsedCols && state.collapsedCols.has(col.id);
        if (collapsed) colEl.classList.add('collapsed');
        const head = el('div', 'column-head');
        const chev = el('span', 'col-chevron');   // nur mobil sichtbar (CSS)
        const setChev = (c) => { chev.textContent = ''; chev.appendChild(mdiIcon(c ? MDI.chevronRight : MDI.chevronDown)); };
        setChev(collapsed);
        head.appendChild(chev);
        head.appendChild(el('span', null, col.title));
        const allInCol = board.cards.filter(c => c.columnId === col.id).length;
        // Bei aktivem Personen-/Label-Filter zählt die Kopfzeile die gefilterten (sichtbaren) Karten
        const anyFilter = userSel || (state.labelFilter && state.labelFilter.length);
        const count = el('span', 'count', (!anyFilter && col.wipLimit > 0) ? `${allInCol}/${col.wipLimit}` : String(anyFilter ? matchedCount : allInCol));
        head.appendChild(count);
        if (col.wipLimit > 0 && allInCol > col.wipLimit) colEl.classList.add('over-wip');

        // Erledigt-Spalte: Auge-Toggle rechts oben (blendet erledigte Karten ein/aus)
        const isDoneCol = !!col.isDone;
        if (isDoneCol) {
            const eye = el('button', 'col-toggle' + (state.showDone ? '' : ' off'));
            eye.appendChild(mdiIcon(state.showDone ? MDI_EYE : MDI_EYE_CLOSED));
            eye.title = state.showDone ? t('col.hideDone') : t('col.showDone');
            eye.setAttribute('aria-label', eye.title);
            eye.addEventListener('click', () => actions.toggleShowDone());
            head.appendChild(eye);
        }
        // Mobil: Spaltenkopf antippen klappt die Spalte ein/aus
        head.addEventListener('click', (e) => {
            if (!window.matchMedia('(max-width: 600px)').matches) return;   // nur bei gestapelten Spalten
            if (e.target.closest('.col-toggle, button, a')) return;   // Buttons/Links im Kopf nicht abfangen
            const nowCollapsed = colEl.classList.toggle('collapsed');
            setChev(nowCollapsed);
            if (state.collapsedCols) {
                if (nowCollapsed) state.collapsedCols.add(col.id); else state.collapsedCols.delete(col.id);
                try { localStorage.setItem('kanban.collapsedCols', [...state.collapsedCols].join(',')); } catch (e2) { /* ignore */ }
            }
        });
        colEl.appendChild(head);

        const list = el('div', 'cards');
        const hideCards = isDoneCol && !state.showDone;
        if (!hideCards) {
            for (const card of cards) list.appendChild(renderCard(state, board, card, actions));
        }
        colEl.appendChild(list);
        if (hiddenByMax > 0 && !hideCards) {
            const more = el('div', 'col-more', t('board.moreCards', { n: hiddenByMax }));
            more.title = t('board.moreCardsTitle');
            colEl.appendChild(more);
        }

        const canAdd = (typeof col.allowAdd === 'boolean') ? col.allowAdd : (board.columns[0] && board.columns[0].id === col.id);
        if (canAdd) {
            const foot = el('div', 'column-foot');
            const addBtn = el('button', 'linkbtn', t('board.addCard'));
            addBtn.addEventListener('click', () => actions.openCard(null, col.id));
            foot.appendChild(addBtn);
            colEl.appendChild(foot);
        }

        container.appendChild(colEl);

        // eslint-disable-next-line no-undef
        Sortable.create(list, {
            group: 'cards',
            animation: 150,
            delay: 150,               // Touch: kurz halten zum Ziehen, damit Scrollen möglich bleibt
            delayOnTouchOnly: true,
            ghostClass: 'sortable-ghost',
            filter: '.link-badge, .card-check-toggle, .card-checklist',   // lösen kein Ziehen aus
            preventOnFilter: false,              // damit deren Klick normal durchkommt

            onStart: evt => {
                if (isNarrow()) buildQuickMove(evt, col, board);
            },
            onMove: evt => {
                if (quickMoveEl) {
                    for (const t of quickMoveEl.children) {
                        t.classList.toggle('sortable-over', t === evt.to);
                    }
                }
                return true;
            },
            onEnd: evt => {
                removeQuickMove();
                const cardId = evt.item.dataset.cardId;
                const toEl = evt.to;
                const toCol = toEl.dataset.colId || (toEl.closest('.column') && toEl.closest('.column').dataset.colId);
                if (!toCol) return;
                actions.moveCard(cardId, toCol, evt.newIndex);
            },
        });
    }
}
