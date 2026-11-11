/* Rennleitung der Darkline Liga: Serien, Rennen, Fahrer, Ergebnisse und Strafen. Eigener Bereich mit eigenem Login. */
(function () {
  "use strict";
  const API = "api/liga?r=admin";
  const app = document.getElementById("app");
  // Stand beim Öffnen eines Formulars. Der Server lehnt das Speichern ab, wenn jemand anderes inzwischen geändert hat.
  const kopie = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);
  const esc = (s) =>String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
  const TABS = [["cockpit", "Cockpit"], ["reports", "Reports"], ["serien", "Seasons &amp; Events"], ["rennen", "Rennen"], ["strecken", "Strecken"], ["katalog", "Strafenkatalog"], ["reglement", "Reglement"], ["fahrer", "Fahrer"], ["ergebnisse", "Ergebnisse"], ["protokoll", "Protokoll"]];
  const URTEILE = [["kein-vergehen", "Kein Vergehen"], ["verwarnung", "Verwarnung"], ["strafpunkte", "Strafpunkte"], ["zeitstrafe", "Zeitstrafe"], ["dsq", "Disqualifikation"]];
  const NEUE_SERIE = { name: "", typ: "liga", saison: "", status: "geplant", anmeldungOffen: true, farbe: "rot", beschreibung: "", uebertragung: "", kategorie: "Sports_Car", fahrzeugklassen: [], rennenGesamt: 8, gewerteteRennen: 7, anmeldeschlussMinuten: 60,
    klassen: [{ name: "Pro", min: 2500, max: null }, { name: "Pro-Am", min: 1500, max: 2499 }, { name: "Am", min: 0, max: 1499 }],
    punkte: [25, 21, 18, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], punkteDanach: 1, bonusPole: 1, bonusSchnellsteRunde: 1, mindestRundenProzent: 60 };
  const NEUES_RENNEN = { titel: "", serie: "", status: "geplant", datum: "", startzeit: "20:00", strecke: "", fahrzeuge: "", plaetze: 40, training: "", qualifying: "", renndauer: "", wetter: "", server: "", passwort: "", briefing: "" };

  let d = null;
  let tab = "cockpit";
  let serieId = "";
  let form = null;        // { art: "serie"|"rennen"|"strecke", id, werte, vorher }
  let konflikt = false;   // Letztes Speichern scheiterte, weil jemand anderes inzwischen geändert hatte
  let notizEntwurf = null; // { id, text, konflikt } solange Notizen nicht gespeichert sind
  let meldung = null;     // { text, fehler }
  let datei = null;       // eingelesene Ergebnisdatei
  let vorschau = null;
  let beschaeftigt = false;
  let reportId = null;
  let planer = null;      // Saisonplaner, solange er offen ist
  let rennenFilter = "alle";
  let serienReiter = "liga"; // "liga", "event", "archiv" oder "bild"
  let fahrerFilter = "alle";
  let streckenFilter = "alle";
  let streckenSuche = "";
  let streckenAlle = false;
  let akte = null;        // geöffnete Fahrer-Akte: { name, daten }
  let neuSeit = null;     // Zeitpunkt, bis zu dem Reports beim Öffnen des Bereichs schon bekannt waren
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
      konflikt = !r.ok && !!j.konflikt;
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
    if (a) { form = null; notizEntwurf = null; await lade().catch(() => {}); }
    else if (konflikt) {
      // Jemand anderes war schneller: neuen Stand holen, Eingaben behalten. Das nächste Speichern gilt dann bewusst gegen diesen Stand.
      await lade().catch(() => {});
      if (form && form.id) form.vorher = kopie(form.art === "serie" ? serieVon(form.id) : (form.art === "rennen" ? d.rennen : d.strecken).find((x) => x.id === form.id));
      if (notizEntwurf) notizEntwurf.konflikt = true;
    }
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
  const istStrecke = (ziel) => String(ziel).startsWith("strecke:");
  const bildSchluessel = (ziel) => (istStrecke(ziel) ? `strecke-${ziel.slice(8)}` : ziel === "uebersicht" ? "uebersicht" : `serie-${ziel}`);
  const bildVersion = (ziel) => (istStrecke(ziel) ? (d.strecken.find((s) => s.id === ziel.slice(8)) || {}).kartenVersion : ziel === "uebersicht" ? d.kopfbildVersion : (d.serien.find((s) => s.id === ziel) || {}).bildVersion) || 0;
  function bildFeldInhalt(ziel, status, fehler) {
    const v = bildVersion(ziel);
    const klein = istStrecke(ziel) ? "Am besten eine Karte mit transparentem Hintergrund als PNG oder SVG." : ziel === "uebersicht" ? "Querformat, am besten mindestens 1920 Pixel breit." : "Querformat, am besten mindestens 1200 Pixel breit. Ohne eigenes Bild wird ein Livery-Bild verwendet.";
    return `<div class="a-bild-rahmen${istStrecke(ziel) ? " karte" : ""}">${v ? `<img src="api/liga?r=bild&amp;k=${esc(bildSchluessel(ziel))}&amp;v=${v}" alt="Aktuelles Bild">` : `<span>${istStrecke(ziel) ? "Keine Karte" : "Standardbild"}</span>`}</div>
      <div class="a-bild-steuerung">
        <div class="a-feld"><label for="bild-${esc(ziel)}">Neues Bild (${istStrecke(ziel) ? "PNG, SVG, JPG oder WebP" : "JPG, PNG oder WebP"})</label><input type="file" id="bild-${esc(ziel)}" accept="image/jpeg,image/png,image/webp${istStrecke(ziel) ? ",image/svg+xml" : ""}" data-bild-ziel="${esc(ziel)}"></div>
        <p class="a-hinweis${fehler ? " a-bild-fehler" : ""}">${esc(status || klein)}</p>
        ${istStrecke(ziel) ? `<div><button type="button" class="a-knopf zweit klein" data-karte-erzeugen="${esc(ziel)}">Aus Team-Runde erzeugen</button></div>` : ""}
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
      // SVG hat keine feste Auflösung und wird für eine scharfe Karte groß gerechnet.
      const breite = img.naturalWidth || 1400;
      const hoehe = img.naturalHeight || 1050;
      const faktor = datei.type === "image/svg+xml" ? 1400 / breite : Math.min(1, 1920 / breite);
      const c = document.createElement("canvas");
      c.width = Math.round(breite * faktor);
      c.height = Math.round(hoehe * faktor);
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

  /* ---------- Streckenkarte aus Garage 61 ---------- */
  // Umrisse, die schon für die Website gezeichnet wurden. Sie springen ein, wenn das Team auf der Strecke noch keine Runde hat.
  const WEBSITE_UMRISSE = [[/spa[- ]francorchamps/i, "spa-francorchamps"], [/road america/i, "road-america"], [/watkins glen/i, "watkins-glen"], [/le mans|24 heures/i, "circuit-des-24-heures-du-mans"]];
  const KARTE_FEHLT = {
    zuordnung: "Name und Variante passen zu keiner Strecke in Garage 61. Importiere die Streckenliste und nimm den Eintrag von dort.",
    runde: "Das Team hat auf dieser Strecke noch keine Runde mit Telemetrie. Du kannst stattdessen ein Bild hochladen.",
    telemetrie: "Die Runden des Teams enthalten keine vollständigen GPS-Daten. Du kannst stattdessen ein Bild hochladen.",
  };

  async function websiteUmriss(s) {
    const treffer = WEBSITE_UMRISSE.find(([muster]) => muster.test(s.name));
    if (!treffer) return null;
    const r = await fetch(`img/tracks/${treffer[1]}.svg`);
    if (!r.ok) return null;
    const svg = await r.text();
    const punkte = [...svg.matchAll(/[ML]\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    return punkte.length > 20 ? { punkte, geschlossen: /Z\s*"/i.test(svg) } : null;
  }

  // Zeichnet die Linie auf transparentem Grund, mit roter Markierung an Start und Ziel.
  function karteAlsBild(punkte, geschlossen) {
    const c = document.createElement("canvas");
    c.width = 1400;
    c.height = 1000;
    const g = c.getContext("2d");
    const xs = punkte.map((p) => p[0]);
    const ys = punkte.map((p) => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const breite = Math.max(...xs) - minX || 1;
    const hoehe = Math.max(...ys) - minY || 1;
    const rand = 80;
    const faktor = Math.min((c.width - 2 * rand) / breite, (c.height - 2 * rand) / hoehe);
    const dx = (c.width - breite * faktor) / 2;
    const dy = (c.height - hoehe * faktor) / 2;
    const linie = punkte.map(([x, y]) => [(x - minX) * faktor + dx, (y - minY) * faktor + dy]);
    g.lineJoin = "round";
    g.lineCap = "round";
    const ziehe = (farbe, staerke) => {
      g.beginPath();
      linie.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      if (geschlossen) g.closePath();
      g.strokeStyle = farbe;
      g.lineWidth = staerke;
      g.stroke();
    };
    ziehe("rgba(0,0,0,.5)", 22);
    ziehe("#f3f4f6", 11);
    const [x0, y0] = linie[0];
    const [x1, y1] = linie[Math.min(4, linie.length - 1)];
    const laenge = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = -(y1 - y0) / laenge * 30;
    const ny = (x1 - x0) / laenge * 30;
    g.beginPath();
    g.moveTo(x0 - nx, y0 - ny);
    g.lineTo(x0 + nx, y0 + ny);
    g.lineCap = "butt";
    g.strokeStyle = "#e30613";
    g.lineWidth = 14;
    g.stroke();
    const format = c.toDataURL("image/webp", 0.85).startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
    return c.toDataURL(format, 0.85);
  }

  let karteLaeuft = false;
  async function karteErzeugen(ziel) {
    const s = d.strecken.find((x) => x.id === ziel.slice(8));
    if (karteLaeuft || !s) return;
    if (s.kartenVersion && !window.confirm("Die vorhandene Karte wird ersetzt. Fortfahren?")) return;
    karteLaeuft = true;
    bildFeldNeu(ziel, "Team-Runde wird gesucht …");
    let status = "";
    let fehler = false;
    try {
      const a = await sende({ aktion: "strecke-karte", id: s.id });
      if (!a) throw new Error((meldung && meldung.text) || "Das hat nicht geklappt.");
      const website = a.punkte ? null : await websiteUmriss(s).catch(() => null);
      const linie = a.punkte ? a : website;
      if (!linie) throw new Error(KARTE_FEHLT[a.fehlt] || "Das hat nicht geklappt.");
      const gespeichert = await sende({ aktion: "bild-speichern", ziel, daten: karteAlsBild(linie.punkte, linie.geschlossen) });
      if (!gespeichert) throw new Error((meldung && meldung.text) || "Das hat nicht geklappt.");
      status = website ? "Noch keine Team-Runde, deshalb wurde der Umriss der Website übernommen. Bitte prüfe, ob er zur Variante passt." : "Karte aus einer Team-Runde erzeugt.";
    } catch (e) {
      status = e.message;
      fehler = true;
    }
    setzeMeldung("");
    await lade().catch(() => {});
    karteLaeuft = false;
    bildFeldNeu(ziel, status, fehler);
  }

  /* ---------- Hilfen für Serien, Rennen und Strecken ---------- */
  const FARBEN = [["rot", "Rot"], ["blau", "Blau"], ["lila", "Lila"], ["gruen", "Grün"], ["gelb", "Gelb"], ["tuerkis", "Türkis"]];
  const PUNKTE_VORLAGEN = [["DSRS-Reglement, 16 Plätze", NEUE_SERIE.punkte], ["F1, Top 10", [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]], ["Linear, 20 bis 1", Array.from({ length: 20 }, (_, i) => 20 - i)]];
  const MONATE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  const heute = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const plusTage = (iso, tage) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + tage)).toISOString().slice(0, 10) : ""; };
  const serieVon = (id) => d.serien.find((s) => s.id === id);
  const serienFarbe = (id) => { const s = serieVon(id); return `s-${s && s.farbe ? s.farbe : "rot"}`; };
  const kartenUrl = (b) => `api/liga?r=bild&k=${encodeURIComponent(b.k)}&v=${encodeURIComponent(b.v)}`;
  const streckeBild = (s) => (s.kartenVersion ? kartenUrl({ k: `strecke-${s.id}`, v: s.kartenVersion }) : "");
  const streckeLabel = (s) => [s.name, s.variante].filter(Boolean).join(" · ");
  const streckeAus = (text) => d.strecken.find((s) => streckeLabel(s).toLowerCase() === String(text || "").trim().toLowerCase());
  // Bekannte iRacing-Strecken als Vorschlag beim Eintippen, die eigene Bibliothek steht immer zuerst.
  const VORSCHLAEGE = ["Circuit de Spa-Francorchamps", "Autodromo Nazionale Monza", "Imola", "Nürburgring Grand-Prix-Strecke", "Nürburgring Nordschleife", "Silverstone Circuit", "Brands Hatch Circuit", "Donington Park", "Oulton Park", "Snetterton Circuit", "Circuit de Barcelona-Catalunya", "Circuit de Nevers Magny-Cours", "Circuit Paul Ricard", "Circuit des 24 Heures du Mans", "Hockenheimring", "Red Bull Ring", "Circuit Zandvoort", "Algarve International Circuit", "Mugello Circuit", "Misano World Circuit", "Suzuka International Racing Course", "Fuji International Speedway", "Okayama International Circuit", "Mount Panorama Circuit", "Phillip Island Circuit", "Sebring International Raceway", "Daytona International Speedway", "Road Atlanta", "Watkins Glen International", "Road America", "Virginia International Raceway", "Mid-Ohio Sports Car Course", "WeatherTech Raceway Laguna Seca", "Sonoma Raceway", "Long Beach Street Circuit", "Circuit of the Americas", "Indianapolis Motor Speedway", "Circuit Gilles Villeneuve", "Canadian Tire Motorsport Park", "Autodromo Jose Carlos Pace"];
  const streckenDatalist = () => `<datalist id="a-strecken">${[...d.strecken.map(streckeLabel), ...VORSCHLAEGE.filter((v) => !d.strecken.some((s) => s.name === v))].map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>`;
  const abschnittForm = (nr, titel, inhalt, hinweis) => `<section class="a-abschnitt"><h3><span>${nr}</span>${esc(titel)}</h3>${hinweis ? `<p class="a-hinweis">${esc(hinweis)}</p>` : ""}${inhalt}</section>`;
  const formLeiste = (speichern, loeschen) => `<div class="a-leiste a-klebeleiste"><button type="submit" class="a-knopf">${esc(speichern)}</button><button type="button" class="a-knopf zweit" data-abbrechen="1">Abbrechen</button>${loeschen || ""}</div>`;

  /* ---------- Cockpit ---------- */
  // Automatische Prüfung nach dem Rennen: wer gemeldet war und fehlte, wer auffällig viele Incidents hatte.
  function cockpitPruefungen() {
    const liste = d.pruefungen || [];
    if (!liste.length) return "";
    const zeilen = liste.map((p) => {
      const teile = [p.noShows.length ? `Nicht erschienen: ${p.noShows.map((f) => f.name).join(", ")}` : "", p.incidents.length ? `Viele Incidents: ${p.incidents.map((f) => `${f.name} (${f.incidents})`).join(", ")}` : ""].filter(Boolean);
      return `<div class="a-abschluss ${serienFarbe(p.serie)}"><span><b>${esc(p.strecke)}</b><small>${esc([p.serieName, zeit(p.start)].join(" · "))}</small>${teile.map((t) => `<small class="a-pruefung">${esc(t)}</small>`).join("")}</span><button type="button" class="a-knopf zweit klein" data-pruefung-erledigt="${esc(p.id)}" data-serie="${esc(p.serie)}">Erledigt</button></div>`;
    }).join("");
    return `<section class="a-karte a-karte-info"><div class="a-kartenkopf"><h2>Prüfen nach dem Rennen</h2><span class="a-chip gelb">${liste.length}</span></div><div class="a-liste">${zeilen}</div></section>`;
  }

  function cockpitStrafkonten() {
    const liste = d.strafkonten || [];
    if (!liste.length) return "";
    const zeilen = liste.map((k) => `<div class="a-abschluss ${serienFarbe(k.serie)}"><span><b>${esc(k.name)}</b><small>${esc(k.serieName)} · ${k.punkte} Strafpunkte, Grenze ${k.grenze}. Rennsperre prüfen.</small></span></div>`).join("");
    return `<section class="a-karte a-karte-alarm"><div class="a-kartenkopf"><h2>Strafpunkte-Grenze erreicht</h2><span class="a-chip rot">${liste.length}</span></div><div class="a-liste">${zeilen}</div></section>`;
  }

  /* ---------- Rennbericht ---------- */
  function bildLaden(src) {
    return new Promise((fertig) => { const i = new Image(); i.onload = () => fertig(i); i.onerror = () => fertig(null); i.src = src; });
  }

  // Grafik für den Discord-Kanal, gezeichnet im Browser. Scheitert sie, geht die Nachricht ohne Bild raus.
  async function berichtBild(b) {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 630;
    const g = c.getContext("2d");
    const schrift = getComputedStyle(document.documentElement).getPropertyValue("--a-breit").trim() || "sans-serif";
    g.fillStyle = "#0a0c0e";
    g.fillRect(0, 0, 1200, 630);
    const motiv = await bildLaden(window.LigaKarte.bildVon(b.serie, b.bildVersion));
    if (motiv) {
      const f = Math.max(1200 / motiv.width, 630 / motiv.height);
      g.drawImage(motiv, (1200 - motiv.width * f) / 2, (630 - motiv.height * f) / 2, motiv.width * f, motiv.height * f);
    }
    const verlauf = g.createLinearGradient(0, 0, 1200, 0);
    verlauf.addColorStop(0, "rgba(10,12,14,.96)");
    verlauf.addColorStop(1, "rgba(10,12,14,.72)");
    g.fillStyle = verlauf;
    g.fillRect(0, 0, 1200, 630);
    g.fillStyle = "#d3121b";
    g.fillRect(0, 0, 1200, 8);
    const text = (t, x, y, font, farbe, breite) => {
      g.font = font;
      g.fillStyle = farbe;
      let s = String(t || "");
      while (breite && s.length > 1 && g.measureText(s).width > breite) s = s.slice(0, -1);
      g.fillText(s === String(t || "") ? s : `${s.trimEnd()}…`, x, y);
    };
    text("DARKLINE SIMRACING SERIES", 56, 66, `800 20px ${schrift}`, "#ff4a54");
    text(`${b.vorlaeufig ? "VORLÄUFIGES ERGEBNIS" : "ERGEBNIS"} · ${b.serieName}`.toUpperCase(), 56, 124, `900 44px ${schrift}`, "#ffffff", 1088);
    // Viele Rennen tragen die Strecke schon im Titel.
    text(b.titel.includes(b.strecke.split(" · ")[0]) ? b.titel : `${b.titel} · ${b.strecke}`, 56, 166, `600 24px ${schrift}`, "#c4cbc8", 1088);
    const klassen = b.klassen.slice(0, 3);
    const spalte = 1088 / klassen.length;
    const PLATZ = ["#ffd966", "#d6dcd9", "#e0a06a"];
    klassen.forEach((k, s) => {
      const x = 56 + s * spalte;
      const breite = spalte - 28;
      if (b.klassen.length > 1) text(k.fahrzeugklasse, x, 228, `800 22px ${schrift}`, "#ff4a54", breite);
      k.podium.forEach((name, i) => {
        const y = 288 + i * 62;
        text(`${i + 1}`, x, y, `900 38px ${schrift}`, PLATZ[i]);
        text(name, x + 50, y, `800 ${klassen.length > 2 ? 22 : 28}px ${schrift}`, "#ffffff", breite - 50);
      });
    });
    const k = b.klassen[0];
    const unten = [k.schnellste ? ["Schnellste Runde", `${k.schnellste.name} · ${k.schnellste.zeit}`] : null, k.aufholer ? ["Fahrer des Tages", `${k.aufholer.name} · +${k.aufholer.plaetze} Plätze`] : null].filter(Boolean);
    unten.forEach(([titel, wert], i) => {
      const x = 56 + i * 544;
      text(titel.toUpperCase(), x, 540, `700 17px ${schrift}`, "#aeb6b3", 500);
      text(wert, x, 574, `800 25px ${schrift}`, "#ffffff", 500);
    });
    return c.toDataURL("image/jpeg", 0.86);
  }

  // Holt die Daten, zeichnet die Grafik und postet beides. Gibt zurück, ob es geklappt hat.
  async function rennberichtPosten(serie, id) {
    const a = await sende({ aktion: "bericht-daten", serie, id });
    if (!a) return false;
    const bild = await berichtBild(a.bericht).catch(() => "");
    return !!(await sende({ aktion: "bericht-posten", serie, id, bild }));
  }

  function cockpitTab() {
    const offene = d.reports.filter(braucht);
    const einsprueche = d.reports.filter(einspruchOffen);
    const laufend = d.serien.filter((s) => s.status !== "beendet");
    const kommend = [...d.rennen].filter((r) => r.status !== "abgesagt" && String(r.datum) >= heute()).sort((a, b) => `${a.datum} ${a.startzeit}`.localeCompare(`${b.datum} ${b.startzeit}`));
    const unfertig = kommend.filter((r) => rennenWarnungen(r).length);
    // Alle Rennen gefahren, aber noch nicht beendet: Das entscheidet die Rennleitung, wenn Reports und Strafen erledigt sind.
    const fertig = laufend.filter((s) => { const eigene = d.rennen.filter((r) => r.serie === s.id && r.status !== "abgesagt"); return eigene.length >= s.rennenGesamt && eigene.every((r) => String(r.datum) < heute()); });
    const abschluss = fertig.length ? `<section class="a-karte a-karte-info"><h2>Kann beendet werden</h2><div class="a-liste">${fertig.map((s) => `<div class="a-abschluss s-${esc(s.farbe || "rot")}"><span><b>${esc(s.name)}</b><small>Alle Rennen sind gefahren. Beende die Serie, sobald Reports und Strafen erledigt sind.</small></span><button type="button" class="a-knopf zweit klein" data-serie-bearbeiten="${esc(s.id)}">Öffnen</button></div>`).join("")}</div></section>` : "";
    // Eine geplante Serie wechselt nicht von selbst. Rückt ihr Termin näher, erinnert das Cockpit an die Anmeldung.
    const grenze = plusTage(heute(), 14);
    const baldFaellig = d.serien.map((s) => ({ s, r: s.status === "geplant" ? kommend.find((x) => x.serie === s.id) : null })).filter((x) => x.r && String(x.r.datum) <= grenze);
    const anmeldungFaellig = baldFaellig.length ? `<section class="a-karte a-karte-info"><div class="a-kartenkopf"><h2>Anmeldung noch nicht geöffnet</h2><span class="a-chip gelb">${baldFaellig.length}</span></div><div class="a-liste">${baldFaellig.map(({ s, r }) => `<div class="a-abschluss s-${esc(s.farbe || "rot")}"><span><b>${esc(s.name)}</b><small>Erstes Rennen am ${esc(datumKurz(r.datum))}, die Season steht noch auf „Geplant“.</small></span><button type="button" class="a-knopf klein" data-serie-oeffnen="${esc(s.id)}">Anmeldung öffnen</button></div>`).join("")}</div></section>` : "";
    const nummern = d.nummernWuensche || [];
    const nummernHtml = nummern.length ? `<section class="a-karte a-karte-info"><div class="a-kartenkopf"><h2>Startnummer ändern</h2><span class="a-chip gelb">${nummern.length}</span></div><div class="a-liste">${nummern.map((w) => {
      const daten = `data-discord="${esc(w.discordId)}" data-name="${esc(w.name)}" data-nummer="${esc(w.nach)}"`;
      return `<div class="a-abschluss s-rot"><span><b>${esc(w.name)}</b><small>Von #${esc(w.von)} auf #${esc(w.nach)}, beantragt ${esc(zeit(w.seit))}</small></span><div class="a-leiste"><button type="button" class="a-knopf klein" data-nummer-aktion="nummer-bestaetigen" ${daten}>Bestätigen</button><button type="button" class="a-knopf zweit klein" data-nummer-aktion="nummer-ablehnen" ${daten}>Ablehnen</button></div></div>`;
    }).join("")}</div></section>` : "";
    const kachel = (wert, text, art, ziel) => `<button type="button" class="a-kennzahl ${art}" data-tab="${ziel}"><b>${wert}</b><span>${esc(text)}</span></button>`;
    const reportsHtml = offene.slice(0, 5).map(reportZeile).join("");
    const termine = kommend.slice(0, 5).map(terminZeile).join("");
    return `<section class="a-held"><div class="a-held-bild" aria-hidden="true"></div><div><span class="a-kicker">Rennleitung</span><h1>Hallo, ${esc(d.name)}</h1><p>${offene.length ? `${offene.length} ${offene.length === 1 ? "Report wartet" : "Reports warten"} auf eine Entscheidung.` : "Keine offenen Reports, alles erledigt."}</p></div></section>
      <div class="a-kennzahlen">
        ${kachel(offene.length, "Offene Reports", offene.length ? "alarm" : "", "reports")}
        ${einsprueche.length ? kachel(einsprueche.length, "Einsprüche", "alarm", "reports") : ""}
        ${kachel(laufend.length, "Aktive Serien", "", "serien")}
        ${kachel(kommend.length, "Geplante Rennen", "", "rennen")}
        ${kachel(unfertig.length, "Rennen unvollständig", unfertig.length ? "warnung" : "", "rennen")}
      </div>
      ${(d.fehlendeErgebnisse || []).length ? `<section class="a-karte a-karte-info"><div class="a-kartenkopf"><h2>Ergebnis fehlt</h2><span class="a-chip gelb">${d.fehlendeErgebnisse.length}</span></div><div class="a-liste">${d.fehlendeErgebnisse.slice(0, 6).map((r) => `<div class="a-abschluss ${serienFarbe(r.serie)}"><span><b>${esc(r.titel)}</b><small>${esc([(serieVon(r.serie) || {}).name, datumKurz(r.datum)].filter(Boolean).join(" · "))}</small></span><button type="button" class="a-knopf zweit klein" data-ergebnis-import="${esc(r.serie)}">Importieren</button></div>`).join("")}</div></section>` : ""}
      ${nummernHtml}
      ${anmeldungFaellig}
      ${cockpitPruefungen()}
      ${cockpitStrafkonten()}
      ${abschluss}
      <div class="a-zwei">
        <section class="a-karte"><div class="a-kartenkopf"><h2>Zu entscheiden</h2><button type="button" class="a-knopf zweit klein" data-tab="reports">Alle Reports</button></div>${reportsHtml ? `<div class="a-liste">${reportsHtml}</div>` : '<p class="a-leer">Aktuell liegt nichts an.</p>'}</section>
        <section class="a-karte"><div class="a-kartenkopf"><h2>Nächste Rennen</h2><button type="button" class="a-knopf zweit klein" data-tab="rennen">Alle Rennen</button></div>${termine ? `<div class="a-liste">${termine}</div>` : '<p class="a-leer">Keine Rennen geplant.</p>'}</section>
      </div>`;
  }

  /* ---------- Serien ---------- */
  function klassenKontrolle() {
    const ziel = document.getElementById("a-klassen-check");
    const box = document.getElementById("a-klassen");
    if (!ziel || !box) return;
    const zeilen = [...box.querySelectorAll(".a-klasse")].map((z) => ({ name: z.querySelector('[name="k_name"]').value.trim(), min: z.querySelector('[name="k_min"]').value, max: z.querySelector('[name="k_max"]').value })).map((k) => ({ ...k, min: k.min === "" ? null : Number(k.min), max: k.max === "" ? null : Number(k.max) })).sort((a, b) => (a.min ?? 0) - (b.min ?? 0));
    let fehler = "";
    zeilen.forEach((k, i) => {
      if (fehler) return;
      if (!k.name || k.min === null) fehler = "Jede Klasse braucht einen Namen und einen Startwert.";
      else if (i === 0 && k.min !== 0) fehler = "Die unterste Klasse muss bei 0 beginnen.";
      else if (i === zeilen.length - 1 && k.max !== null) fehler = "Bei der obersten Klasse bleibt „bis“ leer.";
      else if (i < zeilen.length - 1 && (k.max === null || k.max + 1 !== zeilen[i + 1].min)) fehler = `Zwischen ${k.name || "dieser Klasse"} und ${zeilen[i + 1].name || "der nächsten"} ist eine Lücke oder Überschneidung.`;
    });
    ziel.innerHTML = `<div class="a-klassen-balken">${zeilen.map((k, i) => `<span class="${i === zeilen.length - 1 ? "pro" : i === 0 ? "am" : "mid"}"><b>${esc(k.name || "?")}</b><small>${k.min ?? "?"} bis ${k.max ?? "offen"}</small></span>`).join("")}</div><p class="a-hinweis ${fehler ? "a-bild-fehler" : "a-gut"}">${esc(fehler || "Die Klassen sind lückenlos.")}</p>`;
  }

  function serienForm() {
    const w = form.werte;
    const farbe = w.farbe || "rot";
    const farben = `<div class="a-feld"><label>Farbe</label><div class="a-farben">${FARBEN.map(([v, t]) => `<label class="s-${v}" title="${t}"><input type="radio" name="farbe" value="${v}"${v === farbe ? " checked" : ""} aria-label="${t}"><i aria-hidden="true"></i></label>`).join("")}</div></div>`;
    const loeschen = form.id ? '<button type="button" class="a-knopf gefahr" data-serie-loeschen="1">Löschen</button>' : "";
    return `<form class="a-karte a-form" id="f-serie" novalidate>
      <div class="a-kartenkopf"><h2>${form.id ? `${esc(w.name)} bearbeiten` : w.typ === "event" ? "Neues Event" : "Neue Season"}</h2>${form.id ? statusChip(w.status) : ""}</div>
      ${abschnittForm(1, "Grundlagen", `<div class="a-felder">
        ${feld("Name", eingabe("name", w.name, 'maxlength="60"'))}
        ${feld("Art", auswahl("typ", w.typ, [["liga", "Liga"], ["event", "Event"]]))}
        <div class="a-feld" data-nur-event${w.typ === "event" ? "" : " hidden"}><label>Eventreihe</label>${eingabe("eventReihe", w.eventReihe || "", 'maxlength="60" list="a-eventreihen" autocomplete="off" placeholder="z. B. 6h Nürburgring"')}<datalist id="a-eventreihen">${[...new Set(d.serien.map((s) => s.eventReihe).filter(Boolean))].map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist></div>
        <div class="a-feld" data-nur-liga${w.typ === "event" ? " hidden" : ""}><label>Saison</label>${eingabe("saison", w.saison, 'maxlength="40" placeholder="Saison 1"')}</div>
        ${feld("Status", auswahl("status", w.status, [["geplant", "Geplant"], ["anmeldung", "Anmeldung"], ["laeuft", "Läuft"], ["beendet", "Beendet"]]))}
        ${farben}
        ${feld("iRacing-Kategorie", auswahl("kategorie", w.kategorie, [["Sports_Car", "Sports Car"], ["Formula", "Formula"], ["Oval", "Oval"], ["Dirt_Road", "Dirt Road"], ["Dirt_Oval", "Dirt Oval"]]))}
        ${feld("Beschreibung", `<textarea name="beschreibung" maxlength="400" style="min-height:60px">${esc(w.beschreibung)}</textarea>`, true)}
        ${feld("Übertragung (Twitch- oder YouTube-Link, leer lassen ohne Stream)", eingabe("uebertragung", w.uebertragung || "", 'maxlength="150" placeholder="https://www.twitch.tv/…" autocomplete="off"'), true)}
      </div>`)}
      ${abschnittForm(2, "Umfang und Fristen", `<div class="a-felder">
        <div class="a-feld" data-nur-liga${w.typ === "event" ? " hidden" : ""}><label>Rennen gesamt</label>${eingabe("rennenGesamt", w.rennenGesamt, 'type="number" min="1"')}</div>
        <div class="a-feld" data-nur-liga${w.typ === "event" ? " hidden" : ""}><label>Gewertete Rennen</label>${eingabe("gewerteteRennen", w.gewerteteRennen, 'type="number" min="1"')}</div>
        ${feld("Fahrzeugklassen (bei Multiclass)", eingabe("fahrzeugklassen", (w.fahrzeugklassen || []).join(", "), 'placeholder="GTP, GT3"'))}
        ${feld("Anmeldeschluss (Minuten vor Start)", eingabe("anmeldeschlussMinuten", w.anmeldeschlussMinuten, 'type="number" min="0"'))}
        ${feld("Report-Frist (Stunden)", eingabe("reportStunden", w.reportStunden ?? 24, 'type="number" min="1"'))}
        ${eingabe("einspruchStunden", w.einspruchStunden ?? 48, 'type="hidden"')}
        ${feld("Strafpunkte-Grenze (0 = aus)", eingabe("strafpunkteGrenze", w.strafpunkteGrenze ?? 0, 'type="number" min="0"'))}
      </div><label class="a-check"><input type="checkbox" name="anmeldungOffen"${w.anmeldungOffen !== false ? " checked" : ""}> Fahrer können sich anmelden</label><p class="a-hinweis">Solange der Status „Geplant“ ist, bleibt die Anmeldung immer geschlossen.</p>`)}
      ${abschnittForm(3, "Klassen", `<label class="a-check"><input type="checkbox" name="ohneKlassen" id="s-ohne-klassen"${w.ohneKlassen ? " checked" : ""}> Keine Klassen nach iRating: alle fahren in einer gemeinsamen Wertung, bei Multiclass je Fahrzeugklasse</label>
        <div class="a-spalte" id="a-klassen-bereich"${w.ohneKlassen ? " hidden" : ""}><div class="a-klassen-kopf"><span>Name</span><span>Von</span><span>Bis</span><span></span></div><div class="a-klassen" id="a-klassen">${w.klassen.map(klasseZeile).join("")}</div><div><button type="button" class="a-knopf zweit klein" data-klasse-neu="1">Klasse hinzufügen</button></div><div id="a-klassen-check"></div>
          <div class="a-felder">
            ${feld("Einstufung der Fahrer", auswahl("einstufungArt", w.einstufungArt || "irating", [["irating", "Nach iRating"], ["sichtung", "Nach Sichtungsrennen"]]))}
            <div class="a-feld" data-nur-sichtung${w.einstufungArt === "sichtung" ? "" : " hidden"}><label>Pace-Grenzen in % zur schnellsten Runde</label>${eingabe("sichtungGrenzen", (w.sichtungGrenzen || []).join(" / ").replace(/\./g, ","), 'placeholder="101,5 / 103" autocomplete="off"')}</div>
            <div class="a-feld" data-nur-sichtung${w.einstufungArt === "sichtung" ? "" : " hidden"}><label>Mindestrunden je Sichtungsstrecke (0 = keine)</label>${eingabe("sichtungMindestRunden", w.sichtungMindestRunden ?? 0, 'type="number" min="0"')}</div>
          </div>
          <p class="a-hinweis" data-nur-sichtung${w.einstufungArt === "sichtung" ? "" : " hidden"}>Je eine Grenze zwischen zwei Klassen, von oben nach unten. Beispiel bei Pro, Pro-Am und Am: „101,5 / 103“ heißt bis 101,5 % Pro, bis 103 % Pro-Am, darüber Am. Leer lassen für die Standardwerte. Besteht die Sichtung aus mehreren Strecken (je ein Rennen als Sichtungsrennen markieren), zählt der Mittelwert der Strecken. Eine Strecke zählt nur mit den Mindestrunden. Wer keine Sichtung gefahren ist, wird nach den iRating-Grenzen oben eingestuft.</p></div>`)}
      <div data-nur-liga${w.typ === "event" ? " hidden" : ""}>${abschnittForm(4, "Punkte", `<div class="a-leiste"><span class="a-beschriftung">Vorlage</span>${PUNKTE_VORLAGEN.map(([t], i) => `<button type="button" class="a-knopf zweit klein" data-punkte-vorlage="${i}">${esc(t)}</button>`).join("")}</div><div class="a-felder">
        ${feld("Punkte nach Platz", eingabe("punkte", w.punkte.join(", ")), true)}
        ${feld("Punkte für alle danach", eingabe("punkteDanach", w.punkteDanach, 'type="number" min="0"'))}
        ${feld("Bonus Pole", eingabe("bonusPole", w.bonusPole, 'type="number" min="0"'))}
        ${feld("Bonus schnellste Runde", eingabe("bonusSchnellsteRunde", w.bonusSchnellsteRunde, 'type="number" min="0"'))}
        ${feld("Mindestrunden in Prozent", eingabe("mindestRundenProzent", w.mindestRundenProzent, 'type="number" min="0" max="100"'))}
        ${feld("Mindestzahl an Startern", eingabe("mindestStarter", w.mindestStarter ?? 5, 'type="number" min="0"'))}
        ${feld("Punkte bei verkürzter Distanz (%)", eingabe("punkteVerkuerztProzent", w.punkteVerkuerztProzent ?? 50, 'type="number" min="0" max="100"'))}
      </div>`)}</div>
      ${abschnittForm(5, "Briefing-Vorlage", `<textarea name="briefingVorlage" maxlength="10000" placeholder="Wird bei jedem neuen Rennen automatisch eingefügt">${esc(w.briefingVorlage || "")}</textarea>`, "Markdown ist möglich. Bereits angelegte Rennen bleiben unverändert.")}
      ${abschnittForm(6, "Bild der Serie", form.id ? bildFeld(form.id) : '<p class="a-hinweis">Ein eigenes Bild kannst du hinzufügen, sobald die Serie gespeichert ist.</p>')}
      ${formLeiste("Serie speichern", loeschen)}
    </form>`;
  }

  function serieKarte(s) {
    const eigene = d.rennen.filter((r) => r.serie === s.id).sort((a, b) => `${a.datum} ${a.startzeit}`.localeCompare(`${b.datum} ${b.startzeit}`));
    const anzahl = eigene.length;
    const anteil = Math.min(100, Math.round((anzahl / Math.max(1, s.rennenGesamt)) * 100));
    const istEvent = s.typ === "event";
    const offen = s.status !== "beendet";
    const termin = eigene[0];
    const info = istEvent
      ? `<p class="a-serie-termin">${termin ? esc([datumKurz(termin.datum), termin.startzeit && `${termin.startzeit} Uhr`, termin.strecke].filter(Boolean).join(" · ")) : "Noch kein Termin"}</p>`
      : `<div class="a-fortschritt" role="img" aria-label="${anzahl} von ${s.rennenGesamt} Rennen geplant"><i style="width:${anteil}%"></i></div><p class="a-hinweis">${anzahl} von ${s.rennenGesamt} Rennen geplant</p>`;
    const aktionen = istEvent
      ? `${offen ? (termin ? `<button type="button" class="a-knopf zweit klein" data-rennen-bearbeiten="${esc(termin.id)}">Termin bearbeiten</button>` : `<button type="button" class="a-knopf zweit klein" data-termin-neu="${esc(s.id)}">Termin anlegen</button>`) : ""}<button type="button" class="a-knopf zweit klein" data-serie-kopie="${esc(s.id)}">Duplizieren</button>`
      : `${offen ? `<button type="button" class="a-knopf zweit klein" data-planer="${esc(s.id)}">Rennen planen</button>` : ""}<button type="button" class="a-knopf zweit klein" data-serie-kopie="${esc(s.id)}">Neue Season</button>`;
    return `<article class="a-serie s-${esc(s.farbe || "rot")}${s.status === "beendet" ? " beendet" : ""}">
      <div class="a-serie-bild" style="background-image:url('${esc(window.LigaKarte.bildVon(s.id, s.bildVersion))}')" aria-hidden="true"></div>
      <div class="a-serie-inhalt">
        <div class="a-leiste">${istEvent ? '<span class="a-chip gold">★ Event</span>' : '<span class="a-chip hell">Season</span>'}${s.status === "geplant" ? '<span class="a-chip">Geplant</span>' : statusChip(s.status)}${s.anmeldungOffen === false && s.status !== "geplant" ? '<span class="a-chip">Anmeldung zu</span>' : ""}</div>
        <h3>${esc(s.name)}</h3>
        <p class="a-hinweis">${esc([istEvent ? "" : s.saison, s.ohneKlassen ? "Ohne iRating-Klassen" : `${(s.klassen || []).length} Klassen`, istEvent ? "" : `${s.gewerteteRennen} von ${s.rennenGesamt} Rennen gewertet`].filter(Boolean).join(" · "))}</p>
        ${info}
        <div class="a-leiste">${s.status === "geplant" ? `<button type="button" class="a-knopf klein" data-serie-oeffnen="${esc(s.id)}">Anmeldung öffnen</button>` : ""}<button type="button" class="a-knopf${s.status === "geplant" ? " zweit" : ""} klein" data-serie-bearbeiten="${esc(s.id)}">Bearbeiten</button>${aktionen}<a class="a-knopf zweit klein" href="/liga?serie=${encodeURIComponent(s.id)}">Ansehen</a></div>
      </div>
    </article>`;
  }

  function serienTab() {
    const aktiv = d.serien.filter((s) => s.status !== "beendet");
    const listen = { liga: aktiv.filter((s) => s.typ !== "event"), event: aktiv.filter((s) => s.typ === "event"), archiv: d.serien.filter((s) => s.status === "beendet") };
    const reiter = [["liga", "Seasons", listen.liga.length], ["event", "Events", listen.event.length], ["archiv", "Archiv", listen.archiv.length], ["bild", "Titelbild", null]];
    const kopf = `<nav class="a-reiter" aria-label="Seasons und Events">${reiter.map(([id, t, n]) => `<button type="button" class="${id === "event" ? "ist-event" : ""}" data-serien-reiter="${id}" aria-pressed="${serienReiter === id}">${t}${n === null ? "" : `<small>${n}</small>`}</button>`).join("")}</nav>`;
    const formular = form && form.art === "serie" ? serienForm() : "";
    if (serienReiter === "bild") return `${kopf}<section class="a-karte"><h2>Titelbild der Liga-Übersicht</h2>${bildFeld("uebersicht")}</section>`;
    const texte = { liga: ["Seasons", "Neue Season", "Noch keine laufende Season. Leg die erste an."], event: ["Events", "Neues Event", "Noch kein Event geplant."], archiv: ["Archiv", "", "Noch nichts beendet."] }[serienReiter];
    const liste = listen[serienReiter];
    return `${kopf}${formular}
      <section class="a-karte"><div class="a-kartenkopf"><h2>${texte[0]}</h2>${texte[1] ? `<button type="button" class="a-knopf" data-serie-neu="${serienReiter}">${texte[1]}</button>` : ""}</div>
      ${liste.length ? `<div class="a-serien">${liste.map(serieKarte).join("")}</div>` : `<p class="a-leer">${texte[2]}</p>`}</section>`;
  }

  /* ---------- Rennen ---------- */
  // Ligen laufen über die iRacing-Liga, nur Events und Serien mit ein oder zwei Rennen brauchen eigene Zugangsdaten.
  const brauchtZugang = (s) => !s || s.typ === "event" || !(s.rennenGesamt > 2);
  const rennenWarnungen = (r) => [!r.passwort && brauchtZugang(serieVon(r.serie)) && "Kein Passwort", !r.briefing && "Kein Briefing", !r.strecke && "Keine Strecke"].filter(Boolean);

  function rennenForm() {
    const w = form.werte;
    const karte = (streckeAus(w.strecke) || {});
    return `<form class="a-karte a-form" id="f-rennen" novalidate>
      <div class="a-kartenkopf"><h2>${form.id ? `${esc(w.titel)} bearbeiten` : "Neues Rennen"}</h2></div>
      ${streckenDatalist()}
      <div class="a-rennen-form">
        <div class="a-spalte">
          ${abschnittForm(1, "Termin", `<div class="a-felder">
            ${feld("Titel", eingabe("titel", w.titel, 'maxlength="80" placeholder="Runde 1 · Spa"'))}
            ${feld("Serie oder Event", auswahl("serie", w.serie || serieId, d.serien.map((s) => [s.id, s.name])))}
            ${feld("Status", auswahl("status", w.status, [["geplant", "Geplant"], ["abgesagt", "Abgesagt"]]))}
            ${feld("Datum", eingabe("datum", w.datum, 'type="date"'))}
            ${feld("Rennstart (deutsche Zeit)", eingabe("startzeit", w.startzeit, 'type="time"'))}
            ${feld("Startplätze", eingabe("plaetze", w.plaetze, 'type="number" min="1"'))}
          </div><label class="a-check"><input type="checkbox" name="sichtung"${w.sichtung ? " checked" : ""}> Sichtungsrennen: zählt nicht für die Tabelle, die Rundenzeiten bestimmen die Klassen</label>`)}
          ${abschnittForm(2, "Ablauf", `<div class="a-felder">
            ${feld("Fahrzeuge", eingabe("fahrzeuge", w.fahrzeuge, 'maxlength="80"'))}
            ${feld("Training", eingabe("training", w.training, 'placeholder="30 min"'))}
            ${feld("Qualifying", eingabe("qualifying", w.qualifying, 'placeholder="15 min"'))}
            ${feld("Renndauer", eingabe("renndauer", w.renndauer, 'placeholder="60 min"'))}
            ${feld("Wetter", eingabe("wetter", w.wetter))}
          </div>`)}
          ${abschnittForm(3, "Zugang und Briefing", `<div class="a-felder">
            ${feld("Session-Name in iRacing", eingabe("server", w.server))}
            ${feld("Session-Passwort", eingabe("passwort", w.passwort, 'autocomplete="off"'))}
            ${feld("Briefing und Renninfos (Markdown)", `<textarea name="briefing" maxlength="10000">${esc(w.briefing)}</textarea>`, true)}
          </div>`, "Session-Name und Passwort braucht es nur bei Events und Serien mit ein oder zwei Rennen, Ligen laufen über die iRacing-Liga. Das Passwort sehen nur Fahrer mit Startplatz, das Briefing nur angemeldete Fahrer.")}
        </div>
        <aside class="a-spalte">
          ${abschnittForm(4, "Strecke", `${feld("Strecke", eingabe("strecke", w.strecke, 'maxlength="80" list="a-strecken" id="r-strecke" autocomplete="off" placeholder="Name eintippen"'))}<div id="a-karte-vorschau">${kartenVorschau(karte)}</div>`, "Strecken aus der Bibliothek bringen ihre Streckenkarte automatisch mit.")}
        </aside>
      </div>
      ${formLeiste("Rennen speichern", form.id ? '<button type="button" class="a-knopf gefahr" data-rennen-loeschen="1">Löschen</button>' : "")}
    </form>`;
  }
  const kartenVorschau = (s) => (s && s.id ? (s.kartenVersion ? `<img class="a-karten-bild" src="${esc(streckeBild(s))}" alt="Streckenkarte ${esc(streckeLabel(s))}">` : '<p class="a-leer">Für diese Strecke gibt es noch keine Karte. Du kannst sie unter „Strecken“ erzeugen oder hochladen.</p>') : '<p class="a-leer">Noch keine Strecke aus der Bibliothek gewählt.</p>');

  function terminZeile(r) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(r.datum || "");
    const vorbei = String(r.datum) < heute();
    const s = serieVon(r.serie);
    const warnungen = vorbei || r.status === "abgesagt" ? [] : rennenWarnungen(r);
    return `<article class="a-termin ${serienFarbe(r.serie)}${vorbei ? " vorbei" : ""}">
      <div class="a-datum"><b>${m ? m[3] : "–"}</b><small>${m ? MONATE[+m[2] - 1] : ""}</small></div>
      <div class="a-termin-karte">${r.streckenBild ? `<img src="${esc(kartenUrl(r.streckenBild))}" alt="" loading="lazy">` : ""}</div>
      <div class="a-termin-text"><b>${esc(r.titel)}</b><small>${esc([s ? s.name : "", r.startzeit ? `${r.startzeit} Uhr` : "", r.strecke, r.plaetze ? `${r.plaetze} Plätze` : ""].filter(Boolean).join(" · "))}</small><span class="a-leiste">${r.sichtung ? '<span class="a-chip hell">Sichtung</span>' : ""}${r.status === "abgesagt" ? statusChip("abgesagt") : ""}${warnungen.map((w) => `<span class="a-chip gelb">${esc(w)}</span>`).join("")}</span></div>
      <div class="a-leiste"><button type="button" class="a-knopf zweit klein" data-rennen-bearbeiten="${esc(r.id)}">Bearbeiten</button><button type="button" class="a-knopf zweit klein" data-rennen-schieben="${esc(r.id)}" data-titel="${esc(r.titel)}">Verschieben</button><button type="button" class="a-knopf zweit klein" data-rennen-kopie="${esc(r.id)}">Duplizieren</button><button type="button" class="a-knopf gefahr klein" data-rennen-weg="${esc(r.id)}" data-titel="${esc(r.titel)}">Löschen</button></div>
    </article>`;
  }

  const planerZeilenHtml = () => {
    const vorhanden = d.rennen.filter((r) => r.serie === planer.serie).length;
    return planer.zeilen.map((z, i) => `<div class="a-plan-zeile"><b>R${vorhanden + i + 1}</b><input type="date" name="p_datum" value="${esc(z.datum)}" aria-label="Datum Runde ${vorhanden + i + 1}"><input name="p_strecke" value="${esc(z.strecke)}" list="a-strecken" autocomplete="off" placeholder="Strecke" aria-label="Strecke Runde ${vorhanden + i + 1}"></div>`).join("");
  };

  function planerForm() {
    const s = serieVon(planer.serie);
    return `<form class="a-karte a-form" id="f-plan" novalidate>
      <div class="a-kartenkopf"><h2>Saison planen: ${esc(s.name)}</h2></div>
      ${streckenDatalist()}
      <div class="a-rennen-form">
        <div class="a-spalte">
          ${abschnittForm(1, "Rhythmus", `<div class="a-felder">
            ${feld("Erstes Rennen", `<input type="date" id="p-start" value="${esc(planer.start)}">`)}
            ${feld("Abstand in Tagen", `<input type="number" id="p-abstand" min="1" max="60" value="${esc(planer.abstand)}">`)}
            ${feld("Anzahl Rennen", `<input type="number" id="p-anzahl" min="1" max="60" value="${planer.zeilen.length}">`)}
            ${feld("Rennstart", eingabe("startzeit", planer.startzeit, 'type="time"'))}
          </div>`, "Die Termine rechnen sich automatisch, jeder lässt sich einzeln ändern.")}
          ${abschnittForm(2, "Gilt für alle Rennen", `<div class="a-felder">
            ${feld("Startplätze", eingabe("plaetze", planer.plaetze, 'type="number" min="1"'))}
            ${feld("Fahrzeuge", eingabe("fahrzeuge", planer.fahrzeuge, 'maxlength="80"'))}
            ${feld("Training", eingabe("training", planer.training, 'placeholder="30 min"'))}
            ${feld("Qualifying", eingabe("qualifying", planer.qualifying, 'placeholder="15 min"'))}
            ${feld("Renndauer", eingabe("renndauer", planer.renndauer, 'placeholder="60 min"'))}
            ${feld("Wetter", eingabe("wetter", planer.wetter))}
          </div>`)}
        </div>
        <div class="a-spalte">${abschnittForm(3, "Rennkalender", `<div class="a-plan" id="a-plan-zeilen">${planerZeilenHtml()}</div>`, "Das Briefing trägst du später je Rennen ein.")}</div>
      </div>
      ${formLeiste("Rennen anlegen")}
    </form>`;
  }

  function neuerPlaner(serie) {
    const s = serieVon(serie);
    const anzahl = Math.max(1, s.rennenGesamt - d.rennen.filter((r) => r.serie === serie).length);
    const start = plusTage(heute(), 7);
    return { serie, start, abstand: 7, startzeit: "20:00", plaetze: 40, fahrzeuge: "", training: "", qualifying: "", renndauer: "", wetter: "", zeilen: Array.from({ length: anzahl }, (_, i) => ({ datum: plusTage(start, i * 7), strecke: "" })) };
  }

  // Merkt sich die Zeilen, bevor sie neu aufgebaut werden.
  function planerLesen() {
    const f = document.getElementById("f-plan");
    if (!f) return;
    const fd = new FormData(f);
    const daten = fd.getAll("p_datum");
    const strecken = fd.getAll("p_strecke");
    planer.zeilen = daten.map((datum, i) => ({ datum, strecke: strecken[i] }));
    ["startzeit", "plaetze", "fahrzeuge", "training", "qualifying", "renndauer", "wetter"].forEach((k) => { planer[k] = fd.get(k); });
    planer.start = document.getElementById("p-start").value;
    planer.abstand = Number(document.getElementById("p-abstand").value) || 7;
  }

  function rennenTab() {
    const nachZeit = (a, b) => `${a.datum} ${a.startzeit}`.localeCompare(`${b.datum} ${b.startzeit}`);
    const gefiltert = d.rennen.filter((r) => rennenFilter === "alle" || r.serie === rennenFilter);
    const kommend = gefiltert.filter((r) => String(r.datum) >= heute()).sort(nachZeit);
    const vorbei = gefiltert.filter((r) => String(r.datum) < heute()).sort((a, b) => nachZeit(b, a));
    const chips = [["alle", "Alle"], ...d.serien.map((s) => [s.id, s.name])].map(([id, n]) => `<button type="button" class="a-filter" data-rennen-filter="${esc(id)}" aria-pressed="${rennenFilter === id}">${esc(n)}</button>`).join("");
    const offeneSerien = d.serien.filter((s) => s.status !== "beendet");
    const knoepfe = d.serien.length ? `<div class="a-leiste">${offeneSerien.length ? `<button type="button" class="a-knopf zweit" data-planer="${esc((serieVon(rennenFilter) || offeneSerien[0]).id)}">Saison planen</button>` : ""}<button type="button" class="a-knopf" data-rennen-neu="1">Neues Rennen</button></div>` : "";
    return `${form && form.art === "rennen" ? rennenForm() : ""}${planer ? planerForm() : ""}
      <section class="a-karte"><div class="a-kartenkopf"><h2>Rennen</h2>${knoepfe}</div>
      ${d.serien.length ? `<div class="a-leiste">${chips}${serieVon(rennenFilter) && serieVon(rennenFilter).status !== "beendet" && brauchtZugang(serieVon(rennenFilter)) ? `<button type="button" class="a-knopf zweit klein a-rechts" data-passwort-alle="${esc(rennenFilter)}">Passwort für alle kommenden Rennen</button>` : ""}</div>` : ""}
      ${!d.serien.length ? '<p class="a-leer">Leg zuerst eine Serie an.</p>' : kommend.length ? `<div class="a-liste">${kommend.map(terminZeile).join("")}</div>` : '<p class="a-leer">Keine kommenden Rennen.</p>'}</section>
      ${vorbei.length ? `<section class="a-karte"><div class="a-kartenkopf"><h2>Vergangene Rennen</h2><span class="a-chip">${vorbei.length}</span></div><div class="a-liste">${vorbei.map(terminZeile).join("")}</div></section>` : ""}`;
  }

  /* ---------- Strecken ---------- */
  function streckenForm() {
    const w = form.werte;
    const laender = [["", "Keine Angabe"], ...window.LigaFlaggen.LAENDER];
    return `<form class="a-karte a-form" id="f-strecke" novalidate>
      <div class="a-kartenkopf"><h2>${form.id ? `${esc(streckeLabel(w))} bearbeiten` : "Neue Strecke"}</h2></div>
      ${streckenDatalist()}
      ${abschnittForm(1, "Angaben", `<div class="a-felder">
        ${feld("Name", eingabe("name", w.name, 'maxlength="80" list="a-strecken" autocomplete="off"'))}
        ${feld("Variante", eingabe("variante", w.variante, 'maxlength="60" placeholder="Grand Prix"'))}
        ${feld("Land", auswahl("land", w.land || "", laender))}
        ${feld("Länge in km", eingabe("laengeKm", w.laengeKm ?? "", 'inputmode="decimal" placeholder="7,004"'))}
        ${feld("Kurven", eingabe("kurven", w.kurven ?? "", 'type="number" min="1"'))}
        ${feld("Notiz für die Rennleitung", eingabe("notiz", w.notiz, 'maxlength="300"'), true)}
      </div>`)}
      ${abschnittForm(2, "Streckenkarte", form.id ? bildFeld(`strecke:${form.id}`) : '<p class="a-hinweis">Nach dem Speichern kannst du direkt die Karte hochladen.</p>')}
      ${formLeiste("Strecke speichern", form.id ? '<button type="button" class="a-knopf gefahr" data-strecke-loeschen="1">Löschen</button>' : "")}
    </form>`;
  }

  const STRECKEN_SEITE = 48;
  const einsaetzeJeStrecke = () => d.rennen.reduce((m, r) => (r.streckeId ? m.set(r.streckeId, (m.get(r.streckeId) || 0) + 1) : m), new Map());
  const STRECKEN_FILTER = { alle: () => true, karte: (s) => !!s.kartenVersion, ohne: (s) => !s.kartenVersion };

  function streckenListe() {
    const einsaetze = einsaetzeJeStrecke();
    const passt = streckenFilter === "kalender" ? (s) => einsaetze.has(s.id) : STRECKEN_FILTER[streckenFilter];
    const woerter = streckenSuche.trim().toLowerCase().split(/\s+/).filter(Boolean);
    // Was schon genutzt wird, steht vorne, damit es in der langen Importliste nicht untergeht.
    const wichtig = (s) => (s.kartenVersion || einsaetze.has(s.id) ? 0 : 1);
    const treffer = d.strecken.filter((s) => passt(s) && woerter.every((w) => streckeLabel(s).toLowerCase().includes(w))).sort((a, b) => wichtig(a) - wichtig(b) || streckeLabel(a).localeCompare(streckeLabel(b), "de"));
    if (!d.strecken.length) return '<p class="a-leer">Noch keine Strecke angelegt. Importiere die Liste aus Garage 61 oder lege eine Strecke von Hand an.</p>';
    if (!treffer.length) return '<p class="a-leer">Keine Strecke gefunden.</p>';
    const karten = (streckenAlle ? treffer : treffer.slice(0, STRECKEN_SEITE)).map((s) => {
      const anzahl = einsaetze.get(s.id) || 0;
      const daten = [s.laengeKm ? `${String(s.laengeKm).replace(".", ",")} km` : "", s.kurven ? `${s.kurven} Kurven` : "", anzahl ? `${anzahl}× im Kalender` : ""].filter(Boolean).join(" · ");
      return `<button type="button" class="a-strecke" data-strecke-bearbeiten="${esc(s.id)}">
        <span class="a-strecke-karte">${s.kartenVersion ? `<img src="${esc(streckeBild(s))}" alt="" loading="lazy">` : "<em>Keine Karte</em>"}</span>
        <span class="a-strecke-text"><b>${window.LigaKarte.flagge(s.land)}${esc(s.name)}</b>${s.variante ? `<small>${esc(s.variante)}</small>` : ""}${daten ? `<small>${esc(daten)}</small>` : ""}</span>
      </button>`;
    }).join("");
    const rest = streckenAlle ? 0 : treffer.length - STRECKEN_SEITE;
    return `<div class="a-strecken">${karten}</div>${rest > 0 ? `<div class="a-mehr"><button type="button" class="a-knopf zweit" data-strecken-alle="1">Alle ${treffer.length} anzeigen</button></div>` : ""}`;
  }
  const streckenListeNeu = () => { document.getElementById("a-strecken-liste").innerHTML = streckenListe(); };

  function streckenTab() {
    const einsaetze = einsaetzeJeStrecke();
    const anzahl = (f) => d.strecken.filter(f).length;
    const chips = [["alle", "Alle", d.strecken.length], ["karte", "Mit Karte", anzahl(STRECKEN_FILTER.karte)], ["ohne", "Ohne Karte", anzahl(STRECKEN_FILTER.ohne)], ["kalender", "Im Kalender", anzahl((s) => einsaetze.has(s.id))]].map(([id, t, n]) => `<button type="button" class="a-filter" data-strecken-filter="${id}" aria-pressed="${streckenFilter === id}">${t} ${n}</button>`).join("");
    return `${form && form.art === "strecke" ? streckenForm() : ""}
      <section class="a-karte"><div class="a-kartenkopf"><h2>Streckenbibliothek</h2><div class="a-leiste"><button type="button" class="a-knopf zweit" data-strecken-import="1">Aus Garage 61 importieren</button><button type="button" class="a-knopf" data-strecke-neu="1">Neue Strecke</button></div></div>
      <p class="a-hinweis">Einmal anlegen, in jeder Saison wiederverwenden. Die Karte erscheint automatisch beim Rennen und im Fahrerbereich. Öffne eine Strecke, um ihre Karte aus einer Team-Runde zu erzeugen.</p>
      <div class="a-leiste">${chips}<input type="search" id="a-strecken-suche" class="a-suche" value="${esc(streckenSuche)}" placeholder="Strecke oder Variante suchen" aria-label="Strecke suchen"></div>
      <div id="a-strecken-liste">${streckenListe()}</div></section>`;
  }

  /* ---------- Protokoll ---------- */
  let protokoll = null;
  let protokollLaedt = false;
  async function protokollLaden() {
    protokollLaedt = true;
    const a = await fetch(`${API}&nur=protokoll`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    protokollLaedt = false;
    protokoll = (a && a.protokoll) || [];
    if (tab === "protokoll") zeichne();
  }

  function protokollTab() {
    if (protokoll === null && !protokollLaedt) protokollLaden();
    const zeilen = (protokoll || []).map((e) => `<tr><td>${esc(zeit(e.zeit))}</td><td>${esc(e.wer)}</td><td class="umbruch">${esc(e.text)}</td></tr>`).join("");
    return `<section class="a-karte"><div class="a-kartenkopf"><h2>Änderungsprotokoll</h2><div class="a-leiste"><span class="a-chip">Letzte 300 Einträge</span><button type="button" class="a-knopf zweit klein" data-discord-test="1">Discord testen</button></div></div>${zeilen ? `<div class="a-scroll"><table><thead><tr><th>Zeit</th><th>Wer</th><th>Was</th></tr></thead><tbody>${zeilen}</tbody></table></div>` : `<p class="a-leer">${protokoll === null ? "Wird geladen …" : "Noch keine Änderungen protokolliert."}</p>`}</section>`;
  }

  /* ---------- Fahrer-Akte ---------- */
  const akteKnopf = (name, cust, discord) => `<button type="button" class="a-knopf zweit klein" data-akte="1" data-name="${esc(name)}" data-cust="${esc(cust || "")}" data-discord="${esc(discord || "")}">Akte</button>`;
  async function akteLaden(name, cust, discord) {
    const r = await fetch(`${API}&akte=1&cust=${encodeURIComponent(cust)}&discord=${encodeURIComponent(discord)}`, { cache: "no-store" }).catch(() => null);
    const daten = r && r.ok ? await r.json() : null;
    if (!daten) { setzeMeldung("Die Akte konnte nicht geladen werden.", true); return zeichne(); }
    akte = { name, cust, discord, daten, bearbeiten: false, werte: null };
    tab = "fahrer"; reportId = null;
    zeichne();
    window.scrollTo(0, 0);
  }
  const akteOeffnen = (b) => { setzeMeldung(""); return akteLaden(b.dataset.name, b.dataset.cust, b.dataset.discord); };

  function akteProfilForm() {
    const w = akte.werte || akte.daten.profil;
    return `<form id="f-akte-profil" class="a-abschnitt" novalidate><h3>Profil bearbeiten</h3>
      <div class="a-felder">
        ${feld("iRacing-Name", eingabe("iracingName", w.iracingName, 'maxlength="40" autocomplete="off"'))}
        ${feld("iRacing-ID", eingabe("custId", w.custId, 'inputmode="numeric" maxlength="9" autocomplete="off"'))}
        ${feld("Sports-Car-iRating", eingabe("irating", w.irating, 'inputmode="numeric" maxlength="5" autocomplete="off"'))}
        ${feld("Startnummer", eingabe("nummer", w.nummer ?? "", 'inputmode="numeric" maxlength="3" placeholder="1 bis 999"'))}
        ${feld("Land", auswahl("land", w.land || "", [["", "Keine Angabe"], ...window.LigaFlaggen.LAENDER]))}
        ${feld("Team oder Club", eingabe("team", w.team || "", 'maxlength="40"'))}
        ${feld("Twitch- oder YouTube-Link", eingabe("kanal", w.kanal || "", 'maxlength="150" placeholder="https://"'), true)}
      </div>
      ${akte.daten.profil.hatBild ? '<label class="a-check"><input type="checkbox" name="bildEntfernen"> Discord-Profilbild entfernen</label>' : ""}
      <p class="a-hinweis">Eine geänderte iRacing-ID gilt erst ab dem nächsten Import. In bestehenden Starterlisten bleibt der alte Name, bis sich der Fahrer neu anmeldet.</p>
      <div class="a-leiste"><button type="submit" class="a-knopf">Profil speichern</button><button type="button" class="a-knopf zweit" data-akte-bearbeiten="zu">Abbrechen</button></div>
    </form>`;
  }

  function akteHtml() {
    if (!akte) return "";
    const { faelle, strafen, summen: s } = akte.daten;
    const zahl_ = (w, t, art) => `<div class="a-kennzahl ${w && art ? art : ""}"><b>${w}</b><span>${t}</span></div>`;
    const fall = (f) => `<button type="button" class="a-fall" data-report="${esc(f.id)}"><span class="a-fall-kopf"><span class="a-chip ${f.rolle === "gemeldet" ? "rot" : ""}">${f.rolle === "gemeldet" ? "Gemeldet" : "Hat gemeldet"}</span>${f.urteil ? `<span class="a-chip">${esc(urteilKurz(f.urteil))}</span>` : '<span class="a-chip gelb">Offen</span>'}<time>${esc(zeit(f.erstellt))}</time></span><b>${esc(f.von)} <span>meldet</span> ${esc(f.gegen)}</b><small>${esc([f.serieName, f.rennenTitel].filter(Boolean).join(" · "))}</small></button>`;
    const strafeZeile = (x) => `<tr><td>${esc(x.serieName)}</td><td class="rechts">${esc(x.typ === "zeit" ? `+${x.sekunden} s` : x.typ === "dsq" ? "DSQ" : `−${x.punkte}`)}</td><td class="umbruch">${esc(x.grund)}</td><td>${x.ausReport ? '<span class="a-chip">aus Report</span>' : ""}</td></tr>`;
    return `<section class="a-karte a-form"><div class="a-kartenkopf"><h2>Akte: ${esc(akte.name)}</h2><div class="a-leiste">${akte.daten.profil && !akte.bearbeiten ? '<button type="button" class="a-knopf klein" data-akte-bearbeiten="auf">Profil bearbeiten</button>' : ""}<button type="button" class="a-knopf zweit klein" data-akte-zu="1">Schließen</button></div></div>
      ${akte.bearbeiten ? akteProfilForm() : ""}
      <div class="a-kennzahlen">${zahl_(s.gemeldet, "Gemeldet worden", "warnung")}${zahl_(s.selbstGemeldet, "Selbst gemeldet")}${zahl_(s.verwarnungen, "Verwarnungen", "warnung")}${zahl_(s.strafpunkte, "Strafpunkte", "alarm")}${zahl_(s.zeitstrafen, "Zeitstrafen", "alarm")}${zahl_(s.disqualifikationen, "Disqualifikationen", "alarm")}</div>
      ${faelle.length ? `<h3>Fälle</h3><div class="a-liste">${faelle.map(fall).join("")}</div>` : '<p class="a-leer">Keine Reports zu diesem Fahrer.</p>'}
      ${strafen.length ? `<h3>Strafen</h3><div class="a-scroll"><table><thead><tr><th>Serie</th><th class="rechts">Strafe</th><th>Grund</th><th></th></tr></thead><tbody>${strafen.map(strafeZeile).join("")}</tbody></table></div>` : ""}
    </section>`;
  }

  /* ---------- Fahrer ---------- */
  const fahrzeugChip = (name) => (name ? `<span class="a-fz" style="--fz:${window.LigaKarte.fahrzeugFarbe(name)}">${esc(name)}</span>` : "");
  const abweichung = (f) => f.iratingAngabe !== null && f.iratingErgebnis !== null && Math.abs(f.iratingAngabe - f.iratingErgebnis) > 150;

  function fahrerZeile(f, serie) {
    const klassenOption = (auto, fest) => `<option value="">${serie.einstufungArt === "sichtung" ? "Nach iRating" : "Automatisch"}${auto ? ` (${esc((serie.klassen.find((k) => k.id === auto) || {}).name || auto)})` : ""}</option>${serie.klassen.map((k) => `<option value="${esc(k.id)}"${k.id === fest ? " selected" : ""}>${esc(k.name)}</option>`).join("")}`;
    const bild = f.bild && f.pid ? `<img class="a-avatar" src="${esc(window.LigaKarte.avatarVon(f.pid, f.bild))}" alt="" width="34" height="34" loading="lazy">` : `<span class="a-avatar leer" aria-hidden="true">${esc(String(f.name).trim().charAt(0).toUpperCase())}</span>`;
    const klasse = f.custId && !serie.ohneKlassen ? `<select data-einstufung="${esc(f.custId)}" aria-label="Klasse von ${esc(f.name)}">${klassenOption(f.klasseAuto, f.klasseFest)}</select>` : "–";
    const abw = abweichung(f);
    return `<tr data-suche="${esc(`${f.name} ${f.custId} ${f.team || ""} ${f.nummer || ""}`.toLowerCase())}">
      <td><div class="a-fahrer">${bild}<div><b>${f.nummer ? `<span class="a-nr">#${esc(f.nummer)}</span> ` : ""}${window.LigaKarte.flagge(f.land)}${esc(f.name)}</b>${f.team ? `<small>${esc(f.team)}</small>` : ""}</div>${fahrzeugChip(f.fahrzeugklasse)}</div></td>
      <td>${f.mitglied ? '<span class="a-chip hell">Season</span>' : '<span class="a-chip">Einzeln</span>'}${f.custId ? "" : ' <span class="a-chip rot">Kein Profil</span>'}</td>
      <td>${esc(f.custId) || "–"}</td>
      <td class="rechts">${zahl(f.iratingAngabe)}</td>
      <td class="rechts ${abw ? "a-abweichung" : ""}">${zahl(f.iratingErgebnis)}${abw ? " !" : ""}</td>
      <td>${klasse}</td>
      <td class="rechts">${akteKnopf(f.name, f.custId, f.discordId)} <button type="button" class="a-knopf gefahr klein" data-aus-serie="${esc(f.discordId)}" data-name="${esc(f.name)}">Entfernen</button></td>
    </tr>`;
  }

  // Klassenvorschlag aus den Sichtungsrennen. Übernommen wird erst auf Knopfdruck, danach lässt sich jede Klasse oben einzeln ändern.
  const rundenzeit = (t) => { if (!t) return "–"; const s = t / 10000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, "0")}`; };
  // „Circuit de Spa-Francorchamps · Grand Prix“ → „Spa-Francorchamps“, damit drei Strecken nebeneinander passen
  const kurzerStreckenname = (s) => { const n = s.split(" · ")[0].replace(/^(Circuit de |Circuit |Autodromo Nazionale |Autodromo Internazionale |Autodromo |Autódromo |Circuito de |Circuito )/i, "").replace(/ (Circuit|Raceway|Speedway|Motorsport Park)$/i, ""); return n.length > 16 ? `${n.slice(0, 15)}…` : n; };
  function sichtungKarte(serie, det) {
    const v = det.sichtung;
    if (!v || !serie || serie.ohneKlassen) return "";
    const name = (id) => (v.klassen.find((k) => k.id === id) || {}).name || "–";
    const grenzen = v.klassen.map((k, i) => (i < v.grenzen.length ? `${esc(k.name)} bis ${String(v.grenzen[i]).replace(".", ",")} %` : `${esc(k.name)} darüber`)).join(" · ");
    if (!v.fahrer.length) return `<section class="a-karte"><h2>Sichtung</h2><p class="a-leer">Noch kein Sichtungsrennen eingelesen. Hak beim Rennen „Sichtungsrennen“ an und lies danach das Ergebnis ein. Bis dahin gilt die Klasse nach iRating.</p><p class="a-hinweis">Grenzen: ${grenzen}</p></section>`;
    const offen = v.fahrer.filter((f) => f.vorschlag && f.vorschlag !== f.fest).length;
    const prozent = (p) => `${String(p.toFixed(1)).replace(".", ",")} %`;
    // Je Strecke: Abstand und darunter die Rundenzeit. Ungültig heißt: zu wenige Runden oder keine Rundenzeit.
    const zelle = (z) => (!z ? '<td class="rechts">–</td>' : z.gueltig ? `<td class="rechts">${prozent(z.prozent)}<small class="a-unter">${rundenzeit(z.zeit)}</small></td>` : `<td class="rechts"><span class="a-chip rot" title="${esc(`${z.runden} Runden${v.mindestRunden ? `, nötig ${v.mindestRunden}` : ""}`)}">ungültig</span></td>`);
    const zeile = (f) => `<tr><td>${esc(f.name)}${f.fahrzeugklasse && v.fahrer.some((x) => x.fahrzeugklasse !== f.fahrzeugklasse) ? ` ${fahrzeugChip(f.fahrzeugklasse)}` : ""}</td>${f.zeiten.map(zelle).join("")}<td class="rechts"><b>${f.prozent === null ? "–" : prozent(f.prozent)}</b></td><td>${f.vollstaendig ? `<b>${esc(name(f.vorschlag))}</b>` : `<span class="a-chip gelb" title="Nicht jede Strecke gültig gefahren, bitte von Hand einstufen">${f.gewertet} von ${v.strecken.length} Strecken</span>`}</td><td>${esc(name(f.nachIrating))}</td><td>${f.fest ? (f.fest === f.vorschlag ? '<span class="a-chip gruen">Übernommen</span>' : `<span class="a-chip gelb">${esc(name(f.fest))}</span>`) : '<span class="a-chip">nach iRating</span>'}</td></tr>`;
    return `<section class="a-karte"><div class="a-kartenkopf"><h2>Sichtung</h2><span class="a-chip">${v.strecken.length} ${v.strecken.length === 1 ? "Strecke" : "Strecken"} · ${v.fahrer.length} Fahrer</span></div>
      <p class="a-hinweis">Je Strecke zählt die beste Runde im Vergleich zur schnellsten der Fahrzeugklasse${v.mindestRunden ? `, aber nur mit mindestens ${v.mindestRunden} Runden` : ""}. Entscheidend ist der Mittelwert aller Strecken. Grenzen: ${grenzen}</p>
      <div class="a-scroll"><table><thead><tr><th>Fahrer</th>${v.strecken.map((s) => `<th class="rechts" title="${esc(s)}">${esc(kurzerStreckenname(s))}</th>`).join("")}<th class="rechts">Schnitt</th><th>Vorschlag</th><th>Nach iRating</th><th>Aktuell</th></tr></thead><tbody>${v.fahrer.map(zeile).join("")}</tbody></table></div>
      <div class="a-leiste"><button type="button" class="a-knopf${offen ? "" : " zweit"}" data-sichtung-uebernehmen="1">${offen ? `Vorschläge übernehmen (${offen} ${offen === 1 ? "Änderung" : "Änderungen"})` : "Vorschläge erneut übernehmen"}</button></div>
      <p class="a-hinweis">Übernommen werden nur Fahrer, die jede Strecke gültig gefahren sind. Alle anderen bleiben nach iRating eingestuft, bis du sie oben in der Spalte „Klasse“ von Hand setzt.</p>
    </section>`;
  }

  function fahrerTab() {
    if (!d.serien.length) return '<section class="a-karte"><p class="a-leer">Leg zuerst eine Serie an.</p></section>';
    const serie = d.serien.find((s) => s.id === serieId);
    const det = d.details;
    const ohneProfil = det.fahrer.filter((f) => !f.custId);
    const abweichend = det.fahrer.filter(abweichung);
    const filter = { alle: det.fahrer, profil: ohneProfil, abweichung: abweichend }[fahrerFilter] || det.fahrer;
    const chips = [["alle", `Alle ${det.fahrer.length}`], ["profil", `Ohne Profil ${ohneProfil.length}`], ["abweichung", `iRating-Abweichung ${abweichend.length}`]].map(([id, t]) => `<button type="button" class="a-filter" data-fahrer-filter="${id}" aria-pressed="${fahrerFilter === id}">${esc(t)}</button>`).join("");
    const kachel = (w, t, art) => `<div class="a-kennzahl ${w && art ? art : ""}"><b>${w}</b><span>${esc(t)}</span></div>`;
    const liste = (r, l) => l.map((f, i) => `<li><span>${i + 1}. ${esc(f.name)}</span>${fahrzeugChip(f.fahrzeugklasse)}<button type="button" class="a-weg" data-aus-rennen="${esc(r.id)}" data-fahrer="${esc(f.discordId)}" data-name="${esc(f.name)}" aria-label="${esc(f.name)} aus dem Rennen nehmen">×</button></li>`).join("");
    const rennen = det.rennen.map((r) => `<details class="a-rennen"><summary>${esc(r.titel)} · ${esc(zeit(r.start))} · ${r.starter.length}/${r.plaetze}${r.warteliste.length ? ` · ${r.warteliste.length} warten` : ""}</summary>
        ${r.starter.length ? `<ol class="a-namen">${liste(r, r.starter)}</ol>` : '<p class="a-hinweis" style="padding:0 12px 10px">Noch niemand gemeldet.</p>'}
        ${r.warteliste.length ? `<h4>Warteliste</h4><ol class="a-namen">${liste(r, r.warteliste)}</ol>` : ""}</details>`).join("");
    return `${akteHtml()}<section class="a-karte"><div class="a-kartenkopf"><h2>Fahrer</h2>${serienAuswahl()}</div>
      <div class="a-kennzahlen">${kachel(det.fahrer.length, "Gemeldet")}${kachel(det.fahrer.filter((f) => f.mitglied).length, "In der Season")}${kachel(det.fahrer.filter((f) => !f.mitglied).length, "Einzelmeldungen")}${kachel(ohneProfil.length, "Ohne Profil", "alarm")}${kachel(abweichend.length, "iRating-Abweichung", "warnung")}</div>
      ${det.fahrer.length ? `<div class="a-leiste">${chips}<input type="search" id="a-fahrer-suche" class="a-suche" placeholder="Fahrer, ID oder Team suchen" aria-label="Fahrer suchen"></div>
      ${filter.length ? `<div class="a-scroll"><table><thead><tr><th>Fahrer</th><th>Meldung</th><th>iRacing-ID</th><th class="rechts" title="Vom Fahrer im Profil angegeben">iRating Profil</th><th class="rechts" title="Aus dem zuletzt eingelesenen Rennergebnis">iRating letztes Rennen</th><th>Klasse</th><th></th></tr></thead><tbody>${filter.map((f) => fahrerZeile(f, serie)).join("")}</tbody></table></div>` : '<p class="a-leer">Keine Fahrer in dieser Ansicht.</p>'}
      <p class="a-hinweis">„iRating Profil“ hat der Fahrer selbst angegeben. „iRating letztes Rennen“ stammt aus dem zuletzt eingelesenen Ergebnis und ist leer, solange kein Ergebnis dieses Fahrers vorliegt. Ein „!“ zeigt mehr als 150 Punkte Unterschied.</p>` : '<p class="a-leer">Noch keine Fahrer gemeldet.</p>'}
    </section>
    ${sichtungKarte(serie, det)}
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
      ${v.sichtung ? '<p class="a-meldung">Das ist ein Sichtungsrennen: Es zählt nicht für die Tabelle. Die Rundenzeiten erscheinen nach dem Veröffentlichen im Reiter „Fahrer“ als Klassenvorschlag.</p>' : ""}
      ${v.ersetzt ? '<p class="a-meldung fehler">Dieses Rennen ist schon eingelesen und würde ersetzt.</p>' : ""}
      ${v.gaeste && v.gaeste.length ? `<p class="a-hinweis">Als Gast ohne Punkte: ${esc(v.gaeste.join(", "))}</p>` : ""}
      ${v.warnungen.length ? `<ul class="a-warnung">${v.warnungen.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      ${fremde}${fehlend}
      ${gruppen}
      <div class="a-leiste">${v.rennen.gewertet ? '<button type="button" class="a-knopf" data-veroeffentlichen="1">Veröffentlichen</button>' : ""}<button type="button" class="a-knopf zweit" data-verwerfen="1">Verwerfen</button></div>
    </section>`;
  }

  function ergebnisTab() {
    if (!d.serien.length) return '<section class="a-karte"><p class="a-leer">Leg zuerst eine Serie an.</p></section>';
    const det = d.details;
    const ergebnisse = det.ergebnisse.map((e) => `<tr><td>${esc(zeit(e.start))}</td><td class="umbruch">${esc([e.strecke, e.variante].filter(Boolean).join(" · "))}</td><td class="rechts">${e.fahrer.length}</td><td>${e.sichtung ? '<span class="a-chip hell" title="Zählt nicht für die Tabelle">Sichtung</span> ' : ""}${e.stand === "vorlaeufig" ? '<span class="a-chip gelb">Vorläufig</span>' : '<span class="a-chip gruen">Endgültig</span>'}${e.verkuerzt ? ' <span class="a-chip rot">Verkürzt</span>' : ""}</td><td class="rechts"><div class="a-leiste a-rechtsbuendig"><button type="button" class="a-knopf zweit klein" data-ergebnis-distanz="${esc(e.id)}" data-wert="${e.verkuerzt ? "" : "1"}">${e.verkuerzt ? "Volle Distanz" : "Unter 75 % Distanz"}</button>${e.stand === "vorlaeufig" ? `<button type="button" class="a-knopf zweit klein" data-ergebnis-endgueltig="${esc(e.id)}">Endgültig freigeben</button>` : ""}<button type="button" class="a-knopf zweit klein" data-bericht-posten="${esc(e.id)}">In Discord posten</button><button type="button" class="a-knopf gefahr klein" data-ergebnis-loeschen="${esc(e.id)}">Löschen</button></div></td></tr>`).join("");
    const strafen = det.strafen.map((s) => {
      const e = det.ergebnisse.find((x) => x.id === s.rennen);
      const wert = s.typ === "zeit" ? `+${s.sekunden} s` : s.typ === "dsq" ? "DSQ" : `−${s.punkte}`;
      const aktion = s.reportId ? '<span class="a-chip">aus Report</span>' : `<button type="button" class="a-knopf gefahr klein" data-strafe-loeschen="${esc(s.id)}">Löschen</button>`;
      return `<tr><td>${esc(s.name)}</td><td class="umbruch">${esc(e ? e.strecke : s.rennen)}</td><td class="rechts">${esc(wert)}</td><td class="umbruch">${esc(s.grund || "")}</td><td class="rechts">${aktion}</td></tr>`;
    }).join("");
    const strafForm = det.ergebnisse.length && (serieVon(serieId) || {}).typ !== "event" ? `<form class="a-felder" id="f-strafe" novalidate>
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
    <section class="a-karte"><h2>Eingelesene Rennen</h2>${ergebnisse ? `<div class="a-scroll"><table><thead><tr><th>Start</th><th>Strecke</th><th class="rechts">Fahrer</th><th>Stand</th><th></th></tr></thead><tbody>${ergebnisse}</tbody></table></div>` : '<p class="a-leer">Noch kein Ergebnis eingelesen.</p>'}</section>
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

  function reportZeile(r) {
    // Im Bereich Reports zählt, was beim Öffnen neu war, sonst der zuletzt gesehene Stand.
    const grenze = tab === "reports" && neuSeit !== null ? neuSeit : gesehenLesen();
    const neu = braucht(r) && String(r.erstellt) > grenze;
    return `<button type="button" class="a-fall ${serienFarbe(r.serie)}${einspruchOffen(r) ? " einspruch" : ""}" data-report="${esc(r.id)}">
      <span class="a-fall-kopf">${neu ? '<span class="a-chip neu">Neu</span>' : ""}${reportChip(r)}<time>${esc(zeit(r.erstellt))}</time></span>
      <b>${esc(r.von.name)} <span>meldet</span> ${esc(r.gegen.name)}</b>
      <small>${esc([r.serieName, r.rennenTitel, r.stelle].filter(Boolean).join(" · "))}</small>
    </button>`;
  }

  function reportListe() {
    const sortiert = [...d.reports].sort((a, b) => String(b.erstellt).localeCompare(String(a.erstellt)));
    const offen = sortiert.filter(braucht).sort((a, b) => Number(einspruchOffen(b)) - Number(einspruchOffen(a)));
    const erledigt = sortiert.filter((r) => !braucht(r));
    const zeilen = erledigt.map((r) => `<tr><td>${esc(zeit(r.erstellt))}</td><td>${esc(r.serieName)}</td><td class="umbruch">${esc(r.rennenTitel)}</td><td class="umbruch">${esc(r.von.name)} → ${esc(r.gegen.name)}</td><td>${reportChip(r)}</td><td class="rechts"><button type="button" class="a-knopf zweit klein" data-report="${esc(r.id)}">Öffnen</button></td></tr>`).join("");
    return `<section class="a-karte ${offen.length ? "a-karte-alarm" : ""}"><div class="a-kartenkopf"><h2>Zu entscheiden</h2><span class="a-chip ${offen.length ? "rot" : "gruen"}">${offen.length} offen</span></div>${offen.length ? `<div class="a-liste">${offen.map(reportZeile).join("")}</div>` : '<p class="a-leer">Alles entschieden, aktuell liegt kein Report vor.</p>'}</section>
      ${erledigt.length ? `<section class="a-karte"><h2>Entschieden</h2><div class="a-scroll"><table><thead><tr><th>Eingang</th><th>Serie</th><th>Rennen</th><th>Melder → Gemeldet</th><th>Status</th><th></th></tr></thead><tbody>${zeilen}</tbody></table></div></section>` : ""}`;
  }

  // Vorlagen aus dem Strafenkatalog. Folgezeilen übernehmen den Namen des Vergehens von der Zeile darüber.
  function katalogVorlagen() {
    let gruppe = "";
    return d.katalog.eintraege.map((k) => { gruppe = k.vergehen || gruppe; return { ...k, gruppe }; }).filter((k) => k.min || k.max);
  }
  // Nur Verwarnung, Sekunden und DQ lassen sich als Urteil abbilden. Alles andere zeigt der Strafrahmen, die Rennleitung wählt selbst.
  function vorlageAus(k) {
    const t = String(k.min || "").toLowerCase();
    const sekunden = /^(\d+)\s*sek/.exec(t);
    if (t.startsWith("verwarn")) return { art: "verwarnung" };
    if (sekunden) return { art: "zeitstrafe", sekunden: Number(sekunden[1]) };
    if (t.startsWith("dq")) return { art: "dsq" };
    return null;
  }
  const strafrahmen = (k) => `Strafrahmen ${k.nr}: ${k.min || "–"}${k.max ? ` bis ${k.max}` : ""}${k.hinweis ? ` · ${k.hinweis}` : ""}${k.kommentar ? ` · ${k.kommentar}` : ""}`;

  function aehnlicheFaelle(vergehen, reportId) {
    const faelle = vergehen ? d.reports.filter((x) => x.id !== reportId && x.urteil && x.urteil.vergehen === vergehen).slice(0, 3) : [];
    const vorlage = vergehen ? katalogVorlagen().find((k) => k.nr === vergehen) : null;
    return `${vorlage ? `<b>${esc(strafrahmen(vorlage))}</b>` : ""}${faelle.length ? `<b>Frühere Fälle dieser Art</b>${faelle.map((x) => `<span>${esc(urteilKurz(x.urteil))} · ${esc(x.gegen.name)} · ${esc(x.rennenTitel)}</span>`).join("")}` : ""}`;
  }

  /* ---------- Strafenkatalog bearbeiten ---------- */
  let katalogEntwurf = null;
  const KATALOG_FELDER = [["nr", "Nr", 7], ["vergehen", "Vergehen", 22], ["erklaerung", "Erklärung", 36], ["min", "Mindeststrafe", 16], ["max", "Höchststrafe", 13], ["hinweis", "Hinweis", 14], ["kommentar", "Kommentar", 20]];

  function katalogAusFormular(f) {
    const zeilen = (attr) => [...f.querySelectorAll(`tr[${attr}]`)].map((z) => Object.fromEntries([...z.querySelectorAll("input")].map((i) => [i.dataset.feld, i.value])));
    return { eintraege: zeilen("data-k-zeile"), strafpunkte: zeilen("data-p-zeile") };
  }

  /* ---------- Reglement bearbeiten ---------- */
  const NR = window.LigaReglementFormat.nummerVergleich;
  let reglementEntwurf = null;
  const reglementAktuell = () => reglementEntwurf || window.LigaReglementFormat.zuBearbeitung(d.reglement || window.LigaReglement);
  const nachNummer = (liste) => liste.sort((a, b) => NR(a.nr, b.nr));

  function reglementAusFormular(f) {
    return {
      titel: f.elements.rg_titel.value, version: f.elements.rg_version.value,
      abschnitte: [...f.querySelectorAll("details[data-rg-haupt]")].map((h) => ({
        offen: h.open,
        nr: h.querySelector("[data-rg='nr']").value, titel: h.querySelector("[data-rg='titel']").value,
        unter: [...h.querySelectorAll("[data-rg-unter]")].map((u) => ({ nr: u.querySelector("[data-rgu='nr']").value, titel: u.querySelector("[data-rgu='titel']").value, text: u.querySelector("textarea").value })),
      })),
    };
  }

  function reglementTab() {
    const r = reglementAktuell();
    const abschnitte = r.abschnitte.map((h, i) => `<details class="a-rennen a-rg" data-rg-haupt="${i}"${h.offen ? " open" : ""}>
      <summary>${esc(h.nr)}. ${esc(h.titel)} <small>${h.unter.length} Punkte</small></summary>
      <div class="a-rg-inhalt">
        <div class="a-rg-kopf"><input data-rg="nr" value="${esc(h.nr)}" aria-label="Nummer des Abschnitts"><input data-rg="titel" value="${esc(h.titel)}" aria-label="Titel des Abschnitts"><button type="button" class="a-knopf gefahr klein" data-rg-weg="${i}">Abschnitt löschen</button></div>
        ${h.unter.map((u, j) => `<div class="a-rg-punkt" data-rg-unter="${j}"><div class="a-rg-kopf"><input data-rgu="nr" value="${esc(u.nr)}" aria-label="Nummer"><input data-rgu="titel" value="${esc(u.titel)}" aria-label="Titel"><button type="button" class="a-knopf gefahr klein" data-rgu-weg="${i}:${j}">Löschen</button></div><textarea rows="${Math.min(14, Math.max(4, u.text.split("\n").length + 1))}" maxlength="20000" aria-label="Text von ${esc(u.nr)}">${esc(u.text)}</textarea></div>`).join("")}
        <div><button type="button" class="a-knopf zweit klein" data-rgu-neu="${i}">Punkt hinzufügen</button></div>
      </div>
    </details>`).join("");
    return `<form id="f-reglement" novalidate><section class="a-karte">
      <div class="a-kartenkopf"><h2>Reglement bearbeiten</h2><div class="a-leiste"><span class="a-chip">Stand ${esc(r.stand || "")}</span><a class="a-knopf zweit klein" href="/regelwerk" target="_blank" rel="noopener">Öffentliche Ansicht</a></div></div>
      <div class="a-felder">${feld("Titel", `<input name="rg_titel" value="${esc(r.titel)}" maxlength="120">`, true)}${feld("Version", `<input name="rg_version" value="${esc(r.version)}" maxlength="20">`)}</div>
      <p class="a-hinweis">Leerzeile = neuer Absatz. <b>**Text**</b> = fett. Zeilen mit „- “ am Anfang = Aufzählung. Zeilen wie „| A | B |“ = Tabelle. Änderst du eine Nummer, rutscht der Punkt automatisch an die richtige Stelle. Der Stand wird beim Speichern gesetzt.</p>
      ${abschnitte}
      <div class="a-leiste"><button type="button" class="a-knopf zweit klein" data-rg-neu="1">Abschnitt hinzufügen</button><button type="submit" class="a-knopf">Reglement speichern</button></div>
    </section></form>`;
  }

  function katalogTab() {
    const k = katalogEntwurf || d.katalog;
    const zelle = (feld, wert, breite, art) => `<td><input data-feld="${feld}" value="${esc(wert ?? "")}" size="${breite}"${art ? ` type="${art}" min="0"` : ""} aria-label="${esc(feld)}"></td>`;
    const zeilen = k.eintraege.map((x, i) => `<tr data-k-zeile="${i}">${KATALOG_FELDER.map(([f, , b]) => zelle(f, x[f], b)).join("")}<td><button type="button" class="a-weg" data-k-weg="${i}" aria-label="Eintrag ${esc(x.nr)} entfernen">×</button></td></tr>`).join("");
    const punkte = k.strafpunkte.map((x, i) => `<tr data-p-zeile="${i}">${zelle("strafe", x.strafe, 20)}${zelle("punkte", x.punkte, 5, "number")}<td><button type="button" class="a-weg" data-p-weg="${i}" aria-label="Strafe entfernen">×</button></td></tr>`).join("");
    return `<form id="f-katalog" novalidate>
      <section class="a-karte"><div class="a-kartenkopf"><h2>Vergehen und Strafrahmen</h2><div class="a-leiste"><span class="a-chip">Stand ${esc(datumKurz(k.stand || d.katalog.stand))}</span><a class="a-knopf zweit klein" href="/regelwerk?teil=strafen" target="_blank" rel="noopener">Öffentliche Ansicht</a></div></div>
        <p class="a-hinweis">Änderungen erscheinen sofort im Regelwerk und in den Vorlagen bei Urteilen. Bereits gesprochene Urteile bleiben unverändert. Bleibt „Vergehen“ leer, gehört die Zeile zum Vergehen darüber.</p>
        <div class="a-scroll a-katalog"><table><thead><tr>${KATALOG_FELDER.map(([, t]) => `<th>${t}</th>`).join("")}<th></th></tr></thead><tbody>${zeilen}</tbody></table></div>
        <div class="a-leiste"><button type="button" class="a-knopf zweit klein" data-k-neu="1">Zeile hinzufügen</button></div>
      </section>
      <section class="a-karte"><h2>Strafpunkte je Strafe</h2>
        <div class="a-scroll a-katalog a-katalog-klein"><table><thead><tr><th>Strafe</th><th>Punkte</th><th></th></tr></thead><tbody>${punkte}</tbody></table></div>
        <div class="a-leiste"><button type="button" class="a-knopf zweit klein" data-p-neu="1">Strafe hinzufügen</button><button type="submit" class="a-knopf">Strafenkatalog speichern</button></div>
      </section>
    </form>`;
  }

  // Bei Events zählt nur die Platzierung, dort gibt es keine Strafpunkte.
  const urteileFuer = (r) => URTEILE.filter(([a]) => a !== "strafpunkte" || (serieVon(r.serie) || {}).typ !== "event");

  // Stimmen der Stewards. Solange man nicht selbst abgestimmt hat, bleiben die anderen verborgen.
  function abstimmung(r) {
    if (r.ichBeteiligt) return "";
    const s = r.stimmen;
    const stimmeText = (x) => [(URTEILE.find(([a]) => a === x.art) || [])[1], x.punkte ? `${x.punkte} Punkte` : "", x.sekunden ? `${x.sekunden} s` : ""].filter(Boolean).join(", ");
    const liste = s.liste ? `<ul class="a-stimmen">${s.liste.map((x) => `<li><b>${esc(x.name)}</b><span>${esc(stimmeText(x))}</span>${x.notiz ? `<small>${esc(x.notiz)}</small>` : ""}</li>`).join("")}</ul>` : `<p class="a-hinweis">${s.anzahl ? "Die anderen Stimmen siehst du, sobald du selbst abgestimmt hast." : "Noch keine Stimme abgegeben."}</p>`;
    const ergebnis = s.mehrheit ? `<p class="a-meldung">Mehrheit: ${esc(stimmeText(s.mehrheit))} (${s.mehrheit.anzahl} Stimmen). Die Entscheidung unten ist damit vorbelegt.</p>` : "";
    const e = s.eigene || {};
    const form = r.urteil ? "" : `<form id="f-stimme" class="a-felder" novalidate>
        ${feld("Deine Stimme", `<select name="art">${urteileFuer(r).map(([v, t]) => `<option value="${v}"${v === (e.art || "kein-vergehen") ? " selected" : ""}>${t}</option>`).join("")}</select>`)}
        ${feld("Punkte oder Sekunden", `<input name="wert" type="number" min="1" value="${esc(e.punkte ?? e.sekunden ?? "")}">`)}
        ${feld("Kurze Notiz", `<input name="notiz" maxlength="300" value="${esc(e.notiz || "")}">`, true)}
        <div><button type="submit" class="a-knopf zweit klein">${s.eigene ? "Stimme ändern" : "Stimme abgeben"}</button></div>
      </form>`;
    return `<section class="a-karte"><div class="a-kartenkopf"><h2>Abstimmung</h2><span class="a-chip${s.anzahl >= s.noetig ? " gruen" : ""}">${s.anzahl} von ${s.noetig} Stimmen</span></div>${liste}${ergebnis}${form}</section>`;
  }

  function rennKontextHtml(r) {
    const k = r.kontext;
    if (!k || (!k.von && !k.gegen)) return "";
    const zeile = (rolle, f) => (f ? `<tr><td>${esc(rolle)}</td><td class="umbruch">${esc(f.name)}</td><td class="rechts">${f.start ?? "–"}</td><td class="rechts">${f.ziel}</td><td class="rechts">${f.runden}</td><td class="rechts">${f.incidents}</td></tr>` : "");
    return `<div class="a-scroll"><table><thead><tr><th></th><th>Fahrer</th><th class="rechts">Start</th><th class="rechts">Ziel</th><th class="rechts">Runden</th><th class="rechts">Incidents</th></tr></thead><tbody>${zeile("Melder", k.von)}${zeile("Gemeldet", k.gegen)}</tbody></table></div>`;
  }

  function urteilForm(r) {
    if (r.ichBeteiligt) return '<p class="a-meldung fehler">Du bist an diesem Vorfall beteiligt. Die Entscheidung muss jemand anderes aus dem League Team treffen.</p>';
    const m = r.urteil ? null : r.stimmen.mehrheit;
    const u = r.urteil || (m ? { art: m.art, punkte: m.punkte, sekunden: m.sekunden } : {});
    const art = u.art || "kein-vergehen";
    const det = d.details && d.details.serie === r.serie ? d.details : { ergebnisse: [] };
    const naechstes = u.rennen ? det.ergebnisse.find((e) => e.id === u.rennen) : [...det.ergebnisse].sort((a, b) => Math.abs(new Date(a.start) - new Date(r.start)) - Math.abs(new Date(b.start) - new Date(r.start)))[0];
    const strafend = art === "strafpunkte" || art === "zeitstrafe" || art === "dsq";
    return `<form id="f-urteil" class="a-karte" novalidate>
      <h2>${einspruchOffen(r) ? "Einspruch entscheiden" : r.urteil ? "Urteil ändern" : "Entscheidung"}</h2>
      ${einspruchOffen(r) ? '<p class="a-hinweis">Nach dieser Entscheidung ist der Fall endgültig. Soll das Urteil bestehen bleiben, speichere es unverändert.</p>' : ""}
      <div class="a-felder">
        ${feld("Vorlage aus dem Strafkatalog", `<select name="vergehen" id="u-katalog"><option value="">Keine Vorlage</option>${katalogVorlagen().map((k) => `<option value="${esc(k.nr)}"${k.nr === u.vergehen ? " selected" : ""}>${esc(`${k.nr} ${k.gruppe}: ${k.erklaerung}`)}</option>`).join("")}</select>`, true)}
        <div class="a-aehnlich breit" id="u-aehnlich">${aehnlicheFaelle(u.vergehen, r.id)}</div>
        ${feld("Entscheidung", `<select name="art" id="u-art">${urteileFuer(r).map(([v, t]) => `<option value="${v}"${v === art ? " selected" : ""}>${t}</option>`).join("")}</select>`)}
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
    const entwurf = notizEntwurf && notizEntwurf.id === r.id ? notizEntwurf : null;
    const clip =r.clip ? `<p><a href="${esc(r.clip)}" target="_blank" rel="noopener noreferrer">Clip ansehen ↗</a></p>` : "";
    const einsprueche = r.einsprueche.map((e) => `<div class="a-einspruch"><b>Einspruch von ${esc(e.name)} · ${esc(zeit(e.zeit))}</b><p>${esc(e.text)}</p></div>`).join("");
    const urteil = r.urteil ? `<p class="a-hinweis">Aktuelles Urteil: ${esc(urteilKurz(r.urteil))} · von ${esc(r.urteil.von)} · ${esc(zeit(r.urteil.zeit))}</p>` : "";
    const status = !r.urteil && !r.ichBeteiligt ? `<button type="button" class="a-knopf zweit klein" data-report-status="${r.status === "pruefung" ? "offen" : "pruefung"}">${r.status === "pruefung" ? "Zurück auf offen" : "In Prüfung nehmen"}</button>` : "";
    const notizen = r.ichBeteiligt ? "" : `<form id="f-notiz" class="a-karte" novalidate><h2>Interne Notizen</h2><textarea name="notizen" maxlength="5000" aria-label="Interne Notizen">${esc(entwurf ? entwurf.text : r.notizen)}</textarea>${entwurf && entwurf.konflikt ? `<p class="a-hinweis">Neuer Stand von jemand anderem:</p><pre class="a-notiz-stand">${esc(r.notizen || "(leer)")}</pre>` : ""}<div><button type="submit" class="a-knopf zweit">Notizen speichern</button></div></form>`;
    return `<section class="a-karte"><div class="a-kartenkopf"><div class="a-leiste"><button type="button" class="a-knopf zweit klein" data-report-zurueck="1">Zurück</button><h2>${esc(r.rennenTitel)}</h2>${reportChip(r)}</div>${status}</div>
      <p class="a-hinweis">${esc(r.serieName)} · Eingang ${esc(zeit(r.erstellt))}</p>
      <p><b>${esc(r.von.name)}</b> meldet <b>${esc(r.gegen.name)}</b> · ${esc(r.stelle)}</p>
      <div class="a-leiste"><span class="a-beschriftung">Akte</span>${akteKnopf(r.von.name, r.von.cust, r.von.discordId).replace(">Akte<", `>${esc(r.von.name)}<`)}${akteKnopf(r.gegen.name, r.gegen.cust, r.gegen.discordId).replace(">Akte<", `>${esc(r.gegen.name)}<`)}</div>
      <p class="a-text">${esc(r.beschreibung)}</p>${clip}${rennKontextHtml(r)}${urteil}${einsprueche}</section>
      ${abstimmung(r)}${urteilForm(r)}${notizen}`;
  }

  function reportsTab() {
    const r = reportId && d.reports.find((x) => x.id === reportId);
    return r ? reportDetail(r) : reportListe();
  }

  /* ---------- Seite ---------- */
  function zeigeLogin() {
    const fehler = FEHLER[new URLSearchParams(location.search).get("fehler")];
    app.innerHTML = `<main class="a-login"><div class="a-login-karte"><img class="a-login-logo" src="img/brand/dsrs-logo.png" alt="Darkline Simracing Series" width="654" height="165"><h1><span>Rennleitung</span></h1><p>Zugang nur mit der Discord-Rolle der Rennleitung.</p>${fehler ? `<p class="a-meldung fehler" role="alert">${esc(fehler)}</p>` : ""}<a class="a-knopf" href="/api/discord-login?ziel=liga-admin">Mit Discord anmelden</a></div></main>`;
  }

  /* ---------- Hinweis auf neue Reports ---------- */
  const GESEHEN = "dsrs-reports-gesehen";
  const gesehenLesen = () => { try { return localStorage.getItem(GESEHEN) || ""; } catch (e) { return ""; } };
  const gesehenSetzen = (w) => { try { localStorage.setItem(GESEHEN, w); } catch (e) { /* ohne Speicher zählt nur die Anzeige dieser Sitzung */ } };

  function reportsAlsGesehen() {
    neuSeit = gesehenLesen();
    const neuester = d.reports.map((r) => String(r.erstellt)).sort().pop();
    if (neuester) gesehenSetzen(neuester);
  }

  function alarmHtml() {
    const offene = d.reports.filter(braucht).length;
    if (!offene || (tab === "reports" && !reportId)) return '<div id="a-alarm" hidden></div>';
    const einsprueche = d.reports.filter(einspruchOffen).length;
    const neu = tab === "reports" ? 0 : d.reports.filter((r) => braucht(r) && String(r.erstellt) > gesehenLesen()).length;
    const teile = [`${offene} ${offene === 1 ? "offener Report" : "offene Reports"}`, einsprueche ? `${einsprueche} ${einsprueche === 1 ? "Einspruch" : "Einsprüche"}` : "", neu ? `${neu} neu` : ""].filter(Boolean).join(" · ");
    return `<div id="a-alarm" class="a-alarm${neu ? " neu" : ""}" role="status"><i aria-hidden="true"></i><span>${esc(teile)}</span><button type="button" class="a-knopf klein" data-tab="reports">Jetzt ansehen</button></div>`;
  }

  // Ändert nur Hinweis, Zähler und Fenstertitel, damit nichts in einem offenen Formular verloren geht.
  function alarmAktualisieren() {
    const offene = d.reports.filter(braucht).length;
    document.title = `${offene ? `(${offene}) ` : ""}Rennleitung · Darkline Simracing Series`;
    const platz = document.getElementById("a-alarm");
    if (platz) platz.outerHTML = alarmHtml();
    const zaehler = document.getElementById("a-zaehler");
    if (zaehler) { zaehler.textContent = offene; zaehler.hidden = !offene; }
  }

  let reportStand = null;
  let reportsGeprueft = 0;
  async function reportsPruefen() {
    if (document.hidden || !d || !d.angemeldet || beschaeftigt || Date.now() - reportsGeprueft < 60000) return;
    reportsGeprueft = Date.now();
    const a = await fetch(`${API}&nur=stand`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!a || !a.angemeldet) return;
    const geaendert = reportStand !== null && a.stand !== reportStand;
    reportStand = a.stand;
    if (!geaendert) return;
    await lade().catch(() => {});
    const offenesFormular = form || planer || reportId;
    if (!offenesFormular && (tab === "cockpit" || tab === "reports")) { if (tab === "reports") reportsAlsGesehen(); zeichne(); } else alarmAktualisieren();
  }

  /* ---------- Rahmen ---------- */
  function zeichne() {
    if (!d || !d.angemeldet) return zeigeLogin();
    const inhalte = { reglement: reglementTab, katalog: katalogTab, protokoll: protokollTab, cockpit: cockpitTab, serien: serienTab, rennen: rennenTab, strecken: streckenTab, fahrer: fahrerTab, reports: reportsTab, ergebnisse: ergebnisTab };
    const inhalt = inhalte[tab]();
    const offene = d.reports.filter(braucht).length;
    app.innerHTML = `<div class="a-rahmen">
      <aside class="a-seite">
        <a class="a-marke" href="/liga"><img src="img/brand/dsrs-logo.png" alt="Darkline Simracing Series" width="654" height="165"><span>Rennleitung</span></a>
        <nav class="a-nav" aria-label="Bereiche">${TABS.map(([id, t]) => `<button type="button" data-tab="${id}"${tab === id ? ' aria-current="page"' : ""}>${t}${id === "reports" ? `<em id="a-zaehler"${offene ? "" : " hidden"}>${offene}</em>` : ""}</button>`).join("")}</nav>
        <div class="a-nutzer"><b>${esc(d.name)}</b><a href="/liga">Zur Liga</a><a href="/fahrerbereich">Fahrerbereich</a><button type="button" id="a-logout">Ausloggen</button></div>
      </aside>
      <main class="a-inhalt">${alarmHtml()}${meldung ? `<p class="a-meldung${meldung.fehler ? " fehler" : ""}" role="status">${esc(meldung.text)}</p>` : ""}${inhalt}</main>
    </div>`;
    document.title = `${offene ? `(${offene}) ` : ""}Rennleitung · Darkline Simracing Series`;
    klassenKontrolle();
  }

  // Öffnet ein Formular oder den Planer und bringt es in den sichtbaren Bereich.
  function zeigeFormular() {
    zeichne();
    const f = app.querySelector(".a-form");
    if (f) f.scrollIntoView({ block: "start" });
  }

  const werte = (f) => Object.fromEntries(new FormData(f).entries());

  app.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.id === "a-logout") { await sende({ aktion: "logout" }); d = { angemeldet: false }; return zeichne(); }
    if (b.dataset.discordTest) {
      const a = await aktion({ aktion: "discord-test" }, "");
      if (a && a.discord) {
        const text = { ok: "gesendet", fehlt: "nicht eingerichtet", fehler: "abgelehnt, Webhook prüfen" };
        setzeMeldung(`Discord-Test: ${a.discord.map((x) => `${x.kanal} ${text[x.stand]}`).join(" · ")}`, a.discord.some((x) => x.stand !== "ok"));
        zeichne();
      }
      return;
    }
    if (b.dataset.akte) return akteOeffnen(b);
    if (b.dataset.fahrerFilter) { fahrerFilter = b.dataset.fahrerFilter; return zeichne(); }
    if (b.dataset.akteZu) { akte = null; return zeichne(); }
    if (b.dataset.akteBearbeiten) { akte.bearbeiten = b.dataset.akteBearbeiten === "auf"; akte.werte = null; setzeMeldung(""); return zeichne(); }
    if (b.dataset.ergebnisImport) {
      serieId = b.dataset.ergebnisImport; tab = "ergebnisse"; form = null; vorschau = null; datei = null; zugelassen = []; setzeMeldung("");
      await lade().catch(() => setzeMeldung("Die Daten konnten nicht geladen werden.", true));
      zeichne();
      return window.scrollTo(0, 0);
    }
    if (b.dataset.rennenSchieben) {
      const eingabe = window.prompt(`„${b.dataset.titel}“ verschieben: um wie viele Tage? Negative Zahl für früher.`, "7");
      if (eingabe === null) return;
      const folgende = window.confirm("Auch alle folgenden Rennen dieser Serie um dieselbe Anzahl Tage verschieben?\n\nOK = alle folgenden, Abbrechen = nur dieses Rennen.");
      return aktion({ aktion: "rennen-verschieben", id: b.dataset.rennenSchieben, tage: Number(eingabe), folgende }, folgende ? "Rennen verschoben, die folgenden Termine sind mitgewandert." : "Rennen verschoben.");
    }
    if (b.dataset.rennenKopie) return aktion({ aktion: "rennen-duplizieren", id: b.dataset.rennenKopie }, "Rennen dupliziert, eine Woche später. Bitte Titel und Termin prüfen.");
    if (b.dataset.passwortAlle) {
      const passwort = window.prompt("Session-Passwort für alle kommenden Rennen dieser Serie. Leer lassen löscht es.");
      if (passwort === null) return;
      return aktion({ aktion: "passwort-setzen", serie: b.dataset.passwortAlle, passwort }, "Passwort für alle kommenden Rennen gesetzt.");
    }
    if (b.dataset.nummerAktion) {
      const ablehnen = b.dataset.nummerAktion === "nummer-ablehnen";
      const grund = ablehnen ? window.prompt("Grund für die Ablehnung (freiwillig). Der Fahrer bekommt ihn zu sehen.", "") : "";
      if (grund === null) return;
      return aktion({ aktion: b.dataset.nummerAktion, discordId: b.dataset.discord, name: b.dataset.name, nummer: b.dataset.nummer, grund }, ablehnen ? "Antrag abgelehnt, der Fahrer wird informiert." : `Startnummer #${b.dataset.nummer} bestätigt, der Fahrer wird informiert.`);
    }
    if (b.dataset.tab) { tab = b.dataset.tab; protokoll = null; form = null; planer = null; reportId = null; akte = null; setzeMeldung(""); if (tab === "reports") reportsAlsGesehen(); zeichne(); return window.scrollTo(0, 0); }
    if (b.dataset.report) {
      const r = d.reports.find((x) => x.id === b.dataset.report);
      tab = "reports"; reportId = r.id; setzeMeldung("");
      // Für die Strafe werden die Ergebnisse der passenden Serie gebraucht.
      if (serieId !== r.serie) { serieId = r.serie; await lade().catch(() => setzeMeldung("Die Daten konnten nicht geladen werden.", true)); }
      return zeichne();
    }
    if (b.dataset.reportZurueck) { reportId = null; setzeMeldung(""); return zeichne(); }
    if (b.dataset.reportStatus) return aktion({ aktion: "report-status", id: reportId, status: b.dataset.reportStatus }, "Status geändert.");
    if (b.dataset.abbrechen) { form = null; planer = null; return zeichne(); }
    if (b.dataset.serienReiter) { serienReiter = b.dataset.serienReiter; form = null; setzeMeldung(""); return zeichne(); }
    if (b.dataset.serieNeu) { form = { art: "serie", id: null, werte: b.dataset.serieNeu === "event" ? { ...NEUE_SERIE, typ: "event", rennenGesamt: 1, gewerteteRennen: 1 } : NEUE_SERIE }; planer = null; return zeigeFormular(); }
    if (b.dataset.terminNeu) { const s = serieVon(b.dataset.terminNeu); rennenFilter = s.id; tab = "rennen"; planer = null; form = { art: "rennen", id: null, werte: { ...NEUES_RENNEN, serie: s.id, titel: s.name, briefing: s.briefingVorlage || "" } }; return zeigeFormular(); }
    if (b.dataset.serieOeffnen) {
      const { id, bildVersion: bild, ...s } = serieVon(b.dataset.serieOeffnen);
      return aktion({ aktion: "serie-speichern", id, serie: { ...s, status: "anmeldung", anmeldungOffen: true }, vorher: serieVon(id) }, "Anmeldung geöffnet.");
    }
    if (b.dataset.serieBearbeiten) {
      const s = serieVon(b.dataset.serieBearbeiten);
      form = { art: "serie", id: s.id, werte: s, vorher: kopie(s) };
      planer = null;
      tab = "serien";
      serienReiter = s.status === "beendet" ? "archiv" : s.typ === "event" ? "event" : "liga";
      return zeigeFormular();
    }
    if (b.dataset.serieKopie) {
      // Neue Saison: Regeln und Klassen bleiben, Status und Bild beginnen neu.
      const { id, bildVersion: bild, ...s } = serieVon(b.dataset.serieKopie);
      const saison = /\d+/.test(s.saison || "") ? s.saison.replace(/\d+/, (n) => Number(n) + 1) : "";
      form = { art: "serie", id: null, werte: { ...s, name: saison ? `${s.name} ${saison}` : `${s.name} Neu`, saison, status: "geplant", anmeldungOffen: true } };
      serienReiter = s.typ === "event" ? "event" : "liga";
      planer = null;
      return zeigeFormular();
    }
    if (b.dataset.planer) { planer = neuerPlaner(b.dataset.planer); tab = "rennen"; form = null; return zeigeFormular(); }
    if (b.dataset.rennenFilter) { rennenFilter = b.dataset.rennenFilter; return zeichne(); }
    if (b.dataset.punkteVorlage) { app.querySelector('#f-serie [name="punkte"]').value = PUNKTE_VORLAGEN[Number(b.dataset.punkteVorlage)][1].join(", "); return; }
    if (b.dataset.rgNeu || b.dataset.rgWeg || b.dataset.rguNeu || b.dataset.rguWeg) {
      const stand = reglementAktuell().stand;
      reglementEntwurf = { ...reglementAusFormular(b.form), stand };
      const liste = reglementEntwurf.abschnitte;
      if (b.dataset.rgNeu) liste.push({ nr: String(Math.max(0, ...liste.map((h) => Number(h.nr) || 0)) + 1), titel: "Neuer Abschnitt", offen: true, unter: [] });
      if (b.dataset.rgWeg) { if (!window.confirm("Diesen Abschnitt mit allen Punkten löschen?")) return; liste.splice(Number(b.dataset.rgWeg), 1); }
      if (b.dataset.rguNeu) { const h = liste[Number(b.dataset.rguNeu)]; h.unter.push({ nr: `${h.nr}.${h.unter.length + 1}`, titel: "Neuer Punkt", text: "" }); }
      if (b.dataset.rguWeg) { const [i, j] = b.dataset.rguWeg.split(":").map(Number); if (!window.confirm("Diesen Punkt löschen?")) return; liste[i].unter.splice(j, 1); }
      return zeichne();
    }
    if (b.dataset.kNeu || b.dataset.kWeg || b.dataset.pNeu || b.dataset.pWeg) {
      // Eingaben zuerst übernehmen, sonst gingen sie beim Neuzeichnen verloren.
      katalogEntwurf = { ...katalogAusFormular(b.form), stand: d.katalog.stand };
      if (b.dataset.kNeu) katalogEntwurf.eintraege.push({ nr: "", vergehen: "", erklaerung: "", min: "", max: "", hinweis: "", kommentar: "" });
      if (b.dataset.kWeg) katalogEntwurf.eintraege.splice(Number(b.dataset.kWeg), 1);
      if (b.dataset.pNeu) katalogEntwurf.strafpunkte.push({ strafe: "", punkte: 0 });
      if (b.dataset.pWeg) katalogEntwurf.strafpunkte.splice(Number(b.dataset.pWeg), 1);
      return zeichne();
    }
    if (b.dataset.karteErzeugen) return karteErzeugen(b.dataset.karteErzeugen);
    if (b.dataset.streckenFilter) {
      streckenFilter = b.dataset.streckenFilter;
      streckenAlle = false;
      app.querySelectorAll("[data-strecken-filter]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.streckenFilter === streckenFilter)));
      return streckenListeNeu();
    }
    if (b.dataset.streckenAlle) { streckenAlle = true; return streckenListeNeu(); }
    if (b.dataset.streckenImport) {
      setzeMeldung("Streckenliste wird aus Garage 61 geladen …");
      zeichne();
      const a = await sende({ aktion: "strecken-import" });
      if (a) setzeMeldung(`${a.gelesen} Strecken aus Garage 61 gelesen, davon ${a.neu} neu in der Bibliothek.`);
      await lade().catch(() => {});
      return zeichne();
    }
    if (b.dataset.streckeNeu) { form = { art: "strecke", id: null, werte: { name: "", variante: "", land: "", laengeKm: "", kurven: "", notiz: "" } }; return zeigeFormular(); }
    if (b.dataset.streckeBearbeiten) { const st = d.strecken.find((s) => s.id === b.dataset.streckeBearbeiten); form = { art: "strecke", id: b.dataset.streckeBearbeiten, werte: st, vorher: kopie(st) }; return zeigeFormular(); }
    if (b.dataset.streckeLoeschen && window.confirm("Diese Strecke wirklich löschen? Geplante Rennen behalten den Namen, die Karte entfällt.")) return aktion({ aktion: "strecke-loeschen", id: form.id }, "Strecke gelöscht.");
    if (b.dataset.rennenNeu) {
      const serie = rennenFilter === "alle" ? "" : rennenFilter;
      form = { art: "rennen", id: null, werte: { ...NEUES_RENNEN, serie, briefing: (serieVon(serie || serieId) || {}).briefingVorlage || "" } };
      planer = null;
      return zeigeFormular();
    }
    if (b.dataset.rennenBearbeiten) { const re = d.rennen.find((r) => r.id === b.dataset.rennenBearbeiten); form = { art: "rennen", id: b.dataset.rennenBearbeiten, werte: re, vorher: kopie(re) }; planer = null; tab = "rennen"; return zeigeFormular(); }
    if (b.dataset.rennenWeg && window.confirm(`„${b.dataset.titel}“ wirklich löschen? Anmeldungen zu diesem Rennen werden mit gelöscht, eingelesene Ergebnisse bleiben erhalten.`)) return aktion({ aktion: "rennen-loeschen", id: b.dataset.rennenWeg }, "Rennen gelöscht.");
    if (b.dataset.klasseNeu) { document.getElementById("a-klassen").insertAdjacentHTML("beforeend", klasseZeile({ name: "", min: "", max: "" })); return klassenKontrolle(); }
    if (b.dataset.klasseWeg) { b.closest(".a-klasse").remove(); return klassenKontrolle(); }
    if (b.dataset.bildWeg && window.confirm("Dieses Bild wirklich entfernen?")) return bildEntfernen(b.dataset.bildWeg);
    if (b.dataset.serieLoeschen) {
      const s = serieVon(form.id);
      if (s.status !== "beendet") {
        if (window.confirm("Diese Serie wirklich löschen?")) return aktion({ aktion: "serie-loeschen", id: form.id }, "Serie gelöscht.");
        return;
      }
      const eingabe = window.prompt(`„${s.name}“ endgültig löschen, mit allen Rennen, Meldungen, Ergebnissen, Strafen und Reports? Das lässt sich nicht rückgängig machen.\n\nZum Bestätigen den Namen der Serie eintippen:`);
      if (eingabe !== null) return aktion({ aktion: "serie-loeschen", id: form.id, bestaetigung: eingabe.trim() }, "Serie gelöscht.");
      return;
    }
    if (b.dataset.rennenLoeschen && window.confirm("Dieses Rennen wirklich löschen? Anmeldungen zu diesem Rennen werden mit gelöscht, eingelesene Ergebnisse bleiben erhalten.")) return aktion({ aktion: "rennen-loeschen", id: form.id }, "Rennen gelöscht.");
    if (b.dataset.ausSerie && window.confirm(`${b.dataset.name} aus der Serie und ihren Rennen entfernen?`)) return aktion({ aktion: "fahrer-aus-serie", serie: serieId, discordId: b.dataset.ausSerie }, "Fahrer entfernt.");
    if (b.dataset.ausRennen && window.confirm(`${b.dataset.name} aus diesem Rennen nehmen?`)) return aktion({ aktion: "fahrer-aus-rennen", rennen: b.dataset.ausRennen, discordId: b.dataset.fahrer }, "Fahrer aus dem Rennen genommen.");
    if (b.dataset.verwerfen) { vorschau = null; datei = null; zugelassen = []; return zeichne(); }
    if (b.dataset.veroeffentlichen) {
      const a = await aktion({ aktion: "ergebnis-veroeffentlichen", serie: serieId, datei, zugelassen }, "Ergebnis veröffentlicht, die Tabelle ist aktualisiert.");
      if (!a) return;
      vorschau = null; datei = null; zugelassen = [];
      if (a.berichtOffen) {
        const gepostet = await rennberichtPosten(serieId, a.ergebnisId);
        setzeMeldung(gepostet ? "Ergebnis veröffentlicht, Rennbericht im Discord gepostet." : `Ergebnis veröffentlicht. Der Rennbericht konnte nicht gepostet werden: ${(meldung && meldung.text) || "Discord hat nicht geantwortet."}`, !gepostet);
      }
      return zeichne();
    }
    if (b.dataset.berichtPosten) {
      if (!window.confirm("Rennbericht in den Discord-Kanal der Liga posten?")) return;
      const gepostet = await rennberichtPosten(serieId, b.dataset.berichtPosten);
      if (gepostet) setzeMeldung("Rennbericht im Discord gepostet.");
      return zeichne();
    }
    if (b.dataset.ergebnisDistanz) {
      const verkuerzt = !!b.dataset.wert;
      if (!window.confirm(verkuerzt ? "Dieses Rennen als verkürzt werten? Es gibt dann nur noch anteilige Platzpunkte, die Tabelle wird neu berechnet." : "Wieder volle Punkte für dieses Rennen vergeben?")) return;
      return aktion({ aktion: "ergebnis-distanz", serie: serieId, id: b.dataset.ergebnisDistanz, verkuerzt }, "Renndistanz geändert, die Tabelle ist aktualisiert.");
    }
    if (b.dataset.sichtungUebernehmen) {
      if (!window.confirm("Alle Fahrer mit Sichtungszeit bekommen die vorgeschlagene Klasse. Von Hand gesetzte Klassen dieser Fahrer werden überschrieben. Fortfahren?")) return;
      return aktion({ aktion: "sichtung-uebernehmen", serie: serieId }, "Klassen aus der Sichtung übernommen, die Tabelle ist aktualisiert.");
    }
    if (b.dataset.ergebnisEndgueltig) {
      if (!window.confirm("Ergebnis jetzt endgültig freigeben? Sonst geschieht das automatisch 72 Stunden nach Rennende.")) return;
      return aktion({ aktion: "ergebnis-endgueltig", serie: serieId, id: b.dataset.ergebnisEndgueltig }, "Ergebnis ist endgültig.");
    }
    if (b.dataset.pruefungErledigt) return aktion({ aktion: "pruefung-erledigt", serie: b.dataset.serie, id: b.dataset.pruefungErledigt }, "Als erledigt markiert.");
    if (b.dataset.ergebnisLoeschen && window.confirm("Dieses Ergebnis wirklich löschen? Die Tabelle wird neu berechnet.")) return aktion({ aktion: "ergebnis-loeschen", serie: serieId, id: b.dataset.ergebnisLoeschen }, "Ergebnis gelöscht.");
    if (b.dataset.strafeLoeschen && window.confirm("Diese Strafe wirklich löschen?")) return aktion({ aktion: "strafe-loeschen", serie: serieId, id: b.dataset.strafeLoeschen }, "Strafe gelöscht.");
  });

  app.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const w = werte(f);
    if (f.id === "f-akte-profil") {
      const { bildEntfernen, ...profil } = w;
      akte.werte = profil; // Bei einem Fehler bleibt alles Eingetippte stehen.
      const stand = akte;
      const a = await aktion({ aktion: "profil-bearbeiten", discordId: stand.discord, profil, bildEntfernen: !!bildEntfernen }, "Profil gespeichert.");
      if (a) { const hinweis = meldung; await akteLaden(profil.iracingName, a.custId, stand.discord); meldung = hinweis; zeichne(); }
      return;
    }
    if (f.id === "f-notiz") {
      notizEntwurf = { id: reportId, text: w.notizen };
      return aktion({ aktion: "report-notiz", id: reportId, notizen: w.notizen, notizenVorher: ((d.reports || []).find((r) => r.id === reportId) || {}).notizen || "" }, "Notizen gespeichert.");
    }
    if (f.id === "f-reglement") {
      const reglement = reglementAusFormular(f);
      reglementEntwurf = { ...reglement, stand: reglementAktuell().stand };
      const a = await aktion({ aktion: "reglement-speichern", reglement }, "Reglement gespeichert.");
      if (a) { reglementEntwurf = null; zeichne(); }
      return;
    }
    if (f.id === "f-katalog") {
      const katalog = katalogAusFormular(f);
      katalogEntwurf = { ...katalog, stand: d.katalog.stand };
      const a = await aktion({ aktion: "katalog-speichern", katalog }, "Strafenkatalog gespeichert.");
      if (a) { katalogEntwurf = null; zeichne(); }
      return;
    }
    if (f.id === "f-stimme") {
      const wert = Number(w.wert) || undefined;
      return aktion({ aktion: "report-stimme", id: reportId, stimme: { art: w.art, notiz: w.notiz, punkte: w.art === "strafpunkte" ? wert : undefined, sekunden: w.art === "zeitstrafe" ? wert : undefined } }, "Stimme gespeichert.");
    }
    if (f.id === "f-urteil") {
      const offen = d.reports.find((x) => x.id === reportId);
      if (offen && !offen.urteil && !offen.stimmen.mehrheit && !window.confirm("Es gibt noch keine Mehrheit der Stewards. Trotzdem entscheiden?")) return;
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
      w.ohneKlassen = f.elements.ohneKlassen.checked;
      // Eingaben merken, damit sie bei einem Fehler im Formular stehen bleiben
      form.werte = { ...w, punkte: String(w.punkte).split(/[\s,;]+/).filter(Boolean), fahrzeugklassen: String(w.fahrzeugklassen).split(",").map((x) => x.trim()).filter(Boolean) };
      // Nach dem Speichern steht man im Reiter, in den die Serie jetzt gehört.
      if (await aktion({ aktion: "serie-speichern", id: form.id, serie: w, vorher: form.vorher }, w.typ === "event" ? "Event gespeichert." : "Season gespeichert.")) { serienReiter = w.status === "beendet" ? "archiv" : w.typ === "event" ? "event" : "liga"; zeichne(); }
    } else if (f.id === "f-rennen") {
      w.sichtung = f.elements.sichtung.checked;
      form.werte = w;
      aktion({ aktion: "rennen-speichern", id: form.id, rennen: { ...w, streckeId: (streckeAus(w.strecke) || {}).id || "" }, vorher: form.vorher },"Rennen gespeichert.");
    } else if (f.id === "f-strecke") {
      const neu = !form.id;
      form.werte = w;
      const a = await aktion({ aktion: "strecke-speichern", id: form.id, strecke: w, vorher: form.vorher },neu ? "Strecke angelegt, jetzt kannst du die Karte hochladen." : "Strecke gespeichert.");
      // Bei einer neuen Strecke geht es direkt mit dem Hochladen der Karte weiter.
      if (a && neu) { const st = d.strecken.find((s) => s.id === a.id); form = { art: "strecke", id: a.id, werte: st || w, vorher: kopie(st) }; zeigeFormular(); }
    } else if (f.id === "f-plan") {
      planerLesen();
      const vorhanden = d.rennen.filter((r) => r.serie === planer.serie).length;
      const gemeinsam = { status: "geplant", briefing: serieVon(planer.serie).briefingVorlage || "", startzeit: planer.startzeit, plaetze: planer.plaetze, fahrzeuge: planer.fahrzeuge, training: planer.training, qualifying: planer.qualifying, renndauer: planer.renndauer, wetter: planer.wetter };
      const rennen = planer.zeilen.map((z, i) => ({ ...gemeinsam, datum: z.datum, strecke: z.strecke.trim(), streckeId: (streckeAus(z.strecke) || {}).id || "", titel: `Runde ${vorhanden + i + 1}${z.strecke.trim() ? ` · ${z.strecke.trim()}` : ""}` }));
      const a = await aktion({ aktion: "saison-planen", serie: planer.serie, rennen }, `${rennen.length} ${rennen.length === 1 ? "Rennen" : "Rennen"} angelegt.`);
      if (a) { planer = null; zeichne(); }
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
    if (t.name === "serie" && t.closest("#f-rennen") && !form.id) {
      // Eine noch unveränderte Vorlage wird beim Wechsel der Serie mitgetauscht, eigener Text bleibt stehen.
      const feldBriefing = t.closest("#f-rennen").elements.briefing;
      if (!feldBriefing.value.trim() || d.serien.some((s) => s.briefingVorlage === feldBriefing.value)) feldBriefing.value = (serieVon(t.value) || {}).briefingVorlage || "";
      return;
    }
    if (t.id === "s-ohne-klassen") { document.getElementById("a-klassen-bereich").hidden = t.checked; return; }
    if (t.name === "einstufungArt" && t.closest("#f-serie")) {
      t.closest("#f-serie").querySelectorAll("[data-nur-sichtung]").forEach((el) => { el.hidden = t.value !== "sichtung"; });
      return;
    }
    if (t.name === "typ" && t.closest("#f-serie")) {
      const f = t.closest("#f-serie");
      f.querySelectorAll("[data-nur-liga]").forEach((el) => { el.hidden = t.value === "event"; });
      f.querySelectorAll("[data-nur-event]").forEach((el) => { el.hidden = t.value !== "event"; });
      // Ein Event ist ein einzelnes Rennen.
      if (t.value === "event") { f.elements.rennenGesamt.value = 1; f.elements.gewerteteRennen.value = 1; f.elements.saison.value = ""; }
      return;
    }
    if (t.id === "p-start" || t.id === "p-abstand" || t.id === "p-anzahl") {
      planerLesen();
      const anzahl = Math.max(1, Math.min(60, Number(document.getElementById("p-anzahl").value) || 1));
      planer.zeilen = Array.from({ length: anzahl }, (_, i) => ({ datum: plusTage(planer.start, i * planer.abstand), strecke: (planer.zeilen[i] || {}).strecke || "" }));
      document.getElementById("a-plan-zeilen").innerHTML = planerZeilenHtml();
      return;
    }
    // Geänderte Nummern rutschen sofort an die richtige Stelle.
    if (t.dataset.feld === "nr" && t.form && t.form.id === "f-katalog") {
      katalogEntwurf = { ...katalogAusFormular(t.form), stand: d.katalog.stand };
      nachNummer(katalogEntwurf.eintraege);
      return zeichne();
    }
    if ((t.dataset.rg === "nr" || t.dataset.rgu === "nr") && t.form && t.form.id === "f-reglement") {
      const stand = reglementAktuell().stand;
      reglementEntwurf = window.LigaReglementFormat.ordneReglement({ ...reglementAusFormular(t.form), stand });
      return zeichne();
    }
    if (t.id === "u-katalog") {
      const k = katalogVorlagen().find((x) => x.nr === t.value);
      document.getElementById("u-aehnlich").innerHTML = aehnlicheFaelle(t.value, reportId);
      if (!k) return;
      const f = t.form;
      // Bei Strafen, die sich nicht abbilden lassen, darf keine Entscheidung der vorherigen Vorlage stehen bleiben.
      const v = vorlageAus(k) || { art: "kein-vergehen" };
      f.elements.art.value = v.art;
      f.elements.punkte.value = "";
      f.elements.sekunden.value = v.sekunden || "";
      f.elements.art.dispatchEvent(new Event("change", { bubbles: true }));
      f.elements.begruendung.value = `${k.nr} ${k.gruppe}: ${k.erklaerung}.`;
      return;
    }
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

  app.addEventListener("input", (e) => {
    const t = e.target;
    if (t.closest && t.closest("#a-klassen")) return klassenKontrolle();
    if (t.id === "a-strecken-suche") { streckenSuche = t.value; streckenAlle = false; return streckenListeNeu(); }
    if (t.id === "a-fahrer-suche") {
      const q = t.value.trim().toLowerCase();
      app.querySelectorAll("tr[data-suche]").forEach((z) => { z.hidden = !!q && !z.dataset.suche.includes(q); });
      return;
    }
    if (t.id === "r-strecke") document.getElementById("a-karte-vorschau").innerHTML = kartenVorschau(streckeAus(t.value));
  });

  lade().catch(() => { d = null; }).then(() => {
    if (!d) { app.innerHTML = '<p class="a-laden">Die Rennleitung ist gerade nicht erreichbar.</p>'; return; }
    zeichne();
    // Neue Reports erscheinen ohne Neuladen. Im Hintergrund wird nicht abgefragt.
    reportsPruefen();
    setInterval(reportsPruefen, 60000);
    document.addEventListener("visibilitychange", reportsPruefen);
  });
})();
