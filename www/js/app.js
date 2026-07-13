// Bootstrap: Konfiguration laden, URL-Parameter, Theme, Live-Sync, Aktionen

import { api, liveSync } from './api.js';
import { renderBoard, userAvatar } from './board.js';
import { initDialogs } from './dialogs.js';
import { initI18n, applyStatic, t } from './i18n.js';

const qs = new URLSearchParams(location.search);

const state = {
    users: [],
    boards: [],
    board: null,
    avatarVer: 0,   // Cache-Bust für Avatar-Bilder
    user: qs.get('user') || localStorage.getItem('kanban.user') || '',
    filterActive: qs.get('filter') === '1',
    labelFilter: qs.get('label') ? qs.get('label').split(',').filter(Boolean) : null,
    usersFilter: qs.get('users') ? qs.get('users').split(',').filter(Boolean) : null,
    columnsFilter: qs.get('columns') ? qs.get('columns').split(',').filter(Boolean) : null,
    doneLimit: qs.has('doneLimit') ? Math.max(0, parseInt(qs.get('doneLimit'), 10) || 0) : null,   // null = alle, 0 = keine
    hideSettings: qs.get('hideSettings') === '1',
    hideFilter: qs.get('hideFilter') === '1',
    showDone: localStorage.getItem('kanban.showDone') !== '0',   // erledigte Spalten ein-/ausblenden
    theme: qs.get('theme') || localStorage.getItem('kanban.theme') || '',
    accent: qs.get('accent') || '',
    embed: qs.get('embed') === '1',
};

// ------------------------------------------------------------ Theme

function applyTheme(cfg) {
    const theme = state.theme || cfg.themeDefault || 'auto';
    const resolved = theme === 'auto'
        ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : theme;
    document.documentElement.dataset.theme = resolved;
    const accent = state.accent || cfg.accentColor;
    if (accent) document.documentElement.style.setProperty('--accent', accent);
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
    for (const u of state.users) {
        const chip = document.createElement('span');
        chip.className = 'user-chip' + (state.user === u.name ? ' active' : '');
        chip.appendChild(userAvatar(state, u.name));
        const nm = document.createElement('span');
        nm.textContent = u.displayName;
        chip.appendChild(nm);
        chip.addEventListener('click', () => {
            state.user = state.user === u.name ? '' : u.name;
            localStorage.setItem('kanban.user', state.user);
            render();
        });
        chips.appendChild(chip);
    }

    document.getElementById('filterBtn').classList.toggle('active', state.filterActive);
}

async function loadBoards() {
    state.boards = await api('api/boards');
}

async function loadBoard(id, force) {
    if (!id) { state.board = null; render(); return; }
    if (!force && state.board && state.board.id === id) return;
    state.board = await api(`api/boards/${encodeURIComponent(id)}`);
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
        data.by = state.user;
        data.createdBy = state.user;
        await api(`api/boards/${state.board.id}/cards`, { method: 'POST', body: data });
        await refreshCurrent();
    },

    async updateCard(cardId, data) {
        data.by = state.user;
        await api(`api/boards/${state.board.id}/cards/${cardId}`, { method: 'PATCH', body: data });
        await refreshCurrent();
    },

    async moveCard(cardId, columnId, order) {
        // optimistisch: lokal sofort umhängen, Server bestätigt via dirty/refresh
        const card = state.board.cards.find(c => c.id === cardId);
        if (card) { card.columnId = columnId; if (order !== undefined) card.order = order - 0.5; }
        try {
            await api(`api/boards/${state.board.id}/cards/${cardId}/move`, {
                method: 'POST', body: { columnId, order, by: state.user },
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
        await loadBoards();
        await loadBoard(board.id, true);
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
    document.getElementById('filterBtn').addEventListener('click', () => {
        state.filterActive = !state.filterActive;
        render();
    });
    // Per URL ausblendbare Bedienelemente (geteilte Ansichten)
    if (state.hideSettings) document.getElementById('settingsBtn').hidden = true;
    if (state.hideFilter) document.getElementById('filterBtn').hidden = true;
    document.getElementById('themeBtn').addEventListener('click', () => {
        const order = ['auto', 'light', 'dark'];
        const cur = state.theme || state.cfg.themeDefault || 'auto';
        state.theme = order[(order.indexOf(cur) + 1) % order.length];
        localStorage.setItem('kanban.theme', state.theme);
        applyTheme(state.cfg);
    });

    await loadBoards();
    const wanted = qs.get('board');
    const first = state.boards.find(b => b.id === wanted) || state.boards[0];
    await loadBoard(first && first.id, true);

    // Deep-Link auf Karte (aus E-Mail)
    const cardParam = qs.get('card');
    if (cardParam && state.board && state.board.cards.some(c => c.id === cardParam)) {
        dialogs.openCard(cardParam);
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
