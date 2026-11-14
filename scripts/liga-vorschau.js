// Lokale Liga-Demo zum Testen: echte Liga-Handler aus dem Repo, alle Daten nur im Arbeitsspeicher.
// Supabase und Discord sind abgefangen (Discord-Nachrichten landen im Log). Ein Neustart setzt alles zurück.
//
// Start:   node scripts/liga-vorschau.js        → http://localhost:8146/liga
// Anmelden als Testnutzer (setzt das Cookie und leitet weiter):
//   /login?als=anna     Fahrerin, Stammfahrerin im GT3 Sprint Cup, hat einen Report offen, Formula-iRating eingetragen
//   /login?als=ben      Fahrer ohne Season, Chef von „Night Racers“, kein Formula-iRating
//   /login?als=carla    Fahrerin im GT3 Sprint Cup und bei Night Racers
//   /login?als=neu      Discord-Konto ohne Fahrerprofil (Registrierung testen)
//   /login?als=steward  Steward im Cockpit
//   /login?als=leitung  Rennleitung im Cockpit
// Alle Namen und Ergebnisse sind erfunden.
const http = require("http");
const fs = require("fs");
const path = require("path");
const WURZEL = path.join(__dirname, "..");
const PORT = Number(process.env.PORT || 8146);

Object.assign(process.env, {
  SESSION_SECRET: "vorschau-geheimnis-mit-mindestens-32-zeichen!!", SUPABASE_URL: "https://projekt.supabase.co/", SUPABASE_SECRET_KEY: "sb_secret_test",
  DISCORD_BOT_TOKEN: "x", DISCORD_GUILD_ID: "1", LIGA_ROLLE_INTERESSENT: "2", LIGA_ROLLE_FAHRER: "3", LIGA_DISCORD_WEBHOOK_TEAM: "https://discord.com/api/webhooks/test/team",
});

/* ---------- Supabase-Attrappe wie in den Tests, Discord wird nur mitgeschrieben ---------- */
const zeilen = new Map();
global.fetch = async (url, o = {}) => {
  const u = new URL(url);
  if (u.hostname !== "projekt.supabase.co") {
    if (o.body) { try { const b = JSON.parse(o.body); if (b.content || b.embeds) console.log(`[DISCORD] ${u.pathname} ${b.content ? `→ ${b.content}` : `→ Karte: ${b.embeds[0].title}`}`); } catch (e) { /* kein JSON */ } }
    return { ok: true, status: 200, json: async () => ({ id: "kanal" }), text: async () => "{}", arrayBuffer: async () => new ArrayBuffer(0) };
  }
  const m = o.method || "GET";
  const pfad = u.searchParams.get("pfad") || "";
  const auswahl = (liste) => { const sp = (u.searchParams.get("select") || "pfad").split(","); return liste.map((z) => Object.fromEntries(sp.map((s) => [s, z[s]]))); };
  const jetzt = () => new Date().toISOString();
  if (m === "POST" && String(o.headers.prefer).includes("ignore-duplicates")) {
    const neu = JSON.parse(o.body).filter((z) => !zeilen.has(z.pfad)).map((z) => ({ geaendert: jetzt(), ...z }));
    neu.forEach((z) => zeilen.set(z.pfad, z));
    return { ok: true, status: 201, json: async () => auswahl(neu) };
  }
  if (m === "POST") { for (const z of JSON.parse(o.body)) zeilen.set(z.pfad, { geaendert: jetzt(), ...z }); return { ok: true, status: 201, json: async () => [] }; }
  if (m === "PATCH") {
    const z = zeilen.get(pfad.slice(3));
    const passt = z && "eq." + z.geaendert === u.searchParams.get("geaendert");
    if (passt) zeilen.set(z.pfad, { ...z, ...JSON.parse(o.body) });
    return { ok: true, status: 200, json: async () => auswahl(passt ? [zeilen.get(z.pfad)] : []) };
  }
  if (m === "DELETE") { [...pfad.slice(4, -1).matchAll(/"((?:[^"\\]|\\.)*)"/g)].forEach((x) => zeilen.delete(x[1].replace(/\\(.)/g, "$1"))); return { ok: true, status: 204, json: async () => [] }; }
  let treffer = [...zeilen.values()].sort((a, b) => a.pfad.localeCompare(b.pfad));
  if (pfad.startsWith("eq.")) treffer = treffer.filter((z) => z.pfad === pfad.slice(3));
  if (pfad.startsWith("like.")) { const vorn = pfad.slice(5, -1).replace(/\\(.)/g, "$1"); treffer = treffer.filter((z) => z.pfad.startsWith(vorn)); }
  const start = Number(u.searchParams.get("offset") || 0);
  const stueck = treffer.slice(start, start + Number(u.searchParams.get("limit") || 1000));
  return { ok: true, status: 200, json: async () => auswahl(stueck) };
};

