'use strict';

/**
 * Datenhaltung: alle Boards im RAM, Primärspeicher ist je Board der JSON-State
 * kanban.0.boards.<boardId>.data. Jede Mutation erhöht board.rev und schreibt
 * debounced (500 ms) in die States. Spiegel-States (cardCount, overdueCount,
 * users.<name>.*) werden bei jeder Mutation und vom Scheduler aktualisiert.
 */

const holidays = require('./holidays');
const { serverT } = require('./i18n-server');

const CARD_FIELDS = ['title', 'description', 'assignees', 'due', 'dueTime', 'labels', 'color', 'priority', 'checklist', 'link', 'location', 'calendarInvite', 'recurrence'];

// ---------------------------------------------------------------- Wiederholung
// recurrence = { type, dayOfWeek:[1..7], dayOfMonth:1..31, month:1..12,
//                interval:N, startDate:'YYYY-MM-DD',
//                ordinal:1..5|-1, workdayPos:'first'|'last'|'nth'|'nth_last', n:N }
// Analog zur Lovelace-ToDo-Karte, erweitert um:
//  - monthly_weekday: n-ter (oder letzter) Wochentag im Monat (z.B. 2. Dienstag)
//  - workday: erster/letzter/n-ter Arbeitstag im Monat (Feiertage via holidays.js)
// Beim Erledigen einer wiederkehrenden Karte wird eine frische Karte mit dem
// naechsten Faelligkeitsdatum erzeugt.
function isoWeekday(d) { return d.getDay() === 0 ? 7 : d.getDay(); }
function daysInMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
function parseDateStr(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}
function fmtDateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function recMatches(rec, d) {
    switch (rec.type) {
        case 'daily': return true;
        case 'weekly': {
            const days = (rec.dayOfWeek && rec.dayOfWeek.length) ? rec.dayOfWeek : [1];
            return days.includes(isoWeekday(d));
        }
        case 'monthly': {
            const dom = rec.dayOfMonth || 1;
            return d.getDate() === Math.min(dom, daysInMonth(d));   // 31. -> letzter Tag kurzer Monate
        }
        case 'yearly':
            return (d.getMonth() + 1) === (rec.month || 1) &&
                   d.getDate() === Math.min(rec.dayOfMonth || 1, daysInMonth(d));
        case 'every_n_days': {
            const n = Math.max(1, Number(rec.interval) || 1);
            const start = parseDateStr(rec.startDate) || new Date();
            const diff = Math.round((d - start) / 86400000);
            return diff >= 0 && diff % n === 0;
        }
        case 'monthly_weekday': {
            // n-ter (oder letzter) Wochentag im Monat, z.B. 2. Dienstag / letzter Freitag
            const wd = rec.dayOfWeek && rec.dayOfWeek.length ? rec.dayOfWeek[0] : 1;
            if (isoWeekday(d) !== wd) return false;
            const ordinal = Number(rec.ordinal) || 1;
            if (ordinal === -1) return d.getDate() + 7 > daysInMonth(d);   // letzter dieses Wochentags
            return Math.ceil(d.getDate() / 7) === ordinal;
        }
        case 'workday': {
            // erster/letzter/n-ter Arbeitstag im Monat (Wochenende + Feiertage übersprungen)
            if (!holidays.isWorkday(d)) return false;
            const pos = rec.workdayPos || 'first';
            const n = Math.max(1, Number(rec.n) || 1);
            if (pos === 'first') return workdayIndex(d, true) === 1;
            if (pos === 'last') return workdayIndex(d, false) === 1;
            if (pos === 'nth') return workdayIndex(d, true) === n;
            if (pos === 'nth_last') return workdayIndex(d, false) === n;
            return false;
        }
        default: return false;
    }
}
// Position des Arbeitstags d im Monat: fromStart -> von vorn (1=erster),
// sonst von hinten (1=letzter). Zählt nur Arbeitstage.
function workdayIndex(d, fromStart) {
    const dim = daysInMonth(d);
    const day = d.getDate();
    let idx = 0;
    if (fromStart) {
        for (let x = 1; x <= day; x++) {
            const c = new Date(d.getFullYear(), d.getMonth(), x, 12, 0, 0, 0);
            if (holidays.isWorkday(c)) idx++;
        }
    } else {
        for (let x = dim; x >= day; x--) {
            const c = new Date(d.getFullYear(), d.getMonth(), x, 12, 0, 0, 0);
            if (holidays.isWorkday(c)) idx++;
        }
    }
    return idx;
}
/** Nächstes Fälligkeitsdatum STRIKT nach afterStr (bzw. heute). '' wenn keins. */
function nextDue(rec, afterStr) {
    if (!rec || !rec.type || rec.type === 'none') return '';
    const base = parseDateStr(afterStr) || new Date();
    for (let i = 1; i <= 800; i++) {
        const d = new Date(base.getTime());
        d.setDate(d.getDate() + i);
        if (recMatches(rec, d)) return fmtDateStr(d);
    }
    return '';
}
/** Erstes Fälligkeitsdatum AB fromStr (heute inklusive). '' wenn keins.
 *  Für neu angelegte wiederkehrende Karten ohne manuelles Datum. */
