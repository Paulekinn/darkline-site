/* Darkline Liga: ohne Parameter die Übersicht aller Serien, mit ?serie=<kennung> Tabellen, Rennen und Regeln einer Serie.
   Die Daten pflegt die Rennleitung unter /liga-admin, geliefert werden sie von api/liga?r=oeffentlich. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const zahl = (n) => Number(n).toLocaleString("de-DE");
  const bereich = (k) => (k.max == null ? `ab ${zahl(k.min)}` : k.min === 0 ? `bis ${zahl(k.max)}` : `${zahl(k.min)} bis ${zahl(k.max)}`);
  // Farbe nach Lage der Klasse: oberste rot, unterste grün, dazwischen gelb
  const farbe = (k) => (k.gesamt || k.offen ? "k-ges" : k.max == null ? "k-pro" : k.min === 0 ? "k-am" : "k-mid");
  // iRacing liefert die Startzeit in UTC, angezeigt wird der Tag in deutscher Zeit.
  const datum = (s) => { const d = new Date(s); return isNaN(d) ? "" : d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" }); };
  const podium = (p) => (p >= 1 && p <= 3 ? `p${p}` : "");

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
    if (s.typ === "event") {
      $("liga-fortschritt").innerHTML = `<div class="liga-fakten"><div><b>${fahrer}</b><span>Fahrer</span></div><div><b>${gruppen.length}</b><span>Wertungen</span></div></div>`;
      return;
    }
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

  /* ---------- Titelkampf: die Spitze jeder Wertung und was jeder noch braucht ---------- */
  function karte(k, d) {
    const erster = k.fahrer[0];
    const zweiter = k.fahrer[1];
    const rest = k.fahrer.slice(1, 4);
    const titelLaeuft = d.rennenGesamt > 1 && d.restRennen > 0 && !!erster.titel;
    const ende = titelLaeuft ? Math.max(1, ...k.fahrer.slice(0, 4).map((f) => f.titel.maxEnde)) : 1;
    const anteil = (w) => Math.max(0, Math.min(100, Math.round((w / ende) * 100)));
    // Voller Balken: heutige Punkte. Heller Balken: was bis zum Saisonende noch möglich ist.
    const balken = (f) => (titelLaeuft ? `<span class="liga-tk-balken"><u style="width:${anteil(f.titel.maxEnde)}%"></u><i style="width:${anteil(f.punkte)}%"></i></span>` : "");
    // Früh in der Saison ist fast jeder noch im Rennen, dann sagt der Rückstand mehr.
    const titelText = (f) => (f !== erster && f.titel.text === "Noch im Titelrennen" ? `${erster.punkte - f.punkte} Punkte Rückstand` : f.titel.text);
    const status = (f) => (d.rennenGesamt > 1 && f.titel && f.titel.text ? `<span class="liga-tk-status ${esc(f.titel.status)}">${esc(titelText(f))}</span>` : "");
    const abstand = zweiter ? `${erster.punkte - zweiter.punkte} vor Platz 2` : "Allein in der Klasse";
    const zeilen = rest.map((f) => `<li><span class="liga-tk-zeile"><span><em>P${f.pos}</em>${esc(f.name)}</span><span>${f.punkte}</span></span>${balken(f)}${status(f)}</li>`).join("");
    const weitere = titelLaeuft ? k.fahrer.slice(4).filter((f) => f.titel.status !== "raus").length : 0;
    return `<button type="button" class="liga-karte ${farbe(k)}" data-k="${esc(k.id)}" aria-label="Tabelle ${esc(k.name)} öffnen">
      <span class="liga-karte-kopf"><span class="liga-karte-klasse">${esc(k.name)}</span></span>
      <span class="liga-karte-erster"><span class="liga-karte-name">${esc(erster.name)}<small>${esc(abstand)} · ${erster.siege} ${erster.siege === 1 ? "Sieg" : "Siege"}</small>${status(erster)}</span><span class="liga-karte-punkte">${erster.punkte}</span></span>
      ${titelLaeuft ? `<span class="liga-tk-erster">${balken(erster)}</span>` : ""}
      ${zeilen ? `<ul class="liga-karte-rest">${zeilen}</ul>` : ""}
      ${weitere ? `<span class="liga-tk-weitere">+${weitere} weitere noch im Titelrennen</span>` : ""}
    </button>`;
  }

  /* ---------- Rennbericht: entsteht automatisch beim Import ---------- */
  function rundenzeit(z) {
    const ms = Math.round(z / 10);
    const min = Math.floor(ms / 60000);
    return `${min}:${((ms - min * 60000) / 1000).toFixed(3).padStart(6, "0")}`;
  }
  const kachel = (art, titel, name, wert) => `<div class="liga-kachel ${art}"><span>${esc(titel)}</span><b>${esc(name)}</b><small>${esc(wert)}</small></div>`;

  const VORLAEUFIG = '<span class="liga-vorlaeufig">Vorläufig</span>';
  const vorlaeufigHinweis = (text) => `<p class="liga-vorlaeufig-hinweis"><b>Vorläufiges Ergebnis</b>${esc(text)}</p>`;

  function berichtHtml(r, s) {
    const mehrere = r.bericht.length > 1;
    return r.bericht.map((b) => {
      const [sieger, ...verfolger] = b.podium;
      const kopfzeile = [`R${r.nr}`, datum(r.start), `${b.starter} Starter`].filter(Boolean).join(" · ");
      const kacheln = [
        b.aufholer ? kachel("auf", "Größter Aufholer", b.aufholer.name, `+${b.aufholer.plaetze} ${b.aufholer.plaetze === 1 ? "Platz" : "Plätze"}`) : "",
        b.schnellste ? kachel("runde", "Schnellste Runde", b.schnellste.name, rundenzeit(b.schnellste.zeit)) : "",
        b.sauberster ? kachel("sauber", "Sauberster Fahrer", b.sauberster.name, `${b.sauberster.incidents}x Incidents`) : "",
      ].join("");
      return `<article class="liga-bericht ${farbeSerie(s)}">
        <div class="liga-bericht-bild" style="background-image:url('${esc(kartenBild(s))}')" aria-hidden="true"></div>
        <div class="liga-bericht-haupt">
          <div class="liga-bericht-zeile">${mehrere ? `<span class="liga-bericht-klasse">${esc(b.fahrzeugklasse)}</span>` : ""}<span class="lbl">${esc(kopfzeile)}</span>${r.vorlaeufig ? VORLAEUFIG : ""}</div>
          <h3>${esc(sieger)} <small>gewinnt ${r.strecke ? `in ${esc(r.strecke)}` : "das Rennen"}</small></h3>
          ${verfolger.length ? `<ol class="liga-bericht-podium" start="2">${verfolger.map((n, i) => `<li class="p${i + 2}"><b>P${i + 2}</b>${esc(n)}</li>`).join("")}</ol>` : ""}
        </div>
        <div class="liga-kacheln">${kacheln}</div>
      </article>`;
    }).join("");
  }

  /* ---------- Fahrerkarten ---------- */
  const { WERTE, rang } = window.LigaKarte;
  const fahrerkarte = (k, f, s, d) => window.LigaKarte.inhalt({ name: f.name, serie: s.id, serieName: s.name, bildVersion: s.bildVersion, klasse: k.name, pos: f.pos, punkte: f.punkte, rennenGesamt: d.rennenGesamt, rennen: f.rennen, karte: f.karte, pid: f.pid, profil: f.pid ? fahrerProfile[f.pid] : null });

  function fahrerkartenAbschnitt(gruppen, s, d) {
    const alle = gruppen.flatMap((k) => k.fahrer.filter((f) => f.karte).map((f) => ({ k, f })));
    const gezeigt = [...alle].sort((a, b) => (b.f.karte.rating ?? -1) - (a.f.karte.rating ?? -1) || b.f.punkte - a.f.punkte).slice(0, 4);
    if (!gezeigt.length || d.rennenGesamt < 3) return "";
    const karten = gezeigt.map(({ k, f }) => {
      const klasse = `liga-fk ${farbe(k)} ${rang(f.karte.rating)}`;
      return f.pid
        ? `<a class="${klasse}" href="/fahrer?id=${encodeURIComponent(f.pid)}" aria-label="Fahrerprofil von ${esc(f.name)} öffnen">${fahrerkarte(k, f, s, d)}</a>`
        : `<button type="button" class="${klasse}" data-karte-k="${esc(k.id)}" data-karte-f="${f.pos}" aria-label="Fahrerkarte von ${esc(f.name)} öffnen">${fahrerkarte(k, f, s, d)}</button>`;
    }).join("");
    return abschnitt("Fahrerkarten", `Top ${gezeigt.length} von ${alle.length}`, "Nach jedem Rennen automatisch neu berechnet. Ein Klick auf einen Namen in der Tabelle öffnet das Profil jedes Fahrers.", `<div class="liga-fk-raster">${karten}</div>`);
  }

  /* ---------- Fahrerkarte als Bild zum Posten in Discord und sozialen Medien ---------- */
  const cssFarbe = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const ladeBild = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
  const RANG_FARBE = { "r-gold": "--liga-gold", "r-silber": "--liga-silber", "r-bronze": "--liga-bronze", "r-offen": "--muted" };
  const KLASSEN_FARBE = { "k-pro": "--liga-rot", "k-mid": "--liga-gelb", "k-am": "--liga-gruen" };

  // Zeichnet die Karte in fester Größe, unabhängig vom Bildschirm des Fahrers.
  async function kartenLeinwand(k, f, s, d) {
    const B = 1000;
    const H = 1240;
    const R = 60;
    const c = f.karte;
    await Promise.all(["900 80px Archivo", "800 40px Archivo", "500 30px 'IBM Plex Mono'", "600 30px 'IBM Plex Mono'"].map((x) => document.fonts.load(x, "Darkline 0123456789")));
    const profil = (f.pid && fahrerProfile[f.pid]) || {};
    const flaggenQuelle = window.LigaFlaggen.quelle(profil.land);
    const [motiv, logo, avatar, flaggenBild] = await Promise.all([ladeBild(kartenBild(s)), ladeBild("img/brand/dsrs-logo.png"), profil.bild ? ladeBild(window.LigaKarte.avatarVon(f.pid, profil.bild)) : null, flaggenQuelle ? ladeBild(flaggenQuelle) : null]);
    const leinwand = document.createElement("canvas");
    leinwand.width = B;
    leinwand.height = H;
    const x = leinwand.getContext("2d");
    const rangFarbe = cssFarbe(RANG_FARBE[rang(c.rating)]);
    const schrift = (gew, groesse, fam) => { x.font = `${gew} ${groesse}px ${fam === "mono" ? "'IBM Plex Mono'" : "Archivo"}`; };

    // Abgeschrägte Ecken wie auf der Website
    x.beginPath();
    [[0, 0], [B - 60, 0], [B, 60], [B, H], [60, H], [0, H - 60]].forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b)));
    x.closePath();
    x.clip();
    x.fillStyle = cssFarbe("--paper");
    x.fillRect(0, 0, B, H);

    if (motiv) {
      const bildH = 500;
      const faktor = Math.max(B / motiv.width, bildH / motiv.height);
      x.globalAlpha = 0.34;
      x.drawImage(motiv, (B - motiv.width * faktor) / 2, (bildH - motiv.height * faktor) / 2, motiv.width * faktor, motiv.height * faktor);
      x.globalAlpha = 1;
      const blende = x.createLinearGradient(0, 120, 0, 500);
      blende.addColorStop(0, "rgba(17,20,22,0)");
      blende.addColorStop(1, cssFarbe("--paper"));
      x.fillStyle = blende;
      x.fillRect(0, 0, B, bildH);
      // Das Motiv kann höher sein als sein Bereich, darunter bleibt die Karte einfarbig.
      x.fillStyle = cssFarbe("--paper");
      x.fillRect(0, bildH, B, H - bildH);
    }
    x.globalAlpha = 0.2;
    const schimmer = x.createLinearGradient(0, 0, B, H * 0.7);
    schimmer.addColorStop(0, rangFarbe);
    schimmer.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = schimmer;
    x.fillRect(0, 0, B, H);
    x.globalAlpha = 1;
    x.fillStyle = rangFarbe;
    x.fillRect(0, 0, B, 12);

    // Rating und Klasse
    x.textBaseline = "alphabetic";
    x.fillStyle = rangFarbe;
    schrift(900, 190);
    x.fillText(c.rating === null ? "–" : String(c.rating), R, 225);
    x.fillStyle = "#c3cac7";
    schrift(500, 28, "mono");
    x.fillText((c.rating === null ? (d.rennenGesamt < 3 ? "Einzelwertung" : "Noch in Wertung") : "Darkline Rating").toUpperCase(), R, 275);

    const klassenText = k.name.toUpperCase();
    schrift(900, 34);
    const textB = x.measureText(klassenText).width;
    x.save();
    x.translate(B - R - textB - 40, 62);
    x.transform(1, 0, -0.18, 1, 0, 0);
    x.fillStyle = cssFarbe(KLASSEN_FARBE[farbe(k)] || "--ink");
    x.fillRect(0, 0, textB + 40, 58);
    x.fillStyle = "#08090a";
    x.fillText(klassenText, 20, 42);
    x.restore();

    // Name: wird kleiner, bis er in die Zeile passt
    const name = `${profil.nummer ? `#${profil.nummer} ` : ""}${f.name}`.toUpperCase();
    const avatarBreite = avatar ? 150 : 0;
    let groesse = 76;
    do { schrift(900, groesse); groesse -= 2; } while (x.measureText(name).width > B - 2 * R - avatarBreite && groesse > 30);
    x.fillStyle = cssFarbe("--ink");
    x.fillText(name, R, 370);
    if (avatar) {
      const seite = Math.min(avatar.width, avatar.height);
      x.drawImage(avatar, (avatar.width - seite) / 2, (avatar.height - seite) / 2, seite, seite, B - R - 130, 305, 130, 130);
    }
    let textX = R;
    if (flaggenBild) { x.drawImage(flaggenBild, R, 395, 40, 30); textX += 52; }
    x.fillStyle = cssFarbe("--muted");
    schrift(500, 30, "mono");
    x.fillText(`${s.name} · P${f.pos} · ${f.punkte} Punkte`, textX, 420);

    // Vier Werte
    const FARBEN_WERTE = { speed: "--liga-rot", sauberkeit: "--liga-gruen", racecraft: "--liga-gelb", konstanz: "--liga-blau" };
    WERTE.forEach(([label, feld], i) => {
      const y = 500 + i * 66;
      const wert = c[feld];
      x.fillStyle = cssFarbe("--muted");
      schrift(500, 32, "mono");
      x.textAlign = "left";
      x.fillText(label, R, y + 22);
      x.fillStyle = "#2a2f33";
      x.fillRect(300, y, 560, 22);
      if (wert !== null) { x.fillStyle = cssFarbe(FARBEN_WERTE[feld]); x.fillRect(300, y, 560 * (wert / 100), 22); }
      x.fillStyle = cssFarbe("--ink");
      schrift(600, 34, "mono");
      x.textAlign = "right";
      x.fillText(wert === null ? "–" : String(wert), B - R, y + 24);
    });
    x.textAlign = "left";

    // Form der letzten Rennen
    f.rennen.slice(-8).forEach((r, i) => {
      const a = R + i * 84;
      const y = 790;
      const text = !r ? "–" : r.status !== "OK" ? r.status : String(r.platz);
      const farbeKasten = !r ? "#1a1d20" : r.status !== "OK" ? "#4b2428" : r.platz === 1 ? cssFarbe("--liga-gold") : r.platz === 2 ? cssFarbe("--liga-silber") : r.platz === 3 ? cssFarbe("--liga-bronze") : "#2a2f33";
      x.fillStyle = farbeKasten;
      x.fillRect(a, y, 74, 62);
      x.fillStyle = r && r.status === "OK" && r.platz <= 3 ? "#12100a" : "#e8ecea";
      schrift(600, r && r.status !== "OK" ? 22 : 30, "mono");
      x.textAlign = "center";
      x.fillText(text, a + 37, y + 42);
      x.textAlign = "left";
    });

    // Abzeichen, bei Bedarf in mehreren Zeilen
    const FARBEN_ABZEICHEN = { sauber: "--liga-gruen", ziel: "--liga-gruen", comeback: "--liga-blau" };
    let a = R;
    let y = 890;
    schrift(600, 26, "mono");
    c.abzeichen.forEach((z) => {
      const breite = x.measureText(z.text).width + 34;
      if (a + breite > B - R) { a = R; y += 66; }
      x.strokeStyle = x.fillStyle = cssFarbe(FARBEN_ABZEICHEN[z.art] || "--liga-gold");
      x.lineWidth = 2;
      x.strokeRect(a, y, breite, 52);
      x.fillText(z.text, a + 17, y + 35);
      a += breite + 12;
    });

    if (logo) x.drawImage(logo, R, H - 145, 352, 89);
    x.fillStyle = cssFarbe("--muted");
    schrift(500, 26, "mono");
    x.textAlign = "right";
    x.fillText("darklineperformance.de/liga", B - R, H - 76);
    return leinwand;
  }
  const alsPng = (leinwand) => new Promise((ok) => leinwand.toBlob(ok, "image/png"));

  // Größere Ansicht einer Karte mit Bild und Link zum Teilen
  function fahrerDialog(gruppen, s, d) {
    document.body.insertAdjacentHTML("beforeend", '<dialog id="liga-fk-dialog" class="liga-fk-dialog" aria-label="Fahrerkarte"></dialog>');
    const dialog = $("liga-fk-dialog");
    const anker = (k, f) => `#fahrer/${encodeURIComponent(k.id)}/${encodeURIComponent(f.name)}`;
    const ohneAnker = () => history.replaceState(null, "", location.pathname + location.search);
    let geoeffnet = null;
    const oeffne = (k, f) => {
      geoeffnet = { k, f };
      const c = f.karte;
      const inc = f.incidentsProRunde === null ? "–" : f.incidentsProRunde.toLocaleString("de-DE", { minimumFractionDigits: 2 });
      dialog.innerHTML = `<div class="liga-fk ${farbe(k)} ${rang(c.rating)} gross">${fahrerkarte(k, f, s, d)}</div>
        <dl class="liga-fk-zahlen">
          <div><dt>Rennen</dt><dd>${c.rennen}</dd></div><div><dt>Siege</dt><dd>${f.siege}</dd></div><div><dt>Podien</dt><dd>${c.podien}</dd></div>
          <div><dt>Ausfälle</dt><dd>${c.ausfaelle}</dd></div><div><dt>Inc/Runde</dt><dd>${inc}</dd></div><div><dt>Strafpunkte</dt><dd>${f.strafpunkte}</dd></div>
        </dl>
        ${c.rating === null && d.rennenGesamt >= 3 ? '<p class="liga-fk-hinweis">Das Gesamtrating erscheint nach drei gefahrenen Rennen.</p>' : ""}
        <div class="liga-serie-aktion"><button type="button" class="liga-mini" data-fk-bild>Bild kopieren</button><button type="button" class="liga-mini zweit" data-fk-speichern>Bild speichern</button><button type="button" class="liga-mini zweit" data-fk-link>Link kopieren</button>${f.pid ? `<a class="liga-mini zweit" href="/fahrer?id=${encodeURIComponent(f.pid)}">Zum Profil</a>` : ""}<button type="button" class="liga-mini zweit" data-fk-zu>Schließen</button></div>
        <p class="liga-fk-hinweis">Das Bild kannst du in Discord mit Strg+V einfügen. Der Link zeigt dort eine Vorschau mit Rating und Werten.</p>`;
      // Voller Pfad, weil die Seite ein base-Element hat und ein reiner #-Link sonst auf die Startseite zeigen würde
      history.replaceState(null, "", location.pathname + location.search + anker(k, f));
      dialog.showModal();
    };
    document.addEventListener("click", async (e) => {
      const knopf = e.target.closest("[data-karte-k]");
      if (knopf) {
        const k = gruppen.find((x) => x.id === knopf.dataset.karteK);
        const f = k && k.fahrer.find((x) => String(x.pos) === knopf.dataset.karteF);
        if (f && f.karte) oeffne(k, f);
        return;
      }
      const kopieren = e.target.closest("[data-fk-link]");
      if (kopieren && geoeffnet) {
        const link = `${location.origin}/karte?serie=${encodeURIComponent(s.id)}&k=${encodeURIComponent(geoeffnet.k.id)}&f=${encodeURIComponent(geoeffnet.f.name)}`;
        try { await navigator.clipboard.writeText(link); kopieren.textContent = "Link kopiert"; } catch (err) { window.prompt("Link zur Fahrerkarte:", link); }
        return;
      }
      const bild = e.target.closest("[data-fk-bild]");
      if (bild && geoeffnet) {
        if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) { bild.textContent = "Bitte speichern"; return; }
        bild.textContent = "Wird erstellt…";
        // Das Bild wird als Promise übergeben, sonst lehnen manche Browser das Kopieren nach der Wartezeit ab.
        const { k, f } = geoeffnet;
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": kartenLeinwand(k, f, s, d).then(alsPng) })]);
          bild.textContent = "Bild kopiert";
        } catch (err) { bild.textContent = "Bitte speichern"; }
        return;
      }
      const speichern = e.target.closest("[data-fk-speichern]");
      if (speichern && geoeffnet) {
        const { k, f } = geoeffnet;
        speichern.textContent = "Wird erstellt…";
        try {
          const url = URL.createObjectURL(await alsPng(await kartenLeinwand(k, f, s, d)));
          const a = document.createElement("a");
          a.href = url;
          a.download = `dsrs-${f.name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, "-").replace(/^-|-$/g, "") || "fahrerkarte"}.png`;
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          speichern.textContent = "Gespeichert";
        } catch (err) { speichern.textContent = "Fehlgeschlagen"; }
        return;
      }
      // Ein Klick neben die Karte trifft den Dialog selbst.
      if (e.target.closest("[data-fk-zu]") || e.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", ohneAnker);
    // Geteilter Link: die Karte öffnet sich direkt
    const teile = location.hash.split("/");
    if (teile[0] === "#fahrer" && teile.length === 3) {
      try {
        const k = gruppen.find((x) => x.id === decodeURIComponent(teile[1]));
        const f = k && k.fahrer.find((x) => x.name === decodeURIComponent(teile[2]));
        if (f && f.karte) oeffne(k, f);
      } catch (err) { /* ein beschädigter Link öffnet einfach keine Karte */ }
    }
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

  // Öffentliche Zusatzangaben je anonymer Kennung
  let fahrerProfile = {};
  // Mit Kennung führt der Name zum Profil, bei älteren Tabellen ohne Kennung öffnet er die Karte.
  function fahrerLink(klasseId, pos, name, pid) {
    const p = (pid && fahrerProfile[pid]) || {};
    const vor = window.LigaKarte.flagge(p.land) + (p.nummer ? `<span class="liga-tab-nr">#${esc(p.nummer)}</span>` : "");
    return `${vor}${pid ? `<a class="liga-fahrerlink" href="/fahrer?id=${encodeURIComponent(pid)}">${esc(name)}</a>` : `<button type="button" class="liga-fahrerlink" data-karte-k="${esc(klasseId)}" data-karte-f="${pos}">${esc(name)}</button>`}`;
  }
  // Fahrerklasse als Farbchip, ohne die Fahrzeugklasse doppelt zu nennen
  function klassenChip(id, k, d) {
    const gruppe = d.klassen.find((x) => x.id === id);
    if (!gruppe) return "";
    return `<span class="liga-klassenchip ${farbe(gruppe)}">${esc(gruppe.name.replace(`${gruppe.fahrzeugklasse} `, ""))}</span>`;
  }

  /* ---------- Ergebnis eines einzelnen Rennens ---------- */
  function rennTabelle(k, r, d) {
    const block = (r.ergebnisse || []).find((e) => e.fahrzeugId === k.fahrzeugId);
    const zeilen = block ? block.zeilen.filter((z) => k.gesamt || z.klasse === k.id) : [];
    if (!zeilen.length) return `<div class="liga-scroll ${farbe(k)}"><p class="liga-hinweis">In diesem Rennen ist niemand aus dieser Wertung gestartet.</p></div>`;
    const wert = (z) => (k.gesamt ? z.gesamt : z.wertung);
    const startRang = new Map(zeilen.filter((z) => z.start !== null).sort((a, b) => a.start - b.start).map((z, i) => [z, i + 1]));
    const spitze = zeilen.find((z) => wert(z).status === "OK");
    const zeiten = zeilen.filter((z) => wert(z).status !== "DSQ" && z.besteRunde !== null).map((z) => z.besteRunde);
    const bestzeit = zeiten.length ? Math.min(...zeiten) : null;
    const abstand = (z) => {
      if (z === spitze) return "Sieger";
      if (!spitze || z.gast || wert(z).status === "DSQ") return "–";
      if (z.abstand !== null && spitze.abstand !== null) return `+${((z.abstand - spitze.abstand) / 10000).toLocaleString("de-DE", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
      const runden = spitze.runden - z.runden;
      return runden > 0 ? `+${runden} Rd.` : "–";
    };
    const gewinn = (z) => {
      const w = wert(z);
      if (w.status !== "OK" || !startRang.has(z)) return '<span class="liga-leerzelle">–</span>';
      const plaetze = startRang.get(z) - w.platz;
      return plaetze > 0 ? `<span class="liga-plus">▲${plaetze}</span>` : plaetze < 0 ? `<span class="liga-minus">▼${-plaetze}</span>` : '<span class="liga-leerzelle">=</span>';
    };
    const punkte = (z) => {
      const w = wert(z);
      const strafe = (z.zeitstrafe ? `<span class="liga-tag minus">+${z.zeitstrafe}s</span>` : "") + (z.strafe ? `<span class="liga-tag minus">−${z.strafe}</span>` : "");
      if (w.status !== "OK") return `<b><span class="liga-tag aus">${esc(w.status)}</span></b>${strafe ? `<small>${strafe}</small>` : ""}`;
      const tags = (w.pole ? '<span class="liga-tag pp">PP</span>' : "") + (w.schnellsteRunde ? '<span class="liga-tag sr">SR</span>' : "");
      // Bei Events zählt nur die Platzierung, die Spalte zeigt dann nur Pole, schnellste Runde und Strafen.
      if (d.istEvent) return tags || strafe ? `<small>${tags}${strafe}</small>` : '<span class="liga-leerzelle">–</span>';
      return `<b>${w.punkte}</b>${tags || strafe ? `<small>${tags}${strafe}</small>` : ""}`;
    };
    const reihen = zeilen.map((z) => {
      const w = wert(z);
      return `<tr>
        <td><span class="liga-fahrer"><span class="liga-pos ${w.status === "OK" ? podium(w.platz) : ""}"><b>${w.status === "OK" ? w.platz : "–"}</b></span>${z.gast ? esc(z.name) : fahrerLink(z.klasse, z.klassenPos, z.name, z.pid)}</span></td>
        ${k.gesamt ? `<td>${klassenChip(z.klasse, k, d)}</td>` : ""}
        <td class="zahl">${startRang.has(z) ? startRang.get(z) : "–"}</td>
        <td class="zahl">${gewinn(z)}</td>
        <td class="zahl">${esc(abstand(z))}</td>
        <td class="zahl">${z.runden}</td>
        <td class="zahl${z.besteRunde === bestzeit ? " liga-bestzeit" : ""}">${z.besteRunde === null ? "–" : rundenzeit(z.besteRunde)}</td>
        <td class="zahl">${z.incidents}x</td>
        <td class="zahl liga-rennen">${punkte(z)}</td>
      </tr>`;
    }).join("");
    return `<div class="liga-scroll ${farbe(k)}" tabindex="0" role="region" aria-label="Ergebnis ${esc(k.name)}, Rennen ${r.nr}"><table class="liga-tabelle">
      <thead><tr><th>Fahrer</th>${k.gesamt ? "<th>Klasse</th>" : ""}<th class="zahl">Start</th><th class="zahl">+/−</th><th class="zahl">Abstand</th><th class="zahl">Runden</th><th class="zahl">Beste Runde</th><th class="zahl">Inc</th><th class="zahl">${d.istEvent ? "Info" : "Punkte"}</th></tr></thead>
      <tbody>${reihen}</tbody>
    </table></div>`;
  }

  function tabelle(k, d) {
    if (!k.fahrer.length) return `<div class="liga-scroll ${farbe(k)}"><p class="liga-hinweis">In dieser Klasse ist noch niemand gewertet.</p></div>`;
    const maximal = Math.max(1, ...k.fahrer.map((f) => f.punkte));
    const kopfzeile = d.rennen.map((r) => `<th class="zahl" title="${esc([r.strecke, r.variante].filter(Boolean).join(" · "))}">R${r.nr}<small>${esc(datum(r.start))}</small></th>`).join("");
    const zeilen = k.fahrer.map((f) => `<tr>
      <td><span class="liga-fahrer"><span class="liga-pos ${podium(f.pos)}"><b>${f.pos}</b></span>${k.gesamt ? fahrerLink(f.klasse.id, f.klassenPos, f.name, f.pid) : f.karte ? fahrerLink(k.id, f.pos, f.name, f.pid) : esc(f.name)}</span></td>
      ${k.gesamt ? `<td>${klassenChip(f.klasse.id, k, d)}</td>` : ""}      ${f.rennen.map(zelle).join("")}
      <td class="zahl">${f.siege}</td>
      <td class="zahl">${f.incidentsProRunde === null ? "–" : f.incidentsProRunde.toLocaleString("de-DE", { minimumFractionDigits: 2 })}</td>
      <td class="zahl ${f.strafpunkte ? "liga-strafe" : "liga-leerzelle"}">${f.strafpunkte ? "−" + f.strafpunkte : "–"}</td>
      <td class="zahl liga-punkte"><b>${f.punkte}</b><span class="liga-balken"><i style="width:${Math.max(0, Math.round((f.punkte / maximal) * 100))}%"></i></span></td>
    </tr>`).join("");
    return `<div class="liga-scroll ${farbe(k)}" tabindex="0" role="region" aria-label="Tabelle ${esc(k.name)}"><table class="liga-tabelle">
      <thead><tr><th>Fahrer</th>${k.gesamt ? "<th>Klasse</th>" : ""}${kopfzeile}<th class="zahl">Siege</th><th class="zahl">Inc/Runde</th><th class="zahl">Strafe</th><th class="zahl">Punkte</th></tr></thead>
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
        <header><div class="liga-rennnr">R${r.nr}</div><div class="liga-strecke">${esc(r.strecke)}<small>${esc([r.variante, datum(r.start)].filter(Boolean).join(" · "))}</small>${r.vorlaeufig ? VORLAEUFIG : ""}</div></header>
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
    // Bei Sichtung entscheidet die Pace, das iRating gilt nur für Fahrer ohne Sichtung.
    const sichtung = r.einstufungArt === "sichtung" && !r.ohneKlassen;
    const grenzen = r.sichtungGrenzen || [];
    const pace = (i) => (i < grenzen.length ? `Sichtung bis ${String(grenzen[i]).replace(".", ",")} %` : `Sichtung über ${String(grenzen[grenzen.length - 1]).replace(".", ",")} %`);
    const klassen = [...r.klassen].sort((a, b) => b.min - a.min).map((k, i) => `<div class="liga-regel-klasse ${farbe(k)}"><b>${esc(k.name)}</b><span>${sichtung ? `${esc(pace(i))}<br>sonst iRating ${esc(bereich(k))}` : `iRating ${esc(bereich(k))}`}</span></div>`).join("");
    if (r.typ === "event") return `${r.ohneKlassen ? "" : `<div class="liga-regel-klassen">${klassen}</div>`}
      <ul class="liga-regelliste">
        <li>Bei Events zählt die Platzierung, Punkte werden nicht vergeben.</li>
        <li>Gewertet wird, wer mindestens ${r.mindestRundenProzent} % der Runden des Klassensiegers schafft.</li>
        <li>Zeitstrafen und Disqualifikationen wirken direkt auf die Platzierung.</li>
      </ul>`;
    const punkte = r.punkte.map((p, i) => `<div class="${podium(i + 1)}">P${i + 1}<b>${p}</b></div>`).join("") + (r.punkteDanach ? `<div>P${r.punkte.length + 1}+<b>${r.punkteDanach}</b></div>` : "");
    return `${r.ohneKlassen ? "" : `<div class="liga-regel-klassen">${klassen}</div>`}
      <h3 class="liga-regel-titel">${r.ohneKlassen ? "Punkte pro Rennen" : "Punkte pro Rennen und Klasse"}</h3>
      <div class="liga-punktetafel">${punkte}</div>
      <ul class="liga-regelliste">
        <li>Je ${r.bonusPole} Bonuspunkt für die Pole und ${r.bonusSchnellsteRunde} für die schnellste Runde der eigenen Klasse.</li>
        <li>Gewertet wird, wer mindestens ${r.mindestRundenProzent} % der Runden des Klassensiegers schafft.</li>
        ${r.mindestStarter > 0 ? `<li>Punkte gibt es ab ${r.mindestStarter} gestarteten Teilnehmern.</li>` : ""}
        ${r.punkteVerkuerztProzent !== undefined ? `<li>Wird weniger als 75 % der ausgeschriebenen Renndistanz gefahren, gibt es ${r.punkteVerkuerztProzent} % der Platzpunkte.</li>` : ""}
        ${r.gewerteteRennen < r.rennenGesamt ? `<li>Es zählen die besten ${r.gewerteteRennen} von ${r.rennenGesamt} Rennen. Strafpunkte werden immer abgezogen.</li>` : ""}
        ${r.ohneKlassen ? "" : sichtung ? `<li>Die Klasse richtet sich nach der Sichtung: Auf jeder Sichtungsstrecke zählt die beste Runde im Vergleich zur schnellsten der Fahrzeugklasse${r.sichtungMindestRunden ? `, gültig ab ${r.sichtungMindestRunden} gefahrenen Runden` : ""}. Entscheidend ist der Mittelwert über alle Strecken. Die Sichtung zählt nicht für die Tabelle. Wer nicht jede Strecke gefahren ist, wird nach iRating oder von der Rennleitung eingestuft. Die Rennleitung bestätigt jede Einstufung.</li>` : "<li>Die Klasse richtet sich nach dem iRating zum Start und bleibt danach gleich.</li>"}
        ${(r.modelle || []).length ? `<li>Bei der Anmeldung wählt jeder Fahrer sein Fahrzeug (${r.modelle.length} zur Auswahl). ${r.freieWechsel ? `${r.freieWechsel === 1 ? "Ein Wechsel" : `${r.freieWechsel} Wechsel`} während der Season ${r.freieWechsel === 1 ? "ist" : "sind"} frei, jeder weitere nur mit Zustimmung der Rennleitung.` : "Ein Wechsel während der Season ist nur mit Zustimmung der Rennleitung möglich."} Wer ohne Genehmigung ein anderes Fahrzeug fährt, dem kann die Rennleitung das Ergebnis streichen.</li>` : ""}
        ${r.typ !== "event" ? "<li>Gaststarter erscheinen im Rennergebnis, bekommen aber keine Punkte und nehmen auch niemandem welche weg.</li>" : ""}
        ${r.klassen.length > 1 ? "<li>Die Gesamtwertung vergibt eigene Punkte nach dem Zieleinlauf der ganzen Fahrzeugklasse. Die Klassenwertungen bleiben davon unberührt.</li>" : ""}
        <li>Bei Punktgleichheit entscheiden die Anzahl der Siege, dann der zweiten Plätze und so weiter, zuletzt das jüngste Rennen.</li>
      </ul>`;
  }

  function regelnAnhaengen(r) {
    if (r && Array.isArray(r.klassen) && Array.isArray(r.punkte)) einfuegen(abschnitt("Regeln", "Punkte und Klassen", "", regelnHtml(r)));
  }

  function leer(regeln) {
    einfuegen(abschnitt("Ergebnisse", "In Vorbereitung", "", `<div class="liga-leer">
      <h3>Noch keine Ergebnisse</h3>
      <p>Sobald die ersten Rennen gefahren sind, stehen hier Tabellen, Rennberichte und Fahrerkarten aller Klassen.</p>
    </div>`));
    regelnAnhaengen(regeln);
  }

  /* ---------- Vorschau: was vor dem ersten Ergebnis schon feststeht ---------- */
  const tagMonat = (t) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t || ""); return m ? `${m[3]}.${m[2]}.` : ""; };
  function vorschau(s, rennen) {
    const event = s.typ === "event";
    const klassen = s.ohneKlassen ? "" : (s.klassen || []).map((k) => `<span class="liga-klassenchip ${farbe(k)}">${esc(k.name)}</span>`).join("");
    const fzKlassen = (s.fahrzeugklassen || []).map((k) => `<span class="liga-klassenchip" style="--k:${window.LigaKarte.fahrzeugFarbe(k)}">${esc(k)}</span>`).join("");
    const anmeldung = s.status === "geplant" ? (s.aufAnfrage ? "Folgt, nur auf Anfrage" : "Folgt") : s.status === "beendet" ? "Beendet" : s.anmeldungOffen === false ? "Geschlossen" : s.aufAnfrage ? "Auf Anfrage" : "Offen";
    const daten = [
      ["Anmeldung", esc(anmeldung)],
      ["Umfang", esc(event ? "Einzelrennen" : `${s.rennenGesamt} Rennen${s.gewerteteRennen < s.rennenGesamt ? `, beste ${s.gewerteteRennen} zählen` : ""}`)],
      fzKlassen ? [(s.fahrzeugklassen || []).length > 1 ? "Fahrzeugklassen" : "Fahrzeugklasse", `<span class="liga-poster-klassen">${fzKlassen}</span>`] : null,
      klassen ? ["Fahrerklassen", `<span class="liga-poster-klassen">${klassen}</span>`] : null,
    ].filter(Boolean);
    const modelle = (s.modelle || []).length ? `<h3 class="liga-regel-titel">Fahrzeuge zur Wahl (${s.modelle.length})</h3><ul class="liga-modelle">${s.modelle.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : "";
    const privat = s.aufAnfrage ? `<div class="liga-privat"><h3>Private Season</h3><p>Die Teilnahme ist nur nach Freigabe durch die Rennleitung möglich. Stelle eine Beitrittsanfrage, du bekommst die Entscheidung per Discord-Nachricht.</p>${s.voraussetzungen ? `<p><b>Voraussetzungen:</b> ${esc(s.voraussetzungen)}</p>` : ""}</div>` : "";
    einfuegen(abschnitt(event ? "Das Event" : "Die Season", STATUS[s.status] || "", "", `<dl class="liga-vorschau">${daten.map(([t, d]) => `<div><dt>${t}</dt><dd>${d}</dd></div>`).join("")}</dl>${privat}${modelle}`));

    // Sichtung: Zeitraum und Strecken sind öffentlich, die Werte der Fahrer nicht.
    if (s.einstufungArt === "sichtung" && !s.ohneKlassen && s.sichtungVon && (s.sichtungStrecken || []).length) {
      const phase = heute < s.sichtungVon ? `Startet am ${tagMonat(s.sichtungVon)}` : s.sichtungBis && heute > s.sichtungBis ? "Abgeschlossen" : `Läuft bis ${tagMonat(s.sichtungBis)}`;
      const laeuft = phase.startsWith("Läuft");
      const wertung = s.sichtungWertung === "schnitt" ? "der Schnitt" : "die beste Runde";
      einfuegen(abschnitt("Sichtung", phase, "", `<div class="liga-sichtung${laeuft ? " laeuft" : ""}">
        <p>Die Sichtung entscheidet, in welcher Klasse du fährst. Gefahren wird offline mit festen Bedingungen, gewertet ${s.sichtungRunden ? `wird ${wertung} aus ${s.sichtungRunden} sauberen Runden am Stück` : `wird ${wertung}`}. Zeitraum: ${esc(tagMonat(s.sichtungVon))} bis ${esc(tagMonat(s.sichtungBis))}</p>
        <ol class="liga-sichtung-strecken">${s.sichtungStrecken.map((x) => `<li>${esc(x.name)}</li>`).join("")}</ol>
        <p class="liga-hinweis">Die genauen Vorgaben und deine eigenen Werte findest du nach der Anmeldung im Fahrerbereich unter „Sichtung“. Die Werte siehst nur du und die Rennleitung.</p>
        ${laeuft && s.status !== "geplant" ? '<div class="liga-serie-aktion"><a class="liga-mini" href="/fahrerbereich">Zur Sichtung</a></div>' : ""}
      </div>`));
    }

    // Kalender: alle eingetragenen Rennen der Serie, auch ohne Datum
    const eigene = rennen.filter((r) => r.serie === s.id && r.status !== "abgesagt").sort((a, b) => `${a.datum || "9"} ${a.startzeit || ""}`.localeCompare(`${b.datum || "9"} ${b.startzeit || ""}`));
    einfuegen(abschnitt(event ? "Termin" : "Kalender", eigene.length ? `${eigene.length} ${eigene.length === 1 ? "Termin" : "Termine"}` : "Termine folgen", "", eigene.length
      ? `<div class="liga-termine">${eigene.map((r) => terminZeile(r, s)).join("")}</div>`
      : `<p class="liga-hinweis">Die Termine werden hier und im Discord angekündigt.</p>`));

    if (s.status === "laeuft") einfuegen(abschnitt("Ergebnisse", "In Vorbereitung", "", '<p class="liga-hinweis">Nach dem ersten Rennen stehen hier Tabellen, Rennberichte und Fahrerkarten.</p>'));
    regelnAnhaengen(s);
  }

  /* ---------- Serien: Anmeldung, Karten und Übersicht ---------- */
  let fahrerStand = null;
  const FARBEN = ["rot", "blau", "lila", "gruen", "gelb", "tuerkis"];
  const farbeSerie = (s) => `s-${FARBEN.includes(s.farbe) ? s.farbe : "rot"}`;
  const STATUS = { geplant: "Geplant", anmeldung: "Anmeldung offen", laeuft: "Läuft", beendet: "Beendet" };
  // Einfarbige Logos von Twitch und YouTube (Pfade aus Simple Icons, CC0), Farbe kommt aus dem Text
  const PLATTFORM_LOGO = {
    twitch: "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z",
    youtube: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
  };
  const plattform = (s) => (/youtu/.test(s.uebertragung) ? "youtube" : "twitch");
  const plattformLogo = (p) => `<svg class="liga-plattform" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${PLATTFORM_LOGO[p]}"/></svg>`;
  // Plakette, wenn für die Serie eine Übertragung eingetragen ist. Ein Klick öffnet den Kanal.
  const streamBadge = (s) => {
    if (!s.uebertragung) return "";
    const p = plattform(s);
    return `<a class="liga-pill liga-pill-stream ${p}" href="${esc(s.uebertragung)}" target="_blank" rel="noopener" title="Die Rennen dieser Serie werden übertragen">${plattformLogo(p)}${p === "youtube" ? "YouTube" : "Twitch"}-Übertragung</a>`;
  };
  // Schräges Band oben rechts auf der Serienkarte, wenn eine Übertragung eingetragen ist
  const streamBand = (s) => {
    if (!s.uebertragung) return "";
    const p = plattform(s);
    return `<a class="liga-band ${p}" href="${esc(s.uebertragung)}" target="_blank" rel="noopener" title="Die Rennen dieser Serie werden übertragen">${plattformLogo(p)}${p === "youtube" ? "YouTube" : "Twitch"}</a>`;
  };
  // Private Season: Teilnahme nur nach Freigabe durch die Rennleitung
  const privatPill = (s) => (s.aufAnfrage ? '<span class="liga-pill liga-pill-privat" title="Teilnahme nur nach Freigabe durch die Rennleitung"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 0 1 6 0v3z"/></svg>Privat · Auf Anfrage</span>' : "");
  const artBadge = (typ, klein) => `<span class="liga-art ${typ === "event" ? "event" : "liga"}${klein ? " klein" : ""}">${typ === "event" ? "Event" : "Liga"}</span>`;
  const heute = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const terminText = (r) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(r.datum || ""); return `${m ? `${m[3]}.${m[2]}.` : ""}${r.startzeit ? ` · ${r.startzeit}` : ""}`; };
  const offeneRennen = (rennen) => rennen.filter((r) => r.status !== "abgesagt" && String(r.datum || "") >= heute).sort((a, b) => `${a.datum} ${a.startzeit}`.localeCompare(`${b.datum} ${b.startzeit}`));

  function serienAktion(s) {
    if (s.status === "beendet") return "";
    if (s.status === "geplant") return '<span class="liga-folgt">Anmeldung folgt</span>';
    const offen = s.anmeldungOffen !== false;
    const geschlossen = '<span class="liga-zu">Anmeldung geschlossen</span>';
    if (!fahrerStand || !fahrerStand.angemeldet) return offen ? `<a class="liga-melden" href="/api/discord-login?ziel=liga">${s.aufAnfrage ? "Beitritt anfragen" : "Jetzt anmelden"}</a>` : geschlossen;
    const eigen = (fahrerStand.serien || []).find((x) => x.id === s.id);
    if (eigen && eigen.ich) return `<span class="liga-dabei"><i aria-hidden="true">✓</i>Du bist dabei</span><button type="button" class="liga-abmelden" data-serie-aktion="serie-abmelden" data-serie="${esc(s.id)}">Abmelden</button>`;
    if (eigen && eigen.anfrage) return `<span class="liga-folgt">Anfrage gestellt, die Rennleitung entscheidet</span><button type="button" class="liga-abmelden" data-serie-aktion="serie-anfrage-zurueck" data-serie="${esc(s.id)}">Anfrage zurückziehen</button>`;
    if (!offen) return geschlossen;
    if (!fahrerStand.fahrer.profil) return `<a class="liga-melden" href="/fahrerbereich">${s.aufAnfrage ? "Beitritt anfragen" : "Jetzt anmelden"}</a>`;
    const klassen = s.fahrzeugklassen || [];
    const auswahl = klassen.length > 1 ? `<select id="fz-${esc(s.id)}" class="liga-auswahl" aria-label="Fahrzeugklasse wählen"><option value="">Klasse</option>${klassen.map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join("")}</select>` : "";
    // Fahrzeugwahl der Season: Die erlaubten Modelle kommen mit dem Fahrerstand.
    const modelle = (eigen && eigen.modelle) || [];
    const modell = modelle.length ? `<select data-modell class="liga-auswahl" aria-label="Fahrzeug wählen"><option value="">Fahrzeug wählen</option>${modelle.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("")}</select>` : "";
    return s.aufAnfrage
      ? `${auswahl}${modell}<button type="button" class="liga-melden" data-serie-aktion="serie-anfragen" data-serie="${esc(s.id)}">Beitritt anfragen</button>`
      : `${auswahl}${modell}<button type="button" class="liga-melden" data-serie-aktion="serie-anmelden" data-serie="${esc(s.id)}">Jetzt anmelden</button>`;
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
    // Ohne iRating-Klassen zeigen die Chips die Fahrzeugklassen, sofern welche eingetragen sind.
    const klassen = s.ohneKlassen ? (s.fahrzeugklassen || []).map((k) => `<span class="liga-klassenchip" style="--k:${window.LigaKarte.fahrzeugFarbe(k)}">${esc(k)}</span>`).join("") : (s.klassen || []).map((k) => `<span class="liga-klassenchip ${farbe(k)}">${esc(k.name)}</span>`).join("");
    const umfang = s.typ === "event" ? "Einzelrennen" : `${s.rennenGesamt} Rennen`;
    return `<article class="liga-poster ${farbeSerie(s)}${s.typ === "event" ? " ist-event" : ""}${s.status === "beendet" ? " beendet" : ""}">
      ${streamBand(s)}
      <div class="liga-poster-bild" style="background-image:url('${esc(kartenBild(s))}')" aria-hidden="true"></div>
      <div class="liga-poster-inhalt">
        <div class="liga-poster-kopf">${artBadge(s.typ)}${s.saison ? `<span class="liga-pill">${esc(s.saison)}</span>` : ""}${privatPill(s)}<span class="liga-pill farbig">${esc(s.status === "anmeldung" && s.anmeldungOffen === false ? "Anmeldung geschlossen" : STATUS[s.status] || "")}</span></div>
        <h3><a href="${serienLink(s)}">${esc(s.name)}</a></h3>
        ${s.beschreibung ? `<p>${esc(s.beschreibung)}</p>` : ""}
        <div class="liga-poster-klassen">${klassen}</div>
        <dl class="liga-poster-daten"><div><dt>Umfang</dt><dd>${esc(umfang)}</dd></div><div><dt>Nächstes Rennen</dt><dd>${naechstes ? `${esc(terminText(naechstes))} · ${esc(naechstes.strecke || naechstes.titel)}` : "Termine folgen"}</dd></div></dl>
        <div class="liga-serie-aktion">${s.status === "geplant"
          // Geplante Serien haben noch keine Tabelle: der Link zur Serie wird der Hauptknopf.
          ? `<a class="liga-melden zweit" href="${serienLink(s)}">${s.typ === "event" ? "Infos" : "Details"}</a>${serienAktion(s)}`
          : `${serienAktion(s)}<a class="liga-mini zweit" href="${serienLink(s)}">${s.typ === "event" ? "Infos" : "Tabelle"}</a>`}</div>
      </div>
    </article>`;
  }

  function terminZeile(r, s) {
    const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(r.datum || "");
    return `<a class="liga-termin ${farbeSerie(s)}${s.typ === "event" ? " ist-event" : ""}" href="${serienLink(s)}">
      <span class="liga-termin-datum"><b>${d ? d[3] : "–"}</b><small>${d ? MONATE[+d[2] - 1] : ""}</small></span>
      <span class="liga-termin-text">${artBadge(s.typ, true)}<b>${esc(r.titel)}</b><small>${esc(s.name)}${r.startzeit ? ` · ${esc(r.startzeit)} Uhr` : ""}${r.sichtung ? " · Sichtung" : ""}</small></span>
    </a>`;
  }

  // Das nächste Rennen groß im Kopfbereich
  function feature(r, s) {
    const start = startMs(r);
    return `<aside class="liga-feature ${farbeSerie(s)}">
      <div class="liga-feature-kopf"><span class="lbl">Nächstes Rennen</span>${artBadge(s.typ)}</div>
      <p class="liga-feature-serie">${esc(s.name)}</p>
      <h2>${esc(r.strecke || r.titel)}</h2>
      ${r.streckenBild ? `<img class="liga-feature-karte" src="api/liga?r=bild&k=${encodeURIComponent(r.streckenBild.k)}&v=${encodeURIComponent(r.streckenBild.v)}" alt="Streckenkarte ${esc(r.strecke)}" loading="lazy">` : ""}
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
    const termine = offeneRennen(rennen).filter((r) => { const t = startMs(r); return t === null || t + 3 * 3600e3 > Date.now(); }).map((r) => ({ r, s: serien.find((x) => x.id === r.serie) })).filter((x) => x.s && x.s.status !== "beendet");

    // Kopfbereich: nächstes Rennen und Zahlen
    const kopfBereich = document.querySelector(".liga-kopf");
    kopfBereich.classList.add("gross");
    const imBetrieb = (l) => l.filter((s) => s.status !== "geplant").length;
    // Nur Zahlen über null zeigen, sonst wirkt die Liga zwischen den Saisons leer.
    const inPlanung = aktiv.length - imBetrieb(aktiv);
    const klassenMax = Math.max(0, ...aktiv.filter((s) => !s.ohneKlassen).map((s) => (s.klassen || []).length));
    const fakten = [
      [imBetrieb(aktiv), imBetrieb(aktiv) === 1 ? "Aktive Serie" : "Aktive Serien"],
      [inPlanung, inPlanung === 1 ? "Serie in Planung" : "Serien in Planung"],
      [termine.length, termine.length === 1 ? "Geplantes Rennen" : "Geplante Rennen"],
      [klassenMax, "iRating-Klassen"],
    ].filter(([n]) => n > 0);
    $("liga-fortschritt").innerHTML = fakten.length ? `<div class="liga-fakten">${fakten.map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`).join("")}</div>` : "";
    if (termine[0]) { kopfBereich.querySelector(".wrap").insertAdjacentHTML("beforeend", feature(termine[0].r, termine[0].s)); countdown(); setInterval(countdown, 30000); }

    const liste = (l) => `<div class="liga-poster-raster">${l.map((s) => serienKarte(s, rennen)).join("")}</div>`;
    const ligen = aktiv.filter((s) => s.typ !== "event");
    const events = aktiv.filter((s) => s.typ === "event");
    if (ligen.length) einfuegen(abschnitt("Ligen", imBetrieb(ligen) ? `${imBetrieb(ligen)} aktiv` : "In Planung", "", liste(ligen)));
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
    if (b.dataset.serieAktion === "serie-anfrage-zurueck" && !window.confirm("Beitrittsanfrage zurückziehen?")) return;
    const auswahl = $("fz-" + b.dataset.serie);
    const anfrage = b.dataset.serieAktion === "serie-anfragen";
    const modell = b.dataset.serieAktion === "serie-anmelden" || anfrage ? b.parentElement.querySelector("select[data-modell]") : null;
    if (modell && !modell.value) { modell.focus(); return window.alert("Bitte wähle zuerst dein Fahrzeug für diese Season. Ein späterer Wechsel ist nur nach den Regeln der Season möglich."); }
    if (!anfrage && modell && !window.confirm(`Mit dem ${modell.value} für die Season anmelden? Ein späterer Fahrzeugwechsel ist nur eingeschränkt möglich.`)) return;
    // Bei einer Anfrage kann der Fahrer der Rennleitung kurz schreiben, warum er dabei sein möchte.
    const nachricht = anfrage ? window.prompt(`Beitrittsanfrage${modell ? ` mit dem ${modell.value}` : ""}. Möchtest du der Rennleitung etwas dazu schreiben? (freiwillig)`, "") : "";
    if (nachricht === null) return;
    b.disabled = true;
    try {
      const r = await fetch("api/liga?r=fahrer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aktion: b.dataset.serieAktion, serie: b.dataset.serie, fahrzeugklasse: auswahl ? auswahl.value : "", modell: modell ? modell.value : "", nachricht }) });
      if (r.ok) return location.reload();
      window.alert((await r.json().catch(() => ({}))).error || "Das hat nicht geklappt. Bitte versuche es noch einmal.");
    } catch (err) {
      window.alert("Keine Verbindung. Bitte versuche es noch einmal.");
    }
    b.disabled = false;
  });

  // Wiederkehrende Events: wer wann gewonnen hat und die ewige Bestenliste
  function eventreiheZeigen(reihe) {
    if (!reihe.ausgaben.length) return;
    const name = (f) => (f.pid ? `<a href="/fahrer?id=${encodeURIComponent(f.pid)}">${esc(f.name)}</a>` : esc(f.name));
    const ausgaben = reihe.ausgaben.map((a) => `<article class="liga-ausgabe"><header><a href="${serienLink({ id: a.serie })}"><b>${esc(a.jahr)}</b></a>${a.vorlaeufig ? VORLAEUFIG : ""}</header>${a.klassen.map((k) => `<div>${a.klassen.length > 1 ? `<h3>${esc(k.name)}</h3>` : ""}<ol>${k.podium.map((f) => `<li class="p${f.platz}"><em>${f.platz}</em>${name(f)}</li>`).join("")}</ol></div>`).join("")}</article>`).join("");
    einfuegen(abschnitt("Siegerliste", reihe.name, "", `<div class="liga-ausgaben">${ausgaben}</div>`));
    if (!reihe.bestenliste.length) return;
    const zeilen = reihe.bestenliste.map((f, i) => `<tr><td><span class="liga-fahrer"><span class="liga-pos ${podium(i + 1)}"><b>${i + 1}</b></span>${name(f)}</span></td><td class="zahl">${f.p1}</td><td class="zahl">${f.p2}</td><td class="zahl">${f.p3}</td></tr>`).join("");
    einfuegen(abschnitt("Ewige Bestenliste", reihe.name, "", `<div class="liga-scroll k-ges" tabindex="0" role="region" aria-label="Ewige Bestenliste"><table class="liga-tabelle"><thead><tr><th>Fahrer</th><th class="zahl">Siege</th><th class="zahl">2. Plätze</th><th class="zahl">3. Plätze</th></tr></thead><tbody>${zeilen}</tbody></table></div><p class="liga-legende"><span>Es zählen nur endgültige Ergebnisse.</span></p>`));
  }

  function zeige(d, regeln) {
    // Bei mehreren Fahrzeugklassen werden leere Gruppen ausgeblendet, sonst wären es zu viele Reiter.
    d.istEvent = regeln.typ === "event";
    const gruppen = new Set(d.klassen.map((k) => k.fahrzeugklasse)).size > 1 ? d.klassen.filter((k) => k.fahrer.length) : d.klassen;
    const besetzt = gruppen.filter((k) => k.fahrer.length);
    kopf(d, gruppen, regeln);

    // Die Tabelle ist das, wofür die meisten kommen, darum steht sie ganz oben.
    // Reiter je Fahrzeugklasse: zuerst Gesamt, dann die Fahrerklassen. Gesamt nur, wenn mindestens zwei Klassen besetzt sind.
    const alleReiter = !Array.isArray(d.gesamt) || !d.gesamt.length ? gruppen : [...new Set(gruppen.map((k) => k.fahrzeugId))].flatMap((fz) => {
      const eigene = gruppen.filter((k) => k.fahrzeugId === fz);
      const gesamt = d.gesamt.find((g) => g.fahrzeugId === fz);
      return gesamt && eigene.filter((k) => k.fahrer.length).length >= 2 ? [gesamt, ...eigene] : eigene;
    });
    const rennenMitErgebnis = d.rennen.filter((r) => Array.isArray(r.ergebnisse) && r.ergebnisse.length);
    const ansichtWahl = d.rennenGesamt > 1 && rennenMitErgebnis.length ? `<div class="liga-ansicht" role="group" aria-label="Saison oder einzelnes Rennen"><button type="button" data-ansicht="saison" aria-pressed="true">Saison</button>${rennenMitErgebnis.map((r) => `<button type="button" data-ansicht="${r.nr}" aria-pressed="false" title="${esc(r.strecke)}">R${r.nr}</button>`).join("")}</div>` : "";
    einfuegen(abschnitt(d.istEvent ? "Ergebnis" : "Tabelle", d.saison, "", `${ansichtWahl}<div class="liga-tabs" role="tablist" aria-label="Wertung wählen">${alleReiter.map((k) => `<button type="button" class="${farbe(k)}" role="tab" id="tab-${esc(k.id)}" data-k="${esc(k.id)}" aria-controls="liga-tabelle" aria-selected="false">${esc(k.name)}</button>`).join("")}</div>
      <div id="liga-tabelle" role="tabpanel"></div>
      <p class="liga-legende" id="liga-legende"><span><b style="color:var(--liga-gold)">Gold</b>, <b style="color:var(--liga-silber)">Silber</b>, <b style="color:var(--liga-bronze)">Bronze</b> = Podium</span><span><b class="liga-tag pp">PP</b> = Pole</span><span><b class="liga-tag sr">SR</b> = schnellste Runde</span><span><b class="liga-tag aus">DNF</b> = nicht gewertet</span><span><b class="liga-tag aus">DSQ</b> = disqualifiziert</span><span>Durchgestrichen = Streichergebnis</span></p>`, "liga-tabelle-bereich"));

    // Letztes Rennen zuerst, ältere Berichte über die Rennnummern
    const berichte = d.rennen.filter((r) => Array.isArray(r.bericht) && r.bericht.length);
    if (berichte.length) {
      const letzter = berichte[berichte.length - 1];
      const wahl = berichte.length > 1 ? `<div class="liga-bericht-wahl" role="group" aria-label="Rennen wählen">${berichte.map((r) => `<button type="button" data-bericht="${r.nr}" aria-pressed="${r === letzter}" title="${esc(r.strecke)}">R${r.nr}</button>`).join("")}</div>` : "";
      einfuegen(abschnitt("Rennbericht", `Aus Runde ${letzter.nr}`, "", `${wahl}<div id="liga-bericht">${berichtHtml(letzter, regeln)}</div>`));
      document.querySelectorAll("[data-bericht]").forEach((b) => b.addEventListener("click", () => {
        document.querySelectorAll("[data-bericht]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        $("liga-bericht").innerHTML = berichtHtml(berichte.find((r) => String(r.nr) === b.dataset.bericht), regeln);
      }));
    }

    const titelLaeuft = d.rennenGesamt > 1 && d.restRennen > 0;
    const spitzeTitel = titelLaeuft ? "Titelkampf" : d.rennenGesamt > 1 && d.restRennen === 0 ? "Endstand" : "Die Spitze";
    const spitzeMeta = titelLaeuft ? `Noch ${d.restRennen} Rennen · bis zu ${d.maxProRennen} Punkte pro Rennen` : `Nach ${d.rennen.length} von ${d.rennenGesamt} Rennen`;
    if (!d.istEvent) einfuegen(abschnitt(spitzeTitel, spitzeMeta, "", `<div class="liga-karten">${besetzt.map((k) => karte(k, d)).join("")}</div>${titelLaeuft ? '<p class="liga-legende"><span>Voller Balken = aktuelle Punkte</span><span>Heller Balken = bis Saisonende noch möglich</span><span>Stand ohne künftige Strafen</span></p>' : ""}`));
    const fahrerkarten = fahrerkartenAbschnitt(besetzt, regeln, d);
    if (fahrerkarten) einfuegen(fahrerkarten);
    // Rennen und Regeln nebeneinander
    const block = (titel, meta, inhalt) => `<div class="liga-block"><div class="doc-head"><h2 class="wide">${esc(titel)}</h2><div class="doc-meta lbl">${esc(meta)}</div></div><div class="liga-abschnitt-inhalt">${inhalt}</div></div>`;
    const regelnGueltig = regeln && Array.isArray(regeln.klassen) && Array.isArray(regeln.punkte);
    einfuegen(`<section class="sheet"><div class="wrap liga-zwei">${block("Rennen", `${d.rennen.length} gefahren`, rennkarten(d, besetzt))}${regelnGueltig ? block("Regeln", "Punkte und Klassen", regelnHtml(regeln)) : ""}</div></section>`);

    const reiter = [...document.querySelectorAll(".liga-tabs button")];
    const ansichtKnoepfe = [...document.querySelectorAll("[data-ansicht]")];
    // Ein einzelnes Event hat keine Saison, dort zählt nur das Rennergebnis.
    let ansicht = (d.rennenGesamt === 1 || d.istEvent) && rennenMitErgebnis.length ? String(rennenMitErgebnis[0].nr) : "saison";
    let aktiv = (alleReiter.find((k) => k.fahrer.length) || alleReiter[0]).id;
    const zeichne = () => {
      const k = alleReiter.find((x) => x.id === aktiv);
      const r = ansicht === "saison" ? null : rennenMitErgebnis.find((x) => String(x.nr) === ansicht);
      reiter.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.k === aktiv)));
      ansichtKnoepfe.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.ansicht === ansicht)));
      const offeneRunden = d.rennen.filter((x) => x.vorlaeufig).map((x) => `R${x.nr}`).join(", ");
      const hinweis = r ? (r.vorlaeufig ? vorlaeufigHinweis("Strafen der Rennleitung können dieses Ergebnis noch ändern.") : "") : offeneRunden ? vorlaeufigHinweis(`${offeneRunden} noch nicht endgültig. Strafen der Rennleitung können die Wertung noch ändern.`) : "";
      $("liga-tabelle").innerHTML = r ? `${hinweis}<p class="liga-renninfo"><b>R${r.nr}</b>${esc([r.strecke, r.variante, datum(r.start)].filter(Boolean).join(" · "))}</p>${rennTabelle(k, r, d)}` : `${hinweis}${tabelle(k, d)}`;
      $("liga-legende").style.display = r ? "none" : "";
    };
    const waehle = (id) => { aktiv = id; zeichne(); };
    reiter.forEach((b) => b.addEventListener("click", () => waehle(b.dataset.k)));
    ansichtKnoepfe.forEach((b) => b.addEventListener("click", () => { ansicht = b.dataset.ansicht; zeichne(); }));
    document.querySelectorAll(".liga-karte").forEach((b) => b.addEventListener("click", () => {
      ansicht = d.rennenGesamt === 1 && rennenMitErgebnis.length ? ansicht : "saison";
      waehle(b.dataset.k);
      $("liga-tabelle-bereich").scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth" });
    }));
    zeichne();
    fahrerDialog(besetzt, regeln, d);
  }

  const lade = (pfad) => fetch(pfad, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const kennung = new URLSearchParams(location.search).get("serie");
  Promise.all([lade(`api/liga?r=oeffentlich${kennung ? `&serie=${encodeURIComponent(kennung)}` : ""}`), lade("api/liga?r=fahrer")]).then(([daten, fahrer]) => {
    fahrerStand = fahrer;
    fahrerProfile = (daten && daten.fahrerprofile) || {};
    const serien = (daten && daten.serien) || [];
    const rennen = (daten && daten.rennen) || [];
    const s = kennung && serien.find((x) => x.id === kennung);
    // Titelbild: Bild der Serie, sonst das Bild der Übersicht, sonst das Teamfoto
    $("liga-kopfbild").src = s && s.bildVersion ? eigenesBild(`serie-${s.id}`, s.bildVersion) : daten && daten.kopfbildVersion ? eigenesBild("uebersicht", daten.kopfbildVersion) : "img/hero.webp";
    if (!s) return uebersicht(serien, rennen);

    document.title = `${s.name} · Darkline Simracing Series`;
    $("liga-titel").innerHTML = esc(s.name);
    document.querySelector(".liga-kicker").innerHTML = `${artBadge(s.typ)}${privatPill(s)}${streamBadge(s)}`;
    $("liga-saison").textContent = [s.saison, s.beschreibung].filter(Boolean).join(" · ");
    $("liga-cta").innerHTML = `${serienAktion(s)}<a class="liga-mini zweit" href="/liga">Alle Serien</a>`;
    const d = daten.tabelle;
    if (d && Array.isArray(d.rennen) && d.rennen.length && Array.isArray(d.klassen)) zeige(d, s);
    else vorschau(s, rennen);
    if (daten.eventreihe) eventreiheZeigen(daten.eventreihe);
  });
})();
