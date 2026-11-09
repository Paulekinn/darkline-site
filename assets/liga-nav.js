/* Feste Navigation der Darkline Liga auf Ligaseite und Fahrerbereich */
(function () {
  "use strict";
  const nav = document.getElementById("liga-nav");
  if (!nav) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const FARBEN = ["rot", "blau", "lila", "gruen", "gelb", "tuerkis"];
  const pfad = location.pathname.replace(/\/$/, "");
  const aktuelleSerie = new URLSearchParams(location.search).get("serie");
  const lade = (u) => fetch(u, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  const eintrag = (href, text, aktiv, klasse) => `<a href="${esc(href)}" class="${klasse || ""}"${aktiv ? ' aria-current="page"' : ""}>${esc(text)}</a>`;

  function zeichne(serien, rennleitung) {
    // Laufende Serien immer, eine beendete nur, solange man sie gerade ansieht
    const sichtbar = serien.filter((s) => s.status !== "beendet" || s.id === aktuelleSerie);
    nav.innerHTML = `<div class="wrap">
      ${eintrag("/liga", "Übersicht", pfad === "/liga" && !aktuelleSerie)}
      ${sichtbar.map((s) => eintrag(`/liga?serie=${encodeURIComponent(s.id)}`, s.name, s.id === aktuelleSerie, `liga-nav-serie s-${FARBEN.includes(s.farbe) ? s.farbe : "rot"}`)).join("")}
      ${eintrag("/fahrerbereich", "Fahrerbereich", pfad === "/fahrerbereich", "liga-nav-rechts")}
      ${rennleitung ? eintrag("/liga-admin", "Rennleitung", false) : ""}
    </div>`;
  }

  zeichne([], false);
  Promise.all([lade("api/liga?r=oeffentlich"), lade("api/liga?r=admin&nur=status")]).then(([daten, admin]) => {
    zeichne((daten && daten.serien) || [], !!(admin && admin.angemeldet));
  });
})();