const liga = require(path.join(WURZEL, "api", "liga.js"));
const S = require(path.join(WURZEL, "api", "_lib", "session.js"));
const B = require(path.join(WURZEL, "api", "_lib", "blob.js"));
const D = require(path.join(WURZEL, "api", "_lib", "liga-daten.js"));
const A = require(path.join(WURZEL, "api", "_lib", "liga-anmeldung.js"));
const P = require(path.join(WURZEL, "api", "_lib", "liga-profil.js"));
const T = require(path.join(WURZEL, "api", "_lib", "liga-teams.js"));
const R = require(path.join(WURZEL, "api", "_lib", "liga-reports.js"));

/* ---------- Testdaten ---------- */
let saat = 31; // fester Zufall: jeder Start ergibt dieselben Ergebnisse
const zufall = () => ((saat = (saat * 16807) % 2147483647) - 1) / 2147483646;
const HEUTE = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
const tag = (n) => D.datumPlus(HEUTE, n);
const isoStart = (datum, zeit) => new Date(A.berlinNachUtc(datum, zeit)).toISOString();
const vorTagen = (t) => new Date(Date.now() - t * 864e5).toISOString();
const json = (pfad, d) => B.blobPut(pfad, JSON.stringify(d), "application/json");

// Testnutzer zum Anmelden. Anna, Ben und Carla haben ein Profil, „neu“ nicht.
const NUTZER = {
  anna: { id: "111111111111111111", name: "Anna", profil: { iracingName: "Anna Racer", custId: "100001", irating: 2100, iratingFormula: 1900, nummer: 12, land: "de" } },
  ben: { id: "222222222222222222", name: "Ben", profil: { iracingName: "Ben Neu", custId: "100002", irating: 1800, iratingFormula: null, nummer: 7, land: "at" } },
  carla: { id: "333333333333333333", name: "Carla", profil: { iracingName: "Carla Fast", custId: "100003", irating: 3600, iratingFormula: 3100, nummer: 21, land: "ch" } },
  neu: { id: "444444444444444444", name: "Neuling" },
};
const COCKPIT = { steward: { id: "888888888888888888", name: "Steward Test", rolle: "steward" }, leitung: { id: "999999999999999999", name: "Rennleitung Test", rolle: "leitung" } };

// Erfundenes Starterfeld
const FELD = [
  ["Lukas Brandt", 3120, 2400, 77, "de"], ["Jonas Keller", 2890, null, 18, "de"], ["Marco Vitale", 2710, 2600, 27, "it"], ["Tim Hoffmann", 2560, null, 4, "de"],
  ["Niklas Sommer", 2440, 1800, 19, "at"], ["Felix Wagner", 2310, null, 33, "de"], ["Sven Larsen", 2180, 2050, 55, "dk"], ["David Krüger", 2050, null, 8, "de"],
  ["Pieter de Vries", 1920, 1500, 71, "nl"], ["Max Becker", 1810, null, 22, "de"], ["Jan Novak", 1700, 1650, 44, "cz"], ["Paul Richter", 1610, null, 13, "de"],
  ["Leon Schulz", 1480, 1200, 88, "de"], ["Tobias Graf", 1390, null, 61, "ch"], ["Erik Lindqvist", 1300, 1400, 9, "se"], ["Moritz Fuchs", 1210, null, 17, "de"],
].map(([iracingName, irating, iratingFormula, nummer, land], i) => ({ id: `9${910001 + i}`, name: iracingName.split(" ")[0], profil: { iracingName, custId: String(910001 + i), irating, iratingFormula, nummer, land } }));
const FAHRER = [NUTZER.anna, NUTZER.ben, NUTZER.carla, ...FELD];
const staerke = new Map(FAHRER.map((f) => [f.profil.custId, f.profil.irating / 1000 + zufall() * 0.6]));
const nach = (cust) => FAHRER.find((f) => f.profil.custId === cust);
const person = (f) => ({ discordId: f.id, name: f.profil.iracingName, cust: f.profil.custId });

