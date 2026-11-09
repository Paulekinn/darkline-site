/* Darkline Liga: ohne Parameter die Übersicht aller Serien, mit ?serie=<kennung> Tabellen, Rennen und Regeln einer Serie.
   Die Daten pflegt die Rennleitung unter /liga-admin, geliefert werden sie von api/liga?r=oeffentlich. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const zahl = (n) => Number(n).toLocaleString("de-DE");
  const bereich = (k) => (k.max == null ? `ab ${zahl(k.min)}` : k.min === 0 ? `bis ${zahl(k.max)}` : `${zahl(k.min)} bis ${zahl(k.max)}`);
  // Farbe nach Lage der Klasse: oberste rot, unterste grün, dazwischen gelb
  const farbe = (k) => (k.max == null ? "k-pro" : k.min === 0 ? "k-am" : "k-mid");
  // iRacing liefert die Startzeit in UTC, angezeigt wird der Tag in deutscher Zeit.
  const datum = (s) => { const d = new Date(s); return isNaN(d) ? "" : d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" }); };
  const podium = (p) => (p >= 1 && p <= 3 ? `p${p}` : "");
  const DISCORD = "https://discord.gg/QP2rKy6n8U";

  $("year").textContent = new Date().getFullYear();

  const abschnitt = (titel, meta, text, inhalt, id) => `<section class="sheet"${id ? ` id="${id}"` : ""}><div class="wrap">
    <div class="doc-head"><h2 class="wide">${esc(titel)}</h2><div class="doc-meta lbl">${esc(meta)}</div>${text ? `<p>${esc(text)}</p>` : ""}</div>
    <div class="liga-abschnitt-inhalt">${inhalt}</div>
  </div></section>`;
  const einfuegen = (html) => $("liga-main").insertAdjacentHTML("beforeend", html);

  /* ---------- Kopf: Zahlen und Saisonfortschritt als Schaltblitze ---------- */
  function kopf(d, gruppen, s) {
    const fahrer = gruppen.reduce((t, k) => t + k.fahrer.length, 0);
    const gefahren = d.rennen.length;
    const lichter = Array.from({ length: d.rennenGesamt }, (_, i) => {
      const anteil = d.rennenGesamt > 1 ? i / (d.rennenGesamt - 1) : 1;
      const r = d.rennen[i];
      return `<i class="${i < gefahren ? "on" : ""} ${anteil < 0.5 ? "g" : anteil < 0.8 ? "y" : "r"}" title="${esc(r ? `R${r.nr} · ${r.strecke}` : `Rennen ${i + 1}`)}"></i>`;
    }).join("");
    $("liga-saison").textContent = [s.saison, s.beschreibung].filter(Boolean).join(" · ");
    $("liga-fortschritt").innerHTML = `<div class="liga-fakten">
        <div><b>${gefahren}/${d.rennenGesamt}</b><span>Rennen</span></div>
        <div><b>${fahrer}</b><span>Fahrer</span></div>
        <div><b>${gruppen.length}</b><span>Wertungen</span></div>
      </div>
      <div class="liga-band" role="img" aria-label="Saisonfortschritt: ${gefahren} von ${d.rennenGesamt} Rennen gefahren">
        <div class="liga-band-titel"><span>Saisonfortschritt</span><span>Noch ${Math.max(0, d.rennenGesamt - gefahren)} Rennen</span></div>
        <div class="liga-lichter">${lichter}</div>
      </div>`;
  }

  /* ---------- Tabellenführer ---------- */
  function karte(k) {
    const [erster, zweiter, dritter] = k.fahrer;
    const abstand = zweiter ? `${erster.punkte - zweiter.punkte} vor Platz 2` : "Allein in der Klasse";
    const rest = [zweiter, dritter].filter(Boolean).map((f) => `<li><span><em>P${f.pos}</em>${esc(f.name)}</span><span>${f.punkte}</span></li>`).join("");
    return `<button type="button" class="liga-karte ${farbe(k)}" data-k="${esc(k.id)}" aria-label="Tabelle ${esc(k.name)} öffnen">
      <span class="liga-karte-kopf"><span class="liga-karte-klasse">${esc(k.name)}</span><span class="liga-karte-bereich">iR ${esc(bereich(k))}</span></span>
      <span class="liga-karte-erster"><span class="liga-karte-name">${esc(erster.name)}<small>${esc(abstand)} · ${erster.siege} ${erster.siege === 1 ? "Sieg" : "Siege"}</small></span><span class="liga-karte-punkte">${erster.punkte}</span></span>
      ${rest ? `<ul class="liga-karte-rest">${rest}</ul>` : ""}
    </button>`;
  }

  /* ---------- Tabelle ---------- */
  function zelle(r) {
    if (!r) return '<td class="zahl liga-leerzelle">–</td>';
    const strafe = (r.zeitstrafe ? `<span class="liga-tag minus">+${r.zeitstrafe}s</span>` : "") + (r.strafe ? `<span class="liga-tag minus">−${r.strafe}</span>` : "");
    const gestrichen = r.gestrichen ? " gestrichen" : "";
    if (r.status !== "OK") return `<td class="zahl liga-rennen${gestrichen}"><b><span class="liga-tag aus">${esc(r.status)}</span></b><small>${strafe}</small></td>`;
    const tags = (r.pole ? '<span class="liga-tag pp">PP</span>' : "") + (r.schnellsteRunde ? '<span class="liga-tag sr">SR</span>' : "");
    return `<td class="zahl liga-rennen ${podium(r.platz)}${gestrichen}"><b>${r.punkte}</b><small>P${r.platz}${tags}${strafe}</small></td>`;
  }

  function tabelle(k, d) {
    if (!k.fahrer.length) return `<div class="liga-scroll ${farbe(k)}"><p class="liga-hinweis">In dieser Klasse ist noch niemand gewertet.</p></div>`;
    const maximal = Math.max(1, ...k.fahrer.map((f) => f.punkte));
    const kopfzeile = d.rennen.map((r) => `<th class="zahl" title="${esc([r.strecke, r.variante].filter(Boolean).join(" · "))}">R${r.nr}<small>${esc(datum(r.start))}</small></th>`).join("");
    const zeilen = k.fahrer.map((f) => `<tr>
      <td><span class="liga-fahrer"><span class="liga-pos ${podium(f.pos)}"><b>${f.pos}</b></span>${esc(f.name)}</span></td>
      <td class="zahl">${f.irating === null ? "–" : zahl(f.irating)}</td>
      ${f.rennen.map(zelle).join("")}
      <td class="zahl">${f.siege}</td>
      <td class="zahl">${f.incidentsProRunde === null ? "–" : f.incidentsProRunde.toLocaleString("de-DE", { minimumFractionDigits: 2 })}</td>
      <td class="zahl ${f.strafpunkte ? "liga-strafe" : "liga-leerzelle"}">${f.strafpunkte ? "−" + f.strafpunkte : "–"}</td>
      <td class="zahl liga-punkte"><b>${f.punkte}</b><span class="liga-balken"><i style="width:${Math.max(0, Math.round((f.punkte / maximal) * 100))}%"></i></span></td>
    </tr>`).join("");
    return `<div class="liga-scroll ${farbe(k)}" tabindex="0" role="region" aria-label="Tabelle ${esc(k.name)}"><table class="liga-tabelle">
      <thead><tr><th>Fahrer</th><th class="zahl">iRating</th>${kopfzeile}<th class="zahl">Siege</th><th class="zahl">Inc/Runde</th><th class="zahl">Strafe</th><th class="zahl">Punkte</th></tr></thead>
      <tbody>${zeilen}</tbody>
    </table></div>`;
  }

  /* ---------- Rennen ---------- */
  function rennkarten(d, gruppen) {
    const gefahren = d.rennen.map((r, i) => {
      const sieger = gruppen.map((k) => {
        const f = k.fahrer.find((x) => x.rennen[i] && x.rennen[i].platz === 1);
        return f ? `<li class="${farbe(k)}"><span>${esc(k.name)}</span><b>${esc(f.name)}</b></li>` : "";
      }).join("");
      return `<article class="liga-rennkarte">
        <header><div class="liga-rennnr">R${r.nr}</div><div class="liga-strecke">${esc(r.strecke)}<small>${esc([r.variante, datum(r.start)].filter(Boolean).join(" · "))}</small></div></header>
        ${sieger ? `<ul class="liga-sieger">${sieger}</ul>` : ""}
      </article>`;
    });
    // Offene Rennen zusammengefasst, damit die Übersicht kurz bleibt
    const naechstes = d.rennen.length + 1;
    const offen = naechstes <= d.rennenGesamt ? [`<article class="liga-rennkarte offen">
        <header><div class="liga-rennnr">R${naechstes}${naechstes < d.rennenGesamt ? `–${d.rennenGesamt}` : ""}</div><div class="liga-strecke">${naechstes < d.rennenGesamt ? "Termine folgen" : "Termin folgt"}</div></header>
      </article>`] : [];
    return `<div class="liga-rennkarten">${[...gefahren, ...offen].join("")}</div>`;
  }

  /* ---------- Regeln: alle Werte kommen aus der Seriendatei ---------- */
  function regelnHtml(r) {
    const klassen = [...r.klassen].sort((a, b) => b.min - a.min).map((k) => `<div class="liga-regel-klasse ${farbe(k)}"><b>${esc(k.name)}</b><span>iRating ${esc(bereich(k))}</span></div>`).join("");
    const punkte = r.punkte.map((p, i) => `<div class="${podium(i + 1)}">P${i + 1}<b>${p}</b></div>`).join("") + (r.punkteDanach ? `<div>P${r.punkte.length + 1}+<b>${r.punkteDanach}</b></div>` : "");
    return `<div class="liga-regel-klassen">${klassen}</div>
      <h3 class="liga-regel-titel">Punkte pro Rennen und Klasse</h3>
      <div class="liga-punktetafel">${punkte}</div>
      <ul class="liga-regelliste">
        <li>Je ${r.bonusPole} Bonuspunkt für die Pole und ${r.bonusSchnellsteRunde} für die schnellste Runde der eigenen Klasse.</li>
        <li>Gewertet wird, wer mindestens ${r.mindestRundenProzent} % der Runden des Klassensiegers schafft.</li>
        ${r.gewerteteRennen < r.rennenGesamt ? `<li>Es zählen die besten ${r.gewerteteRennen} von ${r.rennenGesamt} Rennen. Strafpunkte werden immer abgezogen.</li>` : ""}
        <li>Die Klasse richtet sich nach dem iRating zum Start und bleibt danach gleich.</li>
        <li>Bei Punktgleichheit entscheiden die Anzahl der Siege, dann der zweiten Plätze und so weiter, zuletzt das jüngste Rennen.</li>
      </ul>`;
  }

  function regelnAnhaengen(r) {
    if (r && Array.isArray(r.klassen) && Array.isArray(r.punkte)) einfuegen(abschnitt("Regeln", "Punkte und Klassen", "", regelnHtml(r)));
  }

  function leer(regeln) {
    einfuegen(abschnitt("Ergebnisse", "In Vorbereitung", "", `<div class="liga-leer">
      <h3>Noch keine Ergebnisse</h3>
      <p>Sobald die ersten Rennen gefahren sind, stehen hier Tabellen, Tabellenführer und Ergebnisse aller Klassen. Alle Neuigkeiten gibt es zuerst auf unserem Discord.</p>
      <a class="hbtn" href="${DISCORD}">Discord beitreten ↗</a>
    </div>`));
    regelnAnhaengen(regeln);
  }

  /* ---------- Serien: Anmeldung, Karten und Übersicht ---------- */
  let fahrerStand = null;
  const FARBEN = ["rot", "blau", "lila", "gruen", "gelb", "tuerkis"];
  const farbeSerie = (s) => `s-${FARBEN.includes(s.farbe) ? s.farbe : "rot"}`;
  const STATUS = { anmeldung: "Anmeldung offen", laeuft: "Läuft", beendet: "Beendet" };
  const artBadge = (typ, klein) => `<span class="liga-art ${typ === "event" ? "event" : "liga"}${klein ? " klein" : ""}">${typ === "event" ? "Event" : "Liga"}</span>`;
  const heute = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const terminText = (r) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(r.datum || ""); return `${m ? `${m[3]}.${m[2]}.` : ""}${r.startzeit ? ` · ${r.startzeit}` : ""}`; };
  const offeneRennen = (rennen) => rennen.filter((r) => r.status !== "abgesagt" && String(r.datum || "") >= heute).sort((a, b) => `${a.datum} ${a.startzeit}`.localeCompare(`${b.datum} ${b.startzeit}`));

  function serienAktion(s) {
    if (s.status === "beendet") return "";
    const offen = s.anmeldungOffen !== false;
    if (!fahrerStand || !fahrerStand.angemeldet) return offen ? '<a class="liga-mini" href="/api/discord-login?ziel=liga">Anmelden</a>' : "";
    const eigen = (fahrerStand.serien || []).find((x) => x.id === s.id);
    if (eigen && eigen.ich) return `<span class="liga-dabei">Du bist dabei</span><button type="button" class="liga-mini zweit" data-serie-aktion="serie-abmelden" data-serie="${esc(s.id)}">Abmelden</button>`;
    if (!offen) return "";
    if (!fahrerStand.fahrer.profil) return '<a class="liga-mini" href="/fahrerbereich">Anmelden</a>';
    const klassen = s.fahrzeugklassen || [];
    const auswahl = klassen.length > 1 ? `<select id="fz-${esc(s.id)}" class="liga-auswahl" aria-label="Fahrzeugklasse wählen"><option value="">Klasse</option>${klassen.map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join("")}</select>` : "";
    return `${auswahl}<button type="button" class="liga-mini" data-serie-aktion="serie-anmelden" data-serie="${esc(s.id)}">Anmelden</button>`;
  }

  // Eure Livery-Bilder als Motiv der Karten. Je Serie immer dasselbe Bild.
  const LIVERYS = ["porsche", "ferrari", "bmw", "amg", "ford"];
  const livery = (id) => LIVERYS[[...String(id)].reduce((t, c) => t + c.charCodeAt(0), 0) % LIVERYS.length];
  const serienLink = (s) => `/liga?serie=${encodeURIComponent(s.id)}`;
  const eigenesBild = (k, v) => `api/liga?r=bild&k=${encodeURIComponent(k)}&v=${encodeURIComponent(v)}`;
  const kartenBild = (s) => (s.bildVersion ? eigenesBild(`serie-${s.id}`, s.bildVersion) : `img/cars/${livery(s.id)}.webp`);
  const MONATE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

  // Startzeitpunkt aus Datum und Uhrzeit in deutscher Zeit
  function startMs(r) {
    const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(r.datum || "");
    const z = /^(\d{1,2}):(\d{2})/.exec(r.startzeit || "");
    if (!d || !z) return null;
    const wunsch = Date.UTC(+d[1], +d[2] - 1, +d[3], +z[1], +z[2]);
    const format = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
    const versatz = (t) => { const p = Object.fromEntries(format.formatToParts(new Date(t)).map((x) => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t; };
    return wunsch - versatz(wunsch - versatz(wunsch));
  }

  function countdown() {
    document.querySelectorAll("[data-countdown]").forEach((el) => {
      const ms = Number(el.dataset.countdown) - Date.now();
      if (ms <= 0) { el.innerHTML = '<span class="liga-live">Rennen läuft</span>'; return; }
      const teile = [[Math.floor(ms / 864e5), "Tage"], [Math.floor(ms / 36e5) % 24, "Std"], [Math.floor(ms / 6e4) % 60, "Min"]];
      el.innerHTML = teile.map(([v, l]) => `<span><b>${String(v).padStart(2, "0")}</b><small>${l}</small></span>`).join("");
    });
  }

  function serienKarte(s, rennen) {
    const naechstes = offeneRennen(rennen.filter((r) => r.serie === s.id))[0];
    const klassen = (s.klassen || []).map((k) => `<span class="liga-klassenchip ${farbe(k)}">${esc(k.name)}</span>`).join("");
    const umfang = s.typ === "event" ? "Einzelrennen" : `${s.rennenGesamt} Rennen`;
    return `<article class="liga-poster ${farbeSerie(s)}${s.typ === "event" ? " ist-event" : ""}${s.status === "beendet" ? " beendet" : ""}">
      <div class="liga-poster-bild" style="background-image:url('${esc(kartenBild(s))}')" aria-hidden="true"></div>
      <div class="liga-poster-inhalt">
        <div class="liga-poster-kopf">${artBadge(s.typ)}${s.saison ? `<span class="liga-pill">${esc(s.saison)}</span>` : ""}<span class="liga-pill farbig">${esc(STATUS[s.status] || "")}</span></div>
        <h3><a href="${serienLink(s)}">${esc(s.name)}</a></h3>
        ${s.beschreibung ? `<p>${esc(s.beschreibung)}</p>` : ""}
        <div class="liga-poster-klassen">${klassen}</div>
        <dl class="liga-poster-daten"><div><dt>Umfang</dt><dd>${esc(umfang)}</dd></div><div><dt>Nächstes Rennen</dt><dd>${naechstes ? `${esc(terminText(naechstes))} · ${esc(naechstes.strecke || naechstes.titel)}` : "Termine folgen"}</dd></div></dl>
        <div class="liga-serie-aktion">${serienAktion(s)}<a class="liga-mini zweit" href="${serienLink(s)}">${s.typ === "event" ? "Infos" : "Tabelle"}</a></div>
      </div>
    </article>`;
  }

  function terminZeile(r, s) {
    const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(r.datum || "");
    return `<a class="liga-termin ${farbeSerie(s)}${s.typ === "event" ? " ist-event" : ""}" href="${serienLink(s)}">
      <span class="liga-termin-datum"><b>${d ? d[3] : "–"}</b><small>${d ? MONATE[+d[2] - 1] : ""}</small></span>
      <span class="liga-termin-text">${artBadge(s.typ, true)}<b>${esc(r.titel)}</b><small>${esc(s.name)}${r.startzeit ? ` · ${esc(r.startzeit)} Uhr` : ""}</small></span>
    </a>`;
  }

  // Das nächste Rennen groß im Kopfbereich
  function feature(r, s) {
    const start = startMs(r);
    return `<aside class="liga-feature ${farbeSerie(s)}">
      <div class="liga-feature-kopf"><span class="lbl">Nächstes Rennen</span><span class="liga-poster-kopf">${artBadge(s.typ)}<span class="liga-pill farbig">${esc(s.name)}</span></span></div>
      <h2>${esc(r.strecke || r.titel)}</h2>
      <p>${esc(terminText(r))} Uhr${r.strecke && r.titel !== r.strecke ? ` · ${esc(r.titel)}` : ""}</p>
      ${start ? `<div class="liga-countdown" data-countdown="${start}" aria-hidden="true"></div>` : ""}
      <div class="liga-serie-aktion">${serienAktion(s)}<a class="liga-mini zweit" href="${serienLink(s)}">Zur Serie</a></div>
    </aside>`;
  }

  function uebersicht(serien, rennen) {
    if (!serien.length) return leer(null);
    const aktiv = serien.filter((s) => s.status !== "beendet");
    const archiv = serien.filter((s) => s.status === "beendet");
    // Rennen von heute bleiben drei Stunden nach dem Start stehen, danach rückt das nächste nach.
    const termine = offeneRennen(rennen).filter((r) => { const t = startMs(r); return t === null || t + 3 * 3600e3 > Date.now(); }).map((r) => ({ r, s: serien.find((x) => x.id === r.serie) })).filter((x) => x.s);

    // Kopfbereich: nächstes Rennen und Zahlen
    const kopfBereich = document.querySelector(".liga-kopf");
    kopfBereich.classList.add("gross");
    $("liga-fortschritt").innerHTML = `<div class="liga-fakten"><div><b>${aktiv.length}</b><span>${aktiv.length === 1 ? "Aktive Serie" : "Aktive Serien"}</span></div><div><b>${termine.length}</b><span>Geplante Rennen</span></div><div><b>${Math.max(0, ...aktiv.map((s) => (s.klassen || []).length))}</b><span>Klassen</span></div></div>`;
    if (termine[0]) { kopfBereich.querySelector(".wrap").insertAdjacentHTML("beforeend", feature(termine[0].r, termine[0].s)); countdown(); setInterval(countdown, 30000); }

    const liste = (l) => `<div class="liga-poster-raster">${l.map((s) => serienKarte(s, rennen)).join("")}</div>`;
    const ligen = aktiv.filter((s) => s.typ !== "event");
    const events = aktiv.filter((s) => s.typ === "event");
    if (ligen.length) einfuegen(abschnitt("Ligen", `${ligen.length} aktiv`, "", liste(ligen)));
    if (events.length) einfuegen(abschnitt("Events", `${events.length} ${events.length === 1 ? "Termin" : "Termine"}`, "", liste(events)));
    if (!aktiv.length) einfuegen(abschnitt("Ligen und Events", "In Planung", "", '<p class="liga-hinweis">Neue Serien werden hier und im Discord angekündigt.</p>'));
    const weitere = termine.slice(1, 7);
    if (weitere.length) einfuegen(abschnitt("Weitere Termine", "Alle Serien", "", `<div class="liga-termine">${weitere.map((x) => terminZeile(x.r, x.s)).join("")}</div>`));
    einfuegen(abschnitt("So bist du dabei", "In drei Schritten", "", `<ol class="liga-schritte">
      <li><b>1</b><div><h3>Mit Discord anmelden</h3><p>Du brauchst nur ein Konto auf unserem Discord-Server.</p></div></li>
      <li><b>2</b><div><h3>Profil ausfüllen</h3><p>iRacing-Name, iRacing-ID und iRating, einmal und fertig.</p></div></li>
      <li><b>3</b><div><h3>Serie wählen</h3><p>Anmelden und in deiner Klasse gegen Fahrer auf deinem Niveau antreten.</p></div></li>
    </ol>`));
    if (archiv.length) einfuegen(abschnitt("Archiv", `${archiv.length} beendet`, "", liste(archiv)));
  }

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-serie-aktion]");
    if (!b) return;
    if (b.dataset.serieAktion === "serie-abmelden" && !window.confirm("Wirklich aus dieser Serie abmelden? Du wirst dann auch aus allen kommenden Rennen der Serie genommen.")) return;
    const auswahl = $("fz-" + b.dataset.serie);
    b.disabled = true;
    try {
      const r = await fetch("api/liga?r=fahrer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aktion: b.dataset.serieAktion, serie: b.dataset.serie, fahrzeugklasse: auswahl ? auswahl.value : "" }) });
      if (r.ok) return location.reload();
      window.alert((await r.json().catch(() => ({}))).error || "Das hat nicht geklappt. Bitte versuche es noch einmal.");
    } catch (err) {
      window.alert("Keine Verbindung. Bitte versuche es noch einmal.");
    }
    b.disabled = false;
  });

  function zeige(d, regeln) {
    // Bei mehreren Fahrzeugklassen werden leere Gruppen ausgeblendet, sonst wären es zu viele Reiter.
    const gruppen = new Set(d.klassen.map((k) => k.fahrzeugklasse)).size > 1 ? d.klassen.filter((k) => k.fahrer.length) : d.klassen;
    const besetzt = gruppen.filter((k) => k.fahrer.length);
    kopf(d, gruppen, regeln);

    einfuegen(abschnitt("Die Spitze", `Nach ${d.rennen.length} von ${d.rennenGesamt} Rennen`, "", `<div class="liga-karten">${besetzt.map(karte).join("")}</div>`));
    einfuegen(abschnitt("Tabelle", d.saison, "", `<div class="liga-tabs" role="tablist" aria-label="Klasse wählen">${gruppen.map((k) => `<button type="button" class="${farbe(k)}" role="tab" id="tab-${esc(k.id)}" data-k="${esc(k.id)}" aria-controls="liga-tabelle" aria-selected="false">${esc(k.name)}<small>iRating ${esc(bereich(k))}</small></button>`).join("")}</div>
      <div id="liga-tabelle" role="tabpanel"></div>
      <p class="liga-legende"><span><b style="color:var(--liga-gold)">Gold</b>, <b style="color:var(--liga-silber)">Silber</b>, <b style="color:var(--liga-bronze)">Bronze</b> = Podium</span><span><b class="liga-tag pp">PP</b> = Pole</span><span><b class="liga-tag sr">SR</b> = schnellste Runde</span><span><b class="liga-tag aus">DNF</b> = nicht gewertet</span><span><b class="liga-tag aus">DSQ</b> = disqualifiziert</span><span>Durchgestrichen = Streichergebnis</span></p>`, "liga-tabelle-bereich"));
    // Rennen und Regeln nebeneinander
    const block = (titel, meta, inhalt) => `<div class="liga-block"><div class="doc-head"><h2 class="wide">${esc(titel)}</h2><div class="doc-meta lbl">${esc(meta)}</div></div><div class="liga-abschnitt-inhalt">${inhalt}</div></div>`;
    const regelnGueltig = regeln && Array.isArray(regeln.klassen) && Array.isArray(regeln.punkte);
    einfuegen(`<section class="sheet"><div class="wrap liga-zwei">${block("Rennen", `${d.rennen.length} gefahren`, rennkarten(d, besetzt))}${regelnGueltig ? block("Regeln", "Punkte und Klassen", regelnHtml(regeln)) : ""}</div></section>`);

    const reiter = [...document.querySelectorAll(".liga-tabs button")];
    const waehle = (id) => {
      reiter.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.k === id)));
      $("liga-tabelle").innerHTML = tabelle(gruppen.find((k) => k.id === id), d);
    };
    reiter.forEach((b) => b.addEventListener("click", () => waehle(b.dataset.k)));
    document.querySelectorAll(".liga-karte").forEach((b) => b.addEventListener("click", () => {
      waehle(b.dataset.k);
      $("liga-tabelle-bereich").scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth" });
    }));
    waehle((besetzt[0] || gruppen[0]).id);
  }

  const lade = (pfad) => fetch(pfad, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const kennung = new URLSearchParams(location.search).get("serie");
  Promise.all([lade(`api/liga?r=oeffentlich${kennung ? `&serie=${encodeURIComponent(kennung)}` : ""}`), lade("api/liga?r=fahrer")]).then(([daten, fahrer]) => {
    fahrerStand = fahrer;
    const serien = (daten && daten.serien) || [];
    const rennen = (daten && daten.rennen) || [];
    const s = kennung && serien.find((x) => x.id === kennung);
    // Titelbild: Bild der Serie, sonst das Bild der Übersicht, sonst das Teamfoto
    $("liga-kopfbild").src = s && s.bildVersion ? eigenesBild(`serie-${s.id}`, s.bildVersion) : daten && daten.kopfbildVersion ? eigenesBild("uebersicht", daten.kopfbildVersion) : "img/hero.webp";
    if (!s) return uebersicht(serien, rennen);

    document.title = `${s.name} · Darkline Liga`;
    $("liga-titel").innerHTML = esc(s.name);
    document.querySelector(".liga-kicker").innerHTML = artBadge(s.typ);
    $("liga-saison").textContent = [s.saison, s.beschreibung].filter(Boolean).join(" · ");
    $("liga-cta").innerHTML = `<a class="liga-mini zweit" href="/liga">Alle Serien</a>${serienAktion(s)}`;
    const d = daten.tabelle;
    if (d && Array.isArray(d.rennen) && d.rennen.length && Array.isArray(d.klassen)) zeige(d, s);
    else leer(s);
  });
})();
