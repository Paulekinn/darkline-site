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
  { id: "demo-gt3-sprint", ...serie({ name: "Demo · GT3 Sprint Cup", saison: "Saison 1", status: "laeuft", farbe: "rot", fahrzeugklassen: ["GT3"], rennenGesamt: 8, gewerteteRennen: 7, beschreibung: "Beispiel-Season mit erfundenen Fahrern: acht Sprintrennen auf den Klassikern Europas, gewertet in Pro, Pro-Am und Am." }) },
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

const demo = {
  hinweis: "Beispieldaten: alle Namen und Ergebnisse sind erfunden.",
  gebaut: new Date().toISOString(),
  uebersicht: { serien, rennen: RENNEN.map(D.oeffentlichesRennen), kopfbildVersion: 0 },
  serien: Object.fromEntries(SERIEN.map((s) => [s.id, { tabelle: tabellen.get(s.id) || null, fahrerprofile, ...(reiheDaten(s.id) ? { eventreihe: reiheDaten(s.id) } : {}) }])),
  profile: Object.fromEntries(FAHRER.map((f) => [pid(f.cust), P.fahrerAkte(serien, tabellen, pid(f.cust))]).filter(([, a]) => a).map(([p, a]) => [p, { pid: p, ...a, profil: fahrerprofile[p] }])),
};
fs.writeFileSync(path.join(__dirname, "..", "assets", "liga-demo.json"), JSON.stringify(demo));
console.log(`liga-demo.json: ${serien.length} Serien, ${RENNEN.length} Rennen, ${Object.keys(demo.profile).length} Fahrerprofile`);
