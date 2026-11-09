// Teilen-Adresse einer Fahrerkarte (/karte?serie=…&k=…&f=…): liefert Discord und anderen Diensten die Vorschau, Menschen werden zur Karte weitergeleitet.
// Enthält nur Daten, die ohnehin öffentlich unter /liga stehen.
const D = require("./liga-daten");

const BASIS = "https://darklineperformance.de";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Gleiche Bildauswahl wie auf der Ligaseite, damit Vorschau und Karte zusammenpassen.
const LIVERYS = ["porsche", "ferrari", "bmw", "amg", "ford"];
const livery = (id) => LIVERYS[[...String(id)].reduce((t, c) => t + c.charCodeAt(0), 0) % LIVERYS.length];
const rangFarbe = (w) => (w === null ? "#8a9390" : w >= 85 ? "#ffd966" : w >= 70 ? "#cdd5da" : "#e09a62");
const WERTE = [["Speed", "speed"], ["Sauberkeit", "sauberkeit"], ["Racecraft", "racecraft"], ["Konstanz", "konstanz"]];

function baueSeite(serie, gruppe, fahrer) {
  const c = fahrer.karte;
  const ziel = `/liga?serie=${encodeURIComponent(serie.id)}#fahrer/${encodeURIComponent(gruppe.id)}/${encodeURIComponent(fahrer.name)}`;
  const titel = c.rating === null ? fahrer.name : `${fahrer.name} · Darkline Rating ${c.rating}`;
  const werte = WERTE.filter(([, feld]) => c[feld] !== null).map(([label, feld]) => `${label} ${c[feld]}`).join(" · ");
  const zeilen = [
    `${serie.name} · ${gruppe.name} · P${fahrer.pos} · ${fahrer.punkte} Punkte`,
    werte,
    c.abzeichen.map((a) => a.text).join(" · "),
  ].filter(Boolean).join("\n");
  const bild = serie.bildVersion ? `${BASIS}/api/liga?r=bild&k=${encodeURIComponent(`serie-${serie.id}`)}&v=${encodeURIComponent(serie.bildVersion)}` : `${BASIS}/img/cars/${livery(serie.id)}.webp`;
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<title>${esc(titel)}</title>
<meta name="robots" content="noindex">
<meta property="og:site_name" content="Darkline Simracing Series">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(titel)}">
<meta property="og:description" content="${esc(zeilen)}">
<meta property="og:image" content="${esc(bild)}">
<meta property="og:url" content="${esc(BASIS + ziel)}">
<meta name="theme-color" content="${rangFarbe(c.rating)}">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=${esc(ziel)}">
</head><body><p><a href="${esc(ziel)}">Zur Fahrerkarte von ${esc(fahrer.name)}</a></p></body></html>`;
}

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).json({ error: "Nicht erlaubt" });
  const { serie: kennung, k, f } = req.query || {};
  const weiter = (ziel) => { res.setHeader("Location", ziel); return res.status(302).end(); };
  if (!D.istId(kennung)) return weiter("/liga");
  const { serien } = await D.katalog(false);
  const serie = serien.find((s) => s.id === kennung);
  if (!serie) return weiter("/liga");
  const tabelle = await D.tabelleLesen(kennung);
  const gruppe = tabelle && (tabelle.klassen || []).find((x) => x.id === k);
  const fahrer = gruppe && gruppe.fahrer.find((x) => x.name === f);
  if (!fahrer || !fahrer.karte) return weiter(`/liga?serie=${encodeURIComponent(kennung)}`);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Robots-Tag", "noindex");
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return res.status(200).end(baueSeite(serie, gruppe, fahrer));
};
module.exports.baueSeite = baueSeite;
