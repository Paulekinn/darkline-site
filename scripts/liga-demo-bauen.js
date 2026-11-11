// Baut die Beispieldaten für /liga?demo (assets/liga-demo.json). Alle Namen und Ergebnisse sind erfunden.
// Gerechnet wird mit derselben Wertung wie in der echten Liga, damit Tabelle, Fahrerkarten und Profile genau so aussehen.
// Aufruf: node scripts/liga-demo-bauen.js   (Termine liegen relativ zum Tag des Aufrufs)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const D = require("../api/_lib/liga-daten");
const R = require("../api/_lib/liga-reports");
const P = require("../api/_lib/liga-profil");
const { eventReihe } = require("../api/_lib/liga-events");
const { berechneTabelle } = require("../assets/liga-wertung.js");
const { berlinNachUtc } = require("../api/_lib/liga-anmeldung");

// Fester Zufall, damit jeder Lauf dieselben Ergebnisse liefert
let saat = 31;
const zufall = () => ((saat = (saat * 16807) % 2147483647) - 1) / 2147483646;
const pid = (cust) => crypto.createHash("sha256").update(`demo-${cust}`).digest("hex").slice(0, 16);
const HEUTE = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
const tag = (versatz) => D.datumPlus(HEUTE, versatz);
const isoStart = (datum, zeit) => new Date(berlinNachUtc(datum, zeit)).toISOString();

const FAHRER = [
  ["Lukas Brandt", 3120, 7, "de", "Nordkurve Racing"], ["Jonas Keller", 2890, 12, "de", "Nordkurve Racing"], ["Marco Vitale", 2710, 27, "it", "Scuderia Ventuno"],
  ["Tim Hoffmann", 2560, 4, "de", ""], ["Niklas Sommer", 2440, 19, "at", "Alpen Motorsport"], ["Felix Wagner", 2310, 33, "de", "Blackline Sim"],
  ["Sven Larsen", 2180, 55, "dk", ""], ["David Krüger", 2050, 8, "de", "Blackline Sim"], ["Pieter de Vries", 1920, 71, "nl", "Oranje Simsport"],
  ["Max Becker", 1810, 22, "de", ""], ["Jan Novak", 1700, 44, "cz", "Alpen Motorsport"], ["Paul Richter", 1610, 13, "de", "Nordkurve Racing"],
  ["Leon Schulz", 1480, 88, "de", ""], ["Tobias Graf", 1390, 61, "ch", "Scuderia Ventuno"], ["Erik Lindqvist", 1300, 9, "se", ""],
  ["Moritz Fuchs", 1210, 17, "de", "Oranje Simsport"], ["Ben Arnold", 1120, 3, "de", ""], ["Kevin Lang", 1040, 99, "de", "Blackline Sim"],
].map(([name, irating, nummer, land, team], i) => ({ cust: String(910001 + i), name, irating, nummer, land, team, staerke: irating / 1000 + zufall() * 0.6 }));

const serie = (e) => D.pruefeSerie({
  kategorie: "Sports_Car", punkte: [30, 26, 23, 21, 19, 17, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2], punkteDanach: 1, bonusPole: 1, bonusSchnellsteRunde: 1,
  mindestRundenProzent: 75, anmeldeschlussMinuten: 60, reportStunden: 24, einspruchStunden: 48, uebertragung: "",
  klassen: [{ name: "Pro", min: 2500, max: "" }, { name: "Pro-Am", min: 1500, max: 2499 }, { name: "Am", min: 0, max: 1499 }], ...e,
});

