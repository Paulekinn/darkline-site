/* Feste Navigation der Darkline Liga auf Ligaseite und Fahrerbereich */
(function () {
  "use strict";
  const nav = document.getElementById("liga-nav");
  const konto = document.getElementById("liga-konto");
  if (!nav || !konto) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const FARBEN = ["rot", "blau", "lila", "gruen", "gelb", "tuerkis"];
  const pfad = location.pathname.replace(/\/$/, "");
  const aktuelleSerie = new URLSearchParams(location.search).get("serie");
  const lade = (u) => fetch(u, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  const eintrag = (href, text, aktiv, klasse) => `<a href="${esc(href)}" class="${klasse || ""}"${aktiv ? ' aria-current="page"' : ""}>${esc(text)}</a>`;

  function zeichne(serien, rennleitung, angemeldet) {
    // Laufende Serien immer, eine beendete nur, solange man sie gerade ansieht
    const sichtbar = serien.filter((s) => s.status !== "beendet" || s.id === aktuelleSerie);
    nav.innerHTML = `<div class="wrap">
      ${eintrag("/liga", "Übersicht", pfad === "/liga" && !aktuelleSerie)}
      ${sichtbar.map((s) => eintrag(`/liga?serie=${encodeURIComponent(s.id)}`, s.name, s.id === aktuelleSerie, `liga-nav-serie s-${FARBEN.includes(s.farbe) ? s.farbe : "rot"}${s.typ === "event" ? " liga-nav-event" : ""}`)).join("")}
      ${eintrag("/regelwerk", "Regelwerk", pfad === "/regelwerk", "liga-nav-regeln")}
    </div>`;
    konto.innerHTML = `${eintrag("/fahrerbereich", "Fahrerbereich", pfad === "/fahrerbereich", "haupt")}
      ${rennleitung ? eintrag("/liga-admin", "Rennleitung", false, "leitung") : ""}
      ${angemeldet ? '<button type="button" id="liga-logout">Ausloggen</button>' : ""}`;
  }

  konto.addEventListener("click", async (e) => {
    if (!e.target.closest("#liga-logout")) return;
    e.target.disabled = true;
    await fetch("api/liga?r=fahrer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aktion: "logout" }) }).catch(() => null);
    location.reload();
  });

  zeichne([], false, false);
  Promise.all([lade("api/liga?r=oeffentlich"), lade("api/liga?r=admin&nur=status"), lade("api/liga?r=fahrer&nur=status")]).then(([daten, admin, fahrer]) => {
    zeichne((daten && daten.serien) || [], !!(admin && admin.angemeldet), !!(fahrer && fahrer.angemeldet));
  });
})();