function firstDue(rec, fromStr) {
    if (!rec || !rec.type || rec.type === 'none') return '';
    const base = parseDateStr(fromStr) || new Date();
    for (let i = 0; i <= 800; i++) {
        const d = new Date(base.getTime());
        d.setDate(d.getDate() + i);
        if (recMatches(rec, d)) return fmtDateStr(d);
    }
    return '';
}
const PERSIST_DEBOUNCE_MS = 500;

function slugify(text) {
    const s = String(text || '').toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return s || 'board';
}

function genId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Nur valides ISO-Datum (YYYY-MM-DD) bzw. Uhrzeit (HH:MM) übernehmen, sonst ''.
// Schützt Overdue-Vergleich (String-Vergleich) und die ICS-Erzeugung vor krummen Eingaben aus der API.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
function cleanDate(s) { s = String(s == null ? '' : s); return DATE_RE.test(s) ? s : ''; }
function cleanTime(s) { s = String(s == null ? '' : s); return TIME_RE.test(s) ? s : ''; }

class Store {
    /**
     * @param adapter ioBroker-Adapter
     * @param bus EventBus aus events.js
     */
    constructor(adapter, bus) {
        this.adapter = adapter;
        this.bus = bus;
        this.boards = new Map();          // boardId -> Board-Objekt
        this._persistTimers = new Map();  // boardId -> Timeout
        this._knownUserStates = new Set();
        this.onChange = null;             // (boardId, rev) => void — für WS-Broadcast
    }

    // ------------------------------------------------------------ Laden

    async load() {
        const states = await this.adapter.getStatesAsync('boards.*.data');
        for (const [fullId, state] of Object.entries(states || {})) {
            if (!state || !state.val) continue;
            try {
                const board = JSON.parse(state.val);
                if (board && board.id) {
                    this.boards.set(board.id, this._normalizeBoard(board));
                }
            } catch (e) {
                this.adapter.log.warn(`Board-State ${fullId} enthält kein gültiges JSON: ${e.message}`);
            }
        }
        this.adapter.log.info(`${this.boards.size} Board(s) geladen`);
        await this.updateMirrors();
    }

    _normalizeBoard(board) {
        board.columns = Array.isArray(board.columns) ? board.columns : [];
        board.cards = Array.isArray(board.cards) ? board.cards : [];
        board.labels = Array.isArray(board.labels) ? board.labels : [];
        board.members = Array.isArray(board.members) ? board.members : [];
        board.linkTarget = board.linkTarget || 'board';
        board.linkUrl = board.linkUrl || '';
        board.rev = Number(board.rev) || 0;
        for (const c of board.cards) {
            c.assignees = Array.isArray(c.assignees) ? c.assignees : [];
            c.labels = Array.isArray(c.labels) ? c.labels : [];
            c.checklist = Array.isArray(c.checklist) ? c.checklist : [];
        }
        return board;
    }

    // ------------------------------------------------------------ Hilfen

