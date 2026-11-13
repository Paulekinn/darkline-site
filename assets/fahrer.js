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
      <td class="zahl liga-rennen${r.gestrichen ? " gestrichen" : ""}">${ok ? `<b>${r.event ? `P${r.platz}` : r.punkte}</b>` : `<b><span class="liga-tag aus">${esc(r.status)}</span></b>`}${tags ? `<small>${tags}</small>` : ""}</td>
    </tr>`;
  }

  const ohneRennen = '<section class="sheet"><div class="wrap"><div class="liga-leer"><h3>Noch keine Rennen</h3><p>Dieser Fahrer ist registriert, aber noch kein gewertetes Rennen gefahren. Ergebnisse und Fahrerkarte erscheinen hier nach dem ersten Start.</p><a class="hbtn" href="/fahrer">Alle Fahrer</a></div></div></section>';

  function zeige(d) {
    const p = d.profil || {};
    const haupt = d.karten[0];
    const kopfbild = haupt ? K.bildVon(haupt.serie, haupt.bildVersion) : "img/hero.webp";
    document.title = `${d.name} · Darkline Simracing Series`;
    const b = d.bilanz;
    const zahlen = [[b.starts, "Starts"], [b.siege, "Siege"], [b.podien, "Podien"], [b.poles, "Poles"], [b.schnellste, "Schnellste Runden"], [b.ausfaelle, "Ausfälle"]];
    const land = p.land ? `${K.flagge(p.land)}<span>${esc(F.name(p.land))}</span>` : "";
    const meta = [land ? `<span class="fa-land">${land}</span>` : "", p.team ? `<span>${esc(p.team)}</span>` : ""].filter(Boolean).join('<span aria-hidden="true">·</span>');
    main.innerHTML = `<section class="fa-held">
        <div class="fa-held-bild" style="background-image:url('${esc(kopfbild)}')" aria-hidden="true"></div>
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
          ${haupt ? karteHtml(haupt, p) : ""}
        </div>
      </section>
      ${haupt ? "" : ohneRennen}
      ${(d.erfolge || []).length ? `<section class="sheet"><div class="wrap"><div class="doc-head"><h2 class="wide">Event-Erfolge</h2><div class="doc-meta lbl">${d.erfolge.length} ${d.erfolge.length === 1 ? "Podium" : "Podien"}</div></div><ul class="fa-erfolge">${d.erfolge.map((e) => `<li class="${podium(e.platz)}"><b>${e.platz === 1 ? "Sieger" : `P${e.platz}`}</b><a href="/liga?serie=${encodeURIComponent(e.serie)}">${esc(e.titel)}</a>${e.klasse ? `<small>${esc(e.klasse)}</small>` : ""}</li>`).join("")}</ul></div></section>` : ""}
      ${d.karten.length > 1 ? `<section class="sheet"><div class="wrap"><div class="doc-head"><h2 class="wide">Weitere Serien</h2><div class="doc-meta lbl">${d.karten.length} Wertungen</div></div><div class="fa-karten">${d.karten.slice(1).map((k) => karteHtml(k, p)).join("")}</div></div></section>` : ""}
      ${haupt ? `<section class="sheet"><div class="wrap">
        <div class="doc-head"><h2 class="wide">Ergebnisse</h2><div class="doc-meta lbl">${b.starts} ${b.starts === 1 ? "Rennen" : "Rennen"}</div></div>
        <div class="liga-abschnitt-inhalt"><div class="liga-scroll k-ges" tabindex="0" role="region" aria-label="Ergebnisse von ${esc(d.name)}"><table class="liga-tabelle">
          <thead><tr><th>Rennen</th><th>Datum</th><th>Serie</th><th>Klasse</th><th class="zahl">Punkte</th></tr></thead>
          <tbody>${d.verlauf.map(zeileVerlauf).join("")}</tbody>
        </table></div></div>
      </div></section>` : ""}`;
  }

  function fehlt() {
    main.innerHTML = '<section class="sheet"><div class="wrap"><div class="liga-leer"><h3>Fahrer nicht gefunden</h3><p>Zu diesem Link gibt es kein Profil. Ein Fahrerprofil entsteht mit dem ersten gewerteten Rennen oder mit der Registrierung im Fahrerbereich.</p><a class="hbtn" href="/fahrer">Alle Fahrer</a></div></div></section>';
  }

  /* ---------- Fahrerübersicht: /fahrer ohne Kennung ---------- */
  let alle = [];
  let sortierung = "nummer";
  let suche = "";
  const SORT = {
    nummer: (a, b) => (a.nummer || 1000) - (b.nummer || 1000) || a.name.localeCompare(b.name, "de"),
    name: (a, b) => a.name.localeCompare(b.name, "de"),
    starts: (a, b) => b.starts - a.starts || b.siege - a.siege || a.name.localeCompare(b.name, "de"),
  };

  function fahrerKachel(f) {
    const bild = f.bild ? `<img class="fa-l-bild" src="${esc(K.avatarVon(f.pid, f.bild))}" alt="" width="64" height="64" loading="lazy">` : `<span class="fa-l-bild fa-l-ohne" aria-hidden="true">${esc(f.name.split(/\s+/).filter(Boolean).slice(0, 2).map((t) => t[0]).join("").toUpperCase())}</span>`;
    const herkunft = [f.land ? `${K.flagge(f.land)}<span>${esc(F.name(f.land))}</span>` : "", f.team ? `<span>${esc(f.team)}</span>` : ""].filter(Boolean).join('<span aria-hidden="true">·</span>');
    const bilanz = f.starts ? `${f.starts} ${f.starts === 1 ? "Start" : "Starts"}${f.siege ? ` · ${f.siege} ${f.siege === 1 ? "Sieg" : "Siege"}` : ""}${f.podien ? ` · ${f.podien} ${f.podien === 1 ? "Podium" : "Podien"}` : ""}` : "Noch kein Rennen";
    const serien = f.serien.map((s) => `<span class="fa-l-serie s-${esc(s.farbe)}">${esc(s.name)}</span>`).join("");
    return `<li><a class="fa-l-kachel" href="/fahrer?id=${encodeURIComponent(f.pid)}">
      ${bild}
      <div class="fa-l-text">
        <strong>${f.nummer ? `<em>#${esc(f.nummer)}</em> ` : ""}${esc(f.name)}</strong>
        ${herkunft ? `<small class="fa-land">${herkunft}</small>` : ""}
        <small class="fa-l-bilanz">${esc(bilanz)}</small>
        ${serien ? `<div class="fa-l-serien">${serien}</div>` : ""}
      </div>
    </a></li>`;
  }

  function listeZeichnen() {
    const q = suche.trim().toLowerCase();
    const treffer = alle.filter((f) => !q || f.name.toLowerCase().includes(q) || String(f.nummer || "") === q.replace(/^#/, "") || (f.team || "").toLowerCase().includes(q)).sort(SORT[sortierung]);
    $("fa-l-liste").innerHTML = treffer.length ? treffer.map(fahrerKachel).join("") : '<li class="fa-l-leer">Kein Fahrer gefunden.</li>';
    $("fa-l-anzahl").textContent = q ? `${treffer.length} von ${alle.length}` : `${alle.length} ${alle.length === 1 ? "Fahrer" : "Fahrer"}`;
    main.querySelectorAll("[data-sort]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sort === sortierung)));
  }

  function zeigeListe(d) {
    alle = (d && d.fahrer) || [];
    const aktiv = alle.filter((f) => f.serien.length).length;
    main.innerHTML = `<section class="fa-held fa-l-held">
        <div class="fa-held-bild" style="background-image:url('img/hero.webp')" aria-hidden="true"></div>
        <div class="wrap"><div class="fa-held-text">
          <div class="lbl liga-kicker">Darkline Simracing Series</div>
          <h1>Unsere Fahrer</h1>
          <div class="fa-zahlen fa-l-zahlen"><div><b>${alle.length}</b><span>Fahrer</span></div><div><b>${aktiv}</b><span>In laufenden Serien</span></div></div>
          <p class="fa-l-satz">Selbst dabei sein? <a href="/fahrerbereich">Im Fahrerbereich registrieren</a> und Startnummer sichern.</p>
        </div></div>
      </section>
      <section class="sheet"><div class="wrap">
        <div class="fa-l-leiste">
          <input type="search" id="fa-l-suche" class="fa-l-suche" placeholder="Name, Startnummer oder Team" aria-label="Fahrer suchen" autocomplete="off">
          <div class="fa-l-sort" role="group" aria-label="Sortieren">${[["nummer", "Nummer"], ["name", "Name"], ["starts", "Starts"]].map(([k, t]) => `<button type="button" data-sort="${k}">${t}</button>`).join("")}</div>
          <span class="lbl" id="fa-l-anzahl"></span>
        </div>
        <ul class="fa-l-liste" id="fa-l-liste"></ul>
      </div></section>`;
    listeZeichnen();
  }

  const id = new URLSearchParams(location.search).get("id");
  if (!id) {
    document.title = "Fahrer · Darkline Simracing Series";
    main.addEventListener("input", (e) => { if (e.target.id === "fa-l-suche") { suche = e.target.value; listeZeichnen(); } });
    main.addEventListener("click", (e) => { const b = e.target.closest("[data-sort]"); if (b) { sortierung = b.dataset.sort; listeZeichnen(); } });
    fetch("api/liga?r=fahrerliste", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d ? zeigeListe(d) : Promise.reject()))
      .catch(() => { main.innerHTML = '<section class="sheet"><div class="wrap"><div class="liga-leer"><h3>Gerade nicht erreichbar</h3><p>Die Fahrerübersicht konnte nicht geladen werden. Bitte versuche es gleich noch einmal.</p></div></div></section>'; });
    return;
  }

  fetch(`api/liga?r=profil&id=${encodeURIComponent(id)}`, { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d ? zeige(d) : fehlt()))
    .catch(fehlt);
})();
