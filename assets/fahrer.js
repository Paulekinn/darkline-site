/* Öffentliche Profilseite eines Fahrers: /fahrer?id=<anonyme Kennung> */
(function () {
  "use strict";
  const K = window.LigaKarte;
  const F = window.LigaFlaggen;
  const $ = (id) => document.getElementById(id);
  const main = $("fa-main");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const datum = (s) => { const d = new Date(s); return isNaN(d) ? "" : d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "Europe/Berlin" }); };
  const podium = (p) => (p >= 1 && p <= 3 ? `p${p}` : "");
  $("year").textContent = new Date().getFullYear();

  const teilenLink = (k) => `/liga?serie=${encodeURIComponent(k.serie)}#fahrer/${encodeURIComponent(k.klasseId)}/${encodeURIComponent(k.name)}`;
  const karteHtml = (k, profil) => `<div class="fa-karte"><div class="liga-fk ${K.klassenFarbe(k)} ${K.rang(k.karte.rating)}">${K.inhalt({ ...k, profil })}</div><a class="liga-mini zweit" href="${esc(teilenLink(k))}">Bild und Link zum Teilen</a></div>`;

  const kanalName = (url) => (/twitch\.tv/.test(url) ? "Twitch" : "YouTube");

  function zeileVerlauf(r) {
    const ok = r.status === "OK";
    const tags = (r.pole ? '<span class="liga-tag pp">PP</span>' : "") + (r.schnellsteRunde ? '<span class="liga-tag sr">SR</span>' : "") + (r.zeitstrafe ? `<span class="liga-tag minus">+${r.zeitstrafe}s</span>` : "") + (r.strafe ? `<span class="liga-tag minus">−${r.strafe}</span>` : "");
    return `<tr>
      <td><span class="liga-fahrer"><span class="liga-pos ${ok ? podium(r.platz) : ""}"><b>${ok ? r.platz : "–"}</b></span>${esc(r.strecke || `Rennen ${r.nr}`)}</span></td>
      <td>${esc(datum(r.start))}</td>
      <td><a class="fa-serie s-${esc(r.serieFarbe)}" href="/liga?serie=${encodeURIComponent(r.serie)}">${esc(r.serieName)}</a></td>
      <td>${esc(r.klasse)}</td>
      <td class="zahl liga-rennen${r.gestrichen ? " gestrichen" : ""}">${ok ? `<b>${r.punkte}</b>` : `<b><span class="liga-tag aus">${esc(r.status)}</span></b>`}${tags ? `<small>${tags}</small>` : ""}</td>
    </tr>`;
  }

  function zeige(d) {
    const p = d.profil || {};
    const haupt = d.karten[0];
    document.title = `${d.name} · Darkline Simracing Series`;
    const b = d.bilanz;
    const zahlen = [[b.starts, "Starts"], [b.siege, "Siege"], [b.podien, "Podien"], [b.poles, "Poles"], [b.schnellste, "Schnellste Runden"], [b.ausfaelle, "Ausfälle"]];
    const land = p.land ? `${K.flagge(p.land)}<span>${esc(F.name(p.land))}</span>` : "";
    const meta = [land ? `<span class="fa-land">${land}</span>` : "", p.team ? `<span>${esc(p.team)}</span>` : ""].filter(Boolean).join('<span aria-hidden="true">·</span>');
    main.innerHTML = `<section class="fa-held">
        <div class="fa-held-bild" style="background-image:url('${esc(K.bildVon(haupt.serie, haupt.bildVersion))}')" aria-hidden="true"></div>
        <div class="wrap">
          <div class="fa-held-text">
            <div class="lbl liga-kicker">Fahrerprofil</div>
            <div class="fa-identitaet">
              ${p.bild ? `<img class="fa-avatar" src="${esc(K.avatarVon(d.pid, p.bild))}" alt="" width="120" height="120">` : ""}
              <div>${p.nummer ? `<div class="fa-nummer">#${esc(p.nummer)}</div>` : ""}<h1>${esc(d.name)}</h1></div>
            </div>
            ${meta ? `<div class="fa-meta">${meta}</div>` : ""}
            <div class="fa-zahlen">${zahlen.map(([w, t]) => `<div><b>${w}</b><span>${t}</span></div>`).join("")}</div>
            ${p.kanal ? `<a class="hbtn ghost fa-kanal" href="${esc(p.kanal)}" target="_blank" rel="noopener noreferrer">${kanalName(p.kanal)} ansehen ↗</a>` : ""}
          </div>
          ${karteHtml(haupt, p)}
        </div>
      </section>
      ${d.karten.length > 1 ? `<section class="sheet"><div class="wrap"><div class="doc-head"><h2 class="wide">Weitere Serien</h2><div class="doc-meta lbl">${d.karten.length} Wertungen</div></div><div class="fa-karten">${d.karten.slice(1).map((k) => karteHtml(k, p)).join("")}</div></div></section>` : ""}
      <section class="sheet"><div class="wrap">
        <div class="doc-head"><h2 class="wide">Ergebnisse</h2><div class="doc-meta lbl">${b.starts} ${b.starts === 1 ? "Rennen" : "Rennen"}</div></div>
        <div class="liga-abschnitt-inhalt"><div class="liga-scroll k-ges" tabindex="0" role="region" aria-label="Ergebnisse von ${esc(d.name)}"><table class="liga-tabelle">
          <thead><tr><th>Rennen</th><th>Datum</th><th>Serie</th><th>Klasse</th><th class="zahl">Punkte</th></tr></thead>
          <tbody>${d.verlauf.map(zeileVerlauf).join("")}</tbody>
        </table></div></div>
      </div></section>`;
  }

  function fehlt() {
    main.innerHTML = '<section class="sheet"><div class="wrap"><div class="liga-leer"><h3>Fahrer nicht gefunden</h3><p>Zu diesem Link gibt es kein Profil. Ein Fahrerprofil entsteht mit dem ersten gewerteten Rennen.</p><a class="hbtn" href="/liga">Zur Übersicht</a></div></div></section>';
  }

  fetch(`api/liga?r=profil&id=${encodeURIComponent(new URLSearchParams(location.search).get("id") || "")}`, { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d ? zeige(d) : fehlt()))
    .catch(fehlt);
})();
