// Länder und selbst gezeichnete Flaggen fürs Fahrerprofil. Windows zeigt Flaggen-Emojis nicht an, und so lädt kein fremder Dienst mit.
// Läuft im Browser (window.LigaFlaggen) und in Node (Prüfung der Eingaben).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LigaFlaggen = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const B = 30;
  const H = 20;
  const quer = (farben) => farben.map((f, i) => `<rect y="${(i * H) / farben.length}" width="${B}" height="${H / farben.length}" fill="${f}"/>`).join("");
  const hoch = (farben) => farben.map((f, i) => `<rect x="${(i * B) / farben.length}" width="${B / farben.length}" height="${H}" fill="${f}"/>`).join("");
  const kreuz = (grund, farbe, innen) => `<rect width="${B}" height="${H}" fill="${grund}"/><rect x="9" width="6" height="${H}" fill="${farbe}"/><rect y="7" width="${B}" height="6" fill="${farbe}"/>${innen ? `<rect x="10.5" width="3" height="${H}" fill="${innen}"/><rect y="8.5" width="${B}" height="3" fill="${innen}"/>` : ""}`;
  const FLAGGEN = {
    DE: quer(["#000", "#d00", "#ffce00"]),
    AT: quer(["#ed2939", "#fff", "#ed2939"]),
    CH: `<rect width="${B}" height="${H}" fill="#d52b1e"/><rect x="13" y="4" width="4" height="12" fill="#fff"/><rect x="9" y="8" width="12" height="4" fill="#fff"/>`,
    NL: quer(["#ae1c28", "#fff", "#21468b"]),
    BE: hoch(["#000", "#fae042", "#ed2939"]),
    LU: quer(["#ed2939", "#fff", "#00a1de"]),
    FR: hoch(["#0055a4", "#fff", "#ef4135"]),
    IT: hoch(["#009246", "#fff", "#ce2b37"]),
    IE: hoch(["#169b62", "#fff", "#ff883e"]),
    ES: `<rect width="${B}" height="${H}" fill="#aa151b"/><rect y="5" width="${B}" height="10" fill="#f1bf00"/>`,
    PL: quer(["#fff", "#dc143c"]),
    CZ: `${quer(["#fff", "#d7141a"])}<polygon points="0,0 15,10 0,20" fill="#11457e"/>`,
    HU: quer(["#ce2939", "#fff", "#477050"]),
    DK: kreuz("#c8102e", "#fff"),
    SE: kreuz("#006aa7", "#fecc00"),
    NO: kreuz("#ba0c2f", "#fff", "#00205b"),
    FI: kreuz("#fff", "#003580"),
    GB: `<rect width="${B}" height="${H}" fill="#012169"/><path d="M0 0L30 20M30 0L0 20" stroke="#fff" stroke-width="4"/><path d="M0 0L30 20M30 0L0 20" stroke="#c8102e" stroke-width="1.5"/><rect x="12" width="6" height="${H}" fill="#fff"/><rect y="7" width="${B}" height="6" fill="#fff"/><rect x="13.2" width="3.6" height="${H}" fill="#c8102e"/><rect y="8.2" width="${B}" height="3.6" fill="#c8102e"/>`,
  };
  const LAENDER = [["DE", "Deutschland"], ["AT", "Österreich"], ["CH", "Schweiz"], ["NL", "Niederlande"], ["BE", "Belgien"], ["LU", "Luxemburg"], ["FR", "Frankreich"], ["IT", "Italien"], ["ES", "Spanien"], ["IE", "Irland"], ["GB", "Vereinigtes Königreich"], ["PL", "Polen"], ["CZ", "Tschechien"], ["HU", "Ungarn"], ["DK", "Dänemark"], ["SE", "Schweden"], ["NO", "Norwegen"], ["FI", "Finnland"]];
  const gueltig = (code) => Object.prototype.hasOwnProperty.call(FLAGGEN, code);
  const name = (code) => (LAENDER.find(([c]) => c === code) || [])[1] || "";
  // Als Bildquelle, damit die Flagge auch auf die Fahrerkarte als Bild gezeichnet werden kann
  const quelle = (code) => (gueltig(code) ? `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${B} ${H}" width="${B}" height="${H}">${FLAGGEN[code]}</svg>`)}` : "");
  return { LAENDER, gueltig, name, quelle };
});
