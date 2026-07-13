// Eigener eingebetteter Colorpicker – überall identisch, voller Farbraum,
// touch-tauglich (der native <input type=color> zeigt auf Mobilgeräten oft
// nur eine kleine Palette). SV-Feld + Hue-Slider + Hex-Eingabe + Presets.

import { t } from './i18n.js';

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function hsvToRgb(h, s, v) {
    h = (h % 360 + 360) % 360; s = clamp(s, 0, 1); v = clamp(v, 0, 1);
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60; if (h < 0) h += 360;
    }
    return { h, s: max ? d / max : 0, v: max };
}

function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0')).join('');
}

let openPop = null;   // aktuell offenes Popover (nur eins gleichzeitig)

/**
 * @param anchorEl  Element, an dem das Popover ausgerichtet wird
 * @param current   aktuelle Farbe ('' = keine)
 * @param onPick    (color) => void  – live bei jeder Änderung
 * @param opts      { presets?: string[], allowNone?: bool }
 */
export function openColorPicker(anchorEl, current, onPick, opts = {}) {
    closeColorPicker();
    const presets = opts.presets || [];
    const start = hexToRgb(current) || { r: 126, g: 87, b: 194 };
    let hsv = rgbToHsv(start.r, start.g, start.b);

    const pop = document.createElement('div');
    pop.className = 'cp-pop';

    const sv = document.createElement('div'); sv.className = 'cp-sv';
    const svCur = document.createElement('div'); svCur.className = 'cp-cursor'; sv.appendChild(svCur);
    const hue = document.createElement('div'); hue.className = 'cp-hue';
    const hueCur = document.createElement('div'); hueCur.className = 'cp-hue-cursor'; hue.appendChild(hueCur);

    const row = document.createElement('div'); row.className = 'cp-row';
    const preview = document.createElement('span'); preview.className = 'cp-preview';
    const hex = document.createElement('input'); hex.type = 'text'; hex.className = 'cp-hex';
    hex.maxLength = 7; hex.spellcheck = false;
    row.append(preview, hex);

    pop.append(sv, hue, row);

    if (presets.length) {
        const pr = document.createElement('div'); pr.className = 'cp-presets';
        for (const c of presets) {
            const s = document.createElement('span');
            s.className = 'cp-swatch' + (c ? '' : ' none');
            if (c) s.style.background = c;
            s.title = c || t('color.none');
            s.addEventListener('click', () => {
                if (!c) { emit(''); render(); return; }
                const rgb = hexToRgb(c); hsv = rgbToHsv(rgb.r, rgb.g, rgb.b); render(); emit(c);
            });
            pr.appendChild(s);
        }
        pop.appendChild(pr);
    }

    function currentHex() {
        const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);
        return rgbToHex(r, g, b);
    }
    function emit(val) { onPick(val !== undefined ? val : currentHex()); }
    function render() {
        const hueRgb = hsvToRgb(hsv.h, 1, 1);
        sv.style.background =
            `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${rgbToHex(hueRgb.r, hueRgb.g, hueRgb.b)})`;
        svCur.style.left = (hsv.s * 100) + '%';
        svCur.style.top = ((1 - hsv.v) * 100) + '%';
        hueCur.style.left = (hsv.h / 360 * 100) + '%';
        const hx = currentHex();
        preview.style.background = hx;
        svCur.style.background = hx;
        if (document.activeElement !== hex) hex.value = hx;
    }

    // ---- Pointer-Tracking für SV-Feld und Hue-Slider (touch-tauglich) ----
    function track(el, handler) {
        const move = e => {
            const r = el.getBoundingClientRect();
            const x = clamp((e.clientX - r.left) / r.width, 0, 1);
            const y = clamp((e.clientY - r.top) / r.height, 0, 1);
            handler(x, y); render(); emit();
        };
        el.addEventListener('pointerdown', e => {
            e.preventDefault(); el.setPointerCapture(e.pointerId); move(e);
            const mv = ev => move(ev);
            const up = ev => { el.releasePointerCapture(e.pointerId); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
            el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
        });
    }
    track(sv, (x, y) => { hsv.s = x; hsv.v = 1 - y; });
    track(hue, x => { hsv.h = x * 360; });

    hex.addEventListener('input', () => {
        const rgb = hexToRgb(hex.value);
        if (rgb) { hsv = rgbToHsv(rgb.r, rgb.g, rgb.b); render(); emit(rgbToHex(rgb.r, rgb.g, rgb.b)); }
    });

    // In einen offenen modalen <dialog> hängen (top-layer), sonst an den body –
    // sonst läge das fixed-Popover hinter dem Dialog-Backdrop.
    const host = anchorEl.closest('dialog[open]') || document.body;
    host.appendChild(pop);
    // Positionierung nahe des Ankers, im Viewport gehalten
    const a = anchorEl.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = clamp(a.left, 6, window.innerWidth - pw - 6);
    let top = a.bottom + 6;
    if (top + ph > window.innerHeight - 6) top = Math.max(6, a.top - ph - 6);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    render();

    // Schließen bei Klick/Touch außerhalb
    const onDown = e => { if (!pop.contains(e.target) && e.target !== anchorEl) closeColorPicker(); };
    setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
    openPop = { pop, onDown };
    return pop;
}

export function closeColorPicker() {
    if (!openPop) return;
    document.removeEventListener('pointerdown', openPop.onDown, true);
    openPop.pop.remove();
    openPop = null;
}
