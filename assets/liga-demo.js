/* Beispiel-Liga unter /liga?demo: Die Liga-Seiten zeigen dann erfundene Daten aus assets/liga-demo.json statt der echten.
   Echte Daten, Anmeldungen und Discord bleiben unberührt. Gebaut werden die Daten mit scripts/liga-demo-bauen.js.
   Muss vor allen anderen Liga-Skripten geladen werden, weil es fetch für api/liga umleitet. */
(function () {
  "use strict";
  if (!new URLSearchParams(location.search).has("demo")) return;
  window.LigaDemo = true;
  const echtesFetch = window.fetch.bind(window);
  const TAG = 864e5;

  // Termine wandern mit: Die Daten wurden an einem festen Tag gebaut, angezeigt werden sie so, als wäre heute dieser Tag.
  const berlin = (ms) => new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  function verschiebe(wert, tage) {
    if (Array.isArray(wert)) return wert.map((w) => verschiebe(w, tage));
    if (wert && typeof wert === "object") return Object.fromEntries(Object.entries(wert).map(([k, w]) => [k, k === "gebaut" ? w : verschiebe(w, tage)]));
    if (typeof wert !== "string") return wert;
    if (/^\d{4}-\d{2}-\d{2}$/.test(wert)) return new Date(Date.parse(wert + "T12:00:00Z") + tage * TAG).toISOString().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(wert)) return new Date(Date.parse(wert) + tage * TAG).toISOString();
    return wert;
  }
  let daten = null;
  const laden = () => (daten = daten || echtesFetch("assets/liga-demo.json", { cache: "no-cache" }).then((r) => r.json()).then((d) => {
    const tage = Math.round((Date.parse(berlin(Date.now()) + "T12:00:00Z") - Date.parse(berlin(Date.parse(d.gebaut)) + "T12:00:00Z")) / TAG);
    return tage ? verschiebe(d, tage) : d;
  }));

  const antwort = (inhalt, status = 200) => new Response(JSON.stringify(inhalt), { status, headers: { "Content-Type": "application/json" } });
  window.fetch = async function (eingabe, optionen) {
    const url = new URL(typeof eingabe === "string" ? eingabe : eingabe.url, location.href);
    if (url.origin !== location.origin || !/\/api\/liga$/.test(url.pathname)) return echtesFetch(eingabe, optionen);
    const r = url.searchParams.get("r");
    const post = ((optionen && optionen.method) || "GET").toUpperCase() === "POST";
    if (r === "oeffentlich") {
      const d = await laden();
      const serie = url.searchParams.get("serie");
      return antwort({ ...d.uebersicht, ...((serie && d.serien[serie]) || {}) });
    }
    if (r === "profil") {
      const p = (await laden()).profile[url.searchParams.get("id")];
      return p ? antwort(p) : antwort({ error: "Nicht gefunden" }, 404);
    }
    if (r === "fahrer" || r === "admin") return post ? antwort({ error: "Das ist die Beispiel-Liga. Hier kann man sich nicht anmelden." }, 400) : antwort({ angemeldet: false });
    return echtesFetch(eingabe, optionen); // Bilder, Regelwerk
  };

  // Links innerhalb der Liga bleiben in der Demo.
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a || a.hasAttribute("data-echt")) return;
    const ziel = new URL(a.href, location.href);
    if (ziel.origin !== location.origin || !/^\/(liga|fahrer)(\.html)?$/.test(ziel.pathname) || ziel.searchParams.has("demo")) return;
    ziel.searchParams.set("demo", "1");
    a.href = ziel.pathname + ziel.search + ziel.hash;
  }, true);

  // Deutlicher Hinweis, damit niemand die Beispieldaten für echte hält
  const streifen = () => {
    if (document.querySelector(".liga-demo-streifen")) return;
    const el = document.createElement("div");
    el.className = "liga-demo-streifen";
    el.setAttribute("role", "note");
    el.innerHTML = '<b>Beispiel-Liga</b><span>Alle Namen, Ergebnisse und Termine sind erfunden.</span><a href="/liga" data-echt>Zur echten Liga</a>';
    document.body.prepend(el);
  };
  if (document.body) streifen(); else document.addEventListener("DOMContentLoaded", streifen);
})();
