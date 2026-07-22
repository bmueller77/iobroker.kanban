// Bootstrap: Konfiguration laden, URL-Parameter, Theme, Live-Sync, Aktionen

import { api, liveSync } from './api.js';
import { renderBoard, userAvatar, boardUsers, contrastText, mdiIcon } from './board.js';
import { initDialogs } from './dialogs.js';
import { initI18n, applyStatic, t } from './i18n.js';

const qs = new URLSearchParams(location.search);

const state = {
    users: [],
    boards: [],
    board: null,
    avatarVer: 0,   // Cache-Bust für Avatar-Bilder
    labelFilter: qs.get('label') ? qs.get('label').split(',').filter(Boolean) : null,
    usersFilter: [],   // Mehrfach-User-Filter (Kopf-Chips); je Board aus localStorage, per URL vorbelegbar
    columnsFilter: qs.get('columns') ? qs.get('columns').split(',').filter(Boolean) : null,
    doneLimit: qs.has('doneLimit') ? Math.max(0, parseInt(qs.get('doneLimit'), 10) || 0) : null,   // null = alle, 0 = keine
    hideSettings: qs.get('hideSettings') === '1',
    showDone: localStorage.getItem('kanban.showDone') !== '0',   // erledigte Spalten ein-/ausblenden
    theme: qs.get('theme') || localStorage.getItem('kanban.theme') || '',
    accent: qs.get('accent') || '',
    embed: qs.get('embed') === '1',
    collapsedCols: new Set((localStorage.getItem('kanban.collapsedCols') || '').split(',').filter(Boolean)),
};

// ------------------------------------------------------------ Theme

const MDI_SUN = 'M3.55 19.09L4.96 20.5L6.76 18.71L5.34 17.29M12 6C8.69 6 6 8.69 6 12S8.69 18 12 18 18 15.31 18 12C18 8.68 15.31 6 12 6M20 13H23V11H20M17.24 18.71L19.04 20.5L20.45 19.09L18.66 17.29M20.45 5L19.04 3.6L17.24 5.39L18.66 6.81M13 1H11V4H13M6.76 5.39L4.96 3.6L3.55 5L5.34 6.81L6.76 5.39M1 13H4V11H1M13 20H11V23H13';
const MDI_MOON = 'M17.75,4.09L15.22,6.03L16.13,9.09L13.5,7.28L10.87,9.09L11.78,6.03L9.25,4.09L12.44,4L13.5,1L14.56,4L17.75,4.09M21.25,11L19.61,12.25L20.2,14.23L18.5,13.06L16.8,14.23L17.39,12.25L15.75,11L17.81,10.95L18.5,9L19.19,10.95L21.25,11M18.97,15.95C19.8,15.87 20.69,17.05 20.16,17.8C19.84,18.25 19.5,18.67 19.08,19.07C15.17,23 8.84,23 4.94,19.07C1.03,15.17 1.03,8.83 4.94,4.93C5.34,4.53 5.76,4.17 6.21,3.85C6.96,3.32 8.14,4.21 8.06,5.04C7.79,7.9 8.75,10.87 10.95,13.06C13.14,15.26 16.1,16.22 18.97,15.95M17.33,17.97C14.5,17.81 11.7,16.64 9.53,14.5C7.36,12.31 6.2,9.5 6.04,6.68C3.23,9.82 3.34,14.64 6.35,17.66C9.37,20.67 14.19,20.78 17.33,17.97Z';

function applyTheme(cfg) {
    const theme = state.theme || cfg.themeDefault || 'auto';
    const resolved = theme === 'auto'
        ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : theme;
    document.documentElement.dataset.theme = resolved;
    const accent = state.accent || cfg.accentColor;
    if (accent) document.documentElement.style.setProperty('--accent', accent);
    // Schriftfarbe auf Akzent-Buttons je nach Helligkeit (auch bei Custom-CSS-Akzent)
    const effAccent = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || accent || '#7E57C2').trim();
    document.documentElement.style.setProperty('--accent-text', contrastText(effAccent));
    const tbtn = document.getElementById('themeBtn');
    if (tbtn) { tbtn.textContent = ''; tbtn.appendChild(mdiIcon(resolved === 'dark' ? MDI_MOON : MDI_SUN)); }
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((state.theme || state.cfg.themeDefault || 'auto') === 'auto') applyTheme(state.cfg);
});

// ------------------------------------------------------------ Laden & Rendern

const boardEl = document.getElementById('board');
let actions; // wird unten befüllt (Dialoge brauchen actions, actions brauchen render)

function render() {
    renderBoard(boardEl, state, actions);
    renderHeader();
}