    listBoards() {
        return [...this.boards.values()].map(b => ({
            id: b.id,
            title: b.title,
            rev: b.rev,
            cardCount: b.cards.length,
            members: Array.isArray(b.members) ? b.members : [],
        }));
    }

    getBoard(id) {
        return this.boards.get(id) || null;
    }

    _requireBoard(id) {
        const b = this.boards.get(id);
        if (!b) throw new Error(`Board '${id}' existiert nicht`);
        return b;
    }

    _boardRef(b) {
        return { id: b.id, title: b.title, linkTarget: b.linkTarget || 'board', linkUrl: b.linkUrl || '' };
    }

    _isDoneColumn(board, columnId) {
        const col = board.columns.find(c => c.id === columnId);
        return !!(col && col.isDone);
    }

    /** Mutation ausführen: rev++, persistieren, Spiegel-States, onChange-Callback. */
    _mutate(board, fn) {
        const result = fn(board);
        board.rev++;
        this._schedulePersist(board.id);
        this.updateMirrors().catch(e => this.adapter.log.error(`Spiegel-States: ${e.message}`));
        if (this.onChange) this.onChange(board.id, board.rev);
        return result;
    }

    // ------------------------------------------------------------ Board-CRUD

    async createBoard({ id, title }) {
        if (!title) throw new Error('title fehlt');
        let boardId = slugify(id || title);
        let n = 2;
        while (this.boards.has(boardId)) boardId = `${slugify(id || title)}-${n++}`;
        const board = {
            id: boardId,
            title: String(title),
            rev: 1,
            columns: [
                { id: 'todo', title: serverT(this.adapter._language, 'col.todo'), wipLimit: 0, isDone: false },
                { id: 'doing', title: serverT(this.adapter._language, 'col.doing'), wipLimit: 0, isDone: false },
                { id: 'done', title: serverT(this.adapter._language, 'col.done'), wipLimit: 0, isDone: true },
            ],
            cards: [],
            labels: [],
            members: [],
            linkTarget: 'board',
            linkUrl: '',
        };
        this.boards.set(boardId, board);
        await this._ensureBoardObjects(boardId, board.title);
        this._schedulePersist(boardId);
        if (this.onChange) this.onChange(boardId, board.rev);
        return board;
    }

    /** Titel/Spalten/Labels ändern (partiell). */
    updateBoard(boardId, patch) {
        const board = this._requireBoard(boardId);
        return this._mutate(board, b => {
            if (patch.title !== undefined) b.title = String(patch.title);
            if (patch.linkTarget !== undefined) b.linkTarget = ['edit', 'board', 'url'].includes(patch.linkTarget) ? patch.linkTarget : 'board';
            if (patch.linkUrl !== undefined) b.linkUrl = String(patch.linkUrl || '');
            if (Array.isArray(patch.labels)) b.labels = patch.labels;
            if (Array.isArray(patch.members)) b.members = patch.members.filter(x => typeof x === 'string');
            if (Array.isArray(patch.columns)) {
                // Spalten ersetzen; Karten aus gelöschten Spalten in die erste Spalte schieben
                const newIds = new Set(patch.columns.map(c => c.id));
                b.columns = patch.columns.map(c => ({
                    id: c.id || genId('col'),
                    title: String(c.title || '?'),
                    maxVisible: Number(c.maxVisible) || 0,
                    wipLimit: Number(c.wipLimit) || 0,
                    isDone: !!c.isDone,
                    allowAdd: !!c.allowAdd,
                }));
                const fallback = b.columns[0] && b.columns[0].id;
                if (fallback) {
                    for (const card of b.cards) {
                        if (!newIds.has(card.columnId)) card.columnId = fallback;
                    }
                }
            }
            return b;
        });
    }

    async deleteBoard(boardId) {
        this._requireBoard(boardId);
        this.boards.delete(boardId);
        const t = this._persistTimers.get(boardId);
        if (t) { clearTimeout(t); this._persistTimers.delete(boardId); }
        await this.adapter.delObjectAsync(`boards.${boardId}`, { recursive: true });
        await this.updateMirrors();
        if (this.onChange) this.onChange(boardId, -1);
    }

