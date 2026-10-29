// Rennbericht für den Teambereich: Auswertung eines Teamrennens aus Garage 61.
// GET ?datum=YYYY-MM-DD → Garage-61-Events rund um diesen Tag (Kandidaten für das Teamrennen)
// GET ?event=<ID>       → Auswertung der Rennsession: Stints, Fahrer, Boxenstopps, Wetter (einen Tag gemerkt)
const { requireSession } = require("../_lib/session");
const { g61Get, cached, items, teamSlug, sendError } = require("../_lib/g61");

const ID = /^[0-9A-Za-z]{20,32}$/;
const RACE = 3; // Session-Typ Rennen (1 = Training, 2 = Qualifying)

const name = (d) => [d.firstName, d.lastName].filter(Boolean).join(" ") || d.slug || "Unbekannt";
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
// Konstanz: typische Abweichung vom Median (robust, einzelne Ausreißer wie Regenrunden oder Gelbphasen zählen kaum)
const spread = (a) => {
  if (a.length < 3) return null;
  const m = median(a);
  return median(a.map((v) => Math.abs(v - m))) * 1.4826;
};
const r3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

// Events von einem Tag vorher bis zwei Tage danach (Renndatum im Kalender ist deutsche Zeit, Garage 61 rechnet in UTC)
async function candidates(datum) {
  const day = new Date(`${datum}T00:00:00Z`);
  const after = new Date(day.getTime() - 86400000).toISOString();
  const before = new Date(day.getTime() + 2 * 86400000).toISOString();
  const data = await g61Get("/events", { team: teamSlug(), after, before, limit: 100 });
  return items(data)
    .filter((e) => e.lapCount > 0)
    .map((e) => ({
      id: e.id,
      start: e.startedAt,
      track: e.track ? (e.track.variant ? `${e.track.name} (${e.track.variant})` : e.track.name) : "",
      car: e.car ? e.car.name : "",
      laps: e.lapCount,
      drivers: (e.drivers || []).map(name),
      official: !!e.platformEvent, // iRacing-Session (kein Offline-Test)
    }))
    // wahrscheinlichstes Teamrennen zuerst: offizielle Session, viele Fahrer, viele Runden
    .sort((a, b) => (b.official - a.official) || (b.drivers.length - a.drivers.length) || (b.laps - a.laps));
}

async function analyse(id) {
  const ev = await g61Get(`/events/${id}`);
  const laps = (ev.laps || []).filter((l) => l.sessionType === RACE && l.driver).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const base = {
    id,
    track: ev.track ? (ev.track.variant ? `${ev.track.name} (${ev.track.variant})` : ev.track.name) : "",
    car: ev.car ? ev.car.name : "",
  };
  if (!laps.length) return { ...base, empty: true };

  // Rundenzeiten, die etwas über die Pace aussagen: sauber, nicht in der Box, vollständig, nicht die Startrunde
  const racing = (l) => l.clean && !l.pitIn && !l.pitOut && !l.incomplete && l.lapNumber > 1 && l.lapTime > 0;

  // Stints: aufeinanderfolgende Runden desselben Fahrers (ein Fahrerwechsel beginnt einen neuen Stint)
  const stints = [];
  for (const l of laps) {
    const last = stints[stints.length - 1];
    if (!last || last.slug !== l.driver.slug) {
      stints.push({ slug: l.driver.slug, driver: name(l.driver), start: l.startTime, laps: [], pits: 0 });
    }
    const s = stints[stints.length - 1];
    s.laps.push(l);
    if (l.pitIn) s.pits++;
  }
  const stintOut = stints.map((s, i) => {
    const pace = s.laps.filter(racing).map((l) => l.lapTime);
    return {
      nr: i + 1,
      driver: s.driver,
      start: s.start,
      laps: s.laps.length,
      from: s.laps[0].lapNumber,
      to: s.laps[s.laps.length - 1].lapNumber,
      time: r1(s.laps.reduce((t, l) => t + (l.lapTime > 0 ? l.lapTime : 0), 0)),
      best: r3(pace.length ? Math.min(...pace) : null),
      median: r3(median(pace)),
      pits: s.pits,
    };
  });

  // Fahrer gesamt
  const byDriver = new Map();
  for (const l of laps) {
    const d = byDriver.get(l.driver.slug) || { driver: name(l.driver), laps: 0, time: 0, pace: [], offtracks: 0, stints: 0 };
    d.laps++;
    if (l.lapTime > 0) d.time += l.lapTime;
    if (racing(l)) d.pace.push(l.lapTime);
    if (l.offtrack) d.offtracks++;
    byDriver.set(l.driver.slug, d);
  }
  stints.forEach((s) => { byDriver.get(s.slug).stints++; });
  const drivers = [...byDriver.values()].map((d) => ({
    driver: d.driver, laps: d.laps, stints: d.stints, time: r1(d.time), offtracks: d.offtracks,
    best: r3(d.pace.length ? Math.min(...d.pace) : null), median: r3(median(d.pace)), spread: r3(spread(d.pace)),
  })).sort((a, b) => b.time - a.time);

  const pace = laps.filter(racing);
  const bestLap = pace.reduce((b, l) => (!b || l.lapTime < b.lapTime ? l : b), null);
  const fuel = laps.filter((l) => racing(l) && l.fuelUsed > 0).map((l) => l.fuelUsed);
  const first = laps[0], last = laps[laps.length - 1];
  const ends = new Date(new Date(last.startTime).getTime() + Math.max(0, last.lapTime) * 1000);
  const temps = (k) => laps.map((l) => l[k]).filter((v) => typeof v === "number");

  return {
    ...base,
    start: first.startTime,
    end: ends.toISOString(),
    duration: Math.round((ends - new Date(first.startTime)) / 1000),
    laps: Math.max(...laps.map((l) => l.lapNumber)),
    lapsRecorded: laps.length,
    pits: laps.filter((l) => l.pitIn).length,
    offtracks: laps.filter((l) => l.offtrack).length,
    cleanShare: r3(laps.filter((l) => l.clean).length / laps.length),
    bestLap: bestLap ? { time: r3(bestLap.lapTime), driver: name(bestLap.driver), lap: bestLap.lapNumber } : null,
    medianLap: r3(median(pace.map((l) => l.lapTime))),
    fuelPerLap: r1(median(fuel)),
    weather: {
      airStart: r1(first.airTemp), airEnd: r1(last.airTemp),
      trackStart: r1(first.trackTemp), trackEnd: r1(last.trackTemp),
      trackMin: r1(Math.min(...temps("trackTemp"))), trackMax: r1(Math.max(...temps("trackTemp"))),
      rain: laps.some((l) => l.precipitation > 0),
    },
    drivers,
    stints: stintOut,
  };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (!requireSession(req, res)) return;
  try {
    const q = req.query || {};
    if (q.event !== undefined) {
      if (!ID.test(q.event)) return res.status(400).json({ error: "Ungültiges Event." });
      return res.status(200).json(await cached(`race:${q.event}`, 86400, () => analyse(q.event)));
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(q.datum || "")) return res.status(400).json({ error: "Datum fehlt (JJJJ-MM-TT)." });
    return res.status(200).json({ events: await cached(`events:${q.datum}`, 900, () => candidates(q.datum)) });
  } catch (e) {
    return sendError(res, e);
  }
};