const SERIEN = [
  { id: "demo-gt3-sprint", ...serie({ name: "Demo · GT3 Sprint Cup", saison: "Saison 1", status: "laeuft", farbe: "rot", fahrzeugklassen: ["GT3"], rennenGesamt: 8, gewerteteRennen: 7, strafpunkteGrenze: 10, modelle: "BMW M4 GT3 EVO\nFerrari 296 GT3\nPorsche 911 GT3 R (992)\nMercedes-AMG GT3 2020\nChevrolet Corvette Z06 GT3.R", freieWechsel: 1, beschreibung: "Beispiel-Season mit erfundenen Fahrern: acht Sprintrennen auf den Klassikern Europas, gewertet in Pro, Pro-Am und Am." }) },
  { id: "demo-gt4-cup", ...serie({ name: "Demo · GT4 Cup", saison: "Saison 1", status: "anmeldung", farbe: "blau", fahrzeugklassen: ["GT4"], rennenGesamt: 6, gewerteteRennen: 6, beschreibung: "Die Einsteigerserie im GT4: kurze Rennen, faire Zweikämpfe. Die Anmeldung ist offen." }) },
  { id: "demo-6h-nuerburgring", ...serie({ name: "Demo · 6h Nürburgring", typ: "event", eventReihe: "Demo 6h Nürburgring", status: "anmeldung", farbe: "gruen", fahrzeugklassen: ["GT3", "GT4"], rennenGesamt: 1, gewerteteRennen: 1, ohneKlassen: true, beschreibung: "Langstrecken-Event auf der Nordschleifen-Kombination. Teams aus zwei bis drei Fahrern." }) },
  { id: "demo-6h-nuerburgring-2025", ...serie({ name: "Demo · 6h Nürburgring 2025", typ: "event", eventReihe: "Demo 6h Nürburgring", status: "beendet", farbe: "gruen", fahrzeugklassen: ["GT3"], rennenGesamt: 1, gewerteteRennen: 1, ohneKlassen: true, beschreibung: "Die erste Ausgabe des Langstrecken-Events." }) },
];

const STRECKEN = [["Circuit de Spa-Francorchamps", "Grand Prix", 1373000], ["Autodromo Nazionale Monza", "Grand Prix", 1068000], ["Red Bull Ring", "Grand Prix", 885000], ["Circuit Zandvoort", "Grand Prix", 951000], ["Autodromo Enzo e Dino Ferrari", "Grand Prix", 1011000], ["Silverstone Circuit", "Grand Prix", 1182000], ["Nürburgring Grand-Prix-Strecke", "GP", 1146000], ["Circuit de Barcelona-Catalunya", "Grand Prix", 1052000]];
const rennenBasis = { startzeit: "20:00", plaetze: 30, training: "60 Min", qualifying: "15 Min", renndauer: "45 Min", wetter: "Dynamisch, trocken", fahrzeuge: "GT3", status: "geplant" };

// GT3: fünf Rennen gefahren (wöchentlich, das letzte vor zwei Tagen und damit noch vorläufig), drei folgen.
const gt3 = STRECKEN.map(([strecke], i) => ({ id: `demo-gt3-r${i + 1}`, serie: "demo-gt3-sprint", titel: `Runde ${i + 1} · ${strecke.split(" ").slice(-1)[0] === "Grand-Prix-Strecke" ? "Nürburgring" : strecke.replace("Autodromo Enzo e Dino Ferrari", "Imola").replace(/^(Circuit de |Circuit |Autodromo Nazionale |)/, "").replace(/ Circuit$/, "")}`, datum: tag(-2 - 7 * (4 - i)), strecke, ...rennenBasis }));
const gt4 = [3, 4, 5, 6, 7, 0].map((s, i) => ({ id: `demo-gt4-r${i + 1}`, serie: "demo-gt4-cup", titel: `Runde ${i + 1}`, datum: tag(18 + 14 * i), strecke: STRECKEN[s][0], ...rennenBasis, startzeit: "19:30", renndauer: "30 Min", fahrzeuge: "GT4" }));
const event = { id: "demo-6h-2026", serie: "demo-6h-nuerburgring", titel: "6h Nürburgring", datum: tag(40), strecke: "Nürburgring Kombination", ...rennenBasis, startzeit: "14:00", plaetze: 60, training: "120 Min", qualifying: "30 Min", renndauer: "6 Std", fahrzeuge: "GT3 und GT4" };
const eventAlt = { id: "demo-6h-2025", serie: "demo-6h-nuerburgring-2025", titel: "6h Nürburgring", datum: tag(-330), strecke: "Nürburgring Kombination", ...rennenBasis, startzeit: "14:00", plaetze: 60, renndauer: "6 Std" };
const RENNEN = [...gt3, ...gt4, event, eventAlt];