    // ------------------------------------------------------------ Karten-CRUD

    addCard(boardId, data, source) {
        const board = this._requireBoard(boardId);
        if (!data || !data.title) throw new Error('title fehlt');
        const columnId = data.columnId && board.columns.some(c => c.id === data.columnId)
            ? data.columnId
            : (board.columns[0] && board.columns[0].id);
        if (!columnId) throw new Error('Board hat keine Spalten');
        const card = {
            id: genId('c'),
            columnId,
            order: board.cards.filter(c => c.columnId === columnId).length,
            title: String(data.title),
            description: String(data.description || ''),
            assignees: Array.isArray(data.assignees) ? data.assignees : [],
            due: cleanDate(data.due),
            dueTime: (cleanDate(data.due) && cleanTime(data.dueTime)) ? cleanTime(data.dueTime) : '',
            labels: Array.isArray(data.labels) ? data.labels : [],
            color: data.color || '',
            priority: Number(data.priority) || 0,
            checklist: Array.isArray(data.checklist) ? data.checklist : [],
            link: data.link || '',
            location: data.location || '',
            calendarInvite: !!data.calendarInvite,
            recurrence: (data.recurrence && data.recurrence.type && data.recurrence.type !== 'none') ? data.recurrence : null,
            createdAt: new Date().toISOString(),
            createdBy: data.createdBy || source || '',
            movedAt: null,
            doneAt: null,
            lastReminderAt: null,
        };
        // Wiederkehrende Karte ohne manuelles Datum: nächstes passendes Datum setzen
        if (card.recurrence && !card.due) card.due = firstDue(card.recurrence, todayStr());
        this._mutate(board, b => b.cards.push(card));
        this.bus.emitEvent('cardCreated', { board: this._boardRef(board), card, detail: { by: card.createdBy } });
        for (const a of card.assignees) {
            this.bus.emitEvent('cardAssigned', { board: this._boardRef(board), card, detail: { assignee: a, by: card.createdBy } });
        }
        return card;
    }

    updateCard(boardId, cardId, patch, source) {
        const board = this._requireBoard(boardId);
        const card = board.cards.find(c => c.id === cardId);
        if (!card) throw new Error(`Karte '${cardId}' existiert nicht`);
        const oldAssignees = new Set(card.assignees);
        this._mutate(board, () => {
            for (const f of CARD_FIELDS) {
                if (patch[f] !== undefined) card[f] = patch[f];
            }
            card.assignees = Array.isArray(card.assignees) ? card.assignees : [];
            // Datum/Uhrzeit nach dem generischen Patch validieren (API kann Rohwerte setzen)
            card.due = cleanDate(card.due);
            card.dueTime = (card.due && cleanTime(card.dueTime)) ? cleanTime(card.dueTime) : '';
            // recurrence normalisieren + fehlendes Datum für Wiederholung nachziehen
            if (card.recurrence && (!card.recurrence.type || card.recurrence.type === 'none')) card.recurrence = null;
            if (card.recurrence && !card.due) card.due = firstDue(card.recurrence, todayStr());
        });
        const by = patch.by || source || '';
        this.bus.emitEvent('cardUpdated', { board: this._boardRef(board), card, detail: { by } });
        for (const a of card.assignees) {
            if (!oldAssignees.has(a)) {
                this.bus.emitEvent('cardAssigned', { board: this._boardRef(board), card, detail: { assignee: a, by } });
            }
        }
        return card;
    }

