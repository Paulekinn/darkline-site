// Vorschau für geteilte Telemetrie-Links: /vergleich?strecke=…&auto=…&a=…&b=…&zoom=…
// Discord & Co. lesen hier Titel und Beschreibung (Strecke, Fahrer, Rundenzeiten). Telemetrie wird nicht gezeigt.
// Besucher werden sofort zum Teambereich weitergeleitet, der Vergleich selbst ist dort weiterhin nur mit Login sichtbar.
const { g61Get, cached } = require("../_lib/g61");

const ID = /^[0-9A-Za-z]{20,32}$/;
const REF = /^ref-[0-9a-z-]{4,60}$/; // hochgeladene Referenzrunde; in der öffentlichen Vorschau ohne Namen und Zeit
const ZOOM = /^(k\d{1,2}|s\d|start|r\d{1,4}-\d{1,4})$/;
const SITE = "https://darklineperformance.de";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const lapTime = (t) => {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(3).padStart(6, "0")}`;
};
const signed = (v) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(3).replace(".", ",")} s`;

// Nur die Angaben, die in der Vorschau stehen; einen Tag gemerkt (Runden ändern sich nicht)
const lapMeta = (id) => cached(`meta:${id}`, 86400, async () => {
  const lap = await g61Get(`/laps/${id}`);
  const d = lap.driver || {}, t = lap.track || {};
  return {
    driver: [d.firstName, d.lastName].filter(Boolean).join(" ") || d.slug || "Unbekannt",
    track: t.variant ? `${t.name} (${t.variant})` : t.name || "",
    car: (lap.car && lap.car.name) || "",
    lapTime: lap.lapTime,
    sectors: Array.isArray(lap.sectors) ? lap.sectors.map((s) => s && s.sectorTime) : null,
  };
});

function zoomLabel(zoom, A, B) {
  if (!zoom) return "";
  if (zoom === "start") return "Start";
  if (zoom[0] === "k") return `Kurve ${zoom.slice(1)}`;
  if (zoom[0] === "r") return "Ausschnitt";
  const k = Number(zoom.slice(1)) - 1;
  const a = A.sectors && A.sectors[k], b = B && B.sectors && B.sectors[k];
  return `Sektor ${k + 1}` + (a && b ? ` ${signed(b - a)}` : "");
}

module.exports = async (req, res) => {
  const q = req.query || {};
  // Nur bekannte, geprüfte Angaben in den Link zum Teambereich übernehmen
  const params = new URLSearchParams();
  if (/^\d{1,6}$/.test(q.strecke || "")) params.set("strecke", q.strecke);
  if (/^\d{1,6}$/.test(q.auto || "")) params.set("auto", q.auto);
  if (ID.test(q.a || "") || REF.test(q.a || "")) params.set("a", q.a);
  if (ID.test(q.b || "") || REF.test(q.b || "")) params.set("b", q.b);
  if (ID.test(q.c || "") || REF.test(q.c || "")) params.set("c", q.c); // Runde C: nur weitergeben, nicht in der Vorschau
  if (ZOOM.test(q.zoom || "")) params.set("zoom", q.zoom);
  const target = `/team#telemetrie${params.toString() ? `?${params}` : ""}`;

  let title = "Telemetrie-Vergleich · Darkline Performance Motorsport";
  let text = "Vergleich zweier Runden im Teambereich. Nur für Teammitglieder, Anmeldung mit Discord.";
  try {
    if (ID.test(params.get("a") || "") && REF.test(params.get("b") || "")) {
      const A = await lapMeta(params.get("a"));
      title = `${A.track} · ${A.driver} vs. Referenzrunde`;
      text = [zoomLabel(params.get("zoom"), A, null), A.car, `A ${lapTime(A.lapTime)}`].filter(Boolean).join(" · ") + " · Telemetrie im Teambereich (Login mit Discord)";
    } else if (ID.test(params.get("a") || "")) {
      const [A, B] = await Promise.all([lapMeta(params.get("a")), ID.test(params.get("b") || "") ? lapMeta(params.get("b")) : null]);
      title = B ? `${A.track} · ${A.driver} vs. ${B.driver}` : `${A.track} · ${A.driver}`;
      const parts = [zoomLabel(params.get("zoom"), A, B), A.car,
        B ? `A ${lapTime(A.lapTime)} · B ${lapTime(B.lapTime)} (${signed(B.lapTime - A.lapTime)})` : lapTime(A.lapTime)];
      text = parts.filter(Boolean).join(" · ") + " · Telemetrie im Teambereich (Login mit Discord)";
    }
  } catch (e) {
    // Garage 61 nicht erreichbar oder Runde nicht freigegeben: allgemeine Vorschau
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.status(200).send(`<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="robots" content="noindex,nofollow">
<meta property="og:site_name" content="Darkline Performance Motorsport">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(text)}">
<meta property="og:image" content="${SITE}/img/og/default.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#d3121b">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
</head><body style="background:#08090a;color:#e8ecea;font-family:system-ui,sans-serif">
<p><a href="${esc(target)}" style="color:#e8ecea">Weiter zum Teambereich</a></p>
<script>location.replace(${JSON.stringify(target)});</script>
</body></html>`);
};
