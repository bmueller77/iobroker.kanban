// Karten-Dialog + Board-/Spalten-Verwaltung

import { openColorPicker } from './colorpicker.js';
import { api } from './api.js';
import { t } from './i18n.js';

const CARD_COLORS = ['', '#e57373', '#ffb74d', '#fff176', '#aed581', '#4fc3f7', '#9575cd', '#f06292', '#a1887f'];
const WEEKDAYS = [['Mo', 1], ['Di', 2], ['Mi', 3], ['Do', 4], ['Fr', 5], ['Sa', 6], ['So', 7]];

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

// Klickbarer Farb-Swatch, der den eingebetteten Colorpicker öffnet.
// Aktuelle Farbe liegt in dataset.color; onChange(col) wird live aufgerufen.
function makeColorTrigger(initial, onChange, opts = {}) {
    const t = el('span', 'cp-trigger');
    t.tabIndex = 0;
    const set = col => { t.dataset.color = col || ''; t.style.background = col || ''; t.classList.toggle('empty', !col); };
    set(initial || '');
    const open = () => openColorPicker(t, t.dataset.color, col => { set(col); if (onChange) onChange(col); },
        { presets: opts.presets || CARD_COLORS });
    t.addEventListener('click', open);
    t.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    return t;
}

function initials(name) {
    return String(name || '?').split(/[\s_-]+/).map(p => p[0] || '').join('').slice(0, 2).toUpperCase();
}

// Bilddatei quadratisch zuschneiden + auf `size` px verkleinern → PNG-Data-URL
function fileToSquareDataUrl(file, size) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(img.src);
            const c = document.createElement('canvas');
            c.width = c.height = size;
            const ctx = c.getContext('2d');
            const s = Math.min(img.width, img.height);
            ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
            resolve(c.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error('Bild konnte nicht gelesen werden'));
        img.src = URL.createObjectURL(file);
    });
}