const serie = (e) => D.pruefeSerie({
  kategorie: "Sports_Car", punkte: [30, 26, 23, 21, 19, 17, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2], punkteDanach: 1, bonusPole: 1, bonusSchnellsteRunde: 1,
  mindestRundenProzent: 75, anmeldeschlussMinuten: 60, reportStunden: 24, einspruchStunden: 48, uebertragung: "",
  klassen: [{ name: "Pro", min: 2500, max: "" }, { name: "Pro-Am", min: 1500, max: 2499 }, { name: "Am", min: 0, max: 1499 }], ...e,
});
const SERIEN = {
  "gt3-sprint": serie({ name: "GT3 Sprint Cup", saison: "Saison 1", status: "laeuft", farbe: "rot", fahrzeugklassen: ["GT3"], rennenGesamt: 8, gewerteteRennen: 7, strafpunkteGrenze: 10,
    klassen: [{ name: "Pro", min: 2500, max: "", farbe: "lila" }, { name: "Pro-Am", min: 1500, max: 2499 }, { name: "Am", min: 0, max: 1499 }],
    beschreibung: "Acht Sprintrennen auf den Klassikern Europas, gewertet in Pro, Pro-Am und Am. Läuft gerade, fünf Rennen sind gefahren." }),
  "gt4-cup": serie({ name: "GT4 Cup", saison: "Saison 1", status: "anmeldung", farbe: "blau", fahrzeugklassen: ["GT4"], rennenGesamt: 6, gewerteteRennen: 6, freieWechsel: 1,
    modelle: "BMW M4 G82 GT4\nPorsche 718 Cayman GT4 Clubsport MR\nMercedes-AMG GT4\nAston Martin Vantage GT4",
    beschreibung: "Einsteigerserie im GT4 mit Fahrzeugwahl. Die Anmeldung ist offen." }),
  "formula-cup": serie({ name: "Formula Cup", saison: "Saison 1", status: "anmeldung", farbe: "lila", kategorie: "Formula", fahrzeugklassen: ["Formula"], rennenGesamt: 6, gewerteteRennen: 5,
    klassen: [{ name: "Pro", min: 2000, max: "", farbe: "orange" }, { name: "Am", min: 0, max: 1999, farbe: "tuerkis" }],
    beschreibung: "Formelserie, eingestuft nach Formula-iRating. Ohne Formula-iRating im Profil ist keine Anmeldung möglich." }),
  "gt3-pro": serie({ name: "GT3 Pro Invitational", saison: "Saison 1", status: "anmeldung", farbe: "gelb", fahrzeugklassen: ["GT3"], rennenGesamt: 4, gewerteteRennen: 4, ohneKlassen: true,
    aufAnfrage: true, voraussetzungen: "Teilnahme nur auf Einladung, iRating ab 2.500.", beschreibung: "Private Season: Beitritt nur nach Freigabe durch die Rennleitung." }),
  "6h-nuerburgring": serie({ name: "6h Nürburgring", typ: "event", eventReihe: "6h Nürburgring", status: "anmeldung", farbe: "gruen", fahrzeugklassen: ["GT3", "GT4"], rennenGesamt: 1, gewerteteRennen: 1, ohneKlassen: true,
    beschreibung: "Langstrecken-Event auf der Nordschleifen-Kombination." }),
  "6h-nuerburgring-2025": serie({ name: "6h Nürburgring 2025", typ: "event", eventReihe: "6h Nürburgring", status: "beendet", farbe: "gruen", fahrzeugklassen: ["GT3"], rennenGesamt: 1, gewerteteRennen: 1, ohneKlassen: true,
    beschreibung: "Die erste Ausgabe des Langstrecken-Events." }),
};

