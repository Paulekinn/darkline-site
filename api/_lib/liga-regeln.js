// Strafenkatalog (Anhang A). Die Rennleitung kann ihn selbst bearbeiten, ohne Livegang. Ohne gespeicherte Fassung gilt der Stand des PDFs.
const { blobGet, blobPut } = require("./blob");
const { Hinweis } = require("./liga-daten");

const PFAD = "liga/daten/strafenkatalog.json";
const VW = "Verwarnung";
const z = (nr, vergehen, erklaerung, min, max = "", hinweis = "", kommentar = "") => ({ nr, vergehen, erklaerung, min, max, hinweis, kommentar });

const STANDARD = {
  stand: "2026-08-05",
  eintraege: [
    z("01.0", "Anschieben eines Teilnehmers", "ohne Vorteil, TN ohne Schaden", "Verwarnung (s/w Flagge)", "5 Sek."),
    z("01.1", "", "mit Vorteil, TN ohne Schaden / mit Schaden", "5 Sek.", "10 Sek.", "Je nach Situation", "Position zurückgeben wenn möglich"),
    z("01.2", "", "Wiederholungsfall, TN unabhängig", "10 Sek.", "20 Sek.", "Strafmaß erhöhen"),
    z("02.0", "Abdrängen von der Strecke", "eines anderen Teilnehmers; Unabsichtlich / ohne Vorteil / ohne Schaden", "Verwarnung (s/w Flagge)", "10 Sek.", "Je nach Situation"),
    z("02.1", "", "Abdrängen mit Vorteil / mit Schaden", "10 Sek.", "20 Sek.", "Je nach Situation"),
    z("02.2", "", "Wiederholungsfall; TN unabhängig", "20 Sek.", "30 Sek.", "Max. Strafe"),
    z("03.0", "Behinderung", "(Q1+2) In der Qualifikation", "+ 3 Plätze", "BS"),
    z("03.1", "", "(R) Versehentlich / Gefährlich", VW, "5 Sek."),
    z("03.2", "", "(R) Wiederholungsfall; TN unabhängig", "10 Sek.", "20 Sek.", "Max. Strafe"),
    z("04.0", "Kollision", "Verursachen einer Kollision", "5 Sek.", "10 Sek.", "", "z.B. Divebombs"),
    z("04.1", "", "Wiederholungsfall, TN unabhängig", "10 Sek.", "30 Sek.", "Max. Strafe"),
    z("05.0", "Unsportliches Verhalten", "Versuch eines absichtlichen Unfalls", VW, "10 Sek."),
    z("05.1", "", "Wiederholungsfall; TN unabhängig", "10 Sek.", "20 Sek."),
    z("05.2", "", "Verursachen eines Unfalls", "10 Sek.", "20 Sek."),
    z("05.3", "", "Wiederholungsfall; TN unabhängig", "20 Sek.", "S&H 60 Sek.", "Max. Strafe", "Serienausschluss prüfen!"),
    z("06.0", "Unsafe Rejoin", "Unsafe Rejoin", VW, "10 Sek."),
    z("06.1", "", "Unsafe Rejoin mit Kontakt", "30 Sek.", "S&H 60 Sek.", "", "Bei Wiederholung, DQ"),
    z("07.0", "Gefahrensituation", "Gefahrensituation nicht richtig gehandhabt", VW, "30 Sek.", "", "Keine Bremsbereitschaft, Überholen, Verunfallen"),
    z("08.0", "Blaue Flaggen", "Einfache Missachtung blauer Flaggen", VW, "5 Sek."),
    z("08.1", "", "Wiederholungsfall; TN unabhängig", "10 Sek.", "30 Sek."),
    z("09.0", "Zurückrunden", "Erfolgloser Versuch des Zurückrundens ohne Kollision", VW, "5 Sek."),
    z("09.1", "", "mit Kollision", "10 Sek.", "DT"),
    z("10.0", "Einführungsrunde", "Unerlaubtes Überholen", VW, "5 Sek.", "", "Bei Kollisionsvermeidung nichts"),
    z("10.1", "", "Zurückfallen in der Formation", VW, "5 Sek."),
    z("11.0", "Startphase", "Startformation verlassen", "10 Sek.", "DT"),
    z("11.1", "", "Bewegung vor Startsignal", "10 Sek.", "DT"),
    z("12.0", "Chat / Voice", "Beleidigung, Bedrohung", VW, "30 Sek."),
    z("12.1", "", "Benutzung im Rennen", VW, "DT"),
    z("13.0", "Boxenstopp", "Kein ordnungsgemäßer Räderwechsel", "30 Sek."),
    z("13.1", "", "Pflichtstopp außerhalb des Boxenstoppfensters", "30 Sek."),
    z("13.2", "", "Nicht absolvierter Pflichtboxenstopp", "DQ"),
    z("14.0", "Safety Car", "Versehentliches, sofort korrigiertes Überholen", VW, "5 Sek."),
    z("14.1", "", "Überholen unter SC mit Positionsgewinn", "30 Sek.", "DQ"),
    z("14.2", "", "Vorsätzliches Überholen mehrerer TN", "DQ"),
    z("15.1", "Full Course Yellow", "Pit-Limiter nicht aktiviert", VW, "30 Sek.", "", "RT berücksichtigen"),
    z("15.2", "", "Pflichtboxenstopp während FCY", "30 Sek."),
    z("15.3", "", "Strafe/n während FCY angetreten", "15 Sek."),
    z("16.0", "Chat / Voice", "Beleidigung, Bedrohung", VW, "30 Sek.", "", "Je nach Härte / Wiederholung DQ"),
    z("16.1", "", "Benutzung im Rennen", VW, "DT"),
    z("17.0", "Track Limits", "Nichteinhaltung der Streckenbegrenzung", VW, "DQ", "17x DT, 25x DQ"),
    z("17.1", "", "mit Vorteil", "10 Sek."),
    z("18.0", "Verwarnungen", "2 Verwarnungen", "10 Sek.", "", "", "Verwarnung nur Renntag"),
  ],
  strafpunkte: [["Verwarnung", 0], ["05s Zeitstrafe", 1], ["10s Zeitstrafe", 1], ["30s Zeitstrafe", 3], ["60s Zeitstrafe", 4], ["BS", 4], ["DT", 3], ["S&G", 3], ["S&H 10s", 3], ["S&H 20s", 4], ["S&H 30s", 4], ["S&H 60s", 5], ["DQ", 5]].map(([strafe, punkte]) => ({ strafe, punkte })),
};

