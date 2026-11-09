// Wertung der Darkline Liga: liest iRacing-Ergebnisdateien (eventresult-….json) und berechnet Klassen, Punkte und Tabellen.
// Reine Rechenlogik ohne Seitenbezug: läuft im Browser (window.LigaWertung) und in Node (scripts/liga-auswerten.js, scripts/liga-test.js).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LigaWertung = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Rennsession in der iRacing-Datei (3 = Training, 4 = Qualifying, 6 = Rennen)
  const SESSION_RENNEN = 6;

  // iRacing zählt Positionen ab 0 (der Sieger hat finish_position 0). Innerhalb der Wertung beginnt alles bei 1.
  function leseErgebnis(json) {
    const d = (json && json.data) || json;
    if (!d || !Array.isArray(d.session_results)) throw new Error("Das ist keine iRacing-Ergebnisdatei (session_results fehlt).");
    const rennen = d.session_results.filter((s) => s.simsession_type === SESSION_RENNEN);
    if (!rennen.length) throw new Error("In der Datei ist keine Rennsession enthalten.");
    const warnungen = [];
    if (rennen.length > 1) warnungen.push(`Datei enthält ${rennen.length} Rennsessions, gewertet wird nur das Hauptrennen.`);
    const haupt = rennen.find((s) => s.simsession_number === 0) || rennen[rennen.length - 1];
    const zeilen = (haupt.results || []).filter((r) => !r.ai);
    if (!zeilen.length) throw new Error("Die Rennsession enthält keine Fahrer.");
    if (zeilen.some((r) => !(r.cust_id > 0))) throw new Error("Teamrennen werden noch nicht gewertet (Einträge ohne iRacing-ID).");
    const kleinste = Math.min(...zeilen.map((r) => r.finish_position));
    if (kleinste !== 0) throw new Error(`Unerwartete Platzierungen in der Datei (kleinste finish_position ist ${kleinste}, erwartet wird 0).`);

    const fahrer = zeilen
      .map((r) => ({
        cust: String(r.cust_id),
        name: String(r.display_name || "").trim() || `Fahrer ${r.cust_id}`,
        irating: Number(r.oldi_rating),
        fahrzeugklasseId: r.car_class_id > 0 ? String(r.car_class_id) : "0",
        fahrzeugklasseName: String(r.car_class_short_name || "").trim(),
        // Abstand zum Klassensieger in 1/10000 Sekunden. iRacing liefert -1 für alle, die nicht in der Führungsrunde sind.
        klassenAbstand: Number.isFinite(r.class_interval) ? r.class_interval : null,
        gesamt: r.finish_position + 1,
        start: r.starting_position >= 0 ? r.starting_position + 1 : null,
        runden: Number(r.laps_complete) || 0,
        besteRunde: r.best_lap_time > 0 ? r.best_lap_time : null,
        incidents: Number(r.incidents) || 0,
        disqualifiziert: /disq/i.test(String(r.reason_out || "")),
      }))
      .sort((a, b) => a.gesamt - b.gesamt);

    return {
      id: String(d.subsession_id),
      start: d.start_time || "",
      strecke: (d.track && d.track.track_name) || "",
      variante: (d.track && d.track.config_name) || "",
      kategorie: d.license_category || "",
      offiziell: !!d.official_session,
      fahrer,
      warnungen,
    };
  }

  // Bricht ab, wenn die Klassen Lücken oder Überschneidungen haben, damit niemand ohne Klasse bleibt.
  function pruefeRegeln(r) {
    if (!Array.isArray(r.klassen) || !r.klassen.length) throw new Error("Regeln: keine Klassen angegeben.");
    if (new Set(r.klassen.map((k) => k.id)).size !== r.klassen.length) throw new Error("Regeln: Klassen-IDs sind nicht eindeutig.");
    const k = [...r.klassen].sort((a, b) => a.min - b.min);
    if (k[0].min !== 0) throw new Error("Regeln: die unterste Klasse muss bei iRating 0 beginnen.");
    k.forEach((x, i) => {
      if (i === k.length - 1) {
        if (x.max != null) throw new Error("Regeln: die oberste Klasse muss nach oben offen sein (max: null).");
      } else if (x.max == null || x.max + 1 !== k[i + 1].min) {
        throw new Error(`Regeln: zwischen ${x.name} und ${k[i + 1].name} gibt es eine Lücke oder Überschneidung.`);
      }
    });
    if (!Array.isArray(r.punkte) || !r.punkte.length) throw new Error("Regeln: keine Punktetabelle angegeben.");
    if (!(r.gewerteteRennen > 0) || r.gewerteteRennen > r.rennenGesamt) throw new Error("Regeln: gewerteteRennen muss zwischen 1 und rennenGesamt liegen.");
    if (!(r.mindestRundenProzent >= 0 && r.mindestRundenProzent <= 100)) throw new Error("Regeln: mindestRundenProzent muss zwischen 0 und 100 liegen.");
  }

  // Eine leere Obergrenze (im Admin nicht ausgefüllt) bedeutet: nach oben offen.
  const klasseFuer = (irating, klassen) => klassen.find((k) => irating >= k.min && (k.max == null || irating <= k.max));

  // Die Klasse wird beim ersten Auftreten festgelegt und gilt die ganze Saison. Einträge in privat.einstufung haben Vorrang.
  function einstufen(rennenListe, regeln, privat, warnungen) {
    const unterste = [...regeln.klassen].sort((a, b) => a.min - b.min)[0];
    const fest = (privat && privat.einstufung) || {};
    const map = new Map();
    for (const rennen of rennenListe) {
      for (const f of rennen.fahrer) {
        if (map.has(f.cust)) continue;
        if (fest[f.cust]) {
          const k = regeln.klassen.find((x) => x.id === fest[f.cust]);
          if (!k) throw new Error(`Einstufung: unbekannte Klasse „${fest[f.cust]}“.`);
          map.set(f.cust, { klasse: k.id, irating: f.irating });
        } else if (f.irating > 0) {
          map.set(f.cust, { klasse: klasseFuer(f.irating, regeln.klassen).id, irating: f.irating });
        } else {
          warnungen.push(`${f.name} hat kein iRating in der Datei und wurde vorläufig in ${unterste.name} eingestuft.`);
          map.set(f.cust, { klasse: unterste.id, irating: null });
        }
      }
    }
    return map;
  }

  const punkteFuer = (platz, regeln) => regeln.punkte[platz - 1] ?? (regeln.punkteDanach || 0);

  // Wertet ein Rennen getrennt je Fahrzeugklasse und iRating-Klasse aus. Ergebnis: Map iRacing-ID → Rennwertung.
  function werteRennen(rennen, einstufung, regeln) {
    const ergebnis = new Map();
    const gruppen = [...new Set(rennen.fahrer.map((f) => f.fahrzeugklasseId))].flatMap((fz) => regeln.klassen.map((klasse) => ({ fz, klasse })));
    for (const { fz, klasse } of gruppen) {
      const starter = rennen.fahrer.filter((f) => f.fahrzeugklasseId === fz && einstufung.get(f.cust).klasse === klasse.id);
      const sieger = starter.find((f) => !f.disqualifiziert);
      const siegerRunden = sieger ? sieger.runden : 0;
      const gewertet = (f) => !f.disqualifiziert && siegerRunden > 0 && f.runden * 100 >= siegerRunden * regeln.mindestRundenProzent;
      const startPlaetze = starter.filter((f) => f.start !== null);
      const pole = startPlaetze.length ? startPlaetze.reduce((a, b) => (b.start < a.start ? b : a)) : null;
      const mitRunde = starter.filter((f) => f.besteRunde !== null);
      const schnellste = mitRunde.length ? mitRunde.reduce((a, b) => (b.besteRunde < a.besteRunde ? b : a)) : null;

      let platz = 0;
      for (const f of starter) {
        const ok = gewertet(f);
        if (ok) platz++;
        // Bonuspunkte gibt es nur für gewertete Fahrer. Fällt der Halter aus, verfällt der Bonus.
        const hatPole = ok && f === pole;
        const hatRunde = ok && f === schnellste;
        const basis = ok ? punkteFuer(platz, regeln) : 0;
        ergebnis.set(f.cust, {
          klasse: klasse.id,
          fahrzeugklasse: fz,
          platz: ok ? platz : null,
          status: f.disqualifiziert ? "DSQ" : ok ? "OK" : "DNF",
          punkte: basis + (hatPole ? regeln.bonusPole || 0 : 0) + (hatRunde ? regeln.bonusSchnellsteRunde || 0 : 0),
          pole: hatPole,
          schnellsteRunde: hatRunde,
          runden: f.runden,
          incidents: f.incidents,
          zeitstrafe: f.zeitstrafe || 0,
        });
      }
    }
    return ergebnis;
  }

  // Wendet Disqualifikationen und Zeitstrafen der Rennleitung auf eine Kopie des Rennens an.
  // Zeitstrafen verschieben Fahrer innerhalb ihrer Fahrzeugklasse. Überrundete haben keinen Zeitabstand und bleiben, wo sie sind.
  function wendeEntscheidungenAn(rennen, privat, warnungen) {
    const zuRennen = (liste) => ((privat && liste) || []).filter((x) => String(x.rennen) === rennen.id);
    const dsq = new Set(zuRennen(privat && privat.disqualifikationen).map((x) => String(x.cust)));
    const zeiten = new Map();
    zuRennen(privat && privat.zeitstrafen).forEach((x) => zeiten.set(String(x.cust), (zeiten.get(String(x.cust)) || 0) + Math.abs(Number(x.sekunden) || 0)));
    if (!dsq.size && !zeiten.size) return rennen;
    const fahrer = rennen.fahrer.map((f) => ({ ...f, disqualifiziert: f.disqualifiziert || dsq.has(f.cust) }));
    for (const fz of new Set(fahrer.map((f) => f.fahrzeugklasseId))) {
      const gruppe = fahrer.filter((f) => f.fahrzeugklasseId === fz);
      if (!gruppe.some((f) => zeiten.has(f.cust))) continue;
      const wertbar = gruppe.filter((f) => f.klassenAbstand !== null && f.klassenAbstand >= 0);
      gruppe.filter((f) => zeiten.has(f.cust) && !wertbar.includes(f)).forEach((f) => warnungen.push(`Zeitstrafe für ${f.name} wurde nicht angewendet, weil der Fahrer nicht in der Führungsrunde war. Bitte stattdessen Strafpunkte vergeben.`));
      const plaetze = wertbar.map((f) => f.gesamt);
      const effektiv = (f) => f.klassenAbstand + (zeiten.get(f.cust) || 0) * 10000;
      wertbar.forEach((f) => { if (zeiten.has(f.cust)) f.zeitstrafe = zeiten.get(f.cust); });
      [...wertbar].sort((a, b) => effektiv(a) - effektiv(b) || a.gesamt - b.gesamt).forEach((f, i) => { f.gesamt = plaetze[i]; });
    }
    return { ...rennen, fahrer: fahrer.sort((a, b) => a.gesamt - b.gesamt) };
  }

  /* ---------- Fahrerkarte, Rennbericht und Titelkampf: alles wird aus den Ergebnisdateien abgeleitet ---------- */

  // Ab so vielen Rennen ist das Gesamtrating aussagekräftig genug, um es zu zeigen.
  const RATING_MIN_RENNEN = 3;
  const skala = (w) => Math.round(Math.min(99, Math.max(40, w)));
  const schnitt = (l) => l.reduce((t, x) => t + x, 0) / l.length;

  // Vergleichswerte eines Rennens innerhalb der Fahrzeugklasse. Map iRacing-ID → Kennzahlen.
  function rennKennzahlen(rennen) {
    const map = new Map();
    for (const fz of new Set(rennen.fahrer.map((f) => f.fahrzeugklasseId))) {
      const feld = rennen.fahrer.filter((f) => f.fahrzeugklasseId === fz);
      const zielListe = [...feld.filter((f) => !f.disqualifiziert), ...feld.filter((f) => f.disqualifiziert)];
      const startListe = feld.filter((f) => f.start !== null).sort((a, b) => a.start - b.start);
      const mitRunde = feld.filter((f) => !f.disqualifiziert && f.besteRunde !== null);
      // Ohne zweite Rundenzeit gibt es nichts zu vergleichen.
      const bestzeit = mitRunde.length > 1 ? Math.min(...mitRunde.map((f) => f.besteRunde)) : null;
      zielListe.forEach((f, ziel) => {
        const start = startListe.indexOf(f);
        map.set(f.cust, {
          aufgeholt: start >= 0 ? start - ziel : null,
          startAnteil: start >= 0 && startListe.length > 1 ? start / (startListe.length - 1) : null,
          zielAnteil: feld.length > 1 ? ziel / (feld.length - 1) : null,
          speedAbstand: bestzeit !== null && f.besteRunde !== null ? (f.besteRunde / bestzeit - 1) * 100 : null,
        });
      });
    }
    return map;
  }

  // Automatischer Rennbericht je Fahrzeugklasse
  function rennBericht(rennen, wertung, kennzahlen, fahrzeugklassen) {
    return fahrzeugklassen.map((fz) => {
      const feld = rennen.fahrer.filter((f) => f.fahrzeugklasseId === fz.id);
      const gewertet = feld.filter((f) => wertung.get(f.cust).status === "OK");
      if (!gewertet.length) return null;
      // reduce behält bei Gleichstand den Fahrer, der weiter vorn angekommen ist.
      const gewinne = gewertet.filter((f) => kennzahlen.get(f.cust).aufgeholt > 0);
      const aufholer = gewinne.length ? gewinne.reduce((a, b) => (kennzahlen.get(b.cust).aufgeholt > kennzahlen.get(a.cust).aufgeholt ? b : a)) : null;
      const mitRunde = feld.filter((f) => !f.disqualifiziert && f.besteRunde !== null);
      const schnellste = mitRunde.length ? mitRunde.reduce((a, b) => (b.besteRunde < a.besteRunde ? b : a)) : null;
      const sauberster = gewertet.reduce((a, b) => (b.incidents < a.incidents ? b : a));
      return {
        fahrzeugklasse: fz.name,
        starter: feld.length,
        podium: gewertet.slice(0, 3).map((f) => f.name),
        aufholer: aufholer ? { name: aufholer.name, plaetze: kennzahlen.get(aufholer.cust).aufgeholt } : null,
        schnellste: schnellste ? { name: schnellste.name, zeit: schnellste.besteRunde } : null,
        sauberster: { name: sauberster.name, incidents: sauberster.incidents },
      };
    }).filter(Boolean);
  }

  // Längste Folge von Rennen, die die Bedingung erfüllen. Ein ausgelassenes Rennen beendet die Folge.
  function laengsteFolge(rennen, bedingung) {
    let beste = 0;
    let aktuell = 0;
    for (const r of rennen) {
      aktuell = r && bedingung(r) ? aktuell + 1 : 0;
      beste = Math.max(beste, aktuell);
    }
    return beste;
  }

  function fahrerKarte(rennen, kennzahlen, strafpunkte) {
    const gefahren = rennen.map((r, i) => r && { r, z: kennzahlen[i].get(r.cust) }).filter(Boolean);
    const abstaende = gefahren.map((x) => x.z.speedAbstand).filter((x) => x !== null);
    const runden = gefahren.reduce((t, x) => t + x.r.runden, 0);
    const incidents = gefahren.reduce((t, x) => t + x.r.incidents, 0);
    const dsq = gefahren.filter((x) => x.r.status === "DSQ").length;
    const zeitstrafen = gefahren.filter((x) => x.r.zeitstrafe).length;
    // Entscheidungen der Rennleitung kosten Sauberkeit, auch wenn die Incidents niedrig waren.
    const abzug = Math.min(25, strafpunkte + dsq * 5 + zeitstrafen * 2);
    const racecraftWerte = gefahren.filter((x) => x.z.startAnteil !== null && x.z.zielAnteil !== null).map(({ z }) => skala(52 + 55 * (z.startAnteil - z.zielAnteil) + 40 * (1 - z.zielAnteil)));
    // Ein Ausfall zählt wie der letzte Platz.
    const zielWerte = gefahren.filter((x) => x.z.zielAnteil !== null).map((x) => (x.r.status === "OK" ? x.z.zielAnteil : 1));
    const mittel = zielWerte.length ? schnitt(zielWerte) : 0;

    const speed = abstaende.length ? skala(99 - 13 * schnitt(abstaende)) : null;
    const sauberkeit = runden > 0 ? skala(99 - 120 * (incidents / runden) - abzug) : null;
    const racecraft = racecraftWerte.length ? skala(schnitt(racecraftWerte)) : null;
    const konstanz = zielWerte.length >= 2 ? skala(99 - 200 * Math.sqrt(schnitt(zielWerte.map((w) => (w - mittel) ** 2)))) : null;
    const vollstaendig = gefahren.length >= RATING_MIN_RENNEN && [speed, sauberkeit, racecraft, konstanz].every((w) => w !== null);

    const abzeichen = [];
    const hattricks = gefahren.filter((x) => x.r.platz === 1 && x.r.pole && x.r.schnellsteRunde).length;
    if (hattricks) abzeichen.push({ art: "hattrick", text: hattricks > 1 ? `${hattricks}× Hattrick` : "Hattrick" });
    const siegesserie = laengsteFolge(rennen, (r) => r.platz === 1);
    if (siegesserie >= 3) abzeichen.push({ art: "siege", text: `${siegesserie} Siege in Folge` });
    const podeste = laengsteFolge(rennen, (r) => r.platz !== null && r.platz <= 3);
    if (podeste >= 3 && podeste > siegesserie) abzeichen.push({ art: "podest", text: `${podeste}× Podest in Folge` });
    const sauber = gefahren.filter((x) => x.r.status === "OK" && x.r.incidents === 0).length;
    if (sauber >= 2) abzeichen.push({ art: "sauber", text: `${sauber}× sauber` });
    const comeback = Math.max(0, ...gefahren.filter((x) => x.r.status === "OK").map((x) => x.z.aufgeholt || 0));
    if (comeback >= 5) abzeichen.push({ art: "comeback", text: `Comeback +${comeback}` });
    if (gefahren.length >= RATING_MIN_RENNEN && gefahren.length === rennen.length && gefahren.every((x) => x.r.status === "OK")) abzeichen.push({ art: "ziel", text: "Immer im Ziel" });

    return {
      rating: vollstaendig ? Math.round(0.35 * speed + 0.25 * sauberkeit + 0.25 * racecraft + 0.15 * konstanz) : null,
      speed, sauberkeit, racecraft, konstanz,
      rennen: gefahren.length,
      podien: gefahren.filter((x) => x.r.platz !== null && x.r.platz <= 3).length,
      ausfaelle: gefahren.filter((x) => x.r.status !== "OK").length,
      abzeichen,
    };
  }

  // Titelkampf einer Wertung. Jede Aussage gilt nach aktuellem Stand mathematisch, auch mit Streichergebnissen.
  // Ein neu einsteigender Fahrer wird mitgerechnet, damit niemand zu früh zum Meister erklärt wird.
  function titelStand(fahrer, regeln, rest) {
    if (!fahrer.length) return;
    const punkteAus = (f, neu) => [...f.rennen.filter(Boolean).map((r) => r.punkte), ...neu].sort((a, b) => b - a).slice(0, regeln.gewerteteRennen).reduce((t, p) => t + p, 0) - f.strafpunkte;
    const mal = (n, wert) => Array.from({ length: Math.max(0, n) }, () => wert);
    const bonus = (regeln.bonusPole || 0) + (regeln.bonusSchnellsteRunde || 0);
    const sieg = punkteFuer(1, regeln);
    const zweiter = punkteFuer(2, regeln);
    const maximal = sieg + bonus;
    const anzahl = fahrer.length;
    const tabellenplaetze = regeln.punkte.length;
    const erster = fahrer[0];
    const neuling = { rennen: [], strafpunkte: 0 };
    const rivalen = (f) => [...fahrer.filter((x) => x !== f), neuling];
    fahrer.forEach((f) => { f.titel = { status: "", text: "", maxEnde: punkteAus(f, mal(rest, maximal)) }; });

    if (rest <= 0) {
      erster.titel = { ...erster.titel, status: "meister", text: "Meister" };
      return;
    }
    // Wer alle restlichen Rennen ohne Bonus gewinnt, darf von niemandem mehr eingeholt werden, der immer Zweiter mit vollem Bonus wird.
    const inEigenerHand = (f) => {
      const eigene = punkteAus(f, mal(rest, sieg));
      return rivalen(f).every((r) => eigene > punkteAus(r, mal(rest, zweiter + bonus)));
    };

    fahrer.forEach((f) => {
      if (f === erster) {
        if (rivalen(f).every((r) => punkteAus(r, mal(rest, maximal)) < f.punkte)) { f.titel.status = "meister"; f.titel.text = "Meister"; return; }
        // Matchball: der schlechteste Platz im nächsten Rennen, mit dem kein Rivale mehr vorbeikommt, ohne Bonus für den Führenden.
        for (let platz = tabellenplaetze; platz >= 1; platz--) {
          const eigene = punkteAus(f, [punkteFuer(platz, regeln)]);
          const naechstes = platz === 1 ? zweiter + bonus : maximal;
          if (rivalen(f).every((r) => eigene > punkteAus(r, [naechstes, ...mal(rest - 1, maximal)]))) {
            const noetig = Math.min(platz, anzahl);
            f.titel.status = "matchball";
            f.titel.text = noetig === 1 ? "Titel mit einem Sieg sicher" : `Titel mit P${noetig} sicher`;
            return;
          }
        }
        if (inEigenerHand(f)) { f.titel.status = "eigen"; f.titel.text = "Titel in eigener Hand"; return; }
        f.titel.status = "fuehrt"; f.titel.text = "Führt die Wertung an";
        return;
      }
      if (f.titel.maxEnde < erster.punkte) { f.titel.status = "raus"; f.titel.text = "Titel nicht mehr möglich"; return; }
      if (inEigenerHand(f)) { f.titel.status = "eigen"; f.titel.text = rest === 1 ? "Mit einem Sieg Meister" : "Titel in eigener Hand"; return; }
      f.titel.status = "hilfe";
      // Der schlechteste Platz im nächsten Rennen, mit dem der Titel überhaupt noch erreichbar bleibt.
      let platz = tabellenplaetze;
      while (platz > 1 && punkteAus(f, [punkteFuer(platz, regeln) + bonus, ...mal(rest - 1, maximal)]) < erster.punkte) platz--;
      f.titel.text = platz === 1 ? "Braucht einen Sieg" : platz < Math.min(tabellenplaetze, anzahl) ? `Braucht mindestens P${platz}` : "Noch im Titelrennen";
    });
  }

  // Reihenfolge bei Punktgleichheit: mehr Siege, mehr zweite Plätze usw., dann das bessere jüngste Rennen.
  function vergleiche(a, b, anzahlRennen) {
    if (b.punkte !== a.punkte) return b.punkte - a.punkte;
    const anzahl = (s, p) => s.rennen.filter((r) => r && r.platz === p).length;
    const maxPlatz = Math.max(1, ...[a, b].flatMap((s) => s.rennen.map((r) => (r && r.platz) || 0)));
    for (let p = 1; p <= maxPlatz; p++) {
      const d = anzahl(b, p) - anzahl(a, p);
      if (d) return d;
    }
    const wert = (s, i) => (s.rennen[i] && s.rennen[i].platz) || Infinity;
    for (let i = anzahlRennen - 1; i >= 0; i--) {
      if (wert(a, i) !== wert(b, i)) return wert(a, i) < wert(b, i) ? -1 : 1;
    }
    return a.name.localeCompare(b.name, "de");
  }

  // Berechnet die Tabellen. Die Rückgabe enthält keine iRacing-IDs und kann öffentlich gespeichert werden.
  function berechneTabelle(rennenEingabe, regeln, privat) {
    pruefeRegeln(regeln);
    const warnungen = rennenEingabe.flatMap((r) => r.warnungen || []);
    const ids = rennenEingabe.map((r) => r.id);
    if (new Set(ids).size !== ids.length) throw new Error("Ein Rennen wurde doppelt angegeben.");
    if (rennenEingabe.length > regeln.rennenGesamt) warnungen.push(`Es sind mehr Rennen angegeben (${rennenEingabe.length}) als die Saison vorsieht (${regeln.rennenGesamt}).`);
    for (const r of rennenEingabe) {
      if (r.offiziell) warnungen.push(`Rennen ${r.id} ist ein offizielles iRacing-Rennen und keine Ligasession.`);
      if (regeln.kategorie && r.kategorie !== regeln.kategorie) warnungen.push(`Rennen ${r.id} hat die Kategorie ${r.kategorie || "unbekannt"} statt ${regeln.kategorie}, das iRating stammt also aus einer anderen Wertung.`);
    }
    const rennenListe = [...rennenEingabe].sort((a, b) => String(a.start).localeCompare(String(b.start))).map((r) => wendeEntscheidungenAn(r, privat, warnungen));
    const einstufung = einstufen(rennenListe, regeln, privat, warnungen);
    const wertungen = rennenListe.map((r) => werteRennen(r, einstufung, regeln));
    const kennzahlen = rennenListe.map(rennKennzahlen);

    const strafen = new Map();
    for (const s of (privat && privat.strafen) || []) {
      const idx = rennenListe.findIndex((r) => r.id === String(s.rennen));
      if (idx < 0 || !wertungen[idx].has(String(s.cust))) { warnungen.push(`Strafe für Rennen ${s.rennen} konnte keinem Fahrer zugeordnet werden.`); continue; }
      const key = `${idx}:${s.cust}`;
      strafen.set(key, (strafen.get(key) || 0) + Math.abs(Number(s.punkte) || 0));
    }

    const namen = new Map();
    rennenListe.forEach((r) => r.fahrer.forEach((f) => namen.set(f.cust, f.name)));

    // Fahrzeugklassen in der Reihenfolge ihres ersten Auftretens. Da der Zieleinlauf sortiert ist, steht die schnellere vorn.
    const fahrzeugklassen = [];
    const fahrzeugeJeFahrer = new Map();
    rennenListe.forEach((r) => r.fahrer.forEach((f) => {
      if (!fahrzeugklassen.some((x) => x.id === f.fahrzeugklasseId)) {
        fahrzeugklassen.push({ id: f.fahrzeugklasseId, name: (regeln.fahrzeugklassenNamen || {})[f.fahrzeugklasseName] || f.fahrzeugklasseName || f.fahrzeugklasseId });
      }
      if (!fahrzeugeJeFahrer.has(f.cust)) fahrzeugeJeFahrer.set(f.cust, new Set());
      fahrzeugeJeFahrer.get(f.cust).add(f.fahrzeugklasseId);
    }));
    fahrzeugeJeFahrer.forEach((set, cust) => {
      if (set.size > 1) warnungen.push(`${namen.get(cust)} ist in ${set.size} Fahrzeugklassen gestartet und wird in jeder getrennt gewertet.`);
    });
    const mehrere = fahrzeugklassen.length > 1;

    const klassen = fahrzeugklassen.flatMap((fz) => regeln.klassen.map((k) => {
      const inGruppe = (r) => r && r.fahrzeugklasse === fz.id;
      const fahrer = [...einstufung.entries()].filter(([cust, e]) => e.klasse === k.id && wertungen.some((w) => inGruppe(w.get(cust)))).map(([cust, e]) => {
        const rennen = wertungen.map((w, i) => {
          const r = w.get(cust);
          if (!inGruppe(r)) return null;
          return { cust, platz: r.platz, status: r.status, punkte: r.punkte, pole: r.pole, schnellsteRunde: r.schnellsteRunde, strafe: strafen.get(`${i}:${cust}`) || 0, gestrichen: false, runden: r.runden, incidents: r.incidents, zeitstrafe: r.zeitstrafe };
        });
        // Beste Rennen zählen. Bei gleichen Punkten bleibt das jüngere Rennen in der Wertung.
        const gefahren = rennen.map((r, i) => ({ r, i })).filter((x) => x.r).sort((a, b) => b.r.punkte - a.r.punkte || b.i - a.i);
        gefahren.slice(regeln.gewerteteRennen).forEach((x) => { x.r.gestrichen = true; });
        const summe = gefahren.slice(0, regeln.gewerteteRennen).reduce((t, x) => t + x.r.punkte, 0);
        // Strafpunkte werden immer abgezogen, auch wenn das Rennen gestrichen wurde.
        const strafpunkte = rennen.reduce((t, r) => t + (r ? r.strafe : 0), 0);
        const runden = rennen.reduce((t, r) => t + (r ? r.runden : 0), 0);
        const incidents = rennen.reduce((t, r) => t + (r ? r.incidents : 0), 0);
        return {
          name: namen.get(cust),
          irating: e.irating,
          rennen: rennen.map((r) => r && { platz: r.platz, status: r.status, punkte: r.punkte, pole: r.pole, schnellsteRunde: r.schnellsteRunde, strafe: r.strafe, gestrichen: r.gestrichen, zeitstrafe: r.zeitstrafe }),
          siege: rennen.filter((r) => r && r.platz === 1).length,
          strafpunkte,
          punkte: summe - strafpunkte,
          incidentsProRunde: runden > 0 ? Math.round((incidents / runden) * 100) / 100 : null,
          karte: fahrerKarte(rennen, kennzahlen, strafpunkte),
        };
      });
      fahrer.sort((a, b) => vergleiche(a, b, rennenListe.length));
      fahrer.forEach((f, i) => { f.pos = i + 1; });
      titelStand(fahrer, regeln, Math.max(0, regeln.rennenGesamt - rennenListe.length));
      return { id: mehrere ? `${fz.id}-${k.id}` : k.id, name: mehrere ? `${fz.name} ${k.name}` : k.name, fahrzeugklasse: fz.name, min: k.min, max: k.max, fahrer };
    }));

    return {
      saison: regeln.saison,
      rennenGesamt: regeln.rennenGesamt,
      gewerteteRennen: regeln.gewerteteRennen,
      restRennen: Math.max(0, regeln.rennenGesamt - rennenListe.length),
      maxProRennen: punkteFuer(1, regeln) + (regeln.bonusPole || 0) + (regeln.bonusSchnellsteRunde || 0),
      rennen: rennenListe.map((r, i) => ({ nr: i + 1, strecke: r.strecke, variante: r.variante, start: r.start, bericht: rennBericht(r, wertungen[i], kennzahlen[i], fahrzeugklassen) })),
      klassen,
      warnungen,
    };
  }

  return { leseErgebnis, pruefeRegeln, klasseFuer, berechneTabelle };
});