    moveCard(boardId, cardId, columnId, order, source) {
        const board = this._requireBoard(boardId);
        const card = board.cards.find(c => c.id === cardId);
        if (!card) throw new Error(`Karte '${cardId}' existiert nicht`);
        if (!board.columns.some(c => c.id === columnId)) throw new Error(`Spalte '${columnId}' existiert nicht`);
        const fromColumn = card.columnId;
        const wasDone = this._isDoneColumn(board, fromColumn);
        const isDone = this._isDoneColumn(board, columnId);

        this._mutate(board, b => {
            card.columnId = columnId;
            card.movedAt = new Date().toISOString();
            // Zielspalte neu durchnummerieren, Karte an gewünschter Position einsortieren
            const targetCards = b.cards
                .filter(c => c.columnId === columnId && c.id !== cardId)
                .sort((x, y) => x.order - y.order);
            const idx = order === undefined || order === null
                ? targetCards.length
                : Math.max(0, Math.min(Number(order), targetCards.length));
            targetCards.splice(idx, 0, card);
            targetCards.forEach((c, i) => { c.order = i; });
            // Quellspalte kompaktieren
            b.cards.filter(c => c.columnId === fromColumn && fromColumn !== columnId)
                .sort((x, y) => x.order - y.order)
                .forEach((c, i) => { c.order = i; });
            card.doneAt = isDone ? (card.doneAt || new Date().toISOString()) : null;
        });

        const by = source || '';
        if (fromColumn !== columnId) {
            this.bus.emitEvent('cardMoved', { board: this._boardRef(board), card, detail: { fromColumn, toColumn: columnId, by } });
            if (isDone && !wasDone) {
                this.bus.emitEvent('cardDone', { board: this._boardRef(board), card, detail: { fromColumn, by } });
                this._spawnRecurrence(board, card, by);
            }
        }
        return card;
    }

    /** Beim Erledigen einer wiederkehrenden Karte: frische Instanz in der ersten
     *  offenen Spalte mit dem nächsten Fälligkeitsdatum erzeugen. Die Wiederholung
     *  wandert auf die neue Karte (die erledigte wird zur einmaligen Karte). */
    _spawnRecurrence(board, doneCard, by) {
        const rec = doneCard.recurrence;
        if (!rec || !rec.type || rec.type === 'none') return;
        const nd = nextDue(rec, doneCard.due || todayStr());
        if (!nd) return;
        const firstCol = board.columns.find(c => !c.isDone) || board.columns[0];
        if (!firstCol) return;
        const fresh = {
            id: genId('c'),
            columnId: firstCol.id,
            order: 0,
            title: doneCard.title,
            description: doneCard.description,
            assignees: [...(doneCard.assignees || [])],
            due: nd,
            labels: [...(doneCard.labels || [])],
            color: doneCard.color || '',
            priority: Number(doneCard.priority) || 0,
            checklist: (doneCard.checklist || []).map(i => ({ ...i, done: false })),
            link: doneCard.link || '',
            recurrence: rec,
            createdAt: new Date().toISOString(),
            createdBy: by || 'recurrence',
            movedAt: null, doneAt: null, lastReminderAt: null,
        };
        doneCard.recurrence = null;   // erledigte Karte nicht erneut spawnen lassen
        this._mutate(board, b => {
            b.cards.forEach(c => { if (c.columnId === firstCol.id) c.order += 1; });
            b.cards.push(fresh);
        });
        this.bus.emitEvent('cardCreated', { board: this._boardRef(board), card: fresh, detail: { by: fresh.createdBy, recurrence: true } });
        for (const a of fresh.assignees) {
            this.bus.emitEvent('cardAssigned', { board: this._boardRef(board), card: fresh, detail: { assignee: a, by: fresh.createdBy } });
        }
        this.adapter.log.info(`Wiederholung: '${fresh.title}' neu angelegt, fällig ${nd}`);
    }

    deleteCard(boardId, cardId, source) {
        const board = this._requireBoard(boardId);
        const idx = board.cards.findIndex(c => c.id === cardId);
        if (idx === -1) throw new Error(`Karte '${cardId}' existiert nicht`);
        const [card] = board.cards.splice(idx, 1);
        this._mutate(board, () => {});
        this.bus.emitEvent('cardDeleted', { board: this._boardRef(board), card, detail: { by: source || '' } });
        return card;
    }

    // ------------------------------------------------------------ Persistenz

    _schedulePersist(boardId) {
        const t = this._persistTimers.get(boardId);
        if (t) clearTimeout(t);
        this._persistTimers.set(boardId, setTimeout(() => {
            this._persistTimers.delete(boardId);
            this._persist(boardId).catch(e => this.adapter.log.error(`Persistieren von ${boardId}: ${e.message}`));
        }, PERSIST_DEBOUNCE_MS));
    }