// Ein erfundenes Rennergebnis im Format, das liga-wertung aus der iRacing-Datei liest
function ergebnis(rennen, nr, runden, rundenzeit, fahrer) {
  const reihe = fahrer.map((f) => ({ f, tempo: f.staerke + zufall() * 1.4 })).sort((a, b) => b.tempo - a.tempo);
  const start = [...reihe].sort((a, b) => b.f.staerke + zufall() - (a.f.staerke + zufall()));
  const ausfall = new Set(reihe.filter(() => zufall() < 0.07).map((x) => x.f.cust));
  let abstand = 0;
  const zeilen = reihe.map(({ f }, i) => {
    abstand += i ? Math.round((1.5 + zufall() * 5) * 10000) : 0;
    const raus = ausfall.has(f.cust);
    const gefahren = raus ? Math.floor(runden * (0.2 + zufall() * 0.5)) : runden - (abstand > rundenzeit ? 1 : 0);
    return { f, gefahren, raus, abstand: gefahren === runden ? abstand : -1 };
  }).sort((a, b) => b.gefahren - a.gefahren || (a.abstand < 0) - (b.abstand < 0) || a.abstand - b.abstand);
  return {
    id: String(80000000 + nr), start: isoStart(rennen.datum, rennen.startzeit), strecke: rennen.strecke, variante: "", kategorie: "sports_car", offiziell: false, warnungen: [],
    fahrer: zeilen.map(({ f, gefahren, raus, abstand }, i) => ({
      cust: f.cust, name: f.name, irating: f.irating, fahrzeugklasseId: "2708", fahrzeugklasseName: "GT3 Class", klassenAbstand: abstand,
      gesamt: i + 1, start: start.findIndex((x) => x.f === f) + 1, runden: gefahren, besteRunde: Math.round(rundenzeit * (1 + (3.4 - f.staerke) * 0.006 + zufall() * 0.004)), incidents: Math.floor(zufall() * (raus ? 12 : 7)), disqualifiziert: false,
    })),
  };
}

const gt3Ergebnisse = gt3.slice(0, 5).map((r, i) => ergebnis(r, i + 1, 24, STRECKEN[i][2], FAHRER.filter((f, j) => (j + i) % 9 !== 0)));
const altErgebnis = ergebnis(eventAlt, 9, 142, 1410000, FAHRER.slice(0, 14));
// Eine Strafe aus einem Report, damit die Spalte in der Tabelle nicht leer bleibt
const privat = { einstufung: {}, strafen: [{ id: "demo-1", reportId: "demo", rennen: gt3Ergebnisse[2].id, cust: FAHRER[5].cust, name: FAHRER[5].name, punkte: 3, grund: "Vermeidbare Kollision" }] };

const regeln = (id) => SERIEN.find((s) => s.id === id);
const tabelle = (id, ergebnisse, p = {}) => {
  const { warnungen, ...t } = berechneTabelle(ergebnisse, regeln(id), { ...p, pid });
  R.staendeSetzen(t, { serie: regeln(id), rennen: RENNEN, reports: [], privat: p, jetzt: Date.now() });
  return t;
};
const tabellen = new Map([["demo-gt3-sprint", tabelle("demo-gt3-sprint", gt3Ergebnisse, privat)], ["demo-6h-nuerburgring-2025", tabelle("demo-6h-nuerburgring-2025", [altErgebnis])]]);