const text = (v, max) => String(v ?? "").trim().slice(0, max);

function pruefeKatalog(e, jetzt = new Date()) {
  const eintraege = (Array.isArray(e && e.eintraege) ? e.eintraege : []).map((x) => ({ nr: text(x.nr, 10), vergehen: text(x.vergehen, 80), erklaerung: text(x.erklaerung, 200), min: text(x.min, 40), max: text(x.max, 40), hinweis: text(x.hinweis, 80), kommentar: text(x.kommentar, 120) }));
  const strafpunkte = (Array.isArray(e && e.strafpunkte) ? e.strafpunkte : []).map((x) => ({ strafe: text(x.strafe, 40), punkte: Number(String(x.punkte ?? "").trim() || NaN) }));
  if (!eintraege.length) throw new Hinweis("Der Strafenkatalog braucht mindestens einen Eintrag.");
  if (eintraege.length > 300 || strafpunkte.length > 60) throw new Hinweis("Der Strafenkatalog ist zu lang.");
  if (eintraege.some((x) => !x.nr)) throw new Hinweis("Jeder Eintrag im Strafenkatalog braucht eine Nummer.");
  const doppelt = eintraege.map((x) => x.nr).find((n, i, l) => l.indexOf(n) !== i);
  if (doppelt) throw new Hinweis(`Die Nummer ${doppelt} steht mehrfach im Strafenkatalog.`);
  if (strafpunkte.some((x) => !x.strafe || !Number.isInteger(x.punkte) || x.punkte < 0 || x.punkte > 100)) throw new Hinweis("Bitte gib bei jeder Strafe einen Namen und die Punkte als ganze Zahl von 0 bis 100 an.");
  return { stand: jetzt.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }), eintraege, strafpunkte };
}

async function katalogLesen() {
  const t = await blobGet(PFAD);
  return t ? JSON.parse(t) : STANDARD;
}
const katalogSpeichern = (k) => blobPut(PFAD, JSON.stringify(k), "application/json");

async function regeln(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Nicht erlaubt" });
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
  return res.status(200).json({ katalog: await katalogLesen() });
}

module.exports = { STANDARD, pruefeKatalog, katalogLesen, katalogSpeichern, regeln };
