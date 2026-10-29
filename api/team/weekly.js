// Wochenbericht für den Teambereich: die letzten 8 Wochen (Montag bis Sonntag) aus der Team-Statistik.
// Eine Anfrage an Garage 61 für alle 8 Wochen, 15 Minuten gemerkt.
const { requireSession } = require("../_lib/session");
const { g61Get, cached, teamSlug, tracks, cars, sendError } = require("../_lib/g61");

const WEEKS = 8;
const TOP = 5;

const iso = (d) => d.toISOString().slice(0, 10);

// Montag der Woche, in der der Tag liegt ("2026-10-29" → "2026-10-26")
function mondayOf(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return iso(d);
}

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

// Sortiert absteigend nach Fahrzeit. Bei Einträgen mit Fahrer-Aufschlüsselung (_by) wird diese als "by" mitgegeben.
function rank(map, limit) {
  return [...map.values()]
    .sort((a, b) => b.time - a.time)
    .slice(0, limit)
    .map(({ _by, ...x }) => (_by ? { ...x, by: rank(_by) } : x));
}

// Zählt eine Statistikzeile in einen Eintrag (Strecke, Auto, Sessionart) und in dessen Fahrer-Aufschlüsselung
function add(map, key, init, r, driver) {
  const e = map.get(key) || { ...init, time: 0, laps: 0, _by: new Map() };
  e.time += r.timeOnTrack;
  e.laps += r.lapsDriven;
  const d = e._by.get(driver.slug) || { name: driver.name, time: 0, laps: 0 };
  d.time += r.timeOnTrack;
  d.laps += r.lapsDriven;
  e._by.set(driver.slug, d);
  map.set(key, e);
}

async function report() {
  const firstMonday = addDays(mondayOf(iso(new Date())), -7 * (WEEKS - 1));
  const [stats, team, trackNames, carNames] = await Promise.all([
    g61Get(`/teams/${teamSlug()}/statistics`, { start: `${firstMonday}T00:00:00Z`, end: new Date().toISOString() }),
    cached("team", 3600, () => g61Get(`/teams/${teamSlug()}`)),
    tracks(),
    cars(),
  ]);
  const names = new Map((team.members || []).map((m) => [m.slug, [m.firstName, m.lastName].filter(Boolean).join(" ") || m.slug]));

  const weeks = Array.from({ length: WEEKS }, (_, i) => {
    const start = addDays(firstMonday, 7 * i);
    return { start, end: addDays(start, 6), time: 0, laps: 0, clean: 0, events: 0,
      _drivers: new Map(), _sessions: new Map(), _tracks: new Map(), _cars: new Map() };
  });
  const byStart = new Map(weeks.map((w) => [w.start, w]));
  const sessionNames = { 1: "Training", 2: "Qualifying", 3: "Rennen" };

  for (const r of stats.drivingStatistics || []) {
    const w = byStart.get(mondayOf(r.day));
    if (!w) continue;
    w.time += r.timeOnTrack;
    w.laps += r.lapsDriven;
    w.clean += r.cleanLapsDriven;
    w.events += r.events;

    const slug = r.user || "?";
    const driver = { slug, name: names.get(slug) || slug };
    const d = w._drivers.get(slug) || { name: driver.name, time: 0, laps: 0, clean: 0 };
    d.time += r.timeOnTrack; d.laps += r.lapsDriven; d.clean += r.cleanLapsDriven;
    w._drivers.set(slug, d);

    if (sessionNames[r.sessionType]) add(w._sessions, r.sessionType, { name: sessionNames[r.sessionType] }, r, driver);
    const tInfo = trackNames.get(r.track) || { name: `Strecke ${r.track}`, variant: "" };
    add(w._tracks, r.track, { name: tInfo.name, variant: tInfo.variant }, r, driver);
    add(w._cars, r.car, { name: carNames.get(r.car) || `Auto ${r.car}` }, r, driver);
  }

  return weeks.map(({ _drivers, _sessions, _tracks, _cars, ...w }) => {
    // Training, Quali, Rennen immer in dieser Reihenfolge, auch wenn eine Sessionart fehlt
    const sessions = [1, 2, 3].map((k) => {
      const s = _sessions.get(k);
      return s ? rank(new Map([[k, s]]))[0] : { name: sessionNames[k], time: 0, laps: 0, by: [] };
    });
    return { ...w, drivers: rank(_drivers), sessions, tracks: rank(_tracks, TOP), cars: rank(_cars, TOP) };
  });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (!requireSession(req, res)) return;
  try {
    return res.status(200).json({ today: iso(new Date()), weeks: await cached("weekly", 900, report) });
  } catch (e) {
    return sendError(res, e);
  }
};
