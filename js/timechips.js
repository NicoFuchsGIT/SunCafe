// ---------- Schnellwahl-Chips für den Zeitschieber (ohne DOM) ----------
// Liefert den Schieberwert (Schritte ab t0) für einen Chip oder null, wenn der Chip gerade keinen Sinn ergibt.
//   now      Jetzt
//   plus1    in einer Stunde
//   evening  eine Stunde vor Sonnenuntergang (entfällt, wenn der Zeitpunkt schon vorbei ist)
//   morning  morgen früh: zwei Stunden nach Sonnenaufgang (liegt vor 11/12 Uhr, die Sonne steht dann schon höher)
export const CHIPS = ['now', 'plus1', 'evening', 'morning'];
const H = 3600000;
const ok = d => d instanceof Date && !isNaN(d);

export function chipSlot(kind, {now, t0, step, max, sunset, sunriseNext}) {
    let target;
    if (kind === 'now') return 0;
    else if (kind === 'plus1') target = new Date(now.getTime() + H);
    else if (kind === 'evening') { if (!ok(sunset)) return null; target = new Date(sunset.getTime() - H); }
    else if (kind === 'morning') { if (!ok(sunriseNext)) return null; target = new Date(sunriseNext.getTime() + 2 * H); }
    else return null;
    if (target <= now) return null; // schon vorbei
    const v = Math.round((target - t0) / (step * 60000));
    return v >= 1 && v <= max ? v : null;
}
