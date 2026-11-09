/* Fahrerkarte: gemeinsamer Aufbau für Ligaseite, Fahrerbereich und Profilseite */
(function () {
  "use strict";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const WERTE = [["Speed", "speed", "s"], ["Sauberkeit", "sauberkeit", "c"], ["Racecraft", "racecraft", "r"], ["Konstanz", "konstanz", "k"]];
  const rang = (w) => (w === null || w === undefined ? "r-offen" : w >= 85 ? "r-gold" : w >= 70 ? "r-silber" : "r-bronze");
  const podium = (p) => (p >= 1 && p <= 3 ? `p${p}` : "");
  // Oberste Klasse rot, unterste grün, dazwischen gelb
  const klassenFarbe = (k) => (k.max == null ? "k-pro" : k.min === 0 ? "k-am" : "k-mid");
  const LIVERYS = ["porsche", "ferrari", "bmw", "amg", "ford"];
  const livery = (id) => LIVERYS[[...String(id)].reduce((t, c) => t + c.charCodeAt(0), 0) % LIVERYS.length];
  const bildVon = (id, version) => (version ? `api/liga?r=bild&k=${encodeURIComponent(`serie-${id}`)}&v=${encodeURIComponent(version)}` : `img/cars/${livery(id)}.webp`);
  const avatarVon = (pid, version) => `api/liga?r=bild&k=${encodeURIComponent(`fahrer-${pid}`)}&v=${encodeURIComponent(version)}`;
  const flagge = (code) => { const q = window.LigaFlaggen.quelle(code); return q ? `<img class="liga-flagge" src="${esc(q)}" alt="${esc(window.LigaFlaggen.name(code))}" title="${esc(window.LigaFlaggen.name(code))}" width="21" height="14">` : ""; };
  const werte = (c) => `<div class="liga-fk-werte">${WERTE.map(([label, feld, art]) => { const w = c[feld] ?? null; return `<div class="w-${art}"><span>${label}</span><span class="liga-fk-balken"><i style="width:${w === null ? 0 : w}%"></i></span><b>${w === null ? "–" : w}</b></div>`; }).join("")}</div>`;
  const formKasten = (r) => (!r ? '<i class="leer" title="Nicht gefahren">–</i>' : r.status !== "OK" ? `<i class="aus" title="${esc(r.status)}">${esc(r.status)}</i>` : `<i class="${podium(r.platz)}" title="Platz ${r.platz}">${r.platz}</i>`);

  // d: name, serie, serieName, bildVersion, klasse, pos, punkte, rennenGesamt, rennen, karte, pid, profil
  function inhalt(d) {
    const c = d.karte;
    const p = d.profil || {};
    const hinweis = c.rating !== null ? "Darkline Rating" : d.rennenGesamt < 3 ? "Einzelwertung" : "Noch in Wertung";
    const avatar = p.bild && d.pid ? `<img class="liga-fk-avatar" src="${esc(avatarVon(d.pid, p.bild))}" alt="" width="48" height="48">` : "";
    return `<div class="liga-fk-bild" style="background-image:url('${esc(bildVon(d.serie, d.bildVersion))}')" aria-hidden="true"></div>
      <div class="liga-fk-kopf"><div class="liga-fk-rating"><b>${c.rating === null ? "–" : c.rating}</b><span>${esc(hinweis)}</span></div><span class="liga-fk-klasse">${esc(d.klasse)}</span></div>
      <div class="liga-fk-fahrer">${avatar}<div class="liga-fk-name"><strong>${p.nummer ? `<span class="liga-fk-nummer">#${esc(p.nummer)}</span> ` : ""}${esc(d.name)}</strong><small>${flagge(p.land)}${esc(d.serieName)} · P${d.pos} · ${d.punkte} Punkte</small></div></div>
      ${werte(c)}
      <div class="liga-fk-form" aria-label="Ergebnisse der letzten Rennen">${d.rennen.slice(-6).map(formKasten).join("")}</div>
      ${c.abzeichen.length ? `<div class="liga-fk-abzeichen">${c.abzeichen.map((a) => `<span class="a-${esc(a.art)}">${esc(a.text)}</span>`).join("")}</div>` : ""}`;
  }

  window.LigaKarte = { WERTE, rang, klassenFarbe, bildVon, avatarVon, flagge, werte, inhalt };
})();
