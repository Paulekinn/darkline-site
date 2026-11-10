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
      ${eintrag("/regelwerk", "Regelwerk", pfad === "/regelwerk", "liga-nav-regeln")}
      ${sichtbar.map((s) => eintrag(`/liga?serie=${encodeURIComponent(s.id)}`, s.name, s.id === aktuelleSerie, `liga-nav-serie s-${FARBEN.includes(s.farbe) ? s.farbe : "rot"}${s.typ === "event" ? " liga-nav-event" : ""}`)).join("")}
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

  /* Streifen über dem Inhalt: Übertragung am Renntag, sonst der Aufruf für Broadcaster.
     Live gilt nach den Rennzeiten im Kalender, nicht nach dem echten Stream-Status. */
  const LIVE_MS = 3.5 * 3600e3;
  const ZU = "liga-broadcaster-zu";
  const zuBis = () => { try { return Number(localStorage.getItem(ZU)) || 0; } catch (e) { return 0; } };
  function streamStreifen(daten) {
    const main = document.querySelector("main");
    if (!main || !daten) return;
    const alt = main.querySelector(".liga-stream");
    if (alt) alt.remove();
    const serien = (daten.serien || []).filter((s) => s.status !== "beendet");
    const nachId = Object.fromEntries(serien.map((s) => [s.id, s]));
    const jetzt = Date.now();
    const heute = new Date().toDateString();
    const termine = (daten.rennen || [])
      .filter((r) => r.status !== "abgesagt" && r.datum && r.startzeit && nachId[r.serie] && nachId[r.serie].uebertragung)
      .map((r) => ({ r, s: nachId[r.serie], t: new Date(`${r.datum}T${String(r.startzeit).padStart(5, "0")}:00`).getTime() }))
      .filter((x) => new Date(x.t).toDateString() === heute || (jetzt >= x.t && jetzt <= x.t + LIVE_MS))
      .sort((a, b) => a.t - b.t);
    const live = termine.find((x) => jetzt >= x.t && jetzt <= x.t + LIVE_MS);
    const spaeter = termine.find((x) => jetzt < x.t);
    const titel = (x) => [x.s.name, x.r.titel].filter(Boolean).join(" · ");
    let html = "";
    if (live) html = `<a class="liga-stream live" href="${esc(live.s.uebertragung)}" target="_blank" rel="noopener"><div class="wrap"><i aria-hidden="true"></i><b>Live</b><span>${esc(titel(live))}</span><em>Jetzt ansehen →</em></div></a>`;
    else if (spaeter) html = `<a class="liga-stream heute" href="${esc(spaeter.s.uebertragung)}" target="_blank" rel="noopener"><div class="wrap"><b>📺 Heute</b><span>ab ${esc(spaeter.r.startzeit)} Uhr live: ${esc(titel(spaeter))}</span><em>Zum Kanal →</em></div></a>`;
    else if (serien.some((s) => !s.uebertragung) && zuBis() < jetzt) html = `<div class="liga-stream suche"><div class="wrap"><b>🎙️ Broadcaster gesucht</b><span>Du willst unsere Rennen kommentieren oder übertragen?</span><a href="https://discord.gg/QP2rKy6n8U" target="_blank" rel="noopener">Melde dich im Discord unter #bewerbung →</a><button type="button" class="liga-stream-zu" aria-label="Hinweis für 30 Tage ausblenden">✕</button></div></div>`;
    if (html) main.insertAdjacentHTML("afterbegin", html);
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".liga-stream-zu")) return;
    try { localStorage.setItem(ZU, String(Date.now() + 30 * 864e5)); } catch (err) { /* ohne Speicher nur bis zum Neuladen */ }
    const streifen = e.target.closest(".liga-stream");
    if (streifen) streifen.remove();
  });

  zeichne([], false, false);
  Promise.all([lade("api/liga?r=oeffentlich"), lade("api/liga?r=admin&nur=status"), lade("api/liga?r=fahrer&nur=status")]).then(([daten, admin, fahrer]) => {
    // Rennleitung zeigen, wenn dort schon angemeldet oder die Discord-Rolle beim Fahrer-Login erkannt wurde.
    zeichne((daten && daten.serien) || [], !!(admin && admin.angemeldet) || !!(fahrer && fahrer.leitung), !!(fahrer && fahrer.angemeldet));
    streamStreifen(daten);
  });
})();