function renderHeader() {
    const sel = document.getElementById('boardSelect');
    sel.textContent = '';
    for (const b of state.boards) {
        const o = document.createElement('option');
        o.value = b.id;
        o.textContent = b.title;
        sel.appendChild(o);
    }
    if (state.board) sel.value = state.board.id;

    const chips = document.getElementById('userChips');
    chips.textContent = '';
    // Chips = Board-Mitglieder als Mehrfach-Filter (angeklickt = nur Karten dieses Users; nichts gewaehlt = alle).
    for (const u of boardUsers(state)) {
        const chip = document.createElement('span');
        const on = state.usersFilter.includes(u.name);
        chip.className = 'user-chip' + (on ? ' active' : '');
        if (u.color) chip.style.setProperty('--uc', u.color);
        chip.appendChild(userAvatar(state, u.name));
        const nm = document.createElement('span');
        nm.textContent = u.displayName;
        chip.appendChild(nm);
        chip.addEventListener('click', () => {
            const i = state.usersFilter.indexOf(u.name);
            if (i >= 0) state.usersFilter.splice(i, 1); else state.usersFilter.push(u.name);
            if (state.board) saveUserFilter(state.board.id, state.usersFilter);
            render();
        });
        chips.appendChild(chip);
    }
}

async function loadBoards() {
    state.boards = await api('api/boards');
}

function loadUserFilter(boardId) {
    const raw = localStorage.getItem('kanban.userFilter.' + boardId);
    if (raw == null) return null;   // nichts gespeichert -> Standard (alle Mitglieder)
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null; }
    catch (e) { return null; }
}
function saveUserFilter(boardId, arr) {
    try { localStorage.setItem('kanban.userFilter.' + boardId, JSON.stringify(arr)); } catch (e) { /* ignore */ }
}

async function loadBoard(id, force) {
    if (!id) { state.board = null; render(); return; }
    if (!force && state.board && state.board.id === id) return;
    state.board = await api(`api/boards/${encodeURIComponent(id)}`);
    const savedFilter = loadUserFilter(id);
    state.usersFilter = savedFilter !== null ? savedFilter : boardUsers(state).map(u => u.name);
    render();
}

async function refreshCurrent() {
    if (!state.board) return;
    const data = await api(`api/boards/${encodeURIComponent(state.board.id)}?rev=${state.board.rev}`);
    if (!data.unchanged) {
        state.board = data;
        render();
    }
}

// ------------------------------------------------------------ Aktionen (API + optimistisches Update)

