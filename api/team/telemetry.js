// Telemetrie einer Runde für den Vergleich im Teambereich.
// GET ?lap=<ID> → Rundendaten auf 4000 Punkte über die Runde, GPS auf 2000 (Garage 61 zeichnet mit 60 Hz auf,
// je nach Rundenlänge ca. 5000–8000 Messpunkte, ~800 KB CSV). Runden ändern sich nicht, deshalb wird das Ergebnis einen Tag gemerkt.
//
// Referenzrunden: schnelle Runden fremder Fahrer, die ein Admin als CSV aus Garage 61 exportiert und im Admin
// (/admin/streckenkarte) hochlädt. Unser Garage-61-Zugang darf deren Telemetrie nicht selbst abrufen. Sie liegen im
// privaten Vercel-Blob-Speicher (nicht im öffentlichen Repository) und werden genauso aufbereitet wie Team-Runden.
// GET ?refs=<Strecke>          → Referenzrunden dieser Strecke (nur Angaben, ohne Telemetrie)
// GET ?ref=<ID>                → Telemetrie einer Referenzrunde, Aufbau wie bei ?lap
// POST (nur Admin)             → { track, trackName, car, carName, driver, lapTime, link, csv } aufbereiten und speichern
// DELETE ?ref=<ID> (nur Admin) → Referenzrunde entfernen
const { requireAdmin, requireAdminOrSession } = require("../_lib/admin"); // Teambereich oder Admin-Werkzeug (Streckenkarte)
const { g61Get, g61Text, cached, sendError } = require("../_lib/g61");
const { blobPut, blobGet, blobDelete } = require("../_lib/blob");

// Punkte über die Runde: nah an der echten Aufzeichnung, damit kurze Eingaben (Antippen der Bremse, Gas lupfen) sichtbar bleiben
const N = 4000;
const MAP_N = 2000;  // GPS-Punkte für die Streckenkarte (ca. alle 2 m), damit die Fahrlinie auch stark gezoomt glatt ist

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
  }
  // GPS für die Karte feiner als die Diagramme, damit die Fahrlinie auch stark gezoomt glatt bleibt
  k = 0;
  for (let j = 0; j < MAP_N; j++) {
    const g = j / (MAP_N - 1);
    while (k < rows.length - 2 && rows[k + 1].d < g) k++;
    const a = rows[k], b = rows[k + 1];
    const f = Math.min(1, Math.max(0, (g - a.d) / (b.d - a.d)));
    out.lat.push(round(a.lat + (b.lat - a.lat) * f, 7));
    out.lon.push(round(a.lon + (b.lon - a.lon) * f, 7));
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

// ---------------------------------------------------------------- Referenzrunden

const REF = /^ref-[0-9a-z-]{4,60}$/;
const INDEX = "refs/index.json";

async function refIndex() {
  const text = await blobGet(INDEX);
  return text ? JSON.parse(text).refs || [] : [];
}

async function addReference(body, admin) {
  const b = typeof body === "string" ? JSON.parse(body) : body || {};
  const track = Number(b.track), car = Number(b.car), lapTime = Number(b.lapTime);
  const text = (v, max) => String(v || "").trim().slice(0, max);
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  if (!Number.isInteger(track) || track <= 0 || !Number.isInteger(car) || car <= 0) throw bad("Strecke oder Auto fehlt.");
  if (!(lapTime > 20 && lapTime < 3600)) throw bad("Rundenzeit fehlt oder ist ungültig.");
  if (!text(b.driver, 80)) throw bad("Fahrername fehlt.");
  if (typeof b.csv !== "string" || b.csv.length < 1000) throw bad("Die CSV-Datei fehlt oder ist leer.");
  const link = /^https:\/\/garage61\.net\//.test(b.link || "") ? text(b.link, 300) : "";
  let data;
  try {
    data = resample(readSamples(b.csv), lapTime);
  } catch (e) {
    throw bad(`Die CSV passt nicht: ${e.message}`);
  }
  const id = `ref-${track}-${car}-${Date.now().toString(36)}`;
  const meta = { id, track, car, trackName: text(b.trackName, 120), carName: text(b.carName, 120), driver: text(b.driver, 80),
    lapTime, link, uploaded: new Date().toISOString(), by: admin };
  await blobPut(`refs/${id}.json`, JSON.stringify({ id, driver: meta.driver, car: meta.carName, track: meta.trackName,
    lapTime, sectors: null, date: null, reference: true, link, ...data }), "application/json");
  const refs = (await refIndex()).concat(meta);
  await blobPut(INDEX, JSON.stringify({ refs }), "application/json");
  return meta;
}

async function removeReference(id) {
  const refs = await refIndex();
  await blobPut(INDEX, JSON.stringify({ refs: refs.filter((r) => r.id !== id) }), "application/json");
  await blobDelete([`refs/${id}.json`]);
}

async function references(req, res) {
  const q = req.query || {};
  if (req.method === "POST" || req.method === "DELETE") {
    // Hochladen und Entfernen nur mit Admin-Anmeldung (GitHub), nicht aus dem Teambereich
    const admin = req.headers.authorization ? await requireAdmin(req, res) : null;
    if (!admin) return res.headersSent ? null : res.status(403).json({ error: "Nur für Admins." });
    if (req.method === "POST") return res.status(200).json(await addReference(req.body, admin));
    if (!REF.test(q.ref || "")) return res.status(400).json({ error: "Ungültige Referenzrunde." });
    await removeReference(q.ref);
    return res.status(200).json({ ok: true });
  }
  if (!(await requireAdminOrSession(req, res))) return null;
  if (q.refs !== undefined) {
    const track = Number(q.refs);
    return res.status(200).json({ refs: (await refIndex()).filter((r) => r.track === track) });
  }
  if (!REF.test(q.ref || "")) return res.status(400).json({ error: "Ungültige Referenzrunde." });
  const text = await cached(`ref:${q.ref}`, 86400, () => blobGet(`refs/${q.ref}.json`));
  if (!text) return res.status(404).json({ error: "Referenzrunde nicht gefunden." });
  return res.status(200).json(JSON.parse(text));
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const q = req.query || {};
  if (req.method !== "GET" || q.ref !== undefined || q.refs !== undefined) {
    try {
      return await references(req, res);
    } catch (e) {
      if (e.status === 400) return res.status(400).json({ error: e.message });
      return sendError(res, e);
    }
  }
  if (!(await requireAdminOrSession(req, res))) return;
  const id = String(req.query.lap || "");
  if (!/^[0-9A-Za-z]{20,32}$/.test(id)) return res.status(400).json({ error: "Ungültige Runde." });
  try {
    return res.status(200).json(await cached(`tele4k:${id}`, 86400, () => lapTelemetry(id)));
  } catch (e) {
    if (e.status === 403) return res.status(403).json({ error: "Diese Runde teilt der Fahrer nicht in Garage 61." });
    if (e.status === 404) return res.status(404).json({ error: "Runde nicht gefunden." });
    return sendError(res, e);
  }
};