const fahrerprofile = Object.fromEntries(FAHRER.map((f) => [pid(f.cust), { nummer: f.nummer, land: f.land, team: f.team, kanal: "", bild: "" }]));
const serien = SERIEN.map((s) => ({ ...s, status: D.wirksamerStatus(s, RENNEN, Date.now()) }));
const reiheDaten = (id) => {
  const s = regeln(id);
  if (s.typ !== "event") return undefined;
  const reihe = SERIEN.filter((x) => x.eventReihe === s.eventReihe);
  return eventReihe(s.eventReihe, reihe, tabellen, () => false);
};

/* ---------- Rennleitung (/liga-admin?demo): dieselben Fahrer und Ergebnisse, dazu Reports, Anträge und Prüfungen ---------- */
const STEWARD = "demo-steward";
const discordVon = (f) => `9${f.cust}`;
const nachCust = new Map(FAHRER.map((f) => [f.cust, f]));
const MODELLE = SERIEN[0].modelle;
const modellVon = (f) => MODELLE[Number(f.cust) % MODELLE.length];
const klasseNachIrating = (s, ir) => (s.klassen.find((k) => ir >= k.min && (k.max == null || ir <= k.max)) || {}).id || "";
const vorTagen = (t) => new Date(Date.now() - t * 864e5).toISOString();
const person = (f) => ({ discordId: discordVon(f), name: f.name, cust: f.cust });
const letztes = gt3Ergebnisse[4], vorletztes = gt3Ergebnisse[3];
const reportBasis = (e, i) => ({ rennen: gt3[i].id, rennenTitel: gt3[i].titel, serie: "demo-gt3-sprint", serieName: SERIEN[0].name, serieFarbe: "rot", start: e.start, notizen: "", clip: "", einsprueche: [], stimmen: [], urteil: null, endgueltig: false });
const urteil = (art, extra, von) => ({ ...R.pruefeUrteil({ art, ...extra }), von, zeit: vorTagen(1) });
const REPORTS = [
  { id: "demo-r1", ...reportBasis(letztes, 4), erstellt: vorTagen(1.5), von: person(FAHRER[3]), gegen: person(FAHRER[6]), stelle: "Runde 1, Kurve 1 (Tamburello)", beschreibung: "Beim Anbremsen auf die erste Schikane wurde ich von hinten getroffen und habe mich gedreht. Ich habe mehrere Plätze verloren.", clip: "https://www.twitch.tv/videos/beispiel", status: "offen", stimmen: [{ von: "demo-st2", name: "Steward B", art: "strafpunkte", punkte: 3, notiz: "Klarer Auffahrunfall", zeit: vorTagen(1) }] },
  { id: "demo-r2", ...reportBasis(letztes, 4), erstellt: vorTagen(1.2), von: person(FAHRER[9]), gegen: person(FAHRER[12]), stelle: "Runde 9, Rivazza", beschreibung: "Beim Überholversuch innen wurde mir die Tür zugemacht, Kontakt am Vorderrad.", status: "pruefung", stimmen: [{ von: STEWARD, name: "Demo-Steward", art: "verwarnung", notiz: "Rennunfall mit leichter Mitschuld", zeit: vorTagen(1) }, { von: "demo-st2", name: "Steward B", art: "verwarnung", notiz: "", zeit: vorTagen(0.8) }] },
  { id: "demo-r3", ...reportBasis(gt3Ergebnisse[2], 2), erstellt: vorTagen(16), von: person(FAHRER[8]), gegen: person(FAHRER[5]), stelle: "Runde 4, Kurve 3", beschreibung: "Ich wurde in der Bremszone abgeschossen und musste an die Box.", status: "entschieden", urteil: urteil("strafpunkte", { punkte: 3, begruendung: "Vermeidbare Kollision beim Anbremsen.", rennen: gt3Ergebnisse[2].id, cust: FAHRER[5].cust, name: FAHRER[5].name }, "Steward B"), einsprueche: [{ discordId: discordVon(FAHRER[5]), name: FAHRER[5].name, text: "Ich war bereits neben ihm und hatte die Linie. Das Video zeigt, dass er nach innen gezogen hat.", zeit: vorTagen(15) }] },
  { id: "demo-r4", ...reportBasis(gt3Ergebnisse[1], 1), erstellt: vorTagen(22), von: person(FAHRER[14]), gegen: person(FAHRER[16]), stelle: "Runde 12, Parabolica", beschreibung: "Leichter Kontakt am Heck beim Herausbeschleunigen.", status: "entschieden", urteil: urteil("verwarnung", { begruendung: "Rennunfall, Verwarnung." }, "Demo-Steward"), endgueltig: true },
];
privat.strafen[0].reportId = "demo-r3";
const adminReports = REPORTS.map((r) => ({ ...r, ichBeteiligt: false, stimmen: R.stimmenSicht(r, STEWARD), kontext: R.rennKontext(r, gt3Ergebnisse) }));

