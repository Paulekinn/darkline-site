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

// Summiert Fahrzeit und Runden pro Schlüssel, sortiert absteigend nach Fahrzeit
function rank(map, limit) {
  return [...map.values()].sort((a, b) => b.time - a.time).slice(0, limit);
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
      sessions: { training: 0, quali: 0, rennen: 0 }, _drivers: new Map(), _tracks: new Map(), _cars: new Map() };
  });
  const byStart = new Map(weeks.map((w) => [w.start, w]));
  const sessionKey = { 1: "training", 2: "quali", 3: "rennen" };

  for (const r of stats.drivingStatistics || []) {
    const w = byStart.get(mondayOf(r.day));
    if (!w) continue;
    w.time += r.timeOnTrack;
    w.laps += r.lapsDriven;
    w.clean += r.cleanLapsDriven;
    w.events += r.events;
    if (sessionKey[r.sessionType]) w.sessions[sessionKey[r.sessionType]] += r.timeOnTrack;

    const slug = r.user || "?";
    const d = w._drivers.get(slug) || { name: names.get(slug) || slug, time: 0, laps: 0, clean: 0 };
    d.time += r.timeOnTrack; d.laps += r.lapsDriven; d.clean += r.cleanLapsDriven;
    w._drivers.set(slug, d);

    const tInfo = trackNames.get(r.track) || { name: `Strecke ${r.track}`, variant: "" };
    const t = w._tracks.get(r.track) || { name: tInfo.name, variant: tInfo.variant, time: 0, laps: 0 };
    t.time += r.timeOnTrack; t.laps += r.lapsDriven;
    w._tracks.set(r.track, t);

    const c = w._cars.get(r.car) || { name: carNames.get(r.car) || `Auto ${r.car}`, time: 0, laps: 0 };
    c.time += r.timeOnTrack; c.laps += r.lapsDriven;
    w._cars.set(r.car, c);
  }

  return weeks.map(({ _drivers, _tracks, _cars, ...w }) => ({
    ...w,
    drivers: rank(_drivers),
    tracks: rank(_tracks, TOP),
    cars: rank(_cars, TOP),
  }));
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
