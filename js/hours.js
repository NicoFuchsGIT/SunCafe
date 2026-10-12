// ---------- Ortszeit und Öffnungszeiten (ohne DOM) ----------
import {DAYS} from './config.js';

// Ortszeit: Date, dessen lokale Felder (getHours, getDay …) der Uhrzeit in tz entsprechen (tz aus Open-Meteo)
let tzFmt = null;
export const wall = (d, tz) => {
    if (!tz) return d;
    if (!tzFmt || tzFmt.resolvedOptions().timeZone !== tz) tzFmt = new Intl.DateTimeFormat('en-US', {timeZone:tz, hourCycle:'h23',
        year:'numeric', month:'numeric', day:'numeric', hour:'numeric', minute:'numeric', second:'numeric'});
    const p = Object.fromEntries(tzFmt.formatToParts(d).map(x => [x.type, x.value]));
    return new Date(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
};
export const fmtT = d => d.toLocaleTimeString('de-AT', {hour:'2-digit', minute:'2-digit'});
export const fmtD = d => DAYS[d.getDay()] + ' ' + fmtT(d);

// opening_hours-Objekt oder null; braucht die Bibliothek opening_hours als globale Variable
export function parseHours(raw, lat, lng, rg) {
    if (!raw) return null;
    // ohne Land kennt opening_hours keine Feiertage und lehnt Werte mit PH ab; lat/lon müssen Strings sein
    try { return new globalThis.opening_hours(raw, {lat:String(lat), lon:String(lng), address:rg || {}}, {locale:'de'}); } catch(x) { return null; }
}

export function openInfo(c, d) { // d in Ortszeit (wall)
    if (!c.oh) return {o:-1, text:'Öffnungszeiten unbekannt'};
    try {
        const next = c.oh.getNextChange(d), nt = next ? (next.toDateString() === d.toDateString() ? fmtT(next) : fmtD(next)) : null;
        if (c.oh.getUnknown(d)) return {o:-1, text:'Öffnungszeiten unklar' + (c.raw ? ': ' + c.raw : '')};
        if (c.oh.getState(d)) return {o:1, text:'Geöffnet' + (nt ? ', schließt ' + nt : '')};
        return {o:0, text:'Geschlossen' + (nt ? ', öffnet ' + nt : '')};
    } catch(e) { return {o:-1, text:'Öffnungszeiten unlesbar'}; }
}