const standCtx = { serie: SERIEN[0], rennen: RENNEN, reports: REPORTS, privat, jetzt: Date.now() };
const starter = (liste) => liste.map((f) => ({ name: f.name, discordId: discordVon(f), fahrzeugklasse: "GT3" }));
const detailsFuer = (s) => {
  const fahrer = s.id === "demo-gt3-sprint" ? FAHRER : s.id === "demo-gt4-cup" ? FAHRER.slice(10, 15) : s.id === "demo-6h-nuerburgring" ? FAHRER.slice(0, 9) : [];
  const ergebnisse = s.id === "demo-gt3-sprint" ? gt3Ergebnisse : s.id === "demo-6h-nuerburgring-2025" ? [altErgebnis] : [];
  return {
    serie: s.id,
    fahrer: fahrer.map((f, i) => ({ pid: pid(f.cust), nummer: f.nummer, land: f.land, team: f.team, bild: "", discordId: discordVon(f), name: f.name, mitglied: s.typ !== "event", fahrzeugklasse: s.fahrzeugklassen[0] || "", custId: f.cust, iratingAngabe: f.irating, iratingErgebnis: ergebnisse.length ? f.irating + (i === 4 ? 210 : (i % 3) * 15) : null, klasseAuto: s.ohneKlassen ? "" : klasseNachIrating(s, f.irating), klasseFest: "", modell: (s.modelle || []).length ? modellVon(f) : "", wechsel: i === 2 ? 1 : 0 })).sort((a, b) => a.name.localeCompare(b.name, "de")),
    rennen: RENNEN.filter((r) => r.serie === s.id).map((r) => ({ id: r.id, titel: r.titel, start: isoStart(r.datum, r.startzeit), status: r.status, plaetze: r.plaetze, starter: starter(fahrer.slice(0, Math.min(fahrer.length, r.plaetze))), warteliste: [] })),
    ergebnisse: ergebnisse.map((e) => ({ id: e.id, start: e.start, strecke: e.strecke, variante: e.variante, verkuerzt: false, sichtung: false, stand: R.ergebnisStand(e.start, { ...standCtx, serie: s }), fahrer: e.fahrer.map((f) => ({ cust: f.cust, name: f.name })) })),
    strafen: s.id === "demo-gt3-sprint" ? privat.strafen.map((x) => ({ ...x, typ: "punkte" })) : [],
    sichtung: null,
  };
};
const admin = {
  angemeldet: true, name: "Demo-Steward", serien, kopfbildVersion: 0,
  rennen: RENNEN.map((r) => ({ ...r, briefing: r.briefing || "**Ablauf:** Training, Qualifying, Rennen.\n\n**Regeln:** Es gilt das Reglement der Darkline Simracing Series.", passwort: r.serie === "demo-6h-nuerburgring" ? "demo" : "" })),
  strecken: STRECKEN.map(([name, variante]) => ({ id: D.slug(`${name} ${variante}`), name, variante, land: "", laengeKm: null, kurven: null, notiz: "", importiert: true })),
  fehlendeErgebnisse: [],
  pruefungen: [{ serie: "demo-gt3-sprint", serieName: SERIEN[0].name, id: letztes.id, strecke: letztes.strecke, start: letztes.start, noShows: [{ name: FAHRER[5].name, discordId: discordVon(FAHRER[5]) }], incidents: [{ name: FAHRER[12].name, cust: FAHRER[12].cust, incidents: 14 }], fahrzeuge: [{ name: FAHRER[8].name, cust: FAHRER[8].cust, discordId: discordVon(FAHRER[8]), gemeldet: modellVon(FAHRER[8]), gefahren: MODELLE.find((m) => m !== modellVon(FAHRER[8])) }] }],
  strafkonten: D.strafkonten(SERIEN[0], { ...privat, strafen: [...privat.strafen, { id: "demo-2", rennen: gt3Ergebnisse[3].id, cust: FAHRER[5].cust, name: FAHRER[5].name, punkte: 8, grund: "Wiederholt Track Limits" }] }),
  nummernWuensche: [{ discordId: discordVon(FAHRER[10]), name: FAHRER[10].name, von: FAHRER[10].nummer, nach: 77, seit: vorTagen(0.5) }],
  fahrzeugAntraege: [{ serie: "demo-gt3-sprint", serieName: SERIEN[0].name, discordId: discordVon(FAHRER[6]), name: FAHRER[6].name, modell: modellVon(FAHRER[6]), antrag: { nach: MODELLE.find((m) => m !== modellVon(FAHRER[6])), seit: vorTagen(0.3) }, wechsel: [{ art: "frei" }] }],
  reports: adminReports,
};
const adminDetails = Object.fromEntries(SERIEN.map((s) => [s.id, detailsFuer(s)]));
const privatJeSerie = [{ serieName: SERIEN[0].name, privat }];
const akten = Object.fromEntries(FAHRER.map((f) => [f.cust, { ...R.fahrerAkte(REPORTS, privatJeSerie, { cust: f.cust, discordId: discordVon(f) }), profil: { iracingName: f.name, custId: f.cust, irating: f.irating, nummer: f.nummer, land: f.land, team: f.team, kanal: "", hatBild: false } }]));
const protokoll = [
  ["Demo-Steward", "Urteil gesprochen (verwarnung): Runde 2 · Monza"], ["Steward B", "Urteil gesprochen (strafpunkte): Runde 3 · Red Bull Ring"], ["Demo-Steward", `Ergebnis veröffentlicht in ${SERIEN[0].name}`],
  ["Steward B", "Rennen geändert: Runde 6 · Silverstone"], ["Demo-Steward", `Serie geändert: ${SERIEN[1].name}`], ["Steward B", `Startnummer bestätigt: ${FAHRER[3].name}, neu #${FAHRER[3].nummer}`],
].map(([wer, text], i) => ({ zeit: vorTagen(0.4 + i * 1.7), wer, text }));

const demo = {
  hinweis: "Beispieldaten: alle Namen und Ergebnisse sind erfunden.",
  gebaut: new Date().toISOString(),
  uebersicht: { serien, rennen: RENNEN.map(D.oeffentlichesRennen), kopfbildVersion: 0 },
  serien: Object.fromEntries(SERIEN.map((s) => [s.id, { tabelle: tabellen.get(s.id) || null, fahrerprofile, ...(reiheDaten(s.id) ? { eventreihe: reiheDaten(s.id) } : {}) }])),
  admin, adminDetails, akten, protokoll,
  profile: Object.fromEntries(FAHRER.map((f) => [pid(f.cust), P.fahrerAkte(serien, tabellen, pid(f.cust))]).filter(([, a]) => a).map(([p, a]) => [p, { pid: p, ...a, profil: fahrerprofile[p] }])),
};
fs.writeFileSync(path.join(__dirname, "..", "assets", "liga-demo.json"), JSON.stringify(demo));
console.log(`liga-demo.json: ${serien.length} Serien, ${RENNEN.length} Rennen, ${Object.keys(demo.profile).length} Fahrerprofile`);