    async _persist(boardId) {
        const board = this.boards.get(boardId);
        if (!board) return;
        await this._ensureBoardObjects(boardId, board.title);
        const today = todayStr();
        const overdue = board.cards.filter(c =>
            c.due && c.due < today && !this._isDoneColumn(board, c.columnId)).length;
        await this.adapter.setStateAsync(`boards.${boardId}.data`, JSON.stringify(board), true);
        await this.adapter.setStateChangedAsync(`boards.${boardId}.rev`, board.rev, true);
        await this.adapter.setStateChangedAsync(`boards.${boardId}.cardCount`, board.cards.length, true);
        await this.adapter.setStateChangedAsync(`boards.${boardId}.overdueCount`, overdue, true);
    }

    /** Alle offenen Persist-Timer sofort ausführen (für onUnload). */
    async flush() {
        const ids = [...this._persistTimers.keys()];
        for (const id of ids) {
            const t = this._persistTimers.get(id);
            if (t) clearTimeout(t);
            this._persistTimers.delete(id);
            await this._persist(id);
        }
    }

    async _ensureBoardObjects(boardId, title) {
        await this.adapter.setObjectNotExistsAsync(`boards.${boardId}`, {
            type: 'channel', common: { name: title }, native: {},
        });
        const stateDefs = {
            data: { name: 'Board JSON', type: 'string', role: 'json', read: true, write: false },
            rev: { name: 'Revision', type: 'number', role: 'value', read: true, write: false },
            cardCount: { name: 'Anzahl Karten', type: 'number', role: 'value', read: true, write: false },
            overdueCount: { name: 'Überfällige Karten', type: 'number', role: 'value', read: true, write: false },
        };
        for (const [suffix, common] of Object.entries(stateDefs)) {
            await this.adapter.setObjectNotExistsAsync(`boards.${boardId}.${suffix}`, {
                type: 'state', common, native: {},
            });
        }
    }

    // ------------------------------------------------------------ Spiegel-States je Benutzer

    async updateMirrors() {
        const users = (this.adapter.config.users || []).map(u => u.name).filter(Boolean);
        const today = todayStr();
        for (const name of users) {
            let assigned = 0;
            let overdue = 0;
            const overdueList = [];
            for (const board of this.boards.values()) {
                for (const card of board.cards) {
                    if (!card.assignees.includes(name)) continue;
                    if (this._isDoneColumn(board, card.columnId)) continue;
                    assigned++;
                    if (card.due && card.due < today) {
                        overdue++;
                        const col = board.columns.find(c => c.id === card.columnId);
                        overdueList.push(`${card.title} (${board.title}/${col ? col.title : '?'})`);
                    }
                }
            }
            await this._ensureUserObjects(name);
            await this.adapter.setStateChangedAsync(`users.${name}.assignedCount`, assigned, true);
            await this.adapter.setStateChangedAsync(`users.${name}.overdueCount`, overdue, true);
            await this.adapter.setStateChangedAsync(`users.${name}.overdueList`, JSON.stringify(overdueList), true);
        }
    }

    async _ensureUserObjects(name) {
        if (this._knownUserStates.has(name)) return;
        this._knownUserStates.add(name);
        await this.adapter.setObjectNotExistsAsync(`users.${name}`, {
            type: 'channel', common: { name }, native: {},
        });
        const defs = {
            assignedCount: { name: 'Zugewiesene offene Karten', type: 'number', role: 'value', read: true, write: false },
            overdueCount: { name: 'Überfällige Karten', type: 'number', role: 'value', read: true, write: false },
            overdueList: { name: 'Überfällige Karten (Liste)', type: 'string', role: 'json', read: true, write: false },
        };
        for (const [suffix, common] of Object.entries(defs)) {
            await this.adapter.setObjectNotExistsAsync(`users.${name}.${suffix}`, {
                type: 'state', common, native: {},
            });
        }
    }
}

module.exports = { Store, todayStr, nextDue, recMatches };