const STRECKEN = [["Spa", "Circuit de Spa-Francorchamps", 1373000], ["Monza", "Autodromo Nazionale Monza", 1068000], ["Red Bull Ring", "Red Bull Ring", 885000], ["Zandvoort", "Circuit Zandvoort", 951000],
  ["Imola", "Autodromo Enzo e Dino Ferrari", 1011000], ["Silverstone", "Silverstone Circuit", 1182000], ["Nürburgring", "Nürburgring Grand-Prix-Strecke", 1146000], ["Barcelona", "Circuit de Barcelona-Catalunya", 1052000]];
const basis = { startzeit: "20:00", plaetze: 30, training: "60 Min", qualifying: "15 Min", renndauer: "45 Min", wetter: "Dynamisch, trocken", fahrzeuge: "GT3", passwort: "demo",
  briefing: "**Ablauf:** Training, Qualifying, Rennen.\n\n**Regeln:** Es gilt das Reglement der Darkline Simracing Series." };
// GT3: fünf Rennen gefahren (wöchentlich, das letzte vor zwei Tagen und damit noch vorläufig), drei folgen
const RENNEN = {
  ...Object.fromEntries(STRECKEN.map(([kurz, strecke], i) => [`gt3-r${i + 1}`, { ...basis, serie: "gt3-sprint", titel: `Runde ${i + 1} · ${kurz}`, datum: tag(-2 - 7 * (4 - i)), strecke }])),
  ...Object.fromEntries([3, 4, 5, 6, 7, 0].map((s, i) => [`gt4-r${i + 1}`, { ...basis, serie: "gt4-cup", titel: `Runde ${i + 1} · ${STRECKEN[s][0]}`, datum: tag(18 + 14 * i), strecke: STRECKEN[s][1], startzeit: "19:30", renndauer: "30 Min", fahrzeuge: "GT4" }])),
  ...Object.fromEntries([0, 1, 5, 7, 4, 2].map((s, i) => [`formula-r${i + 1}`, { ...basis, serie: "formula-cup", titel: `Runde ${i + 1} · ${STRECKEN[s][0]}`, datum: tag(10 + 7 * i), strecke: STRECKEN[s][1], startzeit: "21:00", renndauer: "30 Min", fahrzeuge: "Super Formula Lights" }])),
  ...Object.fromEntries([1, 6, 3, 0].map((s, i) => [`pro-r${i + 1}`, { ...basis, serie: "gt3-pro", titel: `Lauf ${i + 1} · ${STRECKEN[s][0]}`, datum: tag(12 + 14 * i), strecke: STRECKEN[s][1] }])),
  "6h-2026": { ...basis, serie: "6h-nuerburgring", titel: "6h Nürburgring", datum: tag(40), strecke: "Nürburgring Kombination", startzeit: "14:00", plaetze: 60, training: "120 Min", qualifying: "30 Min", renndauer: "6 Std", fahrzeuge: "GT3 und GT4" },
  "6h-2025": { ...basis, serie: "6h-nuerburgring-2025", titel: "6h Nürburgring", datum: tag(-330), strecke: "Nürburgring Kombination", startzeit: "14:00", plaetze: 60, renndauer: "6 Std" },
};

