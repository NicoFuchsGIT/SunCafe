// ---------- Ortszeit und Öffnungszeiten (ohne DOM) ----------
import {t, dayShort, fmtTime} from './i18n.js';

// Ortszeit: Date, dessen lokale Felder (getHours, getDay …) der Uhrzeit in tz entsprechen (tz aus Open-Meteo)
let tzFmt = null;
export const wall = (d, tz) => {
    if (!tz) return d;
    if (!tzFmt || tzFmt.resolvedOptions().timeZone !== tz) tzFmt = new Intl.DateTimeFormat('en-US', {timeZone:tz, hourCycle:'h23',
        year:'numeric', month:'numeric', day:'numeric', hour:'numeric', minute:'numeric', second:'numeric'});
    const p = Object.fromEntries(tzFmt.formatToParts(d).map(x => [x.type, x.value]));
    return new Date(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
};
export const fmtT = fmtTime;
export const fmtD = d => dayShort(d.getDay()) + ' ' + fmtT(d);

// opening_hours-Objekt oder null; braucht die Bibliothek opening_hours als globale Variable
export function parseHours(raw, lat, lng, rg) {
    if (!raw) return null;
    // ohne Land kennt opening_hours keine Feiertage und lehnt Werte mit PH ab; lat/lon müssen Strings sein
    try { return new globalThis.opening_hours(raw, {lat:String(lat), lon:String(lng), address:rg || {}}, {locale:'de'}); } catch(x) { return null; }
}

export function openInfo(c, d) { // d in Ortszeit (wall)
    if (!c.oh) return {o:-1, text:t('hours.unknown')};
    try {
        const next = c.oh.getNextChange(d), nt = next ? (next.toDateString() === d.toDateString() ? fmtT(next) : fmtD(next)) : null;
        if (c.oh.getUnknown(d)) return {o:-1, text:t('hours.unclear') + (c.raw ? ': ' + c.raw : '')};
        if (c.oh.getState(d)) return {o:1, text:nt ? t('hours.openUntil', {when:nt}) : t('hours.open')};
        return {o:0, text:nt ? t('hours.closedUntil', {when:nt}) : t('hours.closed')};
    } catch(e) { return {o:-1, text:t('hours.unreadable')}; }
}
