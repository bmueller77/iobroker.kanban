// Board-Rendering + SortableJS-Drag&Drop

import { t } from './i18n.js';

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
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
        return img;
    }
    const a = el('span', 'avatar', initials(label));
    a.style.background = (u && u.color) || '#888';
    a.title = label;
    return a;
}

function todayStr(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dueBadge(due, dueTime, done) {
    const b = el('span', 'badge date-badge');
    const [, m, d] = due.split('-');
    b.textContent = `\u{1F4C5} ${d}.${m}.` + (dueTime ? ` ${dueTime}` : '');
    if (done) b.classList.add('due-done');            // erledigt → grün, keine Überfällig-Warnung
    else if (due < todayStr()) b.classList.add('due-overdue');
    else if (due <= todayStr(1)) b.classList.add('due-soon');
    return b;
}

/** Icon je Linkart (Muster: Link-Button der Lovelace-ToDo-Karte,
 *  hier mit typabhängigen Icons im Emoji-Stil der App) */
function linkIcon(url) {
    const u = String(url || '').toLowerCase();
    if (u.startsWith('mailto:')) return '✉️';                          // E-Mail
    if (u.startsWith('tel:')) return '\u{1F4DE}';                                // Telefon
    if (/youtube\.com|youtu\.be/.test(u)) return '▶️';                 // Video
    if (/\.pdf(\?|#|$)/.test(u)) return '\u{1F4C4}';                             // PDF
    if (/\.(jpe?g|png|gif|webp|svg)(\?|#|$)/.test(u)) return '\u{1F5BC}️';  // Bild
    if (/waze\.com|\/maps\/dir\/|[?&]daddr=/.test(u)) return '\u{1F697}';        // Route/Navigation (Waze, Maps-Route)
    if (/maps\.google|google\.[a-z.]+\/maps|maps\.apple\.com|openstreetmap|^geo:/.test(u)) return '\u{1F4CD}'; // Karte/Ort
    if (/^https?:\/\/(172\.30\.|192\.168\.|10\.|localhost|127\.)/.test(u)) return '\u{1F3E0}'; // intern
    return '\u{1F517}';                                                          // Standard-Link
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
    if (card.color) c.style.borderLeftColor = card.color;
    c.appendChild(el('div', 'title', card.title));

    const col = (board.columns || []).find(x => x.id === card.columnId);
    const isDone = !!(col && col.isDone);

    const badges = el('div', 'badges');
    if (card.priority > 0) {
        badges.appendChild(el('span', `badge prio-${card.priority}`, card.priority === 2 ? '!!' : '!'));
    }
    if (card.due) badges.appendChild(dueBadge(card.due, card.dueTime, isDone));
    if (card.checklist && card.checklist.length) {
        const done = card.checklist.filter(i => i.done).length;
        badges.appendChild(el('span', 'badge', `✓ ${done}/${card.checklist.length}`));
    }
    if (card.description) badges.appendChild(el('span', 'badge', '≡'));
    if (card.recurrence && card.recurrence.type && card.recurrence.type !== 'none') {
        const rb = el('span', 'badge', '\u{1F501}');   // 🔁 wiederkehrend
        rb.title = t('badge.recurring');
        badges.appendChild(rb);
    }
    if (card.link) {
        const href = safeHref(card.link);
        // klickbares Link-Badge nur bei sicherem Schema; sonst nicht-klickbarer Hinweis
        const lb = href
            ? el('a', 'badge link-badge', linkIcon(card.link))
            : el('span', 'badge link-badge', linkIcon(card.link));
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
        const loc = el('span', 'badge', '\u{1F4CD} ' + short);
        loc.title = card.location;
        badges.appendChild(loc);
    }
    for (const lid of card.labels || []) {
        const label = (board.labels || []).find(l => l.id === lid);
        if (!label) continue;
        const pill = el('span', 'label-pill', label.title);
        pill.style.background = label.color || '#888';
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
        const toggle = el('button', 'card-check-toggle', checkExpanded.has(card.id) ? '▴' : '▾');
        toggle.type = 'button';
        toggle.title = t('card.checklistToggle');
        toggle.addEventListener('click', ev => {
            ev.stopPropagation();
            const expand = clist.hidden;
            clist.hidden = !expand;
            toggle.textContent = expand ? '▴' : '▾';
            if (expand) checkExpanded.add(card.id); else checkExpanded.delete(card.id);
        });
        c.appendChild(toggle);
        c.appendChild(clist);
    }

    c.addEventListener('click', () => actions.openCard(card.id));
    return c;
}

export function renderBoard(container, state, actions) {
    container.textContent = '';
    const board = state.board;
    if (!board) {
        container.appendChild(el('div', 'empty', t('board.empty')));
        return;
    }

    for (const col of board.columns) {
        if (state.columnsFilter && !state.columnsFilter.includes(col.id)) continue;
        const colEl = el('div', 'column');
        colEl.dataset.colId = col.id;

        let cards = board.cards
            .filter(c => c.columnId === col.id)
            .sort((a, b) => a.order - b.order);
        if (state.filterActive && state.user) {
            cards = cards.filter(c => (c.assignees || []).includes(state.user));
        }
        if (state.usersFilter && state.usersFilter.length) {
            cards = cards.filter(c => (c.assignees || []).some(a => state.usersFilter.includes(a)));
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

        const head = el('div', 'column-head');
        head.appendChild(el('span', null, col.title));
        const allInCol = board.cards.filter(c => c.columnId === col.id).length;
        // Bei aktivem Personen-/Label-Filter zählt die Kopfzeile die gefilterten (sichtbaren) Karten
        const anyFilter = (state.filterActive && state.user) || (state.usersFilter && state.usersFilter.length) || (state.labelFilter && state.labelFilter.length);
        const count = el('span', 'count', (!anyFilter && col.wipLimit > 0) ? `${allInCol}/${col.wipLimit}` : String(anyFilter ? matchedCount : allInCol));
        head.appendChild(count);
        if (col.wipLimit > 0 && allInCol > col.wipLimit) colEl.classList.add('over-wip');

        // Erledigt-Spalte: Auge-Toggle rechts oben (blendet erledigte Karten ein/aus)
        const isDoneCol = !!col.isDone;
        if (isDoneCol) {
            const eye = el('button', 'col-toggle' + (state.showDone ? '' : ' off'), '\u{1F441}');
            eye.title = state.showDone ? t('col.hideDone') : t('col.showDone');
            eye.setAttribute('aria-label', eye.title);
            eye.addEventListener('click', () => actions.toggleShowDone());
            head.appendChild(eye);
        }
        colEl.appendChild(head);

        const list = el('div', 'cards');
        const hideCards = isDoneCol && !state.showDone;
        if (!hideCards) {
            for (const card of cards) list.appendChild(renderCard(state, board, card, actions));
        }
        colEl.appendChild(list);

        const foot = el('div', 'column-foot');
        const addBtn = el('button', 'linkbtn', t('board.addCard'));
        addBtn.addEventListener('click', () => actions.openCard(null, col.id));
        foot.appendChild(addBtn);
        colEl.appendChild(foot);

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