// Erfundenes Rennergebnis im gespeicherten Format (wie nach dem Einlesen der iRacing-Datei)
function ergebnis(rennen, nr, runden, rundenzeit, feld) {
  const reihe = feld.map((f) => ({ f, tempo: staerke.get(f.profil.custId) + zufall() * 1.4 })).sort((a, b) => b.tempo - a.tempo);
  const start = [...reihe].sort((a, b) => staerke.get(b.f.profil.custId) + zufall() - (staerke.get(a.f.profil.custId) + zufall()));
  const ausfall = new Set(reihe.filter(() => zufall() < 0.07).map((x) => x.f.profil.custId));
  let abstand = 0;
  const liste = reihe.map(({ f }, i) => {
    abstand += i ? Math.round((1.5 + zufall() * 5) * 10000) : 0;
    const raus = ausfall.has(f.profil.custId);
    const gefahren = raus ? Math.floor(runden * (0.2 + zufall() * 0.5)) : runden - (abstand > rundenzeit ? 1 : 0);
    return { f, gefahren, raus, abstand: gefahren === runden ? abstand : -1 };
  }).sort((a, b) => b.gefahren - a.gefahren || (a.abstand < 0) - (b.abstand < 0) || a.abstand - b.abstand);
  return {
    id: String(80000000 + nr), start: isoStart(rennen.datum, rennen.startzeit), strecke: rennen.strecke, variante: "Grand Prix", kategorie: "sports_car", offiziell: false, warnungen: [],
    fahrer: liste.map(({ f, gefahren, raus, abstand: ab }, i) => ({
      cust: f.profil.custId, name: f.profil.iracingName, irating: f.profil.irating, fahrzeugklasseId: "2708", fahrzeugklasseName: "GT3 Class", klassenAbstand: ab,
      gesamt: i + 1, start: start.findIndex((x) => x.f === f) + 1, runden: gefahren, besteRunde: Math.round(rundenzeit * (1 + (3.4 - staerke.get(f.profil.custId)) * 0.006 + zufall() * 0.004)),
      incidents: Math.floor(zufall() * (raus ? 12 : 7)), disqualifiziert: false,
    })),
  };
}

