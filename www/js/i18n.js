// Minimales i18n: lädt www/i18n/<lang>.json, mit Englisch als Basis-Fallback.
// Sprache: ?lang=… (URL) überschreibt die vom Server gelieferte Vorgabe.

let dict = {};
let lang = 'en';

async function load(l) {
    try { const r = await fetch(`i18n/${encodeURIComponent(l)}.json`); if (r.ok) return await r.json(); } catch (e) { /* ignore */ }
    return null;
}

/** @param preferred Sprachvorgabe vom Server (native.language / System). */
export async function initI18n(preferred) {
    const qsLang = new URLSearchParams(location.search).get('lang');
    lang = (qsLang || preferred || 'en').toLowerCase();
    const base = (await load('en')) || {};
    const target = lang === 'en' ? {} : ((await load(lang)) || {});
    dict = { ...base, ...target };                 // fehlende Keys → Englisch
    document.documentElement.lang = lang;
    return lang;
}

export function t(key, params) {
    let s = dict[key] != null ? dict[key] : key;
    if (params) for (const k in params) s = s.split(`{${k}}`).join(params[k]);
    return s;
}

/** Statische Strings im DOM ersetzen (data-i18n / -title / -ph). */
export function applyStatic(root = document) {
    for (const e of root.querySelectorAll('[data-i18n]')) {
        const txt = t(e.getAttribute('data-i18n'));
        // Nur den Text ersetzen – Kind-Elemente (z.B. <input>/<select> im Label) behalten!
        const textNode = [...e.childNodes].find(n => n.nodeType === 3 && n.nodeValue.trim().length);
        if (textNode) textNode.nodeValue = txt;
        else if (!e.children.length) e.textContent = txt;
        else e.insertBefore(document.createTextNode(txt), e.firstChild);
    }
    for (const e of root.querySelectorAll('[data-i18n-title]')) e.title = t(e.getAttribute('data-i18n-title'));
    for (const e of root.querySelectorAll('[data-i18n-ph]')) e.placeholder = t(e.getAttribute('data-i18n-ph'));
}

export function currentLang() { return lang; }