function slugify(text) {
    return String(text || '').toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

export function initDialogs(state, actions) {
    const dlg = document.getElementById('cardDialog');
    const form = document.getElementById('cardForm');
    // Monats-Select einmalig lokalisiert befüllen (defensiv: bricht nicht die
    // ganze App ab, falls veraltetes HTML gecacht wurde und das Feld fehlt)
    const recMonthSel = form && form.elements ? form.elements.recMonth : null;
    if (recMonthSel && !recMonthSel.options.length) {
        for (let m = 1; m <= 12; m++) recMonthSel.appendChild(new Option(t('month.' + m), String(m)));
    }
    // Listener nur setzen, wenn das Feld existiert (robust gegen veraltetes HTML)
    const on = (name, ev, fn) => { const e = form.elements[name]; if (e) e.addEventListener(ev, fn); };
    let editingCardId = null;
    let selAssignees = new Set();
    let selLabels = new Set();
    let selColor = '';

    // ---------------------------------------------------------- Karten-Dialog

    function renderAssigneePick() {
        const box = document.getElementById('assigneePick');
        box.textContent = '';
        for (const u of state.users) {
            const chip = el('span', 'pick-chip', u.displayName);
            chip.style.borderColor = selAssignees.has(u.name) ? (u.color || '') : '';
            if (selAssignees.has(u.name)) chip.classList.add('selected');
            chip.addEventListener('click', () => {
                selAssignees.has(u.name) ? selAssignees.delete(u.name) : selAssignees.add(u.name);
                renderAssigneePick();
            });
            box.appendChild(chip);
        }
    }

    function renderLabelPick() {
        const box = document.getElementById('labelPick');
        box.textContent = '';
        for (const l of (state.board && state.board.labels) || []) {
            const chip = el('span', 'pick-chip', l.title);
            if (selLabels.has(l.id)) {
                chip.classList.add('selected');
                chip.style.background = l.color || '';
                chip.style.color = '#fff';
            }
            chip.addEventListener('click', () => {
                selLabels.has(l.id) ? selLabels.delete(l.id) : selLabels.add(l.id);
                renderLabelPick();
            });
            box.appendChild(chip);
        }
        const add = el('span', 'pick-chip', t('label.new'));
        add.addEventListener('click', () => showLabelCreator(box));
        box.appendChild(add);
    }

    // Inline-Mini-Form zum Anlegen eines Labels (Name + echter Colorpicker)
    function showLabelCreator(box) {
        if (box.querySelector('.label-new')) return;
        const form = el('span', 'label-new');
        const color = makeColorTrigger('#4CAF50');
        const name = document.createElement('input');
        name.type = 'text';
        name.placeholder = t('label.namePlaceholder');
        name.maxLength = 40;
        const ok = el('button', 'mini', '✓'); ok.type = 'button';
        const cancel = el('button', 'mini', '×'); cancel.type = 'button';
        const submit = async () => {
            const title = name.value.trim();
            if (!title) { name.focus(); return; }
            const id = slugify(title);
            const col = color.dataset.color || '#4CAF50';
            const existing = (state.board && state.board.labels) || [];
            const labels = existing.some(l => l.id === id)
                ? existing.map(l => l.id === id ? { ...l, title, color: col } : l)
                : [...existing, { id, title, color: col }];
            await actions.patchBoard({ labels });
            selLabels.add(id);
            renderLabelPick();
        };
        ok.addEventListener('click', submit);
        name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
        cancel.addEventListener('click', () => renderLabelPick());
        form.append(color, name, ok, cancel);
        box.insertBefore(form, box.lastChild);   // vor den "+ Neu"-Chip
        name.focus();
    }

    function renderColorPick() {
        const box = document.getElementById('colorPick');
        box.textContent = '';
        const swatches = [];
        for (const c of CARD_COLORS) {
            const sw = el('span', 'color-swatch' + (c ? '' : ' none'));
            if (c) sw.style.background = c;
            sw.dataset.color = c;
            sw.addEventListener('click', () => { selColor = c; updateSelection(); });
            box.appendChild(sw);
            swatches.push(sw);
        }
        // Freie Farbwahl (voller Farbraum) über den eigenen Colorpicker
        const custom = el('span', 'color-swatch custom');
        custom.title = t('color.own');
        custom.tabIndex = 0;
        const openCustom = () => openColorPicker(custom, selColor, col => { selColor = col; updateSelection(); }, { presets: CARD_COLORS });
        custom.addEventListener('click', openCustom);
        custom.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCustom(); } });
        box.appendChild(custom);

        function updateSelection() {
            const isCustom = selColor && !CARD_COLORS.includes(selColor);
            for (const sw of swatches) sw.classList.toggle('selected', sw.dataset.color === selColor);
            custom.classList.toggle('selected', !!isCustom);
            custom.style.background = isCustom ? selColor : '';
        }
        updateSelection();
    }

    function addCheckRow(item) {
        const box = document.getElementById('checklistEdit');
        const row = el('div', 'check-item');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!(item && item.done);
        const txt = document.createElement('input');
        txt.type = 'text';
        txt.value = (item && item.text) || '';
        txt.placeholder = t('card.checkPlaceholder');
        const rm = el('button', 'rm', '×');
        rm.type = 'button';
        rm.addEventListener('click', () => row.remove());
        row.append(cb, txt, rm);
        box.appendChild(row);
        return row;
    }

    function readChecklist() {
        return [...document.querySelectorAll('#checklistEdit .check-item')]
            .map(row => ({
                text: row.querySelector('input[type=text]').value.trim(),
                done: row.querySelector('input[type=checkbox]').checked,
            }))
            .filter(i => i.text);
    }

    function fillColumnSelect(selected) {
        const sel = form.elements.columnId;
        sel.textContent = '';
        for (const c of (state.board && state.board.columns) || []) {
            const o = document.createElement('option');
            o.value = c.id;
            o.textContent = c.title;
            sel.appendChild(o);
        }
        if (selected) sel.value = selected;
    }

    function openCard(cardId, defaultColumnId) {
        const card = cardId && state.board ? state.board.cards.find(c => c.id === cardId) : null;
        editingCardId = card ? card.id : null;
        document.getElementById('cardDialogTitle').textContent = card ? t('card.titleEdit') : t('card.titleNew');
        document.getElementById('deleteCardBtn').hidden = !card;
        form.elements.title.value = card ? card.title : '';
        form.elements.description.value = card ? card.description : '';
        form.elements.due.value = (card && card.due) || '';
        form.elements.dueTime.value = (card && card.dueTime) || '';
        form.elements.dueTimeEnabled.checked = !!(card && card.dueTime);
        updateDueTimeUI();
        form.elements.priority.value = String((card && card.priority) || 0);
        form.elements.link.value = (card && card.link) || '';
        form.elements.location.value = (card && card.location) || '';
        form.elements.calendarInvite.checked = !!(card && card.calendarInvite);
        fillColumnSelect(card ? card.columnId : defaultColumnId);
        selAssignees = new Set(card ? card.assignees : (state.user ? [state.user] : []));
        selLabels = new Set(card ? card.labels : []);
        selColor = (card && card.color) || '';
        renderAssigneePick();
        renderLabelPick();
        renderColorPick();
        const box = document.getElementById('checklistEdit');
        box.textContent = '';
        for (const item of (card && card.checklist) || []) addCheckRow(item);
        loadRecurrence(card && card.recurrence);
        updatePreview();
        dlg.showModal();
    }

    // ---- Wiederholung ------------------------------------------------------
    let selWeekdays = new Set();

    function renderWeekdayPick() {
        const box = document.getElementById('recWeekdayWrap');
        box.textContent = '';
        // Bei "Monatlich (Wochentag)" nur EIN Wochentag, sonst Mehrfachauswahl.
        const single = form.elements.recType.value === 'monthly_weekday';
        for (const [, iso] of WEEKDAYS) {
            const chip = el('span', 'pick-chip' + (selWeekdays.has(iso) ? ' selected' : ''), t('weekday.' + iso));
            chip.addEventListener('click', () => {
                if (single) selWeekdays = new Set([iso]);
                else if (selWeekdays.has(iso)) selWeekdays.delete(iso);
                else selWeekdays.add(iso);
                renderWeekdayPick();
                updateRecUI();
            });
            box.appendChild(chip);
        }
    }

    function loadRecurrence(rec) {
        rec = rec || {};
        form.elements.recType.value = rec.type || 'none';
        form.elements.recInterval.value = rec.interval || 2;
        form.elements.recDom.value = rec.dayOfMonth || (new Date().getDate());
        form.elements.recMonth.value = String(rec.month || (new Date().getMonth() + 1));
        form.elements.recOrdinal.value = String(rec.ordinal || 1);
        form.elements.recWorkdayPos.value = rec.workdayPos || 'first';
        form.elements.recWorkdayN.value = rec.n || 1;
        const initWd = (rec.dayOfWeek && rec.dayOfWeek.length) ? rec.dayOfWeek : [isoToday()];
        selWeekdays = new Set(rec.type === 'monthly_weekday' ? [initWd[0]] : initWd);
        renderWeekdayPick();
        updateRecUI();
    }

    function isoToday() { const d = new Date().getDay(); return d === 0 ? 7 : d; }

    function updateRecUI() {
        const type = form.elements.recType.value;
        const pos = form.elements.recWorkdayPos.value;
        document.getElementById('recWeekdayWrap').hidden = !(type === 'weekly' || type === 'monthly_weekday');
        document.getElementById('recIntervalWrap').hidden = type !== 'every_n_days';
        document.getElementById('recDomWrap').hidden = !(type === 'monthly' || type === 'yearly');
        document.getElementById('recMonthWrap').hidden = type !== 'yearly';
        document.getElementById('recOrdinalWrap').hidden = type !== 'monthly_weekday';
        document.getElementById('recWorkdayPosWrap').hidden = type !== 'workday';
        document.getElementById('recWorkdayNWrap').hidden = !(type === 'workday' && (pos === 'nth' || pos === 'nth_last'));
        const hint = document.getElementById('recHint');
        const txt = type === 'none' ? '' : t('rec.hint.' + type);
        hint.hidden = !txt;
        hint.textContent = txt || '';
    }

    on('recType', 'change', () => { renderWeekdayPick(); updateRecUI(); });
    on('recWorkdayPos', 'change', updateRecUI);

    function readRecurrence() {
        const t = form.elements.recType.value;
        if (t === 'none') return null;
        const rec = { type: t };
        if (t === 'weekly') rec.dayOfWeek = [...selWeekdays].sort((a, b) => a - b);
        if (t === 'monthly' || t === 'yearly') rec.dayOfMonth = Number(form.elements.recDom.value) || 1;
        if (t === 'yearly') rec.month = Number(form.elements.recMonth.value) || 1;
        if (t === 'monthly_weekday') {
            rec.dayOfWeek = [[...selWeekdays][0] || isoToday()];
            rec.ordinal = Number(form.elements.recOrdinal.value) || 1;
        }
        if (t === 'workday') {
            rec.workdayPos = form.elements.recWorkdayPos.value || 'first';
            if (rec.workdayPos === 'nth' || rec.workdayPos === 'nth_last') {
                rec.n = Math.max(1, Number(form.elements.recWorkdayN.value) || 1);
            }
        }
        if (t === 'every_n_days') {
            rec.interval = Math.max(1, Number(form.elements.recInterval.value) || 1);
            rec.startDate = form.elements.due.value || null;   // Referenzpunkt = Fälligkeit
        }
        return rec;
    }

    function updateDueTimeUI() {
        document.getElementById('dueTimeWrap').hidden = !form.elements.dueTimeEnabled.checked;
    }
    on('dueTimeEnabled', 'change', () => {
        updateDueTimeUI();
        if (form.elements.dueTimeEnabled.checked && !form.elements.dueTime.value) {
            form.elements.dueTime.value = '09:00';   // sinnvoller Default
        }
    });

    function updatePreview() {
        const prev = document.getElementById('descPreview');
        const txt = form.elements.description.value.trim();
        if (!txt) { prev.hidden = true; return; }
        prev.hidden = false;
        // eslint-disable-next-line no-undef
        const html = marked.parse(txt);
        // Markdown darf rohes HTML enthalten → vor dem Einfügen säubern (verhindert gespeichertes XSS).
        // eslint-disable-next-line no-undef
        if (window.DOMPurify) prev.innerHTML = DOMPurify.sanitize(html);
        else prev.textContent = txt;   // Fallback ohne Sanitizer: nur Text, niemals rohes HTML
    }

    on('description', 'input', updatePreview);
    document.getElementById('addCheckItem').addEventListener('click', () => {
        addCheckRow().querySelector('input[type=text]').focus();
    });
    document.getElementById('cancelCardBtn').addEventListener('click', () => dlg.close());
    document.getElementById('deleteCardBtn').addEventListener('click', async () => {
        if (!editingCardId) return;
        if (!confirm(t('confirm.deleteCard'))) return;
        await actions.deleteCard(editingCardId);
        dlg.close();
    });

    form.addEventListener('submit', async ev => {
        ev.preventDefault();
        const data = {
            title: form.elements.title.value.trim(),
            description: form.elements.description.value,
            due: form.elements.due.value,
            dueTime: (form.elements.dueTimeEnabled.checked && form.elements.due.value)
                ? form.elements.dueTime.value : '',
            priority: Number(form.elements.priority.value),
            link: form.elements.link.value.trim(),
            location: form.elements.location.value.trim(),
            calendarInvite: form.elements.calendarInvite.checked,
            assignees: [...selAssignees],
            labels: [...selLabels],
            color: selColor,
            checklist: readChecklist(),
            recurrence: readRecurrence(),
            columnId: form.elements.columnId.value,
        };
        if (!data.title) return;
        try {
            if (editingCardId) {
                await actions.updateCard(editingCardId, data);
                const card = state.board.cards.find(c => c.id === editingCardId);
                if (card && card.columnId !== data.columnId) {
                    await actions.moveCard(editingCardId, data.columnId);
                }
            } else {
                await actions.addCard(data);
            }
            dlg.close();
        } catch (e) {
            alert(t('error.saveFailed', { msg: e.message }));
        }
    });

    // ---------------------------------------------------------- Board-Verwaltung

    const bdlg = document.getElementById('boardDialog');

    function openBoardManager() {
        const body = document.getElementById('boardDialogBody');
        body.textContent = '';
        body.appendChild(el('h3', null, t('settings.title')));

        const tabbar = el('div', 'tabbar');
        const panels = el('div', 'tab-panels');
        body.append(tabbar, panels);
        const tabs = [];
        const activate = id => {
            for (const tb of tabs) { const on = tb.id === id; tb.btn.classList.toggle('active', on); tb.panel.hidden = !on; }
        };
        const addTab = (id, label, build) => {
            const btn = el('button', 'tab-btn', label); btn.type = 'button';
            const panel = el('div', 'tab-panel'); panel.hidden = true;
            build(panel);
            btn.addEventListener('click', () => activate(id));
            tabbar.appendChild(btn); panels.appendChild(panel);
            tabs.push({ id, btn, panel });
        };

        let titleInput = null, colBox = null, labelBox = null;

        // ---- Tab: aktuelles Board (Titel, Spalten, Labels) ----
        if (state.board) {
            addTab('board', t('settings.tabBoard'), panel => {
                const titleLabel = el('label', null, t('boards.boardTitle'));
                titleInput = document.createElement('input');
                titleInput.type = 'text';
                titleInput.value = state.board.title;
                titleLabel.appendChild(titleInput);
                panel.appendChild(titleLabel);

                panel.appendChild(el('label', null, t('boards.columns')));
                colBox = el('div');
                colBox.style.cssText = 'display:flex;flex-direction:column;gap:6px';
                const mkColRow = col => {
                    const row = el('div', 'col-edit');
                    row.dataset.colId = col.id || '';
                    const drag = el('span', 'drag', '\u2833');
                    const name = document.createElement('input');
                    name.type = 'text';
                    name.value = col.title;
                    name.placeholder = t('boards.columnName');
                    const wip = document.createElement('input');
                    wip.type = 'number';
                    wip.min = '0';
                    wip.value = String(col.wipLimit || 0);
                    wip.title = t('boards.wipTitle');
                    const doneLbl = el('label', 'inline');
                    const done = document.createElement('input');
                    done.type = 'checkbox';
                    done.checked = !!col.isDone;
                    doneLbl.append(done, document.createTextNode(t('boards.done')));
                    const rm = el('button', 'rm', '\u00d7');
                    rm.type = 'button';
                    rm.title = t('boards.deleteColumnTitle');
                    rm.addEventListener('click', () => row.remove());
                    row.append(drag, name, wip, doneLbl, rm);
                    return row;
                };
                for (const col of state.board.columns) colBox.appendChild(mkColRow(col));
                panel.appendChild(colBox);
                // eslint-disable-next-line no-undef
                Sortable.create(colBox, { handle: '.drag', animation: 150 });
                const addCol = el('button', 'linkbtn', t('boards.addColumn'));
                addCol.addEventListener('click', () => colBox.appendChild(mkColRow({ title: '', wipLimit: 0, isDone: false })));
                panel.appendChild(addCol);

                panel.appendChild(el('label', null, t('boards.labels')));
                labelBox = el('div');
                labelBox.style.cssText = 'display:flex;flex-direction:column;gap:6px';
                const mkLabelRow = lab => {
                    const row = el('div', 'label-edit');
                    row.dataset.labelId = lab.id || '';
                    const color = makeColorTrigger(lab.color || '#4CAF50');
                    const name = document.createElement('input');
                    name.type = 'text';
                    name.value = lab.title || '';
                    name.placeholder = t('label.namePlaceholder');
                    const rm = el('button', 'rm', '\u00d7');
                    rm.type = 'button';
                    rm.title = t('boards.deleteLabelTitle');
                    rm.addEventListener('click', () => row.remove());
                    row.append(color, name, rm);
                    return row;
                };
                for (const lab of state.board.labels || []) labelBox.appendChild(mkLabelRow(lab));
                panel.appendChild(labelBox);
                const addLabel = el('button', 'linkbtn', t('boards.addLabel'));
                addLabel.addEventListener('click', () => labelBox.appendChild(mkLabelRow({ color: '#4CAF50' })));
                panel.appendChild(addLabel);
            });
        }

        // ---- Tab: Benutzer (Avatare) ----
        if ((state.users || []).length) {
            addTab('users', t('settings.tabUsers'), panel => {
                panel.appendChild(el('label', null, t('boards.avatars')));
                for (const u of state.users) {
                    const row = el('div', 'avatar-edit');
                    const prev = el('span', 'avatar avatar-prev');
                    const paint = () => {
                        prev.textContent = ''; prev.style.background = '';
                        if (u.avatar) {
                            const im = document.createElement('img');
                            im.src = `avatars/${encodeURIComponent(u.name)}?v=${state.avatarVer || 0}`;
                            prev.appendChild(im);
                        } else {
                            prev.textContent = initials(u.displayName || u.name);
                            prev.style.background = u.color || '#888';
                        }
                    };
                    paint();
                    const nm = el('span', 'avatar-name', u.displayName || u.name);
                    const pick = el('button', 'linkbtn', t('avatar.choose')); pick.type = 'button';
                    const file = document.createElement('input');
                    file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp'; file.hidden = true;
                    pick.addEventListener('click', () => file.click());
                    file.addEventListener('change', async () => {
                        if (!file.files || !file.files[0]) return;
                        try {
                            const dataUrl = await fileToSquareDataUrl(file.files[0], 128);
                            await api(`api/users/${encodeURIComponent(u.name)}/avatar`, { method: 'POST', body: { image: dataUrl } });
                            u.avatar = true; await actions.avatarsChanged(); paint(); rm.hidden = false;
                        } catch (e) { alert(t('avatar.failed', { msg: e.message })); }
                        file.value = '';
                    });
                    const rm = el('button', 'rm', '\u00d7'); rm.type = 'button'; rm.title = t('avatar.remove');
                    rm.hidden = !u.avatar;
                    rm.addEventListener('click', async () => {
                        await api(`api/users/${encodeURIComponent(u.name)}/avatar`, { method: 'DELETE' });
                        u.avatar = false; await actions.avatarsChanged(); paint(); rm.hidden = true;
                    });
                    row.append(prev, nm, pick, file, rm);
                    panel.appendChild(row);
                }
            });
        }

        // ---- Tab: Boards (neu anlegen / aktuelles löschen) ----
        addTab('boards', t('settings.tabBoards'), panel => {
            const newRow = el('div', 'row');
            const newInput = document.createElement('input');
            newInput.type = 'text';
            newInput.placeholder = t('boards.newBoard');
            newInput.style.flex = '1';
            const newBtn = el('button', 'primary', t('boards.create'));
            newBtn.type = 'button';
            newBtn.addEventListener('click', async () => {
                if (!newInput.value.trim()) return;
                await actions.createBoard(newInput.value.trim());
                bdlg.close();
            });
            newRow.append(newInput, newBtn);
            panel.appendChild(newRow);
            if (state.board) {
                const delBoard = el('button', 'danger', t('boards.deleteBoard'));
                delBoard.type = 'button';
                delBoard.style.marginTop = '18px';
                delBoard.addEventListener('click', async () => {
                    if (!confirm(t('confirm.deleteBoard', { title: state.board.title }))) return;
                    await actions.deleteBoard(state.board.id);
                    bdlg.close();
                });
                panel.appendChild(delBoard);
            }
        });

        // ---- Fester Footer: Schließen + Speichern ----
        const foot = el('footer');
        foot.appendChild(el('span', 'spacer'));
        const closeBtn = el('button', null, t('boards.close'));
        closeBtn.type = 'button';
        closeBtn.addEventListener('click', () => bdlg.close());
        foot.appendChild(closeBtn);
        if (state.board) {
            const save = el('button', 'primary', t('boards.save'));
            save.type = 'button';
            save.addEventListener('click', async () => {
                const columns = [...colBox.children].map(row => ({
                    id: row.dataset.colId || undefined,
                    title: row.querySelector('input[type=text]').value.trim() || '?',
                    wipLimit: Number(row.querySelector('input[type=number]').value) || 0,
                    isDone: row.querySelector('input[type=checkbox]').checked,
                }));
                const labels = [...labelBox.children].map(row => {
                    const title = row.querySelector('input[type=text]').value.trim();
                    if (!title) return null;
                    return {
                        id: row.dataset.labelId || slugify(title),
                        title,
                        color: row.querySelector('.cp-trigger').dataset.color || '#4CAF50',
                    };
                }).filter(Boolean);
                await actions.patchBoard({ title: titleInput.value.trim() || state.board.title, columns, labels });
                bdlg.close();
            });
            foot.appendChild(save);
        }
        body.appendChild(foot);

        activate(state.board ? 'board' : 'boards');
        bdlg.showModal();
    }

    // ---------------------------------------------------------- Ansicht teilen
    async function openShareDialog() {
        const sdlg = document.getElementById('shareDialog');
        const body = document.getElementById('shareBody');
        body.textContent = '';
        body.appendChild(el('h3', null, t('share.title')));
        body.appendChild(el('p', 'hint', t('share.hint')));

        const opt = {
            board: (state.board && state.board.id) || (state.boards[0] && state.boards[0].id) || '',
            users: [], labels: [], columns: null, doneLimit: null,
            hideSettings: false, hideFilter: false, embed: false,
        };

        const mkCheck = (text) => {
            const lab = el('label', 'inline');
            const inp = document.createElement('input'); inp.type = 'checkbox';
            lab.append(inp, document.createTextNode(' ' + text));
            return { lab, inp };
        };

        const board = (() => {
            const lab = el('label', null, t('share.board'));
            const sel = document.createElement('select');
            for (const b of state.boards) { const o = document.createElement('option'); o.value = b.id; o.textContent = b.title; sel.appendChild(o); }
            sel.value = opt.board;
            lab.appendChild(sel);
            return { lab, sel };
        })();

        // Benutzer (Mehrfachauswahl) – keine angehakt = alle
        const usersLabel = el('label', null, t('share.users'));
        const usersWrap = el('div', 'share-cols');
        const updateUsers = () => { opt.users = [...usersWrap.querySelectorAll('input:checked')].map(i => i.dataset.val); };
        for (const u of state.users) {
            const chk = mkCheck(u.displayName);
            chk.inp.dataset.val = u.name;
            chk.inp.addEventListener('change', () => { updateUsers(); update(); });
            usersWrap.appendChild(chk.lab);
        }

        // Labels (Mehrfachauswahl, board-abhängig) – keine angehakt = alle
        const labelsLabel = el('label', null, t('share.labels'));
        const labelsWrap = el('div', 'share-cols');
        const updateLabels = () => { opt.labels = [...labelsWrap.querySelectorAll('input:checked')].map(i => i.dataset.val); };
        async function fillLabels(boardId) {
            labelsWrap.textContent = '';
            let labels = [];
            if (state.board && state.board.id === boardId) labels = state.board.labels || [];
            else if (boardId) { try { const b = await api(`api/boards/${encodeURIComponent(boardId)}`); labels = (b && b.labels) || []; } catch (e) { /* ignore */ } }
            for (const l of labels) {
                const chk = mkCheck(l.title);
                chk.inp.dataset.val = l.id;
                chk.inp.addEventListener('change', () => { updateLabels(); update(); });
                labelsWrap.appendChild(chk.lab);
            }
            opt.labels = [];
        }

        const cHideSettings = mkCheck(t('share.hideSettings'));
        const cHideFilter = mkCheck(t('share.hideFilter'));
        const cEmbed = mkCheck(t('share.embed'));

        // Sichtbare Spalten (des gewählten Boards) – alle an = kein Filter
        let curColumns = [];
        const colsLabel = el('label', null, t('share.visibleColumns'));
        const colsWrap = el('div', 'share-cols');
        const updateColumns = () => {
            const checked = [...colsWrap.querySelectorAll('input:checked')].map(i => i.dataset.colId);
            opt.columns = (checked.length === curColumns.length) ? null : checked;
        };
        async function fillColumns(boardId) {
            colsWrap.textContent = '';
            curColumns = [];
            if (state.board && state.board.id === boardId) curColumns = state.board.columns || [];
            else if (boardId) { try { const b = await api(`api/boards/${encodeURIComponent(boardId)}`); curColumns = (b && b.columns) || []; } catch (e) { /* ignore */ } }
            for (const c of curColumns) {
                const chk = mkCheck(c.title);
                chk.inp.checked = true;
                chk.inp.dataset.colId = c.id;
                chk.inp.addEventListener('change', () => { updateColumns(); update(); });
                colsWrap.appendChild(chk.lab);
            }
            opt.columns = null;
        }

        // Limit für erledigte Karten in Erledigt-Spalten
        const doneLimitLbl = el('label', null, t('share.doneLimit'));
        const doneLimitInp = document.createElement('input');
        doneLimitInp.type = 'number'; doneLimitInp.min = '0'; doneLimitInp.value = ''; doneLimitInp.placeholder = t('share.doneLimitAll');
        doneLimitLbl.appendChild(doneLimitInp);

        const urlWrap = el('div', 'share-url');
        const urlField = document.createElement('input');
        urlField.type = 'text'; urlField.readOnly = true; urlField.className = 'share-url-input';
        const copyBtn = el('button', 'primary', t('share.copy')); copyBtn.type = 'button';
        urlWrap.append(urlField, copyBtn);

        const buildUrl = () => {
            const p = new URLSearchParams();
            if (opt.board) p.set('board', opt.board);
            if (opt.users.length) p.set('users', opt.users.join(','));
            if (opt.labels.length) p.set('label', opt.labels.join(','));
            if (opt.columns && opt.columns.length) p.set('columns', opt.columns.join(','));
            if (opt.doneLimit != null) p.set('doneLimit', String(opt.doneLimit));
            if (opt.hideSettings) p.set('hideSettings', '1');
            if (opt.hideFilter) p.set('hideFilter', '1');
            if (opt.embed) p.set('embed', '1');
            const q = p.toString();
            return location.origin + location.pathname + (q ? '?' + q : '');
        };
        const update = () => { urlField.value = buildUrl(); };

        board.sel.addEventListener('change', async () => { opt.board = board.sel.value; await Promise.all([fillLabels(opt.board), fillColumns(opt.board)]); update(); });
        doneLimitInp.addEventListener('input', () => { opt.doneLimit = doneLimitInp.value === '' ? null : Math.max(0, parseInt(doneLimitInp.value, 10) || 0); update(); });
        cHideSettings.inp.addEventListener('change', () => { opt.hideSettings = cHideSettings.inp.checked; update(); });
        cHideFilter.inp.addEventListener('change', () => { opt.hideFilter = cHideFilter.inp.checked; update(); });
        cEmbed.inp.addEventListener('change', () => { opt.embed = cEmbed.inp.checked; update(); });
        copyBtn.addEventListener('click', async () => {
            const done = () => { copyBtn.textContent = t('share.copied'); setTimeout(() => { copyBtn.textContent = t('share.copy'); }, 1500); };
            try { await navigator.clipboard.writeText(urlField.value); done(); }
            catch (e) { urlField.select(); try { document.execCommand('copy'); } catch (_) { /* ignore */ } done(); }
        });

        body.append(board.lab, usersLabel, usersWrap, labelsLabel, labelsWrap, colsLabel, colsWrap, doneLimitLbl,
            cHideSettings.lab, cHideFilter.lab, cEmbed.lab,
            el('label', null, t('share.generatedUrl')), urlWrap);

        const foot = el('footer');
        const close = el('button', null, t('boards.close')); close.type = 'button';
        close.addEventListener('click', () => sdlg.close());
        foot.append(el('span', 'spacer'), close);
        body.appendChild(foot);

        await Promise.all([fillLabels(opt.board), fillColumns(opt.board)]);
        update();
        sdlg.showModal();
    }

    return { openCard, openBoardManager, openShareDialog };
}