async function fuellen() {
  // Fahrerprofile: privat (liga/fahrer) und öffentlich (liga/fahrerprofile) wie beim Speichern im Fahrerbereich
  for (const f of FAHRER) {
    const extras = { nummer: f.profil.nummer, land: f.profil.land, team: "", kanal: "", zeigeBild: false, uebersicht: true };
    const profil = { ...f.profil, ...extras, discordId: f.id, gespeichert: vorTagen(30) };
    await P.speichern({ id: f.id, avatar: "" }, profil, extras);
    await json(A.profilPfad(f.id), profil);
  }

  // Seasons und Rennen
  for (const [id, s] of Object.entries(SERIEN)) await D.serieSpeichern(id, s);
  for (const [id, r] of Object.entries(RENNEN)) await D.rennenSpeichern(id, { ...D.pruefeRennen(r, Object.keys(SERIEN)), streckeId: "" });

  // Stammfahrer: GT3 Sprint mit Anna, Carla und 14 aus dem Feld; GT4 schon 6 Meldungen (Ben ist frei zum Testen)
  const melden = (serieId, f, klasse) => B.blobPut(A.mitgliedPfad(serieId, f.id, klasse, f.profil.iracingName), "1", "text/plain");
  const gt3Feld = [NUTZER.anna, NUTZER.carla, ...FELD.slice(0, 14)];
  for (const f of gt3Feld) await melden("gt3-sprint", f, "GT3");
  for (const f of FELD.slice(8, 14)) await melden("gt4-cup", f, "GT4");
  for (const f of FELD.filter((x) => x.profil.iratingFormula).slice(0, 5)) await melden("formula-cup", f, "Formula");
  for (const f of FELD.slice(0, 4)) await melden("gt3-pro", f, "GT3");
  for (const f of [NUTZER.carla, ...FELD.slice(0, 8)]) await B.blobPut(A.anmeldungPfad("6h-2026", f.id, "GT3", f.profil.iracingName), "1", "text/plain");

  // Ergebnisse GT3 (fünf Rennen) und 6h 2025, dazu eine Strafe aus einem Report
  const rennenListe = Object.entries(RENNEN).map(([id, r]) => ({ id, ...r }));
  const gt3Ergebnisse = [0, 1, 2, 3, 4].map((i) => ergebnis(RENNEN[`gt3-r${i + 1}`], i + 1, 24, STRECKEN[i][2], gt3Feld.filter((f, j) => (j + i) % 9 !== 4)));
  for (const e of gt3Ergebnisse) await D.ergebnisSpeichern("gt3-sprint", e);
  const opfer = FELD[5];
  await D.privatSchreiben("gt3-sprint", { einstufung: {}, strafen: [{ id: "s1", reportId: "r3", rennen: gt3Ergebnisse[2].id, cust: opfer.profil.custId, name: opfer.profil.iracingName, punkte: 3, grund: "Vermeidbare Kollision" }] });
  await D.tabelleNeu("gt3-sprint", SERIEN["gt3-sprint"], gt3Ergebnisse, rennenListe);
  const alt = ergebnis(RENNEN["6h-2025"], 9, 142, 1410000, [NUTZER.carla, ...FELD.slice(0, 12)]);
  await D.ergebnisSpeichern("6h-nuerburgring-2025", alt);
  await D.tabelleNeu("6h-nuerburgring-2025", SERIEN["6h-nuerburgring-2025"], [alt], rennenListe);

  // Reports: einer von Anna (offen), einer mit Stimmen, zwei entschieden
  const rb = (i) => ({ rennen: `gt3-r${i + 1}`, rennenTitel: RENNEN[`gt3-r${i + 1}`].titel, serie: "gt3-sprint", serieName: SERIEN["gt3-sprint"].name, serieFarbe: "rot", start: gt3Ergebnisse[i].start, notizen: "", clip: "", einsprueche: [], stimmen: [], urteil: null, endgueltig: false });
  const urteil = (art, extra, von) => ({ ...R.pruefeUrteil({ art, ...extra }), von, zeit: vorTagen(1) });
  const REPORTS = {
    r1: { ...rb(4), erstellt: vorTagen(1.5), von: person(NUTZER.anna), gegen: person(FELD[6]), session: "rennen", zeitstempel: "02:41", stelle: "Runde 1, Kurve 1 (Tamburello)", beschreibung: "Beim Anbremsen auf die erste Schikane wurde ich von hinten getroffen und habe mich gedreht.", clip: "https://www.twitch.tv/videos/beispiel", status: "offen" },
    r2: { ...rb(4), erstellt: vorTagen(1.2), von: person(FELD[9]), gegen: person(FELD[12]), session: "rennen", zeitstempel: "31:08", stelle: "Runde 9, Rivazza", beschreibung: "Beim Überholversuch innen wurde mir die Tür zugemacht, Kontakt am Vorderrad.", status: "pruefung", stimmen: [{ von: "777777777777777777", name: "Steward B", art: "verwarnung", notiz: "Rennunfall mit leichter Mitschuld", zeit: vorTagen(1) }] },
    r3: { ...rb(2), erstellt: vorTagen(16), von: person(FELD[8]), gegen: person(opfer), session: "rennen", zeitstempel: "14:55", stelle: "Runde 4, Kurve 3", beschreibung: "Ich wurde in der Bremszone abgeschossen und musste an die Box.", status: "entschieden", urteil: urteil("strafpunkte", { punkte: 3, begruendung: "Vermeidbare Kollision beim Anbremsen.", rennen: gt3Ergebnisse[2].id, cust: opfer.profil.custId, name: opfer.profil.iracingName }, "Steward B"), endgueltig: true },
    r4: { ...rb(1), erstellt: vorTagen(22), von: person(FELD[13]), gegen: person(NUTZER.carla), session: "rennen", zeitstempel: "38:20", stelle: "Runde 12, Parabolica", beschreibung: "Leichter Kontakt am Heck beim Herausbeschleunigen.", status: "entschieden", urteil: urteil("verwarnung", { begruendung: "Rennunfall, Verwarnung." }, "Steward Test"), endgueltig: true },
  };
  for (const [id, r] of Object.entries(REPORTS)) await json(`liga/daten/reports/${id}.json`, r);

  // Liga-Teams: Ben gründet „Night Racers“, Carla tritt bei; ein zweites Team aus dem Feld
  const gruenden = async (chef, daten, mitglieder) => {
    await T.aktion("team-gruenden", chef.id, chef.profil, daten);
    const team = T.teamVon(await T.alle(true), chef.id);
    for (const m of mitglieder) await T.aktion("team-beitreten", m.id, m.profil, { code: team.einladung });
  };
  await gruenden(NUTZER.ben, { name: "Night Racers", kuerzel: "NR", farbe: "blau" }, [NUTZER.carla]);
  await gruenden(FELD[0], { name: "Nordkurve Racing", kuerzel: "NKR", farbe: "rot" }, [FELD[1], FELD[11]]);

  // Community-Rennen: ein kommendes mit Freigabe (gesponsert), ein offenes, ein schon gefahrenes
  const start = (n, uhr) => isoStart(tag(n), uhr);
  const community = (id, wer, e) => json(`liga/community/${id}.json`, {
    id, discordId: wer.id, name: wer.profil.iracingName, nummer: wer.profil.nummer, status: "freigegeben", training: 20, qualiDauer: 10, quali: true, art: "einzel", zugang: "offen", plaetze: 20, iratingMin: null, iratingMax: null,
    banner: "", session: { name: "", passwort: "" }, anfragen: [], aenderung: null, erstellt: vorTagen(5), ...e,
  });
  await community("aaaa0001", NUTZER.anna, { titel: "Spa Night Sprint", datum: tag(9), uhrzeit: "20:00", start: start(9, "20:00"), strecke: "Spa-Francorchamps", fahrzeugklasse: "GT3", dauer: 45, training: 30, qualiDauer: 15, zugang: "freigabe", iratingMax: 3000,
    beschreibung: "Lockerer Sprint am Abend, offen für alle GT3-Fahrer bis 3000 iRating.", entscheid: { stewarding: "darkline", sponsored: true, zeit: vorTagen(4), von: "Rennleitung" } });
  await community("bbbb0002", NUTZER.ben, { titel: "MX-5 Feierabendrennen", datum: tag(14), uhrzeit: "19:30", start: start(14, "19:30"), strecke: "Lime Rock Park", fahrzeugklasse: "Mazda MX-5", dauer: 30, training: 15, qualiDauer: 0, quali: false, plaetze: 16,
    beschreibung: "Kurzes Rennen nach Feierabend, jeder ist willkommen.", session: { name: "DSRS MX-5", passwort: "mx5" }, entscheid: { stewarding: "eigene", sponsored: false, zeit: vorTagen(4), von: "Rennleitung" } });
  const vor2 = new Date(Date.now() - 2 * 3600e3);
  await community("cccc0003", NUTZER.anna, { titel: "Monza Sprint", datum: vor2.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }), uhrzeit: vor2.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }), start: vor2.toISOString(),
    strecke: "Monza", fahrzeugklasse: "GT3", dauer: 45, beschreibung: "Schon gefahren: Hier kann Anna als Veranstalterin das Ergebnis hochladen.", entscheid: { stewarding: "darkline", sponsored: false, zeit: vorTagen(4), von: "Rennleitung" } });
  for (const f of [NUTZER.anna, NUTZER.ben, NUTZER.carla]) await B.blobPut(A.anmeldungPfad("c-cccc0003", f.id, "", f.name), "1", "text/plain");
  await B.blobPut(A.anmeldungPfad("c-aaaa0001", NUTZER.carla.id, "", NUTZER.carla.name), "1", "text/plain");
  // Ein Antrag wartet auf die Rennleitung
  await json("liga/community/eeee0005.json", { id: "eeee0005", discordId: NUTZER.carla.id, name: "Carla Fast", nummer: 21, status: "offen", titel: "Suzuka Team-Enduro", datum: tag(25), uhrzeit: "18:00", start: start(25, "18:00"),
    strecke: "Suzuka", fahrzeugklasse: "GT3", dauer: 120, training: 45, qualiDauer: 20, quali: true, art: "team", zugang: "offen", plaetze: 30, iratingMin: null, iratingMax: null, beschreibung: "Zwei Stunden im Team, Fahrerwechsel Pflicht.", banner: "", session: { name: "", passwort: "" }, anfragen: [], aenderung: null, erstellt: vorTagen(0.5) });
}

