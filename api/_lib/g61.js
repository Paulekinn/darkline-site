// Zugriff auf die Garage-61-API mit Zwischenspeicher.
// Das Token (GARAGE61_TOKEN) teilt sich die Website mit dem Bestzeiten-Bot, deshalb wird sparsam abgefragt:
// Antworten werden pro Funktionsinstanz für eine Weile gemerkt.
const API = "https://garage61.net/api/v1";
const cache = new Map();

class RateLimited extends Error {
  constructor(retryAfter) {
    super("Garage 61 meldet zu viele Anfragen.");
    this.retryAfter = retryAfter;
  }
}

function teamSlug() {
  const slug = process.env.G61_TEAM_SLUG;
  if (!slug) throw new Error("G61_TEAM_SLUG fehlt in den Vercel-Umgebungsvariablen.");
  return slug;
}

async function g61Get(path, params = {}) {
  const token = process.env.GARAGE61_TOKEN;
  if (!token) throw new Error("GARAGE61_TOKEN fehlt in den Vercel-Umgebungsvariablen.");
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${API}${path}${qs ? `?${qs}` : ""}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 429) throw new RateLimited(Number(r.headers.get("retry-after")) || 60);
  if (!r.ok) throw new Error(`Garage 61 antwortet mit ${r.status}.`);
  return r.json();
}

// Liefert den gemerkten Wert, solange er jünger als ttl Sekunden ist, sonst wird fn() neu ausgeführt.
// Läuft eine Abfrage schon, warten weitere Aufrufe auf dieselbe Antwort.
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = fn();
  cache.set(key, { value, until: Date.now() + ttl * 1000 });
  try {
    return await value;
  } catch (e) {
    cache.delete(key);
    throw e;
  }
}

const items = (data) => (Array.isArray(data) ? data : data.items || []);

const trackLabel = (t) => (t.variant ? `${t.name} (${t.variant})` : t.name);

// Namen von Strecken und Autos ändern sich selten: einen Tag merken.
// Strecken: ID → { name, variant }
const tracks = () => cached("tracks", 86400, async () => new Map(items(await g61Get("/tracks")).map((t) => [t.id, { name: t.name, variant: t.variant || "" }])));
const cars = () => cached("cars", 86400, async () => new Map(items(await g61Get("/cars")).map((c) => [c.id, c.name])));

// Einheitliche Fehlerantwort für die Daten-Funktionen.
function sendError(res, e) {
  if (e instanceof RateLimited) {
    res.setHeader("Retry-After", String(e.retryAfter));
    return res.status(503).json({ error: `Garage 61 ist gerade ausgelastet. Bitte in ${Math.ceil(e.retryAfter / 60)} Minute(n) noch einmal versuchen.` });
  }
  return res.status(500).json({ error: e.message || "Technischer Fehler." });
}

module.exports = { g61Get, cached, items, teamSlug, tracks, cars, trackLabel, sendError };
