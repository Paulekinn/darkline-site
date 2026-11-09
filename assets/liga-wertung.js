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
    if (zeilen.some((r) => !(r.cust_id > 0))) throw new Error("Teamrennen werden noch nicht gewertet (Einträge ohne Kundennummer).");
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

  // Wertet ein Rennen getrennt je Fahrzeugklasse und iRating-Klasse aus. Ergebnis: Map Kundennummer → Rennwertung.
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

  // Berechnet die Tabellen. Die Rückgabe enthält keine Kundennummern und kann öffentlich gespeichert werden.
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
          return { platz: r.platz, status: r.status, punkte: r.punkte, pole: r.pole, schnellsteRunde: r.schnellsteRunde, strafe: strafen.get(`${i}:${cust}`) || 0, gestrichen: false, runden: r.runden, incidents: r.incidents, zeitstrafe: r.zeitstrafe };
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
        };
      });
      fahrer.sort((a, b) => vergleiche(a, b, rennenListe.length));
      fahrer.forEach((f, i) => { f.pos = i + 1; });
      return { id: mehrere ? `${fz.id}-${k.id}` : k.id, name: mehrere ? `${fz.name} ${k.name}` : k.name, fahrzeugklasse: fz.name, min: k.min, max: k.max, fahrer };
    }));

    return {
      saison: regeln.saison,
      rennenGesamt: regeln.rennenGesamt,
      gewerteteRennen: regeln.gewerteteRennen,
      rennen: rennenListe.map((r, i) => ({ nr: i + 1, strecke: r.strecke, variante: r.variante, start: r.start })),
      klassen,
      warnungen,
    };
  }

  return { leseErgebnis, pruefeRegeln, klasseFuer, berechneTabelle };
});
