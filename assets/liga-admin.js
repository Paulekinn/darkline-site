/* Rennleitung der Darkline Liga: Serien, Rennen, Fahrer, Ergebnisse und Strafen. Eigener Bereich mit eigenem Login. */
(function () {
  "use strict";
  const API = "api/liga?r=admin";
  const app = document.getElementById("app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const zahl = (n) => (n === null || n === undefined ? "–" : Number(n).toLocaleString("de-DE"));
  const zeit = (iso) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const datumKurz = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ""); return m ? `${m[3]}.${m[2]}.${m[1]}` : ""; };
  const FEHLER = {
    abgebrochen: "Die Anmeldung wurde abgebrochen.",
    ungueltig: "Die Anmeldung ist abgelaufen. Bitte versuche es noch einmal.",
    konfiguration: "Der Zugang ist noch nicht eingerichtet: In Vercel fehlt LIGA_ADMIN_ROLE_IDS.",
    discord: "Discord hat nicht geantwortet. Bitte versuche es noch einmal.",
    "kein-mitglied": "Du bist nicht auf dem Discord-Server.",
    "keine-rolle": "Dein Discord-Konto hat keine Rolle für die Rennleitung.",
    technik: "Technischer Fehler. Bitte versuche es gleich noch einmal.",
  };
  const TABS = [["serien", "Serien"], ["rennen", "Rennen"], ["fahrer", "Fahrer"], ["ergebnisse", "Ergebnisse"], ["reports", "Reports"]];
  const URTEILE = [["kein-vergehen", "Kein Vergehen"], ["verwarnung", "Verwarnung"], ["strafpunkte", "Strafpunkte"], ["zeitstrafe", "Zeitstrafe"], ["dsq", "Disqualifikation"]];
  const NEUE_SERIE = { name: "", typ: "liga", saison: "", status: "anmeldung", anmeldungOffen: true, farbe: "rot", beschreibung: "", kategorie: "Sports_Car", fahrzeugklassen: [], rennenGesamt: 8, gewerteteRennen: 7, anmeldeschlussMinuten: 60,
    klassen: [{ name: "Pro", min: 2500, max: null }, { name: "Pro-Am", min: 1500, max: 2499 }, { name: "Am", min: 0, max: 1499 }],
    punkte: [30, 26, 23, 21, 19, 17, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2], punkteDanach: 1, bonusPole: 1, bonusSchnellsteRunde: 1, mindestRundenProzent: 75 };
  const NEUES_RENNEN = { titel: "", serie: "", status: "geplant", datum: "", startzeit: "20:00", strecke: "", fahrzeuge: "", plaetze: 40, training: "", qualifying: "", renndauer: "", wetter: "", server: "", passwort: "", briefing: "" };

  let d = null;
  let tab = "serien";
  let serieId = "";
  let form = null;        // { art: "serie"|"rennen", id, werte }
  let meldung = null;     // { text, fehler }
  let datei = null;       // eingelesene Ergebnisdatei
  let vorschau = null;
  let beschaeftigt = false;
  let reportId = null;
  let zugelassen = [];    // iRacing-IDs nicht gemeldeter Fahrer, die als Gast gewertet werden sollen

  async function vorschauRechnen() {
    const a = await sende({ aktion: "ergebnis-vorschau", serie: serieId, datei, zugelassen });
    vorschau = a;
    if (!a) { datei = null; zugelassen = []; }
    zeichne();
  }

  const setzeMeldung = (text, fehler) => { meldung = text ? { text, fehler: !!fehler } : null; };

  async function lade() {
    const r = await fetch(API + (serieId ? `&serie=${encodeURIComponent(serieId)}` : ""), { cache: "no-store" });
    if (!r.ok) throw new Error();
    d = await r.json();
    if (d.angemeldet && (!serieId || !d.serien.some((s) => s.id === serieId)) && d.serien.length) {
      serieId = d.serien[0].id;
      return lade();
    }
  }

  async function sende(daten, erfolg) {
    if (beschaeftigt) return null;
    beschaeftigt = true;
    let antwort = null;
    try {
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(daten) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { antwort = j; setzeMeldung(erfolg); }
      else setzeMeldung(j.error || "Das hat nicht geklappt.", true);
    } catch (e) {
      setzeMeldung("Keine Verbindung. Bitte versuche es noch einmal.", true);
    }
    beschaeftigt = false;
    return antwort;
  }

  async function aktion(daten, erfolg) {
    const a = await sende(daten, erfolg);
    if (a) { form = null; await lade().catch(() => {}); }
    zeichne();
    return a;
  }

  /* ---------- Bausteine ---------- */
  const feld = (titel, html, breit) => `<div class="a-feld${breit ? " breit" : ""}"><label>${esc(titel)}</label>${html}</div>`;
  const eingabe = (name, wert, attr) => `<input name="${name}" value="${esc(wert)}" ${attr || ""}>`;
  const auswahl = (name, wert, optionen) => `<select name="${name}">${optionen.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(wert) ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  const serienName = (id) => { const s = d.serien.find((x) => x.id === id); return s ? s.name : id; };
  const serienAuswahl = () => (d.serien.length ? `<select id="a-serie" class="a-auswahl" aria-label="Serie wählen">${d.serien.map((s) => `<option value="${esc(s.id)}"${s.id === serieId ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select>` : "");
  const statusChip = (s) => (s === "laeuft" ? '<span class="a-chip gruen">Läuft</span>' : s === "beendet" ? '<span class="a-chip">Beendet</span>' : s === "abgesagt" ? '<span class="a-chip rot">Abgesagt</span>' : s === "geplant" ? '<span class="a-chip gruen">Geplant</span>' : '<span class="a-chip gelb">Anmeldung</span>');
  const klasseZeile = (k) => `<div class="a-klasse"><input name="k_name" value="${esc(k.name)}" placeholder="Name" aria-label="Klassenname"><input name="k_min" type="number" min="0" value="${esc(k.min)}" aria-label="iRating von"><input name="k_max" type="number" min="0" value="${esc(k.max ?? "")}" placeholder="offen" aria-label="iRating bis"><button type="button" class="a-knopf zweit klein" data-klasse-weg="1">Weg</button></div>`;

  /* ---------- Bilder ---------- */
  const bildSchluessel = (ziel) => (ziel === "uebersicht" ? "uebersicht" : `serie-${ziel}`);
  const bildVersion = (ziel) => (ziel === "uebersicht" ? d.kopfbildVersion : (d.serien.find((s) => s.id === ziel) || {}).bildVersion) || 0;
  function bildFeldInhalt(ziel, status, fehler) {
    const v = bildVersion(ziel);
    const klein = ziel === "uebersicht" ? "Querformat, am besten mindestens 1920 Pixel breit." : "Querformat, am besten mindestens 1200 Pixel breit. Ohne eigenes Bild wird ein Livery-Bild verwendet.";
    return `<div class="a-bild-rahmen">${v ? `<img src="api/liga?r=bild&amp;k=${esc(bildSchluessel(ziel))}&amp;v=${v}" alt="Aktuelles Bild">` : "<span>Standardbild</span>"}</div>
      <div class="a-bild-steuerung">
        <div class="a-feld"><label for="bild-${esc(ziel)}">Neues Bild (JPG, PNG oder WebP)</label><input type="file" id="bild-${esc(ziel)}" accept="image/jpeg,image/png,image/webp" data-bild-ziel="${esc(ziel)}"></div>
        <p class="a-hinweis${fehler ? " a-bild-fehler" : ""}">${esc(status || klein)}</p>
        ${v ? `<div><button type="button" class="a-knopf gefahr klein" data-bild-weg="${esc(ziel)}">Bild entfernen</button></div>` : ""}
      </div>`;
  }
  const bildFeld = (ziel) => `<div class="a-bild" data-bild-box="${esc(ziel)}">${bildFeldInhalt(ziel)}</div>`;
  // Aktualisiert nur dieses Feld, damit Eingaben in einem offenen Formular erhalten bleiben.
  function bildFeldNeu(ziel, status, fehler) {
    const box = app.querySelector(`[data-bild-box="${CSS.escape(ziel)}"]`);
    if (box) box.innerHTML = bildFeldInhalt(ziel, status, fehler);
  }

  // Verkleinert das Bild im Browser. WebP, wo es der Browser kann, sonst JPEG.
  async function bildVorbereiten(datei) {
    const url = URL.createObjectURL(datei);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const faktor = Math.min(1, 1920 / img.naturalWidth);
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * faktor);
      c.height = Math.round(img.naturalHeight * faktor);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const format = c.toDataURL("image/webp", 0.8).startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
      for (const q of [0.82, 0.72, 0.6, 0.45]) {
        const daten = c.toDataURL(format, q);
        if (daten.length < 3500000) return daten;
      }
      throw new Error("zu gross");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function bildHochladen(ziel, datei) {
    bildFeldNeu(ziel, "Wird hochgeladen …");
    let daten;
    try {
      daten = await bildVorbereiten(datei);
    } catch (e) {
      return bildFeldNeu(ziel, "Dieses Bild konnte nicht gelesen werden. Bitte wähle ein anderes aus.", true);
    }
    const a = await sende({ aktion: "bild-speichern", ziel, daten });
    const fehler = a ? "" : (meldung && meldung.text) || "Das hat nicht geklappt.";
    setzeMeldung("");
    await lade().catch(() => {});
    bildFeldNeu(ziel, fehler || "Bild gespeichert.", !!fehler);
  }

  async function bildEntfernen(ziel) {
    const a = await sende({ aktion: "bild-loeschen", ziel });
    const fehler = a ? "" : (meldung && meldung.text) || "Das hat nicht geklappt.";
    setzeMeldung("");
    await lade().catch(() => {});
    bildFeldNeu(ziel, fehler || "Bild entfernt.", !!fehler);
  }

  /* ---------- Serien ---------- */
  function serienForm() {
    const w = form.werte;
    return `<form class="a-karte" id="f-serie" novalidate>
      <div class="a-kartenkopf"><h2>${form.id ? "Serie bearbeiten" : "Neue Serie"}</h2></div>
      ${form.id ? `<h3>Bild der Serie</h3>${bildFeld(form.id)}` : '<p class="a-hinweis">Ein eigenes Bild kannst du hinzufügen, sobald die Serie gespeichert ist.</p>'}
      <div class="a-felder">
        ${feld("Name", eingabe("name", w.name, 'maxlength="60"'))}
        ${feld("Art", auswahl("typ", w.typ, [["liga", "Liga"], ["event", "Event"]]))}
        ${feld("Saison", eingabe("saison", w.saison, 'maxlength="40" placeholder="Saison 1"'))}
        ${feld("Status", auswahl("status", w.status, [["anmeldung", "Anmeldung"], ["laeuft", "Läuft"], ["beendet", "Beendet"]]))}
        ${feld("Farbe", auswahl("farbe", w.farbe, [["rot", "Rot"], ["blau", "Blau"], ["lila", "Lila"], ["gruen", "Grün"], ["gelb", "Gelb"], ["tuerkis", "Türkis"]]))}
        ${feld("iRating-Kategorie", auswahl("kategorie", w.kategorie, [["Sports_Car", "Sports Car"], ["Formula", "Formula"], ["Oval", "Oval"], ["Dirt_Road", "Dirt Road"], ["Dirt_Oval", "Dirt Oval"]]))}
        ${feld("Fahrzeugklassen (bei Multiclass)", eingabe("fahrzeugklassen", (w.fahrzeugklassen || []).join(", "), 'placeholder="GTP, GT3"'))}
        ${feld("Rennen gesamt", eingabe("rennenGesamt", w.rennenGesamt, 'type="number" min="1"'))}
        ${feld("Gewertete Rennen", eingabe("gewerteteRennen", w.gewerteteRennen, 'type="number" min="1"'))}
        ${feld("Anmeldeschluss (Minuten vorher)", eingabe("anmeldeschlussMinuten", w.anmeldeschlussMinuten, 'type="number" min="0"'))}
        ${feld("Report-Frist (Stunden nach dem Rennen)", eingabe("reportStunden", w.reportStunden ?? 24, 'type="number" min="1"'))}
        ${feld("Einspruchsfrist (Stunden nach dem Urteil)", eingabe("einspruchStunden", w.einspruchStunden ?? 48, 'type="number" min="1"'))}
        ${feld("Beschreibung", `<textarea name="beschreibung" maxlength="400" style="min-height:60px">${esc(w.beschreibung)}</textarea>`, true)}
      </div>
      <label class="a-check"><input type="checkbox" name="anmeldungOffen"${w.anmeldungOffen !== false ? " checked" : ""}> Fahrer können sich anmelden</label>
      <h3>iRating-Klassen</h3>
      <p class="a-hinweis">Lückenlos von 0 aufwärts. Name, von, bis. Bei der obersten Klasse „bis“ leer lassen.</p>
      <div class="a-klassen" id="a-klassen">${w.klassen.map(klasseZeile).join("")}</div>
      <div><button type="button" class="a-knopf zweit klein" data-klasse-neu="1">Klasse hinzufügen</button></div>
      <h3>Punkte</h3>
      <div class="a-felder">
        ${feld("Punkte nach Platz", eingabe("punkte", w.punkte.join(", ")), true)}
        ${feld("Punkte für alle danach", eingabe("punkteDanach", w.punkteDanach, 'type="number" min="0"'))}
        ${feld("Bonus Pole", eingabe("bonusPole", w.bonusPole, 'type="number" min="0"'))}
        ${feld("Bonus schnellste Runde", eingabe("bonusSchnellsteRunde", w.bonusSchnellsteRunde, 'type="number" min="0"'))}
        ${feld("Mindestrunden in Prozent", eingabe("mindestRundenProzent", w.mindestRundenProzent, 'type="number" min="0" max="100"'))}
      </div>
      <div class="a-leiste"><button type="submit" class="a-knopf">Speichern</button><button type="button" class="a-knopf zweit" data-abbrechen="1">Abbrechen</button>${form.id ? '<button type="button" class="a-knopf gefahr" data-serie-loeschen="1">Löschen</button>' : ""}</div>
    </form>`;
  }

  function serienTab() {
    const zeilen = d.serien.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.typ === "event" ? '<span class="a-chip gelb">★ Event</span>' : '<span class="a-chip">Liga</span>'}</td><td>${esc(s.saison)}</td><td>${statusChip(s.status)}</td><td>${s.anmeldungOffen === false ? "geschlossen" : "offen"}</td><td class="rechts">${d.rennen.filter((r) => r.serie === s.id).length}</td><td class="rechts"><a class="a-knopf zweit klein" href="/liga?serie=${encodeURIComponent(s.id)}">Ansehen</a> <button type="button" class="a-knopf zweit klein" data-serie-bearbeiten="${esc(s.id)}">Bearbeiten</button></td></tr>`).join("");
    return `<section class="a-karte"><div class="a-kartenkopf"><h2>Serien und Events</h2><button type="button" class="a-knopf" data-serie-neu="1">Neue Serie</button></div>
      ${d.serien.length ? `<div class="a-scroll"><table><thead><tr><th>Name</th><th>Art</th><th>Saison</th><th>Status</th><th>Anmeldung</th><th class="rechts">Rennen</th><th></th></tr></thead><tbody>${zeilen}</tbody></table></div>` : '<p class="a-leer">Noch keine Serie angelegt. Leg die erste Liga oder das erste Event an.</p>'}
    </section>
    <section class="a-karte"><h2>Titelbild der Liga-Übersicht</h2>${bildFeld("uebersicht")}</section>
    ${form && form.art === "serie" ? serienForm() : ""}`;
  }

  /* ---------- Rennen ---------- */
  function rennenForm() {
    const w = form.werte;
    return `<form class="a-karte" id="f-rennen" novalidate>
      <div class="a-kartenkopf"><h2>${form.id ? "Rennen bearbeiten" : "Neues Rennen"}</h2></div>
      <div class="a-felder">
        ${feld("Titel", eingabe("titel", w.titel, 'maxlength="80" placeholder="Runde 1 · Spa"'))}
        ${feld("Serie oder Event", auswahl("serie", w.serie || serieId, d.serien.map((s) => [s.id, s.name])))}
        ${feld("Status", auswahl("status", w.status, [["geplant", "Geplant"], ["abgesagt", "Abgesagt"]]))}
        ${feld("Datum", eingabe("datum", w.datum, 'type="date"'))}
        ${feld("Rennstart (deutsche Zeit)", eingabe("startzeit", w.startzeit, 'type="time"'))}
        ${feld("Strecke", eingabe("strecke", w.strecke, 'maxlength="80"'))}
        ${feld("Fahrzeuge", eingabe("fahrzeuge", w.fahrzeuge, 'maxlength="80"'))}
        ${feld("Startplätze", eingabe("plaetze", w.plaetze, 'type="number" min="1"'))}
        ${feld("Training", eingabe("training", w.training, 'placeholder="30 min"'))}
        ${feld("Qualifying", eingabe("qualifying", w.qualifying, 'placeholder="15 min"'))}
        ${feld("Renndauer", eingabe("renndauer", w.renndauer, 'placeholder="60 min"'))}
        ${feld("Wetter", eingabe("wetter", w.wetter))}
        ${feld("Session-Name in iRacing", eingabe("server", w.server))}
        ${feld("Session-Passwort", eingabe("passwort", w.passwort, 'autocomplete="off"'))}
        ${feld("Briefing und Renninfos (Markdown)", `<textarea name="briefing" maxlength="10000">${esc(w.briefing)}</textarea>`, true)}
      </div>
      <p class="a-hinweis">Das Passwort sehen nur Fahrer mit Startplatz, das Briefing nur angemeldete Fahrer.</p>
      <div class="a-leiste"><button type="submit" class="a-knopf">Speichern</button><button type="button" class="a-knopf zweit" data-abbrechen="1">Abbrechen</button>${form.id ? '<button type="button" class="a-knopf gefahr" data-rennen-loeschen="1">Löschen</button>' : ""}</div>
    </form>`;
  }

  function rennenTab() {
    const liste = [...d.rennen].sort((a, b) => `${a.datum} ${a.startzeit}`.localeCompare(`${b.datum} ${b.startzeit}`));
    const zeilen = liste.map((r) => `<tr><td>${esc(datumKurz(r.datum))}</td><td>${esc(r.startzeit)}</td><td class="umbruch">${esc(r.titel)}</td><td>${esc(serienName(r.serie))}</td><td>${statusChip(r.status)}</td><td class="rechts">${r.plaetze}</td><td>${r.passwort ? '<span class="a-chip gruen">gesetzt</span>' : '<span class="a-chip">fehlt</span>'}</td><td class="rechts"><button type="button" class="a-knopf zweit klein" data-rennen-bearbeiten="${esc(r.id)}">Bearbeiten</button></td></tr>`).join("");
    const knopf = d.serien.length ? '<button type="button" class="a-knopf" data-rennen-neu="1">Neues Rennen</button>' : "";
    return `<section class="a-karte"><div class="a-kartenkopf"><h2>Rennen</h2>${knopf}</div>
      ${!d.serien.length ? '<p class="a-leer">Leg zuerst eine Serie an.</p>' : liste.length ? `<div class="a-scroll"><table><thead><tr><th>Datum</th><th>Start</th><th>Titel</th><th>Serie</th><th>Status</th><th class="rechts">Plätze</th><th>Passwort</th><th></th></tr></thead><tbody>${zeilen}</tbody></table></div>` : '<p class="a-leer">Noch keine Rennen geplant.</p>'}
    </section>${form && form.art === "rennen" ? rennenForm() : ""}`;
  }

  /* ---------- Fahrer ---------- */
  function fahrerTab() {
    if (!d.serien.length) return '<section class="a-karte"><p class="a-leer">Leg zuerst eine Serie an.</p></section>';
    const serie = d.serien.find((s) => s.id === serieId);
    const det = d.details;
    const klassenOption = (auto, fest) => `<option value="">Automatisch${auto ? ` (${esc((serie.klassen.find((k) => k.id === auto) || {}).name || auto)})` : ""}</option>${serie.klassen.map((k) => `<option value="${esc(k.id)}"${k.id === fest ? " selected" : ""}>${esc(k.name)}</option>`).join("")}`;
    const zeilen = det.fahrer.map((f) => {
      const abweichung = f.iratingAngabe !== null && f.iratingErgebnis !== null && Math.abs(f.iratingAngabe - f.iratingErgebnis) > 150;
      return `<tr><td>${esc(f.name)}${f.fahrzeugklasse ? ` <span class="a-chip">${esc(f.fahrzeugklasse)}</span>` : ""}</td><td>${f.mitglied ? "Serie" : "Einzeln"}</td><td>${esc(f.custId) || "–"}</td><td class="rechts">${zahl(f.iratingAngabe)}</td><td class="rechts ${abweichung ? "a-abweichung" : ""}">${zahl(f.iratingErgebnis)}${abweichung ? " !" : ""}</td>
        <td>${f.custId ? `<select data-einstufung="${esc(f.custId)}" aria-label="Klasse von ${esc(f.name)}">${klassenOption(f.klasseAuto, f.klasseFest)}</select>` : "–"}</td>
        <td class="rechts"><button type="button" class="a-knopf gefahr klein" data-aus-serie="${esc(f.discordId)}" data-name="${esc(f.name)}">Entfernen</button></td></tr>`;
    }).join("");
    const liste = (r, l) => l.map((f, i) => `<li><span>${i + 1}. ${esc(f.name)}${f.fahrzeugklasse ? ` · ${esc(f.fahrzeugklasse)}` : ""}</span><button type="button" class="a-weg" data-aus-rennen="${esc(r.id)}" data-fahrer="${esc(f.discordId)}" data-name="${esc(f.name)}" aria-label="${esc(f.name)} aus dem Rennen nehmen">×</button></li>`).join("");
    const rennen = det.rennen.map((r) => `<details class="a-rennen"><summary>${esc(r.titel)} · ${esc(zeit(r.start))} · ${r.starter.length}/${r.plaetze}${r.warteliste.length ? ` · ${r.warteliste.length} warten` : ""}</summary>
        ${r.starter.length ? `<ol class="a-namen">${liste(r, r.starter)}</ol>` : '<p class="a-hinweis" style="padding:0 12px 10px">Noch niemand gemeldet.</p>'}
        ${r.warteliste.length ? `<h4>Warteliste</h4><ol class="a-namen">${liste(r, r.warteliste)}</ol>` : ""}</details>`).join("");
    return `<section class="a-karte"><div class="a-kartenkopf"><h2>Fahrer</h2>${serienAuswahl()}</div>
      ${det.fahrer.length ? `<div class="a-scroll"><table><thead><tr><th>Name</th><th>Meldung</th><th>iRacing-ID</th><th class="rechts">iR Angabe</th><th class="rechts">iR Ergebnis</th><th>Klasse</th><th></th></tr></thead><tbody>${zeilen}</tbody></table></div><p class="a-hinweis">„!“ bedeutet: Angabe und letztes Ergebnis liegen mehr als 150 auseinander.</p>` : '<p class="a-leer">Noch keine Fahrer gemeldet.</p>'}
    </section>
    <section class="a-karte"><h2>Starterlisten</h2>${rennen || '<p class="a-leer">Keine kommenden Rennen.</p>'}</section>`;
  }

  /* ---------- Ergebnisse und Strafen ---------- */
  function vorschauHtml() {
    if (!vorschau) return "";
    const v = vorschau;
    const gruppen = v.tabelle.klassen.filter((k) => k.fahrer.length).map((k) => `<div><h3>${esc(k.name)}</h3><div class="a-scroll"><table><thead><tr><th>Pos</th><th>Fahrer</th><th class="rechts">Letztes Rennen</th><th class="rechts">Gesamt</th></tr></thead><tbody>${k.fahrer.map((f) => {
      const l = f.rennen[f.rennen.length - 1];
      return `<tr><td>${f.pos}</td><td>${esc(f.name)}</td><td class="rechts">${l ? (l.status === "OK" ? `P${l.platz} · ${l.punkte}` : esc(l.status)) : "–"}</td><td class="rechts">${f.punkte}</td></tr>`;
    }).join("")}</tbody></table></div></div>`).join("");
    const fremde = v.fremde.length ? `<details class="a-rennen"><summary>${v.fremde.length} nicht gemeldete Fahrer werden nicht gewertet und nicht gespeichert</summary>
        <p class="a-hinweis" style="padding:0 12px 8px">Hak einen Fahrer an, um ihn ausnahmsweise als Gast zu werten.</p>
        <ul class="a-namen">${v.fremde.map((f) => `<li><label class="a-check"><input type="checkbox" data-gast="${esc(f.cust)}"${f.gast ? " checked" : ""}> <span>P${f.gesamt} ${esc(f.name)}</span></label></li>`).join("")}</ul></details>` : "";
    const fehlend = v.fehlend.length ? `<details class="a-rennen"><summary>${v.fehlend.length} gemeldete Fahrer sind nicht im Ergebnis</summary><ul class="a-namen">${v.fehlend.map((n) => `<li><span>${esc(n)}</span></li>`).join("")}</ul></details>` : "";
    const keiner = v.rennen.gewertet === 0 ? '<p class="a-meldung fehler">Keiner der Fahrer in dieser Datei ist für diese Serie gemeldet. Prüfe, ob Serie und Datei zusammenpassen.</p>' : "";
    return `<section class="a-karte"><div class="a-kartenkopf"><h2>Vorschau: ${esc(v.rennen.strecke)}</h2><span class="a-chip">${v.rennen.gewertet} von ${v.rennen.gesamt} Fahrern gewertet · ${esc(zeit(v.rennen.start))}</span></div>
      ${keiner}
      ${v.ersetzt ? '<p class="a-meldung fehler">Dieses Rennen ist schon eingelesen und würde ersetzt.</p>' : ""}
      ${v.warnungen.length ? `<ul class="a-warnung">${v.warnungen.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      ${fremde}${fehlend}
      ${gruppen}
      <div class="a-leiste">${v.rennen.gewertet ? '<button type="button" class="a-knopf" data-veroeffentlichen="1">Veröffentlichen</button>' : ""}<button type="button" class="a-knopf zweit" data-verwerfen="1">Verwerfen</button></div>
    </section>`;
  }

  function ergebnisTab() {
    if (!d.serien.length) return '<section class="a-karte"><p class="a-leer">Leg zuerst eine Serie an.</p></section>';
    const det = d.details;
    const ergebnisse = det.ergebnisse.map((e) => `<tr><td>${esc(zeit(e.start))}</td><td class="umbruch">${esc([e.strecke, e.variante].filter(Boolean).join(" · "))}</td><td class="rechts">${e.fahrer.length}</td><td class="rechts"><button type="button" class="a-knopf gefahr klein" data-ergebnis-loeschen="${esc(e.id)}">Löschen</button></td></tr>`).join("");
    const strafen = det.strafen.map((s) => {
      const e = det.ergebnisse.find((x) => x.id === s.rennen);
      const wert = s.typ === "zeit" ? `+${s.sekunden} s` : s.typ === "dsq" ? "DSQ" : `−${s.punkte}`;
      const aktion = s.reportId ? '<span class="a-chip">aus Report</span>' : `<button type="button" class="a-knopf gefahr klein" data-strafe-loeschen="${esc(s.id)}">Löschen</button>`;
      return `<tr><td>${esc(s.name)}</td><td class="umbruch">${esc(e ? e.strecke : s.rennen)}</td><td class="rechts">${esc(wert)}</td><td class="umbruch">${esc(s.grund || "")}</td><td class="rechts">${aktion}</td></tr>`;
    }).join("");
    const strafForm = det.ergebnisse.length ? `<form class="a-felder" id="f-strafe" novalidate>
        ${feld("Rennen", `<select name="rennen" id="s-rennen">${det.ergebnisse.map((e) => `<option value="${esc(e.id)}">${esc(e.strecke)} · ${esc(zeit(e.start))}</option>`).join("")}</select>`)}
        ${feld("Fahrer", `<select name="cust" id="s-fahrer">${fahrerOptionen(det.ergebnisse[0])}</select>`)}
        ${feld("Strafpunkte", '<input name="punkte" type="number" min="1">')}
        ${feld("Grund (nur intern)", '<input name="grund" maxlength="200">')}
        <div class="a-feld" style="align-self:end"><button type="submit" class="a-knopf">Strafe eintragen</button></div>
      </form>` : '<p class="a-leer">Strafen sind möglich, sobald ein Ergebnis eingelesen ist.</p>';
    return `<section class="a-karte"><div class="a-kartenkopf"><h2>Ergebnis einlesen</h2>${serienAuswahl()}</div>
      <p class="a-hinweis">In iRacing das Ergebnis öffnen, „Export Results“ wählen und die JSON-Datei hier auswählen. Veröffentlicht wird erst nach deiner Prüfung.</p>
      <div class="a-feld"><label for="a-datei">Ergebnisdatei (JSON)</label><input type="file" id="a-datei" accept=".json,application/json"></div>
    </section>
    ${vorschauHtml()}
    <section class="a-karte"><h2>Eingelesene Rennen</h2>${ergebnisse ? `<div class="a-scroll"><table><thead><tr><th>Start</th><th>Strecke</th><th class="rechts">Fahrer</th><th></th></tr></thead><tbody>${ergebnisse}</tbody></table></div>` : '<p class="a-leer">Noch kein Ergebnis eingelesen.</p>'}</section>
    <section class="a-karte"><h2>Strafen</h2>${strafForm}${strafen ? `<div class="a-scroll"><table><thead><tr><th>Fahrer</th><th>Rennen</th><th class="rechts">Punkte</th><th>Grund</th><th></th></tr></thead><tbody>${strafen}</tbody></table></div>` : ""}</section>`;
  }
  const fahrerOptionen = (e, gewaehlt) => e.fahrer.map((f) => `<option value="${esc(f.cust)}"${f.cust === gewaehlt ? " selected" : ""}>${esc(f.name)}</option>`).join("");

  /* ---------- Reports ---------- */
  const einspruchOffen = (r) => r.einsprueche.length > 0 && !r.endgueltig;
  const braucht = (r) => r.status !== "entschieden" || einspruchOffen(r);
  const urteilKurz = (u) => (u.art === "strafpunkte" ? `−${u.punkte} Punkte` : u.art === "zeitstrafe" ? `+${u.sekunden} s` : (URTEILE.find(([a]) => a === u.art) || [])[1] || "");
  function reportChip(r) {
    if (einspruchOffen(r)) return '<span class="a-chip rot">Einspruch</span>';
    if (r.urteil) return `<span class="a-chip">${esc(urteilKurz(r.urteil))}${r.endgueltig ? " · endgültig" : ""}</span>`;
    return r.status === "pruefung" ? '<span class="a-chip gelb">In Prüfung</span>' : '<span class="a-chip gelb">Offen</span>';
  }

  function reportListe() {
    const liste = [...d.reports].sort((a, b) => Number(braucht(b)) - Number(braucht(a)) || String(b.erstellt).localeCompare(String(a.erstellt)));
    const zeilen = liste.map((r) => `<tr><td>${esc(zeit(r.erstellt))}</td><td>${esc(r.serieName)}</td><td class="umbruch">${esc(r.rennenTitel)}</td><td class="umbruch">${esc(r.von.name)} → ${esc(r.gegen.name)}</td><td>${reportChip(r)}</td><td class="rechts"><button type="button" class="a-knopf zweit klein" data-report="${esc(r.id)}">Öffnen</button></td></tr>`).join("");
    return `<section class="a-karte"><h2>Reports</h2>${liste.length ? `<div class="a-scroll"><table><thead><tr><th>Eingang</th><th>Serie</th><th>Rennen</th><th>Melder → Gemeldet</th><th>Status</th><th></th></tr></thead><tbody>${zeilen}</tbody></table></div>` : '<p class="a-leer">Noch keine Reports eingegangen.</p>'}</section>`;
  }

  function urteilForm(r) {
    if (r.ichBeteiligt) return '<p class="a-meldung fehler">Du bist an diesem Vorfall beteiligt. Die Entscheidung muss jemand anderes aus dem League Team treffen.</p>';
    const u = r.urteil || {};
    const art = u.art || "kein-vergehen";
    const det = d.details && d.details.serie === r.serie ? d.details : { ergebnisse: [] };
    const naechstes = u.rennen ? det.ergebnisse.find((e) => e.id === u.rennen) : [...det.ergebnisse].sort((a, b) => Math.abs(new Date(a.start) - new Date(r.start)) - Math.abs(new Date(b.start) - new Date(r.start)))[0];
    const strafend = art === "strafpunkte" || art === "zeitstrafe" || art === "dsq";
    return `<form id="f-urteil" class="a-karte" novalidate>
      <h2>${einspruchOffen(r) ? "Einspruch entscheiden" : r.urteil ? "Urteil ändern" : "Entscheidung"}</h2>
      ${einspruchOffen(r) ? '<p class="a-hinweis">Nach dieser Entscheidung ist der Fall endgültig. Soll das Urteil bestehen bleiben, speichere es unverändert.</p>' : ""}
      <div class="a-felder">
        ${feld("Entscheidung", `<select name="art" id="u-art">${URTEILE.map(([v, t]) => `<option value="${v}"${v === art ? " selected" : ""}>${t}</option>`).join("")}</select>`)}
        <div class="a-feld" data-nur="strafpunkte"${art === "strafpunkte" ? "" : " hidden"}><label>Strafpunkte</label><input name="punkte" type="number" min="1" value="${esc(u.punkte ?? "")}"></div>
        <div class="a-feld" data-nur="zeitstrafe"${art === "zeitstrafe" ? "" : " hidden"}><label>Sekunden</label><input name="sekunden" type="number" min="1" value="${esc(u.sekunden ?? "")}"></div>
        <div class="a-feld" data-nur="strafe"${strafend ? "" : " hidden"}><label>Eingelesenes Ergebnis</label><select name="ergebnis" id="u-ergebnis">${det.ergebnisse.map((e) => `<option value="${esc(e.id)}"${naechstes && e.id === naechstes.id ? " selected" : ""}>${esc(e.strecke)} · ${esc(zeit(e.start))}</option>`).join("")}</select></div>
        <div class="a-feld" data-nur="strafe"${strafend ? "" : " hidden"}><label>Fahrer</label><select name="cust" id="u-fahrer">${naechstes ? fahrerOptionen(naechstes, u.cust || r.gegen.cust) : ""}</select></div>
        ${feld("Begründung (sehen alle angemeldeten Fahrer)", `<textarea name="begruendung" maxlength="2000">${esc(u.begruendung || "")}</textarea>`, true)}
      </div>
      <p class="a-hinweis" data-nur="strafe"${strafend ? "" : " hidden"}>${det.ergebnisse.length ? "Zeitstrafen wirken nur bei Fahrern in der Führungsrunde. Bei Überrundeten bitte Strafpunkte vergeben." : "Für eine Strafe muss das Rennergebnis zuerst unter „Ergebnisse“ eingelesen werden."}</p>
      <div class="a-leiste"><button type="submit" class="a-knopf">Urteil speichern</button></div>
    </form>`;
  }

  function reportDetail(r) {
    const clip = r.clip ? `<p><a href="${esc(r.clip)}" target="_blank" rel="noopener noreferrer">Clip ansehen ↗</a></p>` : "";
    const einsprueche = r.einsprueche.map((e) => `<div class="a-einspruch"><b>Einspruch von ${esc(e.name)} · ${esc(zeit(e.zeit))}</b><p>${esc(e.text)}</p></div>`).join("");
    const urteil = r.urteil ? `<p class="a-hinweis">Aktuelles Urteil: ${esc(urteilKurz(r.urteil))} · von ${esc(r.urteil.von)} · ${esc(zeit(r.urteil.zeit))}</p>` : "";
    const status = !r.urteil && !r.ichBeteiligt ? `<button type="button" class="a-knopf zweit klein" data-report-status="${r.status === "pruefung" ? "offen" : "pruefung"}">${r.status === "pruefung" ? "Zurück auf offen" : "In Prüfung nehmen"}</button>` : "";
    const notizen = r.ichBeteiligt ? "" : `<form id="f-notiz" class="a-karte" novalidate><h2>Interne Notizen</h2><textarea name="notizen" maxlength="5000" aria-label="Interne Notizen">${esc(r.notizen)}</textarea><div><button type="submit" class="a-knopf zweit">Notizen speichern</button></div></form>`;
    return `<section class="a-karte"><div class="a-kartenkopf"><div class="a-leiste"><button type="button" class="a-knopf zweit klein" data-report-zurueck="1">Zurück</button><h2>${esc(r.rennenTitel)}</h2>${reportChip(r)}</div>${status}</div>
      <p class="a-hinweis">${esc(r.serieName)} · Eingang ${esc(zeit(r.erstellt))}</p>
      <p><b>${esc(r.von.name)}</b> meldet <b>${esc(r.gegen.name)}</b> · ${esc(r.stelle)}</p>
      <p class="a-text">${esc(r.beschreibung)}</p>${clip}${urteil}${einsprueche}</section>
      ${urteilForm(r)}${notizen}`;
  }

  function reportsTab() {
    const r = reportId && d.reports.find((x) => x.id === reportId);
    return r ? reportDetail(r) : reportListe();
  }

  /* ---------- Seite ---------- */
  function zeigeLogin() {
    const fehler = FEHLER[new URLSearchParams(location.search).get("fehler")];
    app.innerHTML = `<main class="a-login"><div class="a-login-karte"><h1>Darkline <span>Rennleitung</span></h1><p>Zugang nur mit der Discord-Rolle der Rennleitung.</p>${fehler ? `<p class="a-meldung fehler" role="alert">${esc(fehler)}</p>` : ""}<a class="a-knopf" href="/api/discord-login?ziel=liga-admin">Mit Discord anmelden</a></div></main>`;
  }

  function zeichne() {
    if (!d || !d.angemeldet) return zeigeLogin();
    const inhalt = tab === "serien" ? serienTab() : tab === "rennen" ? rennenTab() : tab === "fahrer" ? fahrerTab() : tab === "reports" ? reportsTab() : ergebnisTab();
    const offene = d.reports.filter(braucht).length;
    app.innerHTML = `<header class="a-kopf"><div class="a-marke">Darkline <span>Rennleitung</span></div><div class="a-nutzer"><a href="/liga">Zur Liga</a> · <a href="/fahrerbereich">Fahrerbereich</a> · ${esc(d.name)} · <button type="button" id="a-logout" style="all:unset;cursor:pointer;text-decoration:underline">Ausloggen</button></div>
      <nav class="a-nav" aria-label="Bereiche">${TABS.map(([id, t]) => `<button type="button" data-tab="${id}"${tab === id ? ' aria-current="page"' : ""}>${t}${id === "reports" && offene ? ` (${offene})` : ""}</button>`).join("")}</nav></header>
      <main class="a-inhalt">${meldung ? `<p class="a-meldung${meldung.fehler ? " fehler" : ""}" role="status">${esc(meldung.text)}</p>` : ""}${inhalt}</main>`;
  }

  const werte = (f) => Object.fromEntries(new FormData(f).entries());

  app.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.id === "a-logout") { await sende({ aktion: "logout" }); d = { angemeldet: false }; return zeichne(); }
    if (b.dataset.tab) { tab = b.dataset.tab; form = null; reportId = null; setzeMeldung(""); return zeichne(); }
    if (b.dataset.report) {
      const r = d.reports.find((x) => x.id === b.dataset.report);
      reportId = r.id; setzeMeldung("");
      // Für die Strafe werden die Ergebnisse der passenden Serie gebraucht.
      if (serieId !== r.serie) { serieId = r.serie; await lade().catch(() => setzeMeldung("Die Daten konnten nicht geladen werden.", true)); }
      return zeichne();
    }
    if (b.dataset.reportZurueck) { reportId = null; setzeMeldung(""); return zeichne(); }
    if (b.dataset.reportStatus) return aktion({ aktion: "report-status", id: reportId, status: b.dataset.reportStatus }, "Status geändert.");
    if (b.dataset.abbrechen) { form = null; return zeichne(); }
    if (b.dataset.serieNeu) { form = { art: "serie", id: null, werte: NEUE_SERIE }; return zeichne(); }
    if (b.dataset.serieBearbeiten) { form = { art: "serie", id: b.dataset.serieBearbeiten, werte: d.serien.find((s) => s.id === b.dataset.serieBearbeiten) }; return zeichne(); }
    if (b.dataset.rennenNeu) { form = { art: "rennen", id: null, werte: NEUES_RENNEN }; return zeichne(); }
    if (b.dataset.rennenBearbeiten) { form = { art: "rennen", id: b.dataset.rennenBearbeiten, werte: d.rennen.find((r) => r.id === b.dataset.rennenBearbeiten) }; return zeichne(); }
    if (b.dataset.klasseNeu) return document.getElementById("a-klassen").insertAdjacentHTML("beforeend", klasseZeile({ name: "", min: "", max: "" }));
    if (b.dataset.klasseWeg) return b.closest(".a-klasse").remove();
    if (b.dataset.bildWeg && window.confirm("Dieses Bild wirklich entfernen?")) return bildEntfernen(b.dataset.bildWeg);
    if (b.dataset.serieLoeschen && window.confirm("Diese Serie wirklich löschen?")) return aktion({ aktion: "serie-loeschen", id: form.id }, "Serie gelöscht.");
    if (b.dataset.rennenLoeschen && window.confirm("Dieses Rennen wirklich löschen?")) return aktion({ aktion: "rennen-loeschen", id: form.id }, "Rennen gelöscht.");
    if (b.dataset.ausSerie && window.confirm(`${b.dataset.name} aus der Serie und ihren Rennen entfernen?`)) return aktion({ aktion: "fahrer-aus-serie", serie: serieId, discordId: b.dataset.ausSerie }, "Fahrer entfernt.");
    if (b.dataset.ausRennen && window.confirm(`${b.dataset.name} aus diesem Rennen nehmen?`)) return aktion({ aktion: "fahrer-aus-rennen", rennen: b.dataset.ausRennen, discordId: b.dataset.fahrer }, "Fahrer aus dem Rennen genommen.");
    if (b.dataset.verwerfen) { vorschau = null; datei = null; zugelassen = []; return zeichne(); }
    if (b.dataset.veroeffentlichen) {
      const a = await aktion({ aktion: "ergebnis-veroeffentlichen", serie: serieId, datei, zugelassen }, "Ergebnis veröffentlicht, die Tabelle ist aktualisiert.");
      if (a) { vorschau = null; datei = null; zugelassen = []; zeichne(); }
      return;
    }
    if (b.dataset.ergebnisLoeschen && window.confirm("Dieses Ergebnis wirklich löschen? Die Tabelle wird neu berechnet.")) return aktion({ aktion: "ergebnis-loeschen", serie: serieId, id: b.dataset.ergebnisLoeschen }, "Ergebnis gelöscht.");
    if (b.dataset.strafeLoeschen && window.confirm("Diese Strafe wirklich löschen?")) return aktion({ aktion: "strafe-loeschen", serie: serieId, id: b.dataset.strafeLoeschen }, "Strafe gelöscht.");
  });

  app.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const w = werte(f);
    if (f.id === "f-notiz") return aktion({ aktion: "report-notiz", id: reportId, notizen: w.notizen }, "Notizen gespeichert.");
    if (f.id === "f-urteil") {
      const { ergebnis, cust, ...urteil } = w;
      const a = await aktion({ aktion: "report-urteil", id: reportId, urteil, ergebnis, cust }, "Urteil gespeichert, die Tabelle ist aktualisiert.");
      if (a && a.warnungen && a.warnungen.length) { setzeMeldung(a.warnungen.join(" "), true); zeichne(); }
      return;
    }
    if (f.id === "f-serie") {
      const fd = new FormData(f);
      const namen = fd.getAll("k_name"), min = fd.getAll("k_min"), max = fd.getAll("k_max");
      w.klassen = namen.map((name, i) => ({ name, min: min[i], max: max[i] }));
      w.anmeldungOffen = f.elements.anmeldungOffen.checked;
      // Eingaben merken, damit sie bei einem Fehler im Formular stehen bleiben
      form.werte = { ...w, punkte: String(w.punkte).split(/[\s,;]+/).filter(Boolean), fahrzeugklassen: String(w.fahrzeugklassen).split(",").map((x) => x.trim()).filter(Boolean) };
      aktion({ aktion: "serie-speichern", id: form.id, serie: w }, "Serie gespeichert.");
    } else if (f.id === "f-rennen") {
      form.werte = w;
      aktion({ aktion: "rennen-speichern", id: form.id, rennen: w }, "Rennen gespeichert.");
    } else if (f.id === "f-strafe") {
      aktion({ aktion: "strafe-hinzufuegen", serie: serieId, ...w }, "Strafe eingetragen, die Tabelle ist aktualisiert.");
    }
  });

  app.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.id === "a-serie") {
      serieId = t.value; vorschau = null; datei = null; zugelassen = []; setzeMeldung("");
      await lade().catch(() => setzeMeldung("Die Daten konnten nicht geladen werden.", true));
      return zeichne();
    }
    if (t.dataset.bildZiel && t.files[0]) return bildHochladen(t.dataset.bildZiel, t.files[0]);
    if (t.id === "u-art") {
      const strafend = ["strafpunkte", "zeitstrafe", "dsq"].includes(t.value);
      app.querySelectorAll("[data-nur]").forEach((el) => { el.hidden = el.dataset.nur === "strafe" ? !strafend : el.dataset.nur !== t.value; });
      return;
    }
    if (t.id === "u-ergebnis") {
      const r = d.reports.find((x) => x.id === reportId);
      const er = d.details.ergebnisse.find((x) => x.id === t.value);
      document.getElementById("u-fahrer").innerHTML = er ? fahrerOptionen(er, r.gegen.cust) : "";
      return;
    }
    if (t.id === "s-rennen") {
      const er = d.details.ergebnisse.find((x) => x.id === t.value);
      document.getElementById("s-fahrer").innerHTML = er ? fahrerOptionen(er) : "";
      return;
    }
    if (t.dataset.einstufung !== undefined) return aktion({ aktion: "einstufung-setzen", serie: serieId, cust: t.dataset.einstufung, klasse: t.value }, "Klasse gespeichert.");
    if (t.id === "a-datei" && t.files[0]) {
      setzeMeldung("");
      try {
        datei = JSON.parse((await t.files[0].text()).replace(/^﻿/, ""));
      } catch (err) {
        setzeMeldung("Das ist keine gültige JSON-Datei.", true);
        return zeichne();
      }
      zugelassen = [];
      return vorschauRechnen();
    }
    if (t.dataset.gast !== undefined) {
      zugelassen = t.checked ? [...zugelassen, t.dataset.gast] : zugelassen.filter((c) => c !== t.dataset.gast);
      return vorschauRechnen();
    }
  });

  lade().catch(() => { d = null; }).then(() => {
    if (!d) { app.innerHTML = '<p class="a-laden">Die Rennleitung ist gerade nicht erreichbar.</p>'; return; }
    zeichne();
  });
})();
