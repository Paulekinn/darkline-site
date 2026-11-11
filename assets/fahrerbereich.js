/* Fahrerbereich der Darkline Liga: Login, Profil, Serien, Rennen aller Serien, An- und Abmeldung */
(function () {
  "use strict";
  const API = "api/liga?r=fahrer";
  const $ = (id) => document.getElementById(id);
  const main = $("fb-main");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const zeitFormat = (o) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", ...o });
  const datum = (s) => zeitFormat({ weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(s));
  const uhr = (s) => zeitFormat({ hour: "2-digit", minute: "2-digit" }).format(new Date(s)) + " Uhr";
  const md = (t) => (window.marked && window.DOMPurify ? window.DOMPurify.sanitize(window.marked.parse(String(t))) : `<p>${esc(t)}</p>`);
  const FARBEN = ["rot", "blau", "lila", "gruen", "gelb", "tuerkis"];
  const farbe = (f) => `s-${FARBEN.includes(f) ? f : "rot"}`;
  const FEHLER = {
    abgebrochen: "Die Anmeldung wurde abgebrochen.",
    ungueltig: "Die Anmeldung ist abgelaufen. Bitte versuche es noch einmal.",
    konfiguration: "Die Anmeldung ist noch nicht eingerichtet. Bitte sag der Rennleitung Bescheid.",
    discord: "Discord hat nicht geantwortet. Bitte versuche es noch einmal.",
    "kein-mitglied": "Du bist noch nicht auf unserem Discord-Server. Tritt zuerst bei und melde dich dann an.",
    technik: "Technischer Fehler. Bitte versuche es gleich noch einmal.",
  };

  let stand = null;
  let beschaeftigt = false;
  let profilOffen = false;
  let briefingOffen = false;
  let starterOffen = false;
  let ansicht = "rennen";  // "rennen" oder "reports"
  let reportEntwurf = {};
  let filter = null;       // "meine", "alle" oder eine Serienkennung
  let auswahl = null;      // Kennung des Rennens im großen Block
  let karteWahl = 0;       // gezeigte Fahrerkarte, falls jemand in mehreren Serien fährt

  $("year").textContent = new Date().getFullYear();

  // Gleiche Motive wie auf der Ligaseite
  const { bildVon } = window.LigaKarte;
  const serieVon = (id) => stand.serien.find((s) => s.id === id);
  const rennBild = (r) => { const s = serieVon(r.serie); return r.serie ? bildVon(r.serie, s && s.bildVersion) : "img/hero.webp"; };
  const motiv = (src) => `style="background-image:url('${esc(src)}')"`;

  function statusChip(r) {
    if (r.status === "abgesagt") return '<span class="fb-status abgesagt">Abgesagt</span>';
    if (r.ich && r.ich.status === "starter") return '<span class="fb-status starter">Dabei</span>';
    if (r.ich) return `<span class="fb-status warteliste">Warteliste · Platz ${r.ich.platz}</span>`;
    if (r.offen && r.anmeldungFolgt) return '<span class="fb-status geschlossen">Anmeldung folgt</span>';
    if (!r.offen || r.anmeldungZu) return '<span class="fb-status geschlossen">Anmeldung geschlossen</span>';
    return '<span class="fb-status">Nicht angemeldet</span>';
  }

  const artBadge = (typ) => `<span class="liga-art klein ${typ === "event" ? "event" : "liga"}">${typ === "event" ? "Event" : "Liga"}</span>`;
  const serienTag = (r) => (r.serieName ? `${artBadge(r.serieTyp)} <span class="fb-serie-tag ${farbe(r.serieFarbe)}">${esc(r.serieName)}</span>` : "");

  function belegung(r) {
    const teile = [r.plaetze ? `${r.starter.length} von ${r.plaetze} Plätzen` : `${r.starter.length} gemeldet`];
    if (r.warteliste.length) teile.push(`${r.warteliste.length} auf der Warteliste`);
    return teile.join(" · ");
  }

  function klassenAuswahl(id, klassen) {
    if (klassen.length < 2) return "";
    return `<select id="fz-${esc(id)}" aria-label="Fahrzeugklasse wählen"><option value="">Klasse wählen</option>${klassen.map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join("")}</select>`;
  }

  const GESCHLOSSEN = '<span class="fb-zu">Anmeldung geschlossen</span>';
  const FOLGT = '<span class="fb-zu">Anmeldung folgt</span>';
  // Die Season, in der dieser Fahrer noch fehlt. Bei Events gibt es keine Gäste, dort zählt die Anmeldung zum Rennen.
  const offeneSeason = (r) => { const s = stand.serien.find((x) => x.id === r.serie); return s && s.typ !== "event" && !s.ich && s.anmeldungOffen ? s : null; };
  // Fahrzeug für die Season: Pflicht, wenn die Season eine Liste erlaubter Modelle hat. Ein Wechsel später nur nach den Regeln der Season.
  const modellAuswahl = (s, wert = "") => ((s.modelle || []).length ? `<select data-modell aria-label="Fahrzeug wählen"><option value="">Fahrzeug wählen</option>${s.modelle.map((m) => `<option value="${esc(m)}"${m === wert ? " selected" : ""}>${esc(m)}</option>`).join("")}</select>` : "");
  const seasonKnopf = (s) => `${modellAuswahl(s)}<button type="button" class="fb-knopf fb-melden" data-serie-aktion="serie-anmelden" data-serie="${esc(s.id)}">Für die Season anmelden</button>`;
  // Eigenes Fahrzeug in einer Season und Wechsel
  function fahrzeugZeile(s) {
    const f = (stand.fahrzeuge || {})[s.id];
    if (!f || !(s.modelle || []).length) return "";
    const regel = f.freiUebrig > 0 ? `${f.freiUebrig} freier Wechsel übrig` : "Wechsel nur mit Zustimmung der Rennleitung";
    const antrag = f.antrag ? `<small class="fb-antrag">Wechsel auf ${esc(f.antrag)} beantragt, die Rennleitung entscheidet.</small>` : "";
    return `<div class="fb-fahrzeug"><small>Dein Fahrzeug: <b>${esc(f.modell)}</b> · ${esc(regel)}</small>${antrag}<div class="fb-fahrzeug-wechsel">${modellAuswahl(s, f.antrag || f.modell)}<button type="button" class="fb-abmelden" data-fahrzeug-wechsel="${esc(s.id)}">${f.freiUebrig > 0 ? "Fahrzeug wechseln" : "Wechsel beantragen"}</button></div></div>`;
  }
  const dabeiStatus = (r) => {
    if (r.ich.status !== "starter") return `<span class="fb-dabei warte">Warteliste, Platz ${Number(r.ich.platz)}</span>`;
    return `<span class="fb-dabei"><i aria-hidden="true">✓</i>${r.ich.quelle === "rennen" && offeneSeason(r) ? "Als Gast dabei" : "Du bist dabei"}</span>`;
  };

  // Ältere Profile können noch ohne die inzwischen verpflichtende Startnummer gespeichert sein.
  const profilFertig = () => !!(stand.fahrer.profil && stand.fahrer.profil.nummer);

  function aktionHtml(r) {
    if (!r.offen) return r.status === "abgesagt" ? "" : r.ich ? dabeiStatus(r) : GESCHLOSSEN;
    const season = profilFertig() ? offeneSeason(r) : null;
    if (r.ich) return `${dabeiStatus(r)}${season ? `${klassenAuswahl("h-" + r.id, r.fahrzeugklassen)}${seasonKnopf(season)}` : ""}<button type="button" class="fb-abmelden" data-aktion="abmelden" data-rennen="${esc(r.id)}" data-quelle="${esc(r.ich.quelle)}">Abmelden</button>`;
    if (r.anmeldungZu) return r.anmeldungFolgt ? FOLGT : GESCHLOSSEN;
    if (!profilFertig()) return '<button type="button" class="fb-knopf fb-melden" data-profil="1">Erst Profil ausfüllen</button>';
    const voll = r.plaetze && r.starter.length >= r.plaetze;
    // In einer Season ist die Anmeldung für alle Runden der Normalfall, ein einzelnes Rennen die Ausnahme für Gäste.
    if (season) return `${klassenAuswahl("h-" + r.id, r.fahrzeugklassen)}${seasonKnopf(season)}<button type="button" class="fb-abmelden" data-aktion="anmelden" data-rennen="${esc(r.id)}">${voll ? "Nur dieses Rennen, auf die Warteliste" : "Nur dieses Rennen als Gast"}</button>`;
    return `${klassenAuswahl("h-" + r.id, r.fahrzeugklassen)}<button type="button" class="fb-knopf fb-melden" data-aktion="anmelden" data-rennen="${esc(r.id)}">${voll ? "Auf die Warteliste" : "Jetzt anmelden"}</button>`;
  }

  const fakt = (titel, wert, klasse) => (wert ? `<div class="${klasse || ""}"><dt>${esc(titel)}</dt><dd>${esc(wert)}</dd></div>` : "");
  const namenListe = (liste, ichName) => liste.map((f, i) => `<li class="${f.name === ichName ? "ich" : ""}"><em>${i + 1}</em><span>${esc(f.name)}</span>${f.gast ? '<small class="gast">Gast</small>' : ""}${f.fahrzeugklasse ? `<small>${esc(f.fahrzeugklasse)}</small>` : ""}</li>`).join("");

  // Trägt die Rennleitung bei einer Liga doch Zugangsdaten ein, werden sie auch angezeigt.
  const zeigeZugang = (r) => r.zugangNoetig || !!r.server || !!r.passwort;

  // Ablauf bis zum Start als Leuchten: grün erledigt, gelb Warteliste, dunkel noch offen
  function ablauf(r) {
    const schritte = [
      ["Profil", stand.fahrer.profil ? "on" : ""],
      ["Gemeldet", r.ich ? (r.ich.status === "starter" ? "on" : "warte") : ""],
      ["Briefing", r.briefing ? "on" : ""],
      ...(zeigeZugang(r) ? [["Zugangsdaten", r.passwort ? "on" : ""]] : []),
    ];
    const text = { on: "erledigt", warte: "Warteliste", "": "noch offen" };
    return `<ol class="fb-ablauf" aria-label="Ablauf bis zum Start">${schritte.map(([name, st]) => `<li class="${st}" aria-label="${name}: ${text[st]}"><i aria-hidden="true"></i><span aria-hidden="true">${name}</span></li>`).join("")}</ol>`;
  }

  function hauptRennen(r) {
    const schluss = r.offen && r.anmeldungZu && !r.ich ? "" : r.offen ? `${r.anmeldungZu ? "Abmeldung" : "Anmeldung und Abmeldung"} bis ${datum(r.schluss)}, ${uhr(r.schluss)}` : r.status === "abgesagt" ? "" : "Änderungen jetzt bitte im Discord an die Rennleitung.";
    const passwort = zeigeZugang(r) && r.ich && r.ich.status === "starter" ? r.passwort || "Kommt im Discord" : "";
    const konflikt = r.konflikt && r.konflikt.length ? `<p class="fb-konflikt">Überschneidung mit: ${esc(r.konflikt.join(", "))}. Melde dich bei einem der Rennen ab.</p>` : "";
    return `<article class="fb-haupt ${farbe(r.serieFarbe)}${r.serieTyp === "event" ? " ist-event" : ""}">
      <div class="fb-haupt-bild" ${motiv(rennBild(r))} aria-hidden="true"></div>
      <div class="fb-haupt-kopf">
        <div><div class="lbl fb-haupt-kicker">${r.id === auswahl ? "Ausgewähltes Rennen" : r.ich ? "Dein nächster Start" : "Nächstes Rennen"}</div><div class="fb-tags">${serienTag(r)}${statusChip(r)}</div><h3 class="fb-titel">${esc(r.titel)}</h3><p class="fb-unter">${esc([r.strecke, datum(r.start), uhr(r.start)].filter(Boolean).join(" · "))}</p></div>
        <div class="fb-haupt-rechts"><div class="fb-countdown" data-start="${esc(r.start)}" aria-hidden="true"></div>${r.streckenBild ? `<img class="fb-streckenkarte" src="api/liga?r=bild&k=${encodeURIComponent(r.streckenBild.k)}&v=${encodeURIComponent(r.streckenBild.v)}" alt="Streckenkarte ${esc(r.strecke)}" loading="lazy">` : ""}</div>
      </div>
      ${ablauf(r)}
      ${konflikt}
      <div class="fb-aktion">${aktionHtml(r)}<p>${esc(schluss)}</p></div>
      <dl class="fb-fakten">
        ${fakt("Belegung", belegung(r))}${fakt("Fahrzeuge", r.fahrzeuge)}${fakt("Training", r.training)}${fakt("Qualifying", r.qualifying)}${fakt("Rennen", r.renndauer)}${fakt("Wetter", r.wetter)}${fakt("Session", r.server)}${fakt("Passwort", passwort, "geheim")}
      </dl>
      <details class="fb-briefing-box"${briefingOffen ? " open" : ""}><summary>Briefing und Renninfos</summary><div class="fb-briefing">${r.briefing ? md(r.briefing) : "<p>Das Briefing folgt vor dem Rennen.</p>"}</div></details>
      ${starterBlock(r)}
    </article>`;
  }

  // Die vollständige Liste, standardmäßig eingeklappt und mehrspaltig, damit auch große Felder übersichtlich bleiben
  function starterBlock(r) {
    const ichName = stand.fahrer.profil ? stand.fahrer.profil.iracingName : "";
    const anzahl = r.plaetze ? `${r.starter.length} von ${r.plaetze}` : String(r.starter.length);
    const suche = r.starter.length + r.warteliste.length > 12 ? '<input type="search" class="fb-suche" id="fb-suche" placeholder="Fahrer suchen" aria-label="Fahrer suchen">' : "";
    return `<details class="fb-starter-box"${starterOffen ? " open" : ""}><summary>Starterliste (${esc(anzahl)})</summary>
      ${suche}
      ${r.starter.length ? `<ol class="fb-namen fb-namen-spalten">${namenListe(r.starter, ichName)}</ol>` : '<p class="fb-klein">Noch niemand gemeldet.</p>'}
      ${r.warteliste.length ? `<h4>Warteliste (${r.warteliste.length})</h4><ol class="fb-namen fb-namen-spalten">${namenListe(r.warteliste, ichName)}</ol>` : ""}
    </details>`;
  }

  // Kurzfassung für die Seitenspalte
  function feldPanel(r) {
    const anzahl = r.plaetze ? `${r.starter.length}/${r.plaetze}` : String(r.starter.length);
    const anteil = r.plaetze ? Math.min(100, Math.round((r.starter.length / r.plaetze) * 100)) : 0;
    const frei = r.plaetze ? Math.max(0, r.plaetze - r.starter.length) : null;
    const je = {};
    r.starter.forEach((f) => { if (f.fahrzeugklasse) je[f.fahrzeugklasse] = (je[f.fahrzeugklasse] || 0) + 1; });
    const klassen = Object.entries(je).map(([k, n]) => `${k}: ${n}`).join(" · ");
    const eigen = !r.ich ? "Du bist nicht gemeldet" : r.ich.status === "starter" ? `Du bist dabei, Meldung Nr. ${r.ich.platz}` : `Du stehst auf Platz ${r.ich.platz} der Warteliste`;
    const zeilen = [frei === null ? "" : frei ? `${frei} ${frei === 1 ? "Platz" : "Plätze"} frei` : "Feld voll", r.warteliste.length ? `${r.warteliste.length} auf der Warteliste` : "", klassen].filter(Boolean).join(" · ");
    // Bis 60 Plätze als Startaufstellung, darüber würde es zu kleinteilig
    const ichStarter = r.ich && r.ich.status === "starter" ? r.ich.platz - 1 : -1;
    const grafik = r.plaetze && r.plaetze <= 60
      ? `<div class="fb-startfeld" role="img" aria-label="${r.starter.length} von ${r.plaetze} Plätzen belegt">${Array.from({ length: r.plaetze }, (_, i) => `<i class="${i === ichStarter ? "ich" : i < r.starter.length ? "voll" : ""}"></i>`).join("")}</div>`
      : r.plaetze ? `<div class="fb-balken" role="img" aria-label="${anteil} Prozent belegt"><i style="width:${anteil}%"></i></div>` : "";
    return `<section class="fb-panel ${farbe(r.serieFarbe)}"><h3>Starterfeld <span>${esc(anzahl)}</span></h3>
      ${grafik}
      <p class="fb-feld-eigen ${r.ich ? r.ich.status : ""}">${esc(eigen)}</p>
      ${zeilen ? `<p class="fb-klein">${esc(zeilen)}</p>` : ""}
      <p class="fb-profil-link"><button type="button" class="fb-link" data-starter-oeffnen="1">Ganze Liste anzeigen</button></p>
    </section>`;
  }

  // Ruhige Terminliste. Angemeldet wird im großen Bereich oben, ein Klick auf die Zeile öffnet das Rennen dort.
  function weiteresRennen(r, mehrereSerien) {
    const start = new Date(r.start);
    const wann = `${zeitFormat({ weekday: "short" }).format(start).replace(".", "")} · ${uhr(r.start)}`;
    const strecke = r.strecke && !String(r.titel).includes(r.strecke) ? r.strecke : "";
    const belegt = r.plaetze ? `${r.starter.length}/${r.plaetze}` : String(r.starter.length);
    const abmelden = r.offen && r.ich ? `<button type="button" class="fb-abmelden" data-aktion="abmelden" data-rennen="${esc(r.id)}" data-quelle="${esc(r.ich.quelle)}">Abmelden</button>` : "";
    return `<li class="fb-termin ${farbe(r.serieFarbe)}${r.serieTyp === "event" ? " ist-event" : ""}">
      <div class="fb-termin-datum"><b>${esc(zeitFormat({ day: "2-digit" }).format(start))}</b><small>${esc(zeitFormat({ month: "short" }).format(start).replace(".", ""))}</small></div>
      <div class="fb-termin-karte">${r.streckenBild ? `<img src="api/liga?r=bild&k=${encodeURIComponent(r.streckenBild.k)}&v=${encodeURIComponent(r.streckenBild.v)}" alt="" loading="lazy">` : ""}</div>
      <div class="fb-termin-text"><button type="button" class="fb-waehle" data-waehle="${esc(r.id)}">${esc(r.titel)}</button><small>${esc([strecke, wann, mehrereSerien ? r.serieName : "", `${belegt} gemeldet`].filter(Boolean).join(" · "))}</small>${r.konflikt && r.konflikt.length ? '<span class="fb-konflikt-kurz">Überschneidung</span>' : ""}</div>
      <div class="fb-termin-status">${statusChip(r)}${abmelden}</div>
    </li>`;
  }

  /* ---------- Renntag ---------- */
  const berlinTag = (t) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
  const RENNTAG_LISTE = [["sim", "Sim und Inhalte aktualisiert"], ["setup", "Setup geladen"], ["briefing", "Briefing gelesen"], ["discord", "Discord offen"]];
  const hakenLesen = (id) => { try { return JSON.parse(localStorage.getItem(`dsrs-renntag-${id}`) || "{}"); } catch (e) { return {}; } };
  const hakenSetzen = (id, w) => { try { localStorage.setItem(`dsrs-renntag-${id}`, JSON.stringify(w)); } catch (e) { /* ohne Speicher gilt der Haken nur bis zum Neuladen */ } };

  // Erscheint nur am Tag eines eigenen Rennens, mit allem, was man vor dem Start braucht.
  function renntagPanel() {
    const heute = berlinTag(Date.now());
    const r = stand.rennen.filter((x) => x.ich && x.ich.status === "starter" && x.status !== "abgesagt" && berlinTag(x.start) === heute)[0];
    if (!r) return "";
    const haken = hakenLesen(r.id);
    const kopieren = (wert, name) => (wert ? `<button type="button" class="fb-abmelden" data-kopieren="${esc(wert)}" aria-label="${esc(name)} kopieren">Kopieren</button>` : "");
    const zugang = (titel, wert, leer) => `<div class="fb-renntag-zugang"><span>${esc(titel)}</span><b>${esc(wert || leer)}</b>${kopieren(wert, titel)}</div>`;
    return `<section class="fb-renntag ${farbe(r.serieFarbe)}">
      <div class="fb-renntag-kopf">
        <div><div class="lbl">Heute ist Renntag</div><h2>${esc(r.titel)}</h2><p>${esc([r.serieName, r.strecke, uhr(r.start)].filter(Boolean).join(" · "))}</p></div>
        <div class="fb-countdown" data-start="${esc(r.start)}" aria-hidden="true"></div>
      </div>
      ${zeigeZugang(r) ? "" : '<p class="fb-klein">Du brauchst keine Zugangsdaten. Die Session findest du in iRacing bei unserer Liga.</p>'}
      <div class="fb-renntag-reihe${zeigeZugang(r) ? "" : " ohne-zugang"}">
        ${zeigeZugang(r) ? `${zugang("Server", r.server, "Folgt im Discord")}${zugang("Passwort", r.passwort, "Folgt im Discord")}` : ""}
        <dl class="fb-fakten">${fakt("Training", r.training)}${fakt("Qualifying", r.qualifying)}${fakt("Rennen", r.renndauer)}${fakt("Wetter", r.wetter)}</dl>
      </div>
      <ul class="fb-renntag-liste">${RENNTAG_LISTE.map(([k, t]) => `<li><label><input type="checkbox" data-haken="${k}" data-rennen="${esc(r.id)}"${haken[k] ? " checked" : ""}> ${esc(t)}</label></li>`).join("")}</ul>
    </section>`;
  }

  function kalenderPanel() {
    if (!stand.kalender || !stand.fahrer.profil) return "";
    const adresse = `${location.origin}${stand.kalender}`;
    return `<section class="fb-panel"><h3>Kalender</h3><p class="fb-klein">Deine Rennen automatisch im Kalender, auch wenn sich Termine verschieben. Der Link ist persönlich, bitte nicht weitergeben.</p><div class="fb-kalender"><a class="fb-knopf zweit" href="${esc(adresse.replace(/^https?:/, "webcal:"))}">Kalender abonnieren</a><button type="button" class="fb-abmelden" data-kopieren="${esc(adresse)}">Link kopieren</button></div></section>`;
  }

  function serienPanel() {
    const offene = stand.serien.filter((s) => s.status !== "beendet");
    if (!offene.length) return "";
    const zeilen = offene.map((s) => {
      let aktion = "";
      if (s.ich) aktion = `<span class="fb-dabei"><i aria-hidden="true">✓</i>Dabei</span><button type="button" class="fb-abmelden" data-serie-aktion="serie-abmelden" data-serie="${esc(s.id)}">Abmelden</button>`;
      else if (s.anmeldungOffen && profilFertig()) aktion = `${klassenAuswahl("s-" + s.id, s.fahrzeugklassen)}${modellAuswahl(s)}<button type="button" class="fb-knopf fb-melden" data-serie-aktion="serie-anmelden" data-serie="${esc(s.id)}">Jetzt anmelden</button>`;
      else if (!s.anmeldungOffen) aktion = s.status === "geplant" ? FOLGT : GESCHLOSSEN;
      const info = [s.ich ? `Dabei${s.fahrzeugklasse ? ` · ${s.fahrzeugklasse}` : ""}` : "", s.einstufungDurchRennleitung ? "Einstufung durch Rennleitung" : s.klasse].filter(Boolean).join(" · ");
      return `<li class="${farbe(s.farbe)}${s.ich ? " dabei" : ""}"><span class="fb-serie-bild" ${motiv(bildVon(s.id, s.bildVersion))} aria-hidden="true"></span><div>${artBadge(s.typ)} <a href="/liga?serie=${encodeURIComponent(s.id)}">${esc(s.name)}</a>${info ? `<small>${esc(info)}</small>` : ""}</div><div class="fb-serie-aktion">${aktion}</div>${s.ich ? fahrzeugZeile(s) : ""}</li>`;
    }).join("");
    return `<section class="fb-panel"><h3>Serien und Events</h3><ul class="fb-serien">${zeilen}</ul></section>`;
  }

  const abschnitt = (titel, meta, inhalt, zusatz) => `<section class="sheet"><div class="wrap">
    <div class="doc-head"><h2 class="wide">${esc(titel)}</h2><div class="doc-meta lbl">${esc(meta)}</div></div>
    ${zusatz || ""}<div class="liga-abschnitt-inhalt">${inhalt}</div>
  </div></section>`;

  function profilForm() {
    const p = stand.fahrer.profil || {};
    const wunsch = stand.fahrer.nummerWunsch;
    const nummerHinweis = wunsch ? `Deine Änderung von #${esc(p.nummer)} auf #${esc(wunsch)} wartet auf die Rennleitung. Trage wieder ${esc(p.nummer)} ein, um sie zurückzuziehen.` : p.nummer ? "Trägst du eine andere Nummer ein, muss die Rennleitung sie bestätigen." : "Jede Startnummer gibt es nur einmal. Spätere Änderungen muss die Rennleitung bestätigen.";
    return `<form class="fb-profil" id="fb-profil" novalidate>
      <div class="fb-feld"><label for="p-name">iRacing-Name</label><input id="p-name" autocomplete="off" maxlength="40" value="${esc(p.iracingName || "")}" required></div>
      <div class="fb-feld"><label for="p-cust">iRacing-ID</label><input id="p-cust" inputmode="numeric" autocomplete="off" maxlength="9" value="${esc(p.custId || "")}" required></div>
      <div class="fb-feld"><label for="p-ir">Sports-Car-iRating</label><input id="p-ir" inputmode="numeric" autocomplete="off" maxlength="5" value="${esc(p.irating ?? "")}" required></div>
      <div class="fb-feld"><label for="p-nr">Startnummer</label><input id="p-nr" inputmode="numeric" autocomplete="off" maxlength="3" placeholder="1 bis 999" value="${esc(wunsch ?? p.nummer ?? "")}" required></div>
      <p class="fb-klein">${nummerHinweis}</p>
      <h4 class="fb-oeffentlich">Öffentlich auf deinem Profil, alles freiwillig</h4>
      <div class="fb-feld"><label for="p-land">Land</label><select id="p-land"><option value="">Keine Angabe</option>${window.LigaFlaggen.LAENDER.map(([c, n]) => `<option value="${c}"${c === p.land ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></div>
      <div class="fb-feld"><label for="p-team">Team oder Club</label><input id="p-team" autocomplete="off" maxlength="40" value="${esc(p.team || "")}"></div>
      <div class="fb-feld"><label for="p-kanal">Twitch- oder YouTube-Link</label><input id="p-kanal" autocomplete="off" maxlength="150" placeholder="https://www.twitch.tv/…" value="${esc(p.kanal || "")}"></div>
      <label class="fb-haken"><input type="checkbox" id="p-bild"${p.zeigeBild === false ? "" : " checked"}><span>Mein Discord-Profilbild auf dem Profil und der Fahrerkarte zeigen</span></label>
      <div class="fb-profil-fuss">
        <button type="submit" class="fb-knopf">Profil speichern</button>
        ${stand.fahrer.profil ? '<button type="button" class="fb-knopf zweit" id="p-abbrechen">Abbrechen</button>' : ""}
        <p>Dein iRacing-Name erscheint in der Starterliste. Startnummer, Land, Team, Link und Profilbild sieht jeder auf deinem öffentlichen Profil. iRacing-ID und iRating sieht nur die Rennleitung. Das iRating prüfen wir vor dem Saisonstart. Mehr dazu in der <a href="/datenschutz">Datenschutzerklärung</a>.</p>
      </div>
    </form>`;
  }

  function profilAnsicht() {
    const p = stand.fahrer.profil;
    const bild = eigenesBild();
    const bildFehlt = p.zeigeBild === true && !bild;
    return `<div class="fb-lizenz">
        <div class="fb-lizenz-kopf"><img src="img/brand/dsrs-logo.png" alt="" width="654" height="165"><span>Fahrerlizenz</span></div>
        <div class="fb-lizenz-fahrer">${bild ? `<img class="fb-lizenz-bild" src="${esc(bild)}" alt="" width="52" height="52">` : ""}<strong>${p.nummer ? `<span class="fb-lizenz-nr">#${esc(p.nummer)}</span> ` : ""}${esc(p.iracingName)}</strong></div>
        ${p.land || p.team ? `<small class="fb-lizenz-info">${window.LigaKarte.flagge(p.land)}${esc([window.LigaFlaggen.name(p.land), p.team].filter(Boolean).join(" · "))}</small>` : ""}
        <dl><div><dt>iRacing-ID</dt><dd>${esc(p.custId)}</dd></div><div><dt>Sports-Car-iRating</dt><dd>${esc(Number(p.irating).toLocaleString("de-DE"))}</dd></div></dl>
      </div>
      ${stand.fahrer.nummerWunsch ? `<p class="fb-klein">Änderung auf #${esc(stand.fahrer.nummerWunsch)} beantragt. Sie gilt, sobald die Rennleitung sie bestätigt.</p>` : ""}
      ${bildFehlt ? '<p class="fb-klein">Dein Discord-Bild ist noch nicht übernommen. Logge dich einmal aus und wieder ein, dann erscheint es hier. Ohne eigenes Bild bei Discord bleibt der Platz leer.</p>' : ""}
      <p class="fb-profil-link"><button type="button" class="fb-link" data-profil="1">Profil ändern</button>${(stand.meineKarten || []).some((k) => k.pid) ? ` <a class="fb-link" href="/fahrer?id=${encodeURIComponent(stand.fahrer.pid)}">Öffentliches Profil</a>` : ""}</p>`;
  }

  /* ---------- Kopfbereich mit persönlicher Fahrerkarte ---------- */
  function eigenesBild() {
    const o = stand.fahrer.oeffentlich;
    return o && o.bild && stand.fahrer.pid ? window.LigaKarte.avatarVon(stand.fahrer.pid, o.bild) : "";
  }
  const { rang, klassenFarbe, werte: wertZeilen } = window.LigaKarte;

  function meineKarte(k) {
    const ziel = k.pid ? `/fahrer?id=${encodeURIComponent(k.pid)}` : `/liga?serie=${encodeURIComponent(k.serie)}#fahrer/${encodeURIComponent(k.klasseId)}/${encodeURIComponent(k.name)}`;
    return `<a class="liga-fk ${klassenFarbe(k)} ${rang(k.karte.rating)}" href="${esc(ziel)}" aria-label="Dein Fahrerprofil in ${esc(k.serieName)} öffnen">${window.LigaKarte.inhalt({ ...k, profil: stand.fahrer.oeffentlich })}</a>`;
  }

  function kartenBereich(name) {
    const karten = stand.meineKarten || [];
    if (!karten.length) {
      return `<div class="liga-fk r-offen fb-platzhalter">
        <div class="liga-fk-kopf"><div class="liga-fk-rating"><b>–</b><span>Noch keine Wertung</span></div></div>
        <div class="liga-fk-fahrer">${eigenesBild() ? `<img class="liga-fk-avatar" src="${esc(eigenesBild())}" alt="" width="48" height="48">` : ""}<div class="liga-fk-name"><strong>${esc(name)}</strong><small>Deine Fahrerkarte entsteht nach deinem ersten gewerteten Rennen.</small></div></div>
        ${wertZeilen({})}
      </div>`;
    }
    const k = karten[Math.min(karteWahl, karten.length - 1)];
    const wahl = karten.length > 1 ? `<div class="fb-karten-wahl" role="group" aria-label="Serie der Fahrerkarte wählen">${karten.map((x, i) => `<button type="button" data-karte-wahl="${i}" aria-pressed="${x === k}">${esc(x.serieName)}</button>`).join("")}</div>` : "";
    return `${meineKarte(k)}${wahl}`;
  }

  function naechsterSchritt(f) {
    if (!f.profil) return "Fülle einmal dein Profil aus, dann kannst du dich für Serien und Rennen anmelden.";
    if (!f.profil.nummer) return "Trage eine Startnummer in deinem Profil ein, dann kannst du dich für Serien und Rennen anmelden.";
    const r = stand.rennen.find((x) => x.ich && x.status !== "abgesagt");
    if (r) return `Dein nächster Start: ${r.titel}, ${datum(r.start)}, ${uhr(r.start)}.`;
    return "Du bist gerade für kein Rennen gemeldet. Such dir unten eine Serie oder ein Event aus.";
  }

  function kopfbereich(f, haupt) {
    const name = f.profil ? f.profil.iracingName : f.name;
    const karten = stand.meineKarten || [];
    const k = karten[Math.min(karteWahl, karten.length - 1)];
    const zahlen = [
      [stand.rennen.filter((r) => r.ich && r.status !== "abgesagt").length, "Rennen gemeldet"],
      [stand.serien.filter((s) => s.ich).length, "Serien"],
      ...(k ? [[`P${k.pos}`, k.klasse], [k.punkte, "Punkte"]] : []),
    ];
    return `<section class="fb-held ${haupt ? farbe(haupt.serieFarbe) : "s-rot"}">
      <div class="fb-held-bild" ${motiv(haupt ? rennBild(haupt) : "img/hero.webp")} aria-hidden="true"></div>
      <div class="wrap">
        <div class="fb-held-text">
          <div class="lbl liga-kicker">Fahrerbereich</div>
          <h1>Hallo, <em>${esc(name)}</em></h1>
          <p class="fb-held-satz">${esc(naechsterSchritt(f))}</p>
          <div class="liga-fakten">${zahlen.map(([w, t]) => `<div><b>${esc(w)}</b><span>${esc(t)}</span></div>`).join("")}</div>
          <div class="fb-held-fuss">${f.profil ? "" : '<button type="button" class="fb-knopf" data-profil="1">Profil ausfüllen</button>'}<span>Angemeldet als ${esc(f.name)}</span><button type="button" class="fb-knopf zweit" id="fb-logout">Ausloggen</button></div>
        </div>
        <div class="fb-held-karte">${kartenBereich(name)}</div>
      </div>
    </section>`;
  }

  function zeigeLogin() {
    const fehler = FEHLER[new URLSearchParams(location.search).get("fehler")];
    main.innerHTML = `<section class="fb-held fb-held-login s-rot">
      <div class="fb-held-bild" ${motiv("img/hero.webp")} aria-hidden="true"></div>
      <div class="wrap">
        <div class="fb-held-text">
          <img class="fb-login-logo" src="img/brand/dsrs-logo.png" alt="Darkline Simracing Series" width="654" height="165">
          <h1>Dein <em>Cockpit</em></h1>
          ${fehler ? `<p class="fb-meldung" role="alert">${esc(fehler)}</p>` : ""}
          <ul class="fb-vorteile">
            <li><b>Rennen</b><span>Alle Termine deiner Serien auf einen Blick</span></li>
            <li><b>Anmeldung</b><span>Für Serien und einzelne Rennen mit einem Klick</span></li>
            <li><b>Fahrerkarte</b><span>Dein Rating, deine Werte, deine Abzeichen</span></li>
          </ul>
          <div class="fb-held-fuss"><a class="fb-knopf" href="/api/discord-login?ziel=liga">Mit Discord anmelden</a><span>Dafür musst du auf unserem <a href="https://discord.gg/QP2rKy6n8U">Discord-Server</a> sein.</span></div>
        </div>
      </div>
    </section>`;
  }

  /* ---------- Reports ---------- */
  function urteilText(u) {
    if (u.art === "strafpunkte") return `${u.punkte} Strafpunkte`;
    if (u.art === "zeitstrafe") return `${u.sekunden} Sekunden Zeitstrafe`;
    if (u.art === "dsq") return "Disqualifikation";
    if (u.art === "verwarnung") return "Verwarnung";
    return "Kein Vergehen";
  }
  const urteilKlasse = (u) => (u.art === "kein-vergehen" ? "starter" : u.art === "verwarnung" ? "warteliste" : "abgesagt");
  const STATUS_REPORT = { offen: "Eingegangen", pruefung: "In Prüfung", entschieden: "Entschieden" };

  function ansichtWahl() {
    const offen = stand.reports.meine.filter((r) => r.kannEinspruch).length;
    return `<div class="fb-ansicht" role="group" aria-label="Ansicht wählen"><button type="button" data-ansicht="rennen" aria-pressed="${ansicht === "rennen"}">Rennen</button><button type="button" data-ansicht="reports" aria-pressed="${ansicht === "reports"}">Reports${offen ? ` (${offen})` : ""}</button></div>`;
  }

  const gegnerOptionen = (rennen, gewaehlt) => `<option value="">Fahrer wählen</option>${(rennen ? rennen.fahrer : []).map((n) => `<option value="${esc(n)}"${n === gewaehlt ? " selected" : ""}>${esc(n)}</option>`).join("")}`;

  function reportForm() {
    const liste = stand.reports.meldbar;
    if (!stand.fahrer.profil) return '<p class="fb-klein">Bitte fülle zuerst dein Profil aus.</p>';
    if (!liste.length && stand.reports.cooldownBis) return `<p class="fb-klein">Nach dem Rennen gilt eine Cooldownphase von 30 Minuten. Proteste sind ab ${esc(uhr(stand.reports.cooldownBis))} möglich.</p>`;
    if (!liste.length) return '<p class="fb-klein">Melden kannst du Vorfälle aus Rennen, in denen du gestartet bist, ab 30 Minuten und bis 24 Stunden nach Rennende. Gerade ist kein Rennen offen.</p>';
    const w = reportEntwurf;
    const rennen = liste.find((r) => r.id === w.rennen) || liste[0];
    return `<form class="fb-profil" id="fb-report" novalidate>
      <div class="fb-feld"><label for="r-rennen">Rennen</label><select id="r-rennen" name="rennen">${liste.map((r) => `<option value="${esc(r.id)}"${r === rennen ? " selected" : ""}>${esc(r.titel)}</option>`).join("")}</select></div>
      <div class="fb-feld"><label for="r-gegen">Beteiligter Fahrer</label><select id="r-gegen" name="gegen">${gegnerOptionen(rennen, w.gegen)}</select></div>
      <div class="fb-feld"><label for="r-stelle">Wann und wo</label><input id="r-stelle" name="stelle" maxlength="120" placeholder="Runde 5, Kurve 3" value="${esc(w.stelle || "")}"></div>
      <div class="fb-feld"><label for="r-text">Was ist passiert?</label><textarea id="r-text" name="beschreibung" maxlength="2000" rows="4">${esc(w.beschreibung || "")}</textarea></div>
      <div class="fb-feld"><label for="r-clip">Clip-Link (optional)</label><input id="r-clip" name="clip" maxlength="300" placeholder="https://" value="${esc(w.clip || "")}"></div>
      <div class="fb-profil-fuss"><button type="submit" class="fb-knopf">Report einreichen</button><p>Melden kannst du bis ${esc(datum(rennen.frist))}, ${esc(uhr(rennen.frist))}. Der gemeldete Fahrer sieht, dass der Report von dir kommt.</p></div>
    </form>`;
  }

  function fallKarte(r) {
    const status = r.urteil ? `<span class="fb-status ${urteilKlasse(r.urteil)}">${esc(urteilText(r.urteil))}</span>` : `<span class="fb-status${r.status === "pruefung" ? " warteliste" : ""}">${esc(STATUS_REPORT[r.status] || "")}</span>`;
    const clip = r.clip ? `<p class="fb-fall-text"><a href="${esc(r.clip)}" target="_blank" rel="noopener noreferrer">Clip ansehen ↗</a></p>` : "";
    const urteil = r.urteil ? `<div class="fb-urteil"><b>Begründung</b><p>${esc(r.urteil.begruendung)}</p>${r.endgueltig ? '<p class="fb-klein">Endgültig entschieden.</p>' : ""}</div>` : "";
    const einspruch = r.meinEinspruch
      ? `<p class="fb-klein">${r.endgueltig ? "Dein Einspruch wurde geprüft." : "Dein Einspruch liegt der Rennleitung vor."}</p>`
      : r.kannEinspruch ? `<details class="fb-einspruch-box"><summary>Einspruch einlegen</summary><form class="fb-einspruch" data-id="${esc(r.id)}"><label for="e-${esc(r.id)}" class="fb-klein">Einmal möglich, bis ${esc(datum(r.einspruchFrist))}, ${esc(uhr(r.einspruchFrist))}.</label><textarea id="e-${esc(r.id)}" name="text" maxlength="2000" rows="3"></textarea><button type="submit" class="fb-knopf">Einspruch senden</button></form></details>` : "";
    return `<article class="fb-fall ${farbe(r.serieFarbe)}">
      <div class="fb-fall-kopf"><div><h3>${esc(r.rennenTitel)}</h3><p class="fb-klein">${esc(r.von)} meldet ${esc(r.gegen)} · ${esc(r.stelle)}</p></div>${status}</div>
      <p class="fb-fall-text">${esc(r.beschreibung)}</p>${clip}${urteil}${einspruch}
    </article>`;
  }

  function reportsAnsicht() {
    const { meine, urteile } = stand.reports;
    const zeilen = urteile.map((r) => `<li class="${farbe(r.serieFarbe)}"><div><b>${esc(r.gegen)}</b><small>${esc(r.rennenTitel)} · gemeldet von ${esc(r.von)}</small><small>${esc(r.urteil.begruendung)}</small></div><span class="fb-status ${urteilKlasse(r.urteil)}">${esc(urteilText(r.urteil))}</span></li>`).join("");
    return `<div class="fb-raster">
      <div class="fb-haupt-spalte">
        <section class="fb-panel"><h3>Vorfall melden</h3>${reportForm()}</section>
        <h3 class="fb-zwischen">Deine Fälle</h3>
        ${meine.length ? `<div class="fb-faelle">${meine.map(fallKarte).join("")}</div>` : '<p class="fb-leer">Du bist an keinem Report beteiligt.</p>'}
      </div>
      <aside class="fb-seiten-spalte"><section class="fb-panel"><h3>Urteile</h3>${zeilen ? `<ul class="fb-urteile">${zeilen}</ul>` : '<p class="fb-klein">Noch keine Urteile.</p>'}</section></aside>
    </div>`;
  }

  function filterChips() {
    const chips = [["meine", "Meine Rennen"], ["alle", "Alle"], ...stand.serien.filter((s) => s.status !== "beendet").map((s) => [s.id, s.typ === "event" ? `★ ${s.name}` : s.name])];
    return `<div class="fb-filter" role="group" aria-label="Rennen filtern">${chips.map(([id, name]) => `<button type="button" data-filter="${esc(id)}" aria-pressed="${filter === id}">${esc(name)}</button>`).join("")}</div>`;
  }

  function zeichne() {
    if (!stand.angemeldet) return zeigeLogin();
    const f = stand.fahrer;
    if (!filter) filter = stand.rennen.some((r) => r.ich) ? "meine" : "alle";
    const sichtbar = stand.rennen.filter((r) => filter === "alle" || (filter === "meine" ? r.ich : r.serie === filter));
    const haupt = sichtbar.find((r) => r.id === auswahl) || sichtbar[0];
    const rest = sichtbar.filter((r) => r !== haupt);
    const profilNoetig = !f.profil || profilOffen;
    const profilPanel = `<section class="fb-panel${f.profil ? "" : " fb-panel-wichtig"}"><h3>${!f.profil ? "Profil einmalig ausfüllen" : profilOffen ? "Profil ändern" : "Dein Profil"}</h3>${profilNoetig ? profilForm() : profilAnsicht()}</section>`;
    const box = main.querySelector(".fb-briefing-box");
    if (box) briefingOffen = box.open;
    const starterBox = main.querySelector(".fb-starter-box");
    if (starterBox) starterOffen = starterBox.open;
    const leerText = filter === "meine" ? "Du bist noch für kein Rennen gemeldet. Melde dich rechts für eine Serie an oder schau unter „Alle“." : "Hier ist gerade kein Rennen geplant. Neue Termine erscheinen hier und im Discord.";
    const kopf = kopfbereich(f, haupt);
    if (ansicht === "reports") {
      main.innerHTML = `${kopf}<section class="sheet"><div class="wrap"><div class="fb-leiste">${ansichtWahl()}</div><p class="fb-meldung" id="fb-meldung" role="alert" hidden></p>${reportsAnsicht()}</div></section>`;
      return;
    }
    main.innerHTML = `${kopf}<section class="sheet"><div class="wrap">
      <div class="fb-leiste">${ansichtWahl()}${filterChips()}</div>
      <p class="fb-meldung" id="fb-meldung" role="alert" hidden></p>
      ${renntagPanel()}
      ${nummerEntscheidPanel()}
      <div class="fb-raster">
        <div class="fb-haupt-spalte">
          ${haupt ? hauptRennen(haupt) : `<p class="fb-leer">${esc(leerText)}</p>`}
          ${rest.length ? `<h3 class="fb-zwischen">Weitere Rennen</h3><ol class="fb-termine">${rest.map((r) => weiteresRennen(r, new Set(rest.map((x) => x.serie)).size > 1)).join("")}</ol>` : ""}
        </div>
        <aside class="fb-seiten-spalte">${serienPanel()}${haupt ? feldPanel(haupt) : ""}${kalenderPanel()}${profilPanel}</aside>
      </div>
    </div></section>`;
    uhrwerk();
  }

  // Bleibt stehen, bis der Fahrer die Entscheidung der Rennleitung wegklickt.
  function nummerEntscheidPanel() {
    const e = (stand.fahrer.profil || {}).nummerEntscheid;
    if (!e) return "";
    return `<section class="fb-panel fb-panel-wichtig"><h3>Startnummer</h3><p>${esc(e.text)}</p><p class="fb-profil-link"><button type="button" class="fb-link" id="fb-nummer-gelesen">Verstanden</button></p></section>`;
  }

  function meldung(text, gut) {
    const el = $("fb-meldung");
    if (el) { el.textContent = text || ""; el.hidden = !text; el.classList.toggle("gut", !!gut); if (text) el.scrollIntoView({ block: "center" }); }
  }

  async function sende(daten) {
    if (beschaeftigt) return;
    beschaeftigt = true;
    main.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    let fehler = "";
    try {
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(daten) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { stand = d; if (daten.aktion === "profil") profilOffen = false; }
      else fehler = d.error || "Das hat nicht geklappt. Bitte versuche es noch einmal.";
    } catch (e) {
      fehler = "Keine Verbindung. Bitte versuche es noch einmal.";
    }
    beschaeftigt = false;
    // Bei einem Fehler bleibt alles Eingetippte stehen.
    const felder = fehler && daten.aktion === "profil" ? ["p-name", "p-cust", "p-ir", "p-nr", "p-land", "p-team", "p-kanal"] : [];
    const eingaben = felder.map((id) => $(id).value);
    const bildHaken = felder.length ? $("p-bild").checked : false;
    zeichne();
    felder.forEach((id, i) => { $(id).value = eingaben[i]; });
    if (felder.length) $("p-bild").checked = bildHaken;
    if (fehler) meldung(fehler);
    return !fehler;
  }

  main.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || beschaeftigt) return;
    if (b.id === "fb-logout") return sende({ aktion: "logout" }).then(() => location.reload());
    if (b.dataset.kopieren) {
      const melden = (t) => { const alt = b.textContent; b.textContent = t; setTimeout(() => { b.textContent = alt; }, 1500); };
      navigator.clipboard.writeText(b.dataset.kopieren).then(() => melden("Kopiert"), () => melden("Nicht möglich"));
      return;
    }
    if (b.id === "fb-nummer-gelesen") return sende({ aktion: "nummer-gelesen" });
    if (b.id === "p-abbrechen") { profilOffen = false; return zeichne(); }
    if (b.dataset.ansicht) { ansicht = b.dataset.ansicht; return zeichne(); }
    if (b.dataset.starterOeffnen) {
      const liste = main.querySelector(".fb-starter-box");
      if (liste) { liste.open = true; liste.scrollIntoView({ block: "start" }); }
      return;
    }
    if (b.dataset.filter) { filter = b.dataset.filter; auswahl = null; return zeichne(); }
    if (b.dataset.karteWahl !== undefined) { karteWahl = Number(b.dataset.karteWahl); return zeichne(); }
    if (b.dataset.waehle) { auswahl = b.dataset.waehle; zeichne(); return main.querySelector(".fb-haupt").scrollIntoView({ block: "start" }); }
    if (b.dataset.profil) {
      profilOffen = true;
      zeichne();
      const form = $("fb-profil");
      if (form) form.scrollIntoView({ block: "center" });
      return;
    }
    if (b.dataset.aktion === "anmelden") {
      const select = b.parentElement.querySelector("select");
      return sende({ aktion: "anmelden", rennen: b.dataset.rennen, fahrzeugklasse: select ? select.value : "" });
    }
    if (b.dataset.aktion === "abmelden") {
      const text = b.dataset.quelle === "serie" ? "Nur von diesem Rennen abmelden? Du bleibst in der Serie gemeldet, dein Platz geht an den Nächsten auf der Warteliste." : "Wirklich von diesem Rennen abmelden? Dein Platz geht an den Nächsten auf der Warteliste.";
      if (window.confirm(text)) sende({ aktion: "abmelden", rennen: b.dataset.rennen });
      return;
    }
    if (b.dataset.serieAktion === "serie-anmelden") {
      const select = b.parentElement.querySelector("select:not([data-modell])");
      const modell = b.parentElement.querySelector("select[data-modell]");
      if (modell && !modell.value) { modell.focus(); return window.alert("Bitte wähle zuerst dein Fahrzeug für diese Season. Ein späterer Wechsel ist nur nach den Regeln der Season möglich."); }
      if (modell && !window.confirm(`Mit dem ${modell.value} für die Season anmelden? Ein späterer Fahrzeugwechsel ist nur eingeschränkt möglich.`)) return;
      return sende({ aktion: "serie-anmelden", serie: b.dataset.serie, fahrzeugklasse: select ? select.value : "", modell: modell ? modell.value : "" });
    }
    if (b.dataset.fahrzeugWechsel) {
      const modell = b.parentElement.querySelector("select[data-modell]");
      const f = (stand.fahrzeuge || {})[b.dataset.fahrzeugWechsel] || {};
      if (!modell || !modell.value || modell.value === (f.antrag || f.modell)) return;
      const frage = modell.value === f.modell ? "Antrag zurückziehen und beim bisherigen Fahrzeug bleiben?" : f.freiUebrig > 0 ? `Auf den ${modell.value} wechseln? Damit ist dein freier Wechsel verbraucht, er gilt ab dem nächsten Rennen.` : `Wechsel auf den ${modell.value} bei der Rennleitung beantragen?`;
      if (!window.confirm(frage)) return;
      return sende({ aktion: "fahrzeug-wechseln", serie: b.dataset.fahrzeugWechsel, modell: modell.value });
    }
    if (b.dataset.serieAktion === "serie-abmelden" && window.confirm("Wirklich aus dieser Serie abmelden? Du wirst dann auch aus allen kommenden Rennen der Serie genommen.")) {
      sende({ aktion: "serie-abmelden", serie: b.dataset.serie });
    }
  });

  // Suche in der Starterliste, ohne die Seite neu aufzubauen
  main.addEventListener("input", (e) => {
    if (e.target.id !== "fb-suche") return;
    const q = e.target.value.trim().toLowerCase();
    main.querySelectorAll(".fb-namen-spalten li").forEach((li) => li.classList.toggle("aus", !!q && !li.querySelector("span").textContent.toLowerCase().includes(q)));
  });

  // Im Report-Formular gehören die Fahrer zum gewählten Rennen.
  main.addEventListener("change", (e) => {
    if (e.target.dataset.haken) {
      const id = e.target.dataset.rennen;
      hakenSetzen(id, { ...hakenLesen(id), [e.target.dataset.haken]: e.target.checked });
      return;
    }
    if (e.target.id !== "r-rennen") return;
    reportEntwurf = { ...reportEntwurf, rennen: e.target.value, gegen: "" };
    $("r-gegen").innerHTML = gegnerOptionen(stand.reports.meldbar.find((r) => r.id === e.target.value), "");
  });

  main.addEventListener("submit", async (e) => {
    if (e.target.id === "fb-report") {
      e.preventDefault();
      reportEntwurf = Object.fromEntries(new FormData(e.target).entries());
      if (await sende({ aktion: "report-melden", ...reportEntwurf })) { reportEntwurf = {}; zeichne(); meldung("Dein Report ist eingegangen.", true); }
      return;
    }
    if (e.target.classList.contains("fb-einspruch")) {
      e.preventDefault();
      if (await sende({ aktion: "report-einspruch", id: e.target.dataset.id, text: e.target.elements.text.value })) meldung("Dein Einspruch ist eingegangen.", true);
      return;
    }
    if (e.target.id !== "fb-profil") return;
    e.preventDefault();
    sende({ aktion: "profil", profil: { iracingName: $("p-name").value, custId: $("p-cust").value, irating: $("p-ir").value, nummer: $("p-nr").value, land: $("p-land").value, team: $("p-team").value, kanal: $("p-kanal").value, zeigeBild: $("p-bild").checked } });
  });

  // Countdown zum gewählten Rennen
  function uhrwerk() {
    main.querySelectorAll(".fb-countdown").forEach((el) => {
      const ms = new Date(el.dataset.start) - Date.now();
      if (ms <= 0) { el.innerHTML = '<span class="fb-live">Rennen läuft</span>'; return; }
      const teile = [[Math.floor(ms / 864e5), "Tage"], [Math.floor(ms / 36e5) % 24, "Std"], [Math.floor(ms / 6e4) % 60, "Min"]];
      el.innerHTML = teile.map(([v, l]) => `<span><b>${String(v).padStart(2, "0")}</b><small>${l}</small></span>`).join("");
    });
  }
  setInterval(uhrwerk, 30000);

  fetch(API, { cache: "no-store" })
    .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
    .then((d) => { stand = d; zeichne(); })
    .catch(() => { main.innerHTML = abschnitt("Fahrerbereich", "Darkline Simracing Series", '<p class="fb-leer">Der Fahrerbereich ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.</p>'); });
})();
