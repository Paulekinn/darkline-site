// Telemetrie einer Runde für den Vergleich im Teambereich.
// GET ?lap=<ID> → Rundendaten, verdichtet auf 1000 Punkte über die Runde (statt ca. 5000 Messpunkte, ~800 KB CSV).
// Runden ändern sich nicht, deshalb wird das Ergebnis einen Tag gemerkt.
const { requireSession } = require("../_lib/session");
const { g61Get, g61Text, cached, sendError } = require("../_lib/g61");

const N = 1000;      // Punkte über die Runde
const MAP_STEP = 1;  // GPS für die Streckenkarte: jeder Punkt (ca. alle 4 m), damit die Karte beim Zoom die Fahrlinie zeigt

const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;

// Liest die CSV von Garage 61 und behält nur die Messpunkte dieser Runde (Rundenposition steigt von 0 bis 1).
function readSamples(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const head = lines[0].split(",");
  const at = (name) => {
    const i = head.indexOf(name);
    if (i === -1) throw new Error(`Spalte ${name} fehlt in der Telemetrie.`);
    return i;
  };
  const c = { d: at("LapDistPct"), speed: at("Speed"), throttle: at("Throttle"), brake: at("Brake"), gear: at("Gear"),
    steer: at("SteeringWheelAngle"), lat: at("Lat"), lon: at("Lon") };
  const rows = [];
  let prev = -1;
  let lastGear = 1;
  for (let k = 1; k < lines.length; k++) {
    const f = lines[k].split(",");
    const d = Number(f[c.d]);
    if (!Number.isFinite(d)) continue;
    if (!rows.length && d > 0.5) continue; // Ende der Vorrunde am Anfang der Datei
    if (d < prev - 0.5) break;             // Beginn der nächsten Runde am Ende der Datei
    if (d <= prev) continue;               // Standpunkte oder Rücksprünge auslassen
    const speed = +f[c.speed];
    // Beim Schalten meldet iRacing kurz Leerlauf (0); in Fahrt gilt dann weiter der vorherige Gang
    let gear = +f[c.gear];
    if (gear <= 0 && speed > 8) gear = lastGear;
    lastGear = gear;
    rows.push({ d, speed, throttle: +f[c.throttle], brake: +f[c.brake], gear,
      steer: +f[c.steer], lat: +f[c.lat], lon: +f[c.lon] });
    prev = d;
  }
  if (rows.length < 100) throw new Error("Zu wenige Telemetrie-Daten für diese Runde.");
  return rows;
}

// Verteilt die Messpunkte gleichmäßig über die Runde. Zeit und Strecke werden aus Speed und Rundenzeit errechnet,
// weil die CSV keine Zeitspalte hat.
function resample(rows, lapTime) {
  const dt = lapTime / rows.length;
  let dist = 0;
  rows.forEach((r, i) => {
    r.t = i * dt;
    r.m = dist;
    dist += r.speed * dt;
  });
  const out = { pct: [], t: [], m: [], speed: [], throttle: [], brake: [], gear: [], steer: [], lat: [], lon: [] };
  let k = 0;
  for (let j = 0; j < N; j++) {
    const g = j / (N - 1);
    while (k < rows.length - 2 && rows[k + 1].d < g) k++;
    const a = rows[k], b = rows[k + 1];
    const f = Math.min(1, Math.max(0, (g - a.d) / (b.d - a.d)));
    const mix = (key) => a[key] + (b[key] - a[key]) * f;
    out.pct.push(round(g * 100, 2));
    out.t.push(round(mix("t"), 3));
    out.m.push(Math.round(mix("m")));
    out.speed.push(round(mix("speed") * 3.6, 1));      // m/s → km/h
    out.throttle.push(Math.round(mix("throttle") * 100));
    out.brake.push(Math.round(mix("brake") * 100));
    out.gear.push(f < 0.5 ? a.gear : b.gear);            // Gang nicht mitteln
    out.steer.push(round(mix("steer") * 180 / Math.PI, 1)); // rad → Grad
    if (j % MAP_STEP === 0) {
      out.lat.push(round(mix("lat"), 6));
      out.lon.push(round(mix("lon"), 6));
    }
  }
  return { length: Math.round(dist), points: out };
}

async function lapTelemetry(id) {
  const [lap, csv] = await Promise.all([g61Get(`/laps/${id}`), g61Text(`/laps/${id}/csv`)]);
  const driver = lap.driver || {};
  const track = lap.track || {};
  return {
    id,
    driver: [driver.firstName, driver.lastName].filter(Boolean).join(" ") || driver.slug || "Unbekannt",
    car: (lap.car && lap.car.name) || "",
    track: track.variant ? `${track.name} (${track.variant})` : track.name || "",
    lapTime: lap.lapTime,
    // offizielle iRacing-Sektorzeiten (Sekunden); null, wenn sie fehlen oder unvollständig sind
    sectors: Array.isArray(lap.sectors) && lap.sectors.length && lap.sectors.every((s) => s && !s.incomplete && s.sectorTime > 0)
      ? lap.sectors.map((s) => round(s.sectorTime, 3)) : null,
    date: lap.startTime,
    trackTemp: lap.trackTemp,
    ...resample(readSamples(csv), lap.lapTime),
  };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (!requireSession(req, res)) return;
  const id = String(req.query.lap || "");
  if (!/^[0-9A-Za-z]{20,32}$/.test(id)) return res.status(400).json({ error: "Ungültige Runde." });
  try {
    return res.status(200).json(await cached(`tele:${id}`, 86400, () => lapTelemetry(id)));
  } catch (e) {
    if (e.status === 403) return res.status(403).json({ error: "Diese Runde teilt der Fahrer nicht in Garage 61." });
    if (e.status === 404) return res.status(404).json({ error: "Runde nicht gefunden." });
    return sendError(res, e);
  }
};
