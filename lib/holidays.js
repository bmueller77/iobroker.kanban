// Feiertags-Berechnung für die Arbeitstag-Logik der Wiederholungen.
//
// Der ioBroker-`feiertage`-Adapter exponiert nur today/tomorrow/next – keine
// abfragbare Jahresliste. Für die Vorausberechnung von Fälligkeiten (bis 800
// Tage voraus) berechnen wir die Feiertage daher selbst und nutzen aus der
// feiertage-Adapter-Config nur die Info, WELCHE Feiertage gelten (Bundesland).
//
// Wichtig: Für „Arbeitstag" zählen ausschließlich gesetzlich arbeitsfreie Tage.
// Deko-Tage wie Valentinstag (im Adapter aktivierbar) sind normale Arbeitstage
// und stehen daher gar nicht erst in RULES.

function fmt(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Ostersonntag (Anonymous-Gregorian-/Meeus-Algorithmus)
function easterSunday(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function easterOffset(year, off) {
    const e = easterSunday(year);
    e.setDate(e.getDate() + off);
    return e;
}

// Nur gesetzlich arbeitsfrei-fähige Feiertage (bundesweit + länderspezifisch).
// Key = feiertage-Adapter enable_<key>. fixed:[monat,tag] | easter:offset | fn.
const RULES = {
    neujahr:         { fixed: [1, 1] },
    dreikoenige:     { fixed: [1, 6] },        // BW, BY, ST
    weltfrauentag:   { fixed: [3, 8] },        // BE, MV
    karfreitag:      { easter: -2 },
    ostersonntag:    { easter: 0 },            // BB (sonst Sonntag)
    ostermontag:     { easter: 1 },
    maifeiertag:     { fixed: [5, 1] },
    chimmelfahrt:    { easter: 39 },           // Christi Himmelfahrt
    pfingstsonntag:  { easter: 49 },           // BB (sonst Sonntag)
    pfingstmontag:   { easter: 50 },
    fronleichnam:    { easter: 60 },           // BW, BY, HE, NW, RP, SL + teilw.
    friedensfest:    { fixed: [8, 8] },        // Augsburg
    mhimmelfahrt:    { fixed: [8, 15] },       // SL, teilw. BY
    wkinder:         { fixed: [9, 20] },        // Weltkindertag, TH
    einheitstag:     { fixed: [10, 3] },
    reformationstag: { fixed: [10, 31] },      // norddt. Länder + Ost
    allerheiligen:   { fixed: [11, 1] },       // BW, BY, NW, RP, SL
    bussbettag:      { fn: bussUndBettag },    // SN – Mittwoch vor dem 23.11.
    weihnachtstag1:  { fixed: [12, 25] },
    weihnachtstag2:  { fixed: [12, 26] },
};

// Buß- und Bettag: Mittwoch vor dem 23. November
function bussUndBettag(year) {
    const d = new Date(year, 10, 23, 12, 0, 0, 0);        // 23.11.
    // zurück bis zum Mittwoch (3) davor
    do { d.setDate(d.getDate() - 1); } while (d.getDay() !== 3);
    return d;
}

// Default-Satz, wenn kein feiertage-Adapter vorhanden ist:
// bundesweit einheitliche gesetzliche Feiertage.
const DEFAULT_KEYS = [
    'neujahr', 'karfreitag', 'ostermontag', 'maifeiertag', 'chimmelfahrt',
    'pfingstmontag', 'einheitstag', 'weihnachtstag1', 'weihnachtstag2',
];

class Holidays {
    constructor() {
        this.activeKeys = new Set(DEFAULT_KEYS);
        this.source = 'default';
        this._cache = new Map();   // year -> Set('YYYY-MM-DD')
    }

    /** native-Config des feiertage-Adapters (oder null) übernehmen. */
    configure(native) {
        this._cache.clear();
        if (native && typeof native === 'object') {
            const keys = Object.keys(RULES).filter(k => native[`enable_${k}`] === true);
            this.activeKeys = new Set(keys);
            this.source = 'feiertage-adapter';
        } else {
            this.activeKeys = new Set(DEFAULT_KEYS);
            this.source = 'default';
        }
        return { source: this.source, count: this.activeKeys.size };
    }

    _yearSet(year) {
        let set = this._cache.get(year);
        if (set) return set;
        set = new Set();
        for (const key of this.activeKeys) {
            const rule = RULES[key];
            if (!rule) continue;
            let d;
            if (rule.fixed) d = new Date(year, rule.fixed[0] - 1, rule.fixed[1], 12, 0, 0, 0);
            else if (typeof rule.easter === 'number') d = easterOffset(year, rule.easter);
            else if (rule.fn) d = rule.fn(year);
            if (d) set.add(fmt(d));
        }
        this._cache.set(year, set);
        return set;
    }

    /** Ist das Datum ein (aktiver) gesetzlicher Feiertag? */
    isHoliday(d) {
        return this._yearSet(d.getFullYear()).has(fmt(d));
    }

    /** Arbeitstag = kein Wochenende und kein gesetzlicher Feiertag. */
    isWorkday(d) {
        const wd = d.getDay();
        if (wd === 0 || wd === 6) return false;   // So/Sa
        return !this.isHoliday(d);
    }
}

module.exports = new Holidays();   // Singleton
module.exports.Holidays = Holidays;
module.exports.easterSunday = easterSunday;
