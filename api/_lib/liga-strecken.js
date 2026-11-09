// Streckenliste und Streckenkarten aus Garage 61 für die Rennleitung.
// Die Karte wird aus den GPS-Punkten einer Team-Runde berechnet. Fahrernamen verlassen diese Datei nicht.
// Das Token teilt sich die Website mit dem Bestzeiten-Bot: Karten entstehen deshalb nur einzeln auf Knopfdruck.
const { g61Get, g61Text, items, teamSlug, tracks } = require("./g61");
const D = require("./liga-daten");
const { Hinweis } = D;

const MAX_PUNKTE = 1200;
const VERSUCHE = 3;

const schluessel = (name, variante) => [name, variante].filter(Boolean).join(" ").trim().toLowerCase();

// Macht aus der Garage-61-Liste (ID → { name, variant }) die Einträge für die Bibliothek.
function importListe(gefunden) {
  const belegt = new Set();
  const liste = [];
  for (const [g61, t] of gefunden) {
    const name = String(t.name || "").trim().slice(0, 80);
    const variante = String(t.variant || "").trim().slice(0, 60);
    if (name.length < 2) continue;
    let id = D.slug([name, variante].filter(Boolean).join(" "));
    if (belegt.has(id)) id = `${id}-${g61}`;
    if (!D.istId(id) || belegt.has(id)) continue;
    belegt.add(id);
    liste.push({ id, name, variante, g61 });
  }
  return liste;
}

// Findet die Garage-61-ID einer von Hand angelegten Strecke über Name und Variante.
function zuordnung(strecke, gefunden) {
  const gesucht = schluessel(strecke.name, strecke.variante);
  for (const [id, t] of gefunden) if (schluessel(t.name, t.variant) === gesucht) return id;
  return null;
}

// Runden mit freigegebener Telemetrie, saubere und schnelle zuerst.
const besteRunden = (runden) => runden
  .filter((r) => r && r.id && r.lapTime > 0 && r.canViewTelemetry)
  .sort((a, b) => (b.clean ? 1 : 0) - (a.clean ? 1 : 0) || a.lapTime - b.lapTime)
  .slice(0, VERSUCHE);

// Liest aus der CSV nur die GPS-Punkte dieser einen Runde.
function gpsAusCsv(csv) {
  const zeilen = String(csv || "").trim().split(/\r?\n/);
  const kopf = zeilen[0].split(",");
  const [sd, slat, slon] = ["LapDistPct", "Lat", "Lon"].map((n) => kopf.indexOf(n));
  if (sd < 0 || slat < 0 || slon < 0) return [];
  const punkte = [];
  let vorher = -1;
  for (let i = 1; i < zeilen.length; i++) {
    const f = zeilen[i].split(",");
    const d = Number(f[sd]);
    const lat = Number(f[slat]);
    const lon = Number(f[slon]);
    if (!Number.isFinite(d) || !Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    if (!punkte.length && d > 0.5) continue; // Ende der Vorrunde am Anfang der Datei
    if (d < vorher - 0.5) break;             // Beginn der nächsten Runde am Ende der Datei
    if (d <= vorher) continue;
    punkte.push({ d, lat, lon });
    vorher = d;
  }
  return punkte;
}

// Rechnet die GPS-Punkte in eine Linie von 0 bis 1000 um. Eine unvollständige oder springende Runde ergibt null.
function umriss(gps) {
  if (gps.length < 100 || gps[0].d > 0.02 || gps[gps.length - 1].d < 0.98) return null;
  const kx = 111320 * Math.cos(gps[0].lat * Math.PI / 180);
  const xy = gps.map((p) => [p.lon * kx, -p.lat * 111320]);
  const xs = xy.map((p) => p[0]);
  const ys = xy.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanne = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY);
  if (!(spanne >= 100)) return null;
  const abstand = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  if (xy.some((p, i) => i > 0 && abstand(p, xy[i - 1]) > spanne * 0.1)) return null;
  const schritt = Math.max(1, Math.ceil(xy.length / MAX_PUNKTE));
  const auswahl = xy.filter((p, i) => i % schritt === 0 || i === xy.length - 1);
  const faktor = 1000 / spanne;
  const eine = (v) => Math.round(v * 10) / 10;
  return {
    punkte: auswahl.map(([x, y]) => [eine((x - minX) * faktor), eine((y - minY) * faktor)]),
    geschlossen: abstand(xy[0], xy[xy.length - 1]) < spanne * 0.02,
  };
}

function g61Fehler(e) {
  if (e instanceof Hinweis) return e;
  if (e.retryAfter) return new Hinweis(`Garage 61 ist gerade ausgelastet. Bitte in ${Math.ceil(e.retryAfter / 60)} Minute(n) noch einmal versuchen.`);
  console.error("Liga Garage 61:", e.message);
  return new Hinweis("Garage 61 ist gerade nicht erreichbar. Bitte versuche es später noch einmal.");
}

async function streckenLaden() {
  try {
    return importListe(await tracks());
  } catch (e) {
    throw g61Fehler(e);
  }
}

// Liefert { punkte, geschlossen } oder { fehlt: "zuordnung" | "runde" | "telemetrie" }.
async function kartendaten(strecke) {
  try {
    const g61 = strecke.g61 || zuordnung(strecke, await tracks());
    if (!g61) return { fehlt: "zuordnung" };
    const runden = besteRunden(items(await g61Get("/laps", { tracks: g61, teams: teamSlug(), drivers: "me", group: "driver-car", limit: 1000 })));
    if (!runden.length) return { fehlt: "runde" };
    for (const runde of runden) {
      const linie = umriss(gpsAusCsv(await g61Text(`/laps/${runde.id}/csv`)));
      if (linie) return linie;
    }
    return { fehlt: "telemetrie" };
  } catch (e) {
    throw g61Fehler(e);
  }
}

module.exports = { importListe, zuordnung, besteRunden, gpsAusCsv, umriss, streckenLaden, kartendaten };
