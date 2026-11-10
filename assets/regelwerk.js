/* Regelwerk: Reglement, Strafenkatalog und Flaggensignale der Liga */
(function () {
  "use strict";
  const inhalt = document.getElementById("rw-inhalt");
  const knoepfe = [...document.querySelectorAll("[data-teil]")];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const PDF = { reglement: ["Reglement_DSRS_1.1.0.pdf", "Reglement 1.1.0 als PDF"], strafen: ["Anhang_A_Strafenkatalog_1.1.0.pdf", "Anhang A als PDF"], flaggen: ["Anhang_B_Flaggensignale_1.0.2.pdf", "Anhang B als PDF"] };
  const pdfLink = (t) => `<a class="rw-pdf" href="dokumente/${PDF[t][0]}" target="_blank" rel="noopener">${PDF[t][1]} ↓</a>`;
  const deDatum = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${m[3]}.${m[2]}.${m[1]}` : ""; };

  // Fett und Adressen im Reglement. Die Ligaplattform liegt unter /liga.
  const formatiere = (t) => esc(t)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/https:\/\/[^\s<]+?(?=[.,]?(?:\s|<|$))/g, (u) => `<a href="${u.includes("liga.darklineperformance") ? "/liga" : u}">${u}</a>`)
    .replace(/kontakt@darklineperformance\.de/g, '<a href="mailto:kontakt@darklineperformance.de">kontakt@darklineperformance.de</a>');

  function block(b) {
    if (b.art === "ul") return `<ul>${b.items.map((x) => `<li>${formatiere(x)}</li>`).join("")}</ul>`;
    if (b.art === "zeilen") return `<p>${b.items.map(formatiere).join("<br>")}</p>`;
    if (b.art === "tabelle") return `<div class="rw-scroll"><table><thead><tr>${b.kopf.map((k) => `<th>${esc(k)}</th>`).join("")}</tr></thead><tbody>${b.zeilen.map((z) => `<tr>${z.map((w) => `<td>${esc(w)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    if (b.art === "bild") return `<figure><img src="${esc(b.src)}" alt="${esc(b.alt)}" loading="lazy"><figcaption>${esc(b.text)}</figcaption></figure>`;
    return `<p>${formatiere(b.text)}</p>`;
  }

  function reglement() {
    const r = window.LigaReglementFormat.zuAnzeige(reglementDaten || window.LigaReglement);
    // Im Dokument kommen 6.4 und 6.5 doppelt vor, die Anker werden deshalb durchgezählt.
    let lauf = 0;
    const teile = r.abschnitte.map((h) => ({ ...h, unter: h.unter.map((u) => ({ ...u, anker: `rw-${++lauf}` })) }));
    const verzeichnis = teile.map((h) => `<li><button type="button" data-ziel="rw-h${h.nr}">${esc(h.nr)}. ${esc(h.titel)}</button></li>`).join("");
    const text = teile.map((h) => `<section class="rw-haupt" id="rw-h${h.nr}"><h2 class="wide">${esc(h.nr)}. ${esc(h.titel)}</h2>${h.unter.map((u) => `<article><h3>${esc(u.nr)} ${esc(u.titel)}</h3>${u.bloecke.map(block).join("")}</article>`).join("")}</section>`).join("");
    return `<div class="rw-kopfzeile"><span class="lbl">${esc(r.titel)} · Version ${esc(r.version)} · Stand ${esc(r.stand)}</span>${pdfLink("reglement")}</div>
      <div class="rw-raster"><nav class="rw-toc" aria-label="Inhaltsverzeichnis"><ol>${verzeichnis}</ol></nav><div class="rw-text">${text}</div></div>`;
  }

  const LEGENDE = [["TN", "Teilnehmer"], ["S&H", "Stop-and-Hold-Strafe"], ["S&G", "Stop-and-Go-Strafe"], ["BS", "Boxengassenstart"], ["DT", "Drive-Through-Strafe"], ["DQ", "Disqualifikation"], ["S/W-Flagge", "Schwarz-Weiße Flagge"], ["RT", "Reaktionszeit (Response Time)"], ["SC", "Safety Car"], ["FCY", "Full Course Yellow"]];

  function strafen(k) {
    const zeilen = k.eintraege.map((x) => `<tr class="${x.vergehen ? "start" : ""}"><td class="rw-nr">${esc(x.nr)}</td><td>${x.vergehen ? `<b>${esc(x.vergehen)}</b>` : ""}</td><td>${esc(x.erklaerung)}</td><td class="rw-strafe">${esc(x.min || "–")}</td><td class="rw-strafe">${esc(x.max || "–")}</td><td>${esc(x.hinweis || "")}</td><td>${esc(x.kommentar || "")}</td></tr>`).join("");
    return `<div class="rw-kopfzeile"><span class="lbl">Anhang A · Aktueller Stand ${esc(deDatum(k.stand))}</span>${pdfLink("strafen")}</div>
      <p class="rw-hinweis">Strafmaße und Punkte kann die Rennleitung anpassen. Maßgeblich ist der hier gezeigte aktuelle Stand, bereits gesprochene Urteile bleiben unverändert.</p>
      <h2 class="wide rw-unter">Vergehen und Strafrahmen</h2>
      <div class="rw-scroll"><table class="rw-katalog"><thead><tr><th>Nr</th><th>Vergehen</th><th>Erklärung</th><th>Mindeststrafe</th><th>Höchststrafe</th><th>Hinweis</th><th>Kommentar</th></tr></thead><tbody>${zeilen}</tbody></table></div>
      <div class="rw-zwei">
        <div><h2 class="wide rw-unter">Strafpunkte</h2><div class="rw-scroll"><table><thead><tr><th>Strafe</th><th class="rw-zahl">Punkte</th></tr></thead><tbody>${k.strafpunkte.map((p) => `<tr><td>${esc(p.strafe)}</td><td class="rw-zahl">${esc(p.punkte)}</td></tr>`).join("")}</tbody></table></div></div>
        <div><h2 class="wide rw-unter">Legende</h2><div class="rw-scroll"><table><thead><tr><th>Abkürzung</th><th>Bedeutung</th></tr></thead><tbody>${LEGENDE.map(([a, b]) => `<tr><td><b>${esc(a)}</b></td><td>${esc(b)}</td></tr>`).join("")}</tbody></table></div></div>
      </div>`;
  }

  const FLAGGEN = [
    ["gruen", "B.2 Grüne Flagge", "Die Strecke ist frei und kann unter normalen Rennbedingungen befahren werden."],
    ["gelb", "B.3 Gelbe Flagge", "Gefahr auf oder unmittelbar neben der Strecke. Fahrweise und Geschwindigkeit sind anzupassen; Überholmanöver sind grundsätzlich untersagt. Ein zur Kollisionsvermeidung notwendiges Vorbeifahren ist zulässig, die Position muss anschließend unverzüglich zurückgegeben werden."],
    ["blau", "B.4 Blaue Flagge", "Ein schnelleres Fahrzeug nähert sich zum Überrunden. Das Überrunden ist zeitnah, sicher und vorhersehbar bei der nächstmöglichen Gelegenheit zu ermöglichen. Ein Positionskampf ist erforderlichenfalls zu unterbrechen."],
    ["schwarzweiss", "B.5 Schwarz-Weiße Flagge", "Die Schwarz-Weiße Flagge stellt eine förmliche Verwarnung durch die Rennleitung dar. Der Teilnehmer muss das beanstandete Verhalten unverzüglich einstellen. Weitere oder wiederholte Verstöße können mit einer zusätzlichen Strafe geahndet werden."],
    ["schwarz", "B.6 Schwarze Flagge", "Der Teilnehmer wurde durch die Simulation oder Rennleitung disqualifiziert oder darf das Rennen nicht fortsetzen. Den Anweisungen der Rennleitung ist unverzüglich Folge zu leisten."],
    ["orange", "B.7 Schwarz-Orange Flagge", "Hinweis auf einen technischen Defekt oder eine Beschädigung. Das Fahrzeug ist schnellstmöglich und sicher an die Box zu bringen."],
    ["weiss", "B.8 Weiße Flagge", "Ein deutlich langsameres Fahrzeug befindet sich auf der Strecke. Alle Teilnehmer müssen ihre Fahrweise entsprechend anpassen."],
    ["ziel", "B.9 Zielflagge", "Das Rennen endet für den jeweiligen Teilnehmer. Nach dem Überqueren der Ziellinie ist das Tempo angemessen zu reduzieren; unnötige oder gefährliche Fahrmanöver sind zu vermeiden."],
  ];

  function flaggen() {
    return `<div class="rw-kopfzeile"><span class="lbl">Anhang B · Bestandteil des Serienreglements 2026</span>${pdfLink("flaggen")}</div>
      <p class="rw-hinweis"><b>B.1 Allgemeines.</b> Die Flaggensignale dienen der Sicherheit aller Teilnehmer und sind jederzeit zu beachten. Die in iRacing angezeigten Flaggensignale sowie die Anweisungen der Rennleitung sind verbindlich. Verstöße können entsprechend dem Hauptreglement und Anhang A geahndet werden.</p>
      <div class="rw-flaggen">${FLAGGEN.map(([art, titel, text]) => `<article><div class="rw-flagge ${art}" aria-hidden="true"></div><div><h3>${esc(titel)}</h3><p>${esc(text)}</p></div></article>`).join("")}</div>
      <p class="rw-hinweis"><b>B.10 Missachtung von Flaggensignalen.</b> Die Missachtung von Flaggensignalen stellt einen Verstoß gegen das Reglement dar. Verstöße werden durch die Rennleitung entsprechend der Art und Schwere des Vergehens geahndet.</p>`;
  }

  let katalog = null;
  let reglementDaten = null;
  let teil = new URLSearchParams(location.search).get("teil");
  if (!PDF[teil]) teil = "reglement";

  function zeige() {
    knoepfe.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.teil === teil)));
    if (teil === "reglement") inhalt.innerHTML = reglement();
    else if (teil === "flaggen") inhalt.innerHTML = flaggen();
    else inhalt.innerHTML = katalog ? strafen(katalog) : '<p class="rw-hinweis">Der Strafenkatalog wird geladen …</p>';
  }

  knoepfe.forEach((b) => b.addEventListener("click", () => {
    teil = b.dataset.teil;
    // Wegen <base href="/"> braucht die Adresse den vollen Pfad.
    history.replaceState(null, "", `${location.pathname}?teil=${teil}`);
    zeige();
  }));
  inhalt.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ziel]");
    if (b) document.getElementById(b.dataset.ziel).scrollIntoView({ block: "start" });
  });

  zeige();
  fetch("api/liga?r=regeln", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => { katalog = d.katalog; reglementDaten = d.reglement; if (teil === "strafen" || (teil === "reglement" && reglementDaten)) zeige(); }).catch(() => { if (teil === "strafen") inhalt.innerHTML = '<p class="rw-hinweis">Der Strafenkatalog ist gerade nicht erreichbar.</p>'; });
})();