actions = {
    openCard: null, // wird nach initDialogs gesetzt

    toggleShowDone() {
        state.showDone = !state.showDone;
        localStorage.setItem('kanban.showDone', state.showDone ? '1' : '0');
        render();
    },

    async avatarsChanged() {
        state.avatarVer++;
        state.cfg = await api('api/config');
        state.users = state.cfg.users || [];
        renderHeader();
        render();
    },

    async addCard(data) {
        data.by = '';
        data.createdBy = '';
        await api(`api/boards/${state.board.id}/cards`, { method: 'POST', body: data });
        await refreshCurrent();
    },

    async updateCard(cardId, data) {
        data.by = '';
        await api(`api/boards/${state.board.id}/cards/${cardId}`, { method: 'PATCH', body: data });
        await refreshCurrent();
    },

    async moveCard(cardId, columnId, order) {
        // optimistisch: lokal sofort umhängen, Server bestätigt via dirty/refresh
        const card = state.board.cards.find(c => c.id === cardId);
        if (card) { card.columnId = columnId; if (order !== undefined) card.order = order - 0.5; }
        try {
            await api(`api/boards/${state.board.id}/cards/${cardId}/move`, {
                method: 'POST', body: { columnId, order, by: '' },
            });
        } catch (e) {
            alert(t('error.moveFailed', { msg: e.message }));
        }
        await refreshCurrent();
    },

    async deleteCard(cardId) {
        await api(`api/boards/${state.board.id}/cards/${cardId}`, { method: 'DELETE' });
        await refreshCurrent();
    },

    async patchBoard(patch) {
        await api(`api/boards/${state.board.id}`, { method: 'PATCH', body: patch });
        await loadBoards();
        await refreshCurrent();
    },

    async createBoard(title) {
        const board = await api('api/boards', { method: 'POST', body: { title } });
        // Neues Board: standardmaessig alle bekannten Benutzer als Mitglieder
        if ((state.users || []).length) {
            await api(`api/boards/${encodeURIComponent(board.id)}`, { method: 'PATCH', body: { members: state.users.map(u => u.name) } });
        }
        await loadBoards();
        await loadBoard(board.id, true);
    },

    async patchBoardById(id, patch) {
        await api(`api/boards/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
        await loadBoards();
    },

    async deleteBoard(id) {
        await api(`api/boards/${encodeURIComponent(id)}`, { method: 'DELETE' });
        state.board = null;
        await loadBoards();
        await loadBoard(state.boards[0] && state.boards[0].id, true);
    },
};

// ------------------------------------------------------------ Init

async function init() {
    // Stale-Cache-Schutz: fehlt ein erwartetes Formularfeld, ist ein veraltetes
    // index.html gecacht (neues JS + altes HTML) → einmal frisch nachladen.
    const cf = document.getElementById('cardForm');
    if (cf && cf.elements && !cf.elements.recType) {
        if (!sessionStorage.getItem('kanban.reloaded')) {
            sessionStorage.setItem('kanban.reloaded', '1');
            location.reload();
            return;
        }
    } else {
        sessionStorage.removeItem('kanban.reloaded');   // frisches HTML → Schutz zurücksetzen
    }

    if (state.embed) document.body.classList.add('embed');

    state.cfg = await api('api/config');
    state.users = state.cfg.users || [];
    await initI18n(state.cfg.language);
    applyStatic();
    applyTheme(state.cfg);

    const dialogs = initDialogs(state, actions);
    actions.openCard = dialogs.openCard;

    document.getElementById('boardSelect').addEventListener('change', ev => loadBoard(ev.target.value, true));
    document.getElementById('addCardBtn').addEventListener('click', () => state.board && dialogs.openCard(null));
    document.getElementById('settingsBtn').addEventListener('click', () => dialogs.openBoardManager());
    document.getElementById('shareBtn').addEventListener('click', () => dialogs.openShareDialog());
    // Der fruehere „nur meine Karten"-Button entfaellt – Filtern geschieht ueber die Kopf-Chips.
    document.getElementById('filterBtn').hidden = true;
    // Per URL ausblendbare Bedienelemente (geteilte Ansichten)
    if (state.hideSettings) document.getElementById('settingsBtn').hidden = true;
    document.getElementById('themeBtn').addEventListener('click', () => {
        const order = ['auto', 'light', 'dark'];
        const cur = state.theme || state.cfg.themeDefault || 'auto';
        state.theme = order[(order.indexOf(cur) + 1) % order.length];
        localStorage.setItem('kanban.theme', state.theme);
        applyTheme(state.cfg);
    });

    // Toolbar-Icons als MDI (Monitor = Ansichten, Hell/Dunkel = Theme, Zahnrad = Einstellungen)
    const TOOLBAR_ICONS = {
        shareBtn: "M21,16H3V4H21M21,2H3C1.89,2 1,2.89 1,4V16A2,2 0 0,0 3,18H10V20H8V22H16V20H14V18H21A2,2 0 0,0 23,16V4C23,2.89 22.1,2 21,2Z",
        settingsBtn: "M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z",
    };
    for (const [id, path] of Object.entries(TOOLBAR_ICONS)) {
        const b = document.getElementById(id);
        if (b) { b.textContent = ''; b.appendChild(mdiIcon(path)); }
    }

    await loadBoards();
    const wanted = qs.get('board');
    const first = state.boards.find(b => b.id === wanted) || state.boards[0];
    await loadBoard(first && first.id, true);

    // URL-Vorbelegung des User-Filters (?users= oder ?user=) fuer das Startboard
    const urlUsers = (qs.get('users') || qs.get('user') || '').split(',').filter(Boolean);
    if (urlUsers.length && state.board) {
        state.usersFilter = urlUsers;
        saveUserFilter(state.board.id, urlUsers);
        render();
    }

    // Deep-Link auf Karte (aus E-Mail): 'card' öffnet den Editor
    const cardParam = qs.get('card');
    if (cardParam && state.board && state.board.cards.some(c => c.id === cardParam)) {
        dialogs.openCard(cardParam);
    }
    // Link-Ziel 'board': Karte im Board hervorheben statt Editor öffnen ('focus'-Parameter)
    const focusParam = qs.get('focus');
    if (focusParam && state.board && state.board.cards.some(c => c.id === focusParam)) {
        requestAnimationFrame(() => {
            const sel = (window.CSS && CSS.escape) ? CSS.escape(focusParam) : focusParam;
            const cardEl = boardEl.querySelector(`.card[data-card-id="${sel}"]`);
            if (cardEl) {
                cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                cardEl.classList.add('card-focus');
                setTimeout(() => cardEl.classList.remove('card-focus'), 3000);
            }
        });
    }

    liveSync(
        (boardId, rev) => {
            if (rev === -1) { loadBoards().then(render); return; }
            if (state.board && boardId === state.board.id && rev > state.board.rev) refreshCurrent();
            else if (!state.board) loadBoards().then(() => loadBoard(boardId, true));
            else loadBoards().then(renderHeader);
        },
        () => refreshCurrent(),
    );

    render();
}

init().catch(e => {
    // i18n ist evtl. noch nicht geladen → Fallback zweisprachig
    const label = t('error.loadFailed') === 'error.loadFailed' ? 'Fehler beim Laden / Loading failed' : t('error.loadFailed');
    const esc = String(e && e.message || e).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    boardEl.innerHTML = `<div class="empty">${label}: ${esc}</div>`;
});
