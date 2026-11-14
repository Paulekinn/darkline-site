/* Teams der Liga: /teams (alle) und /teams?id=<kennung> (ein Team) */
(function () {
  "use strict";
  const K = window.LigaKarte;
  const F = window.LigaFlaggen;
  const $ = (id) => document.getElementById(id);
  const main = $("fa-main");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const FARBEN = ["rot", "blau", "lila", "gruen", "gelb", "tuerkis"];
  const farbe = (f) => `s-${FARBEN.includes(f) ? f : "rot"}`;
  $("year").textContent = new Date().getFullYear();

  const leer = (titel, text) => `<section class="sheet"><div class="wrap"><div class="liga-leer"><h3>${esc(titel)}</h3><p>${esc(text)}</p><a class="hbtn" href="/teams">Alle Teams</a></div></div></section>`;
  const held = (bild, kicker, titel, inhalt) => `<section class="fa-held fa-l-held"><div class="fa-held-bild" style="background-image:url('${esc(bild)}')" aria-hidden="true"></div><div class="wrap"><div class="fa-held-text"><div class="lbl liga-kicker">${esc(kicker)}</div>${titel}${inhalt}</div></div></section>`;
  const logoUrl = (t) => `api/liga?r=bild&k=team-${encodeURIComponent(t.id)}&v=${encodeURIComponent(t.logo)}`;
  const logo = (t, klasse) => (t.logo ? `<img class="fa-t-logo ${klasse || ""}" src="${esc(logoUrl(t))}" alt="Logo ${esc(t.name)}" loading="lazy">` : "");
  const initialen = (n) => String(n).split(/\s+/).filter(Boolean).slice(0, 2).map((t) => t[0]).join("").toUpperCase();

  function teamKachel(t) {
    const namen = t.mitglieder.slice(0, 6).map((m) => `<li>${m.nummer ? `<b>#${esc(m.nummer)}</b> ` : ""}${esc(m.name)}</li>`).join("") + (t.mitglieder.length > 6 ? `<li>+${t.mitglieder.length - 6} weitere</li>` : "");
    return `<li><a class="fa-t-kachel ${farbe(t.farbe)}" href="/teams?id=${encodeURIComponent(t.id)}">
      <div class="fa-t-kopf">${logo(t)}<span class="fa-t-kz">${esc(t.kuerzel)}</span><strong>${esc(t.name)}</strong></div>
      <small class="lbl">${t.mitglieder.length} ${t.mitglieder.length === 1 ? "Fahrer" : "Fahrer"}</small>
      <ul class="fa-t-namen">${namen}</ul>
    </a></li>`;
  }

  function zeigeAlle(teams) {
    const fahrer = teams.reduce((n, t) => n + t.mitglieder.length, 0);
    main.innerHTML = `${held("img/hero.webp", "Darkline Simracing Series", "<h1>Teams</h1>", `<div class="fa-zahlen fa-l-zahlen"><div><b>${teams.length}</b><span>Teams</span></div><div><b>${fahrer}</b><span>Fahrer in Teams</span></div></div><p class="fa-l-satz">Eigenes Team gründen oder beitreten? Das geht im <a href="/fahrerbereich">Fahrerbereich</a>.</p>`)}
      <section class="sheet"><div class="wrap">
        ${teams.length ? `<ul class="fa-t-liste">${teams.map(teamKachel).join("")}</ul>` : '<div class="liga-leer"><h3>Noch keine Teams</h3><p>Das erste Team gründest du im Fahrerbereich.</p><a class="hbtn" href="/fahrerbereich">Zum Fahrerbereich</a></div>'}
      </div></section>`;
  }

  function mitgliedKachel(m) {
    const bild = m.bild ? `<img class="fa-l-bild" src="${esc(K.avatarVon(m.pid, m.bild))}" alt="" width="64" height="64" loading="lazy">` : `<span class="fa-l-bild fa-l-ohne" aria-hidden="true">${esc(initialen(m.name))}</span>`;
    const bilanz = m.starts ? `${m.starts} ${m.starts === 1 ? "Start" : "Starts"}${m.siege ? ` · ${m.siege} ${m.siege === 1 ? "Sieg" : "Siege"}` : ""}${m.podien ? ` · ${m.podien} ${m.podien === 1 ? "Podium" : "Podien"}` : ""}` : "Noch kein Rennen";
    const inhalt = `${bild}<div class="fa-l-text"><strong>${m.nummer ? `<em>#${esc(m.nummer)}</em> ` : ""}${esc(m.name)}</strong>${m.land ? `<small class="fa-land">${K.flagge(m.land)}<span>${esc(F.name(m.land))}</span></small>` : ""}${m.chef ? '<small class="fa-l-bilanz fa-t-chef">Teamchef</small>' : ""}<small class="fa-l-bilanz">${esc(bilanz)}</small></div>`;
    return `<li>${m.pid ? `<a class="fa-l-kachel" href="/fahrer?id=${encodeURIComponent(m.pid)}">${inhalt}</a>` : `<div class="fa-l-kachel">${inhalt}</div>`}</li>`;
  }

  function zeigeTeam(t) {
    document.title = `${t.name} · Darkline Simracing Series`;
    main.innerHTML = `${held("img/hero.webp", "Team", `<div class="fa-identitaet ${farbe(t.farbe)}">${t.logo ? logo(t, "fa-t-logo-gross") : `<span class="fa-t-kz fa-t-gross">${esc(t.kuerzel)}</span>`}<div>${t.logo ? `<span class="fa-t-kz">${esc(t.kuerzel)}</span>` : ""}<h1>${esc(t.name)}</h1></div></div>`, `<div class="fa-zahlen fa-l-zahlen"><div><b>${t.mitglieder.length}</b><span>${t.mitglieder.length === 1 ? "Fahrer" : "Fahrer"}</span></div></div>`)}
      <section class="sheet"><div class="wrap">
        <div class="doc-head"><h2 class="wide">Fahrer</h2><div class="doc-meta lbl">${t.mitglieder.length} im Team</div></div>
        <p class="fa-l-satz fa-t-hinweis">Die Zahlen auf den Kacheln sind die Einzelrennen der Fahrer. Teamergebnisse folgen mit den ersten Team-Events.</p>
        <ul class="fa-t-mitglieder ${farbe(t.farbe)}">${t.mitglieder.map(mitgliedKachel).join("")}</ul>
        <p class="fa-l-satz" style="margin-top:18px"><a href="/teams">← Alle Teams</a></p>
      </div></section>`;
  }

  const id = new URLSearchParams(location.search).get("id");
  fetch("api/liga?r=teams", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((d) => {
      const teams = d.teams || [];
      if (!id) return zeigeAlle(teams);
      const t = teams.find((x) => x.id === id);
      return t ? zeigeTeam(t) : (main.innerHTML = leer("Team nicht gefunden", "Dieses Team gibt es nicht oder nicht mehr."));
    })
    .catch(() => { main.innerHTML = leer("Gerade nicht erreichbar", "Die Teams konnten nicht geladen werden. Bitte versuche es gleich noch einmal."); });
})();