/* ---------- Server ---------- */
const TYPEN = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon", ".jpg": "image/jpeg" };

fuellen().then(() => http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname === "/login") {
    const als = u.searchParams.get("als");
    const cookies = ["dpm_liga=; Path=/; Max-Age=0", "dpm_liga_admin=; Path=/; Max-Age=0"];
    const fake = { getHeader: () => undefined, setHeader: (k, v) => { cookies.push(...[].concat(v)); } };
    if (COCKPIT[als]) S.createLigaAdminSession(fake, COCKPIT[als]);
    else if (NUTZER[als]) S.createLigaSession(fake, { id: NUTZER[als].id, name: NUTZER[als].name });
    res.writeHead(302, { "Set-Cookie": cookies, Location: COCKPIT[als] ? "/liga-admin" : u.searchParams.get("ziel") || "/fahrerbereich" });
    return res.end();
  }
  // Statt Discord: Auswahl der Testnutzer (der „Mit Discord anmelden“-Knopf der Seiten führt hierher)
  if (u.pathname === "/api/discord-login") {
    const admin = u.searchParams.get("ziel") === "liga-admin";
    const wahl = admin
      ? [["steward", "Steward Test", "Reports entscheiden, Rest nur lesen"], ["leitung", "Rennleitung Test", "Alles im Cockpit"]]
      : [["anna", "Anna Racer #12", "Stammfahrerin GT3 Sprint Cup, Report offen"], ["ben", "Ben Neu #7", "Ohne Season, Chef von Night Racers"], ["carla", "Carla Fast #21", "GT3 Sprint Cup, Night Racers"], ["neu", "Neuling", "Discord-Konto ohne Fahrerprofil"], ["steward", "Steward Test", "Cockpit"], ["leitung", "Rennleitung Test", "Cockpit"]];
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Demo-Anmeldung</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d0e;color:#e8ece9;font:16px/1.4 system-ui,sans-serif;padding:16px}main{width:100%;max-width:440px}
h1{font-size:1.3rem;margin:0 0 4px}p{color:#9aa5a0;margin:0 0 18px}a{display:block;padding:14px 16px;margin-bottom:8px;background:#15181a;border-left:3px solid #d3121b;color:inherit;text-decoration:none}
a:hover{background:#1d2124}b{display:block}small{color:#9aa5a0}</style>
<main><h1>Demo-Anmeldung</h1><p>Statt Discord: Als wen möchtest du dich anmelden?</p>${wahl.map(([k, n, t]) => `<a href="/login?als=${k}"><b>${n}</b><small>${t}</small></a>`).join("")}</main>`);
  }
  if (u.pathname === "/logout") { res.writeHead(302, { "Set-Cookie": ["dpm_liga=; Path=/; Max-Age=0", "dpm_liga_admin=; Path=/; Max-Age=0"], Location: "/liga" }); return res.end(); }
  if (u.pathname === "/api/liga") {
    let body = "";
    for await (const c of req) body += c;
    req.query = Object.fromEntries(u.searchParams);
    try { req.body = body ? JSON.parse(body) : {}; } catch (e) { req.body = body; }
    req.headers.origin = req.headers.origin || `http://${req.headers.host}`;
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (d) => { if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(d)); return res; };
    res.send = (d) => { res.end(d); return res; };
    try { return await liga(req, res); } catch (e) { console.error(e); if (!res.headersSent) { res.statusCode = 500; res.end("{}"); } return; }
  }
  let p = u.pathname === "/" ? "/liga.html" : u.pathname;
  if (!path.extname(p)) p += ".html";
  const datei = path.join(WURZEL, p);
  if (!datei.startsWith(WURZEL) || !fs.existsSync(datei)) { res.statusCode = 404; return res.end("404"); }
  res.setHeader("Content-Type", TYPEN[path.extname(datei)] || "application/octet-stream");
  fs.createReadStream(datei).pipe(res);
}).listen(PORT, () => console.log(`Liga-Demo bereit: http://localhost:${PORT}/liga  (Anmelden: /login?als=anna|ben|carla|neu|steward|leitung)`)))
  .catch((e) => { console.error("Testdaten konnten nicht angelegt werden:", e); process.exit(1); });
