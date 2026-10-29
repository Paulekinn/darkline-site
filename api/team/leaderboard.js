// Rangliste für den Teambereich.
// GET                 → Strecken, die das Team in den letzten 4 Wochen gefahren ist (eine Anfrage an die Team-Statistik)
// GET ?track=<ID>     → Team-Bestzeiten auf dieser Strecke, pro Auto (erst beim Anklicken, 15 Minuten gemerkt)
const { requireSession } = require("../_lib/session");
const { g61Get, cached, items, teamSlug, tracks, cars, sendError } = require("../_lib/g61");

const DAYS = 28;

async function trackOverview() {
  const end = new Date();
  const start = new Date(end.getTime() - DAYS * 86400 * 1000);
  const stats = await g61Get(`/teams/${teamSlug()}/statistics`, { start: start.toISOString(), end: end.toISOString() });
  const names = await tracks();
  const byTrack = new Map();
  for (const r of stats.drivingStatistics || []) {
    const info = names.get(r.track) || { name: `Strecke ${r.track}`, variant: "" };
    const t = byTrack.get(r.track) || { id: r.track, name: info.name, variant: info.variant, time: 0, laps: 0, drivers: new Set(), last: "" };
    t.time += r.timeOnTrack;
    t.laps += r.lapsDriven;
    if (r.user) t.drivers.add(r.user);
    if (r.day > t.last) t.last = r.day;
    byTrack.set(r.track, t);
  }
  return [...byTrack.values()]
    .map((t) => ({ ...t, drivers: t.drivers.size }))
    .sort((a, b) => b.time - a.time);
}

async function trackBests(trackId) {
  const data = await g61Get("/laps", {
    tracks: trackId,
    teams: teamSlug(),
    drivers: "me", // eigene Runden des Token-Besitzers sicher mit dabei (wie beim Bot)
    group: "driver-car",
    limit: 1000,
  });
  const carNames = await cars();
  const byCar = new Map();
  for (const lap of items(data)) {
    if (!lap.car || !lap.driver || !lap.lapTime) continue;
    const list = byCar.get(lap.car.id) || [];
    list.push({
      id: lap.id,
      driver: [lap.driver.firstName, lap.driver.lastName].filter(Boolean).join(" ") || lap.driver.slug,
      time: lap.lapTime,
      date: lap.startTime,
      clean: lap.clean,
      trackTemp: lap.trackTemp,
      telemetry: !!lap.canViewTelemetry,
    });
    byCar.set(lap.car.id, list);
  }
  return [...byCar.entries()]
    .map(([id, laps]) => ({
      id,
      name: carNames.get(id) || `Auto ${id}`,
      link: `https://garage61.net/app/laps/${trackId}/${id};t=${teamSlug()}`,
      laps: laps.sort((a, b) => a.time - b.time),
    }))
    .sort((a, b) => b.laps.length - a.laps.length || a.name.localeCompare(b.name));
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (!requireSession(req, res)) return;
  try {
    const track = Number(req.query.track);
    if (req.query.track !== undefined) {
      if (!Number.isInteger(track) || track <= 0) return res.status(400).json({ error: "Ungültige Strecke." });
      return res.status(200).json({ track, cars: await cached(`track:${track}`, 900, () => trackBests(track)) });
    }
    return res.status(200).json({ days: DAYS, tracks: await cached("overview", 900, trackOverview) });
  } catch (e) {
    return sendError(res, e);
  }
};
