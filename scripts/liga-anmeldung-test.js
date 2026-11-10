// Prüft Anmeldung, Warteliste, Fristen und die Trennung der Logins. Aufruf: node scripts/liga-anmeldung-test.js
const assert = require("assert");
process.env.SESSION_SECRET = "test-geheimnis-mit-mindestens-32-zeichen!";
const A = require("../api/_lib/liga-anmeldung");
const S = require("../api/_lib/session");
const D = require("../api/_lib/liga-daten");
const R = require("../api/_lib/liga-reports");
const REPORT = { id: "r1", von: { discordId: "1", name: "Melder" }, gegen: { discordId: "2", name: "Gemeldet" }, stelle: "Runde 3", beschreibung: "Berührung", status: "offen", notizen: "intern geheim", urteil: null };
const ENTSCHIEDEN = { ...REPORT, status: "entschieden", urteil: { art: "strafpunkte", punkte: 4, begruendung: "Klar", zeit: iso0(1000), von: "Rennleiter" } };
function iso0(t) { return new Date(t).toISOString(); }

const iso = (t) => new Date(t).toISOString();
const eintrag = (rennen, id, ms, name = `F${id}`, fz = "") => A.leseEintrag({ pathname: A.anmeldungPfad(rennen, id, fz, name), uploadedAt: iso(ms) });
const RENNEN = { id: "r1", titel: "Test", datum: "2026-12-10", startzeit: "20:00", strecke: "Spa", plaetze: 2 };
const START = Date.UTC(2026, 11, 10, 19, 0);
const OPT = { schlussMinuten: 60, discordId: "2", jetzt: START - 864e5 };
const SERIENRENNEN = { ...RENNEN, id: "s1r", serie: "gt3" };
const mitglied = (serie, id, ms) => A.leseEintrag({ pathname: A.mitgliedPfad(serie, id, "", `M${id}`), uploadedAt: iso(ms) });
const baue = (e, o) => A.baueRennen([RENNEN], e, { ...OPT, ...o })[0];

// Antwort-Attrappe, die das Cookie einsammelt
function res() { const h = {}; return { h, getHeader: (k) => h[k], setHeader: (k, v) => { h[k] = v; } }; }
const wert = (r) => [].concat(r.h["Set-Cookie"])[0].split(";")[0].split("=")[1];
const anfrage = (name, v) => ({ headers: { cookie: `${name}=${v}` } });

const teilen = require("../api/_lib/liga-teilen");
const TEILEN_SERIE = { id: "gt3", name: "GT3 Sprint", bildVersion: 0 };
const TEILEN_GRUPPE = { id: "pro", name: "Pro" };
const teilenFahrer = (karte) => ({ name: "Lena Beispiel", pos: 2, punkte: 77, karte: { rating: 88, speed: 90, sauberkeit: 80, racecraft: 85, konstanz: null, abzeichen: [{ art: "hattrick", text: "Hattrick" }], ...karte } });

const P = require("../api/_lib/liga-profil");
const zeile = (rennen, zusatz) => ({ name: "Lena", pid: "aaaaaaaaaaaaaaaa", pos: 1, punkte: 50, rennen, karte: { rating: 90 }, ...zusatz });
const akteDaten = () => {
  const r = (platz, extra) => ({ platz, status: "OK", punkte: 30, pole: false, schnellsteRunde: false, strafe: 0, gestrichen: false, zeitstrafe: 0, ...extra });
  return new Map([
    ["a", { rennenGesamt: 8, rennen: [{ nr: 1, strecke: "Spa", start: "2026-10-01T18:00:00Z" }, { nr: 2, strecke: "Monza", start: "2026-10-08T18:00:00Z" }, { nr: 3, strecke: "Imola", start: "2026-10-15T18:00:00Z" }], klassen: [{ id: "pro", name: "Pro", min: 2500, max: null, fahrer: [zeile([r(1, { pole: true, schnellsteRunde: true }), null, r(3)]), { name: "Tom", pid: "bbbbbbbbbbbbbbbb", pos: 2, punkte: 10, rennen: [r(2)], karte: { rating: null } }] }] }],
    ["b", { rennenGesamt: 1, rennen: [{ nr: 1, strecke: "Nordschleife", start: "2026-11-01T12:00:00Z" }], klassen: [{ id: "am", name: "Am", min: 0, max: 1499, fahrer: [zeile([{ platz: null, status: "DNF", punkte: 0, pole: false, schnellsteRunde: false, strafe: 0, gestrichen: false, zeitstrafe: 0 }])] }] }],
    ["c", null],
  ]);
};
const akteSerien = [{ id: "a", name: "Serie A" }, { id: "b", name: "Serie B", typ: "event" }, { id: "c", name: "Leer" }];

const kartenTabelle = () => new Map([["gt3", { rennenGesamt: 8, klassen: [{ id: "pro", name: "Pro", min: 2500, max: null, fahrer: [{ name: "Lena Beispiel", pos: 1, punkte: 50, rennen: [], irating: 3000, karte: { rating: 90 } }, { name: "Tom Muster", pos: 2, punkte: 40, rennen: [], karte: null }] }] }], ["leer", null]]);

const G = require("../api/_lib/liga-strecken");
// Der Einspruch ist abgeschaltet. Seine Regeln bleiben getestet, damit er sich gefahrlos wieder einschalten lässt.
function mitEinspruch(fn) {
  process.env.LIGA_EINSPRUCH = "1";
  try { return fn(); } finally { delete process.env.LIGA_EINSPRUCH; }
}
const gpsRunde = (n, r = 0.01) => Array.from({ length: n }, (_, i) => { const w = (i / n) * 2 * Math.PI; return { d: i / (n - 1) * 0.999, lat: 50 + r * Math.sin(w), lon: 6 + r * Math.cos(w) }; });

// Supabase-Attrappe: versteht die Filter, die der Speicher verwendet
function supabaseAttrappe(seite = 1000) {
  const zeilen = new Map();
  const anfragen = [];
  const alt = { fetch: global.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  process.env.SUPABASE_URL = "https://projekt.supabase.co/";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
  global.fetch = async (url, o = {}) => {
    const u = new URL(url);
    anfragen.push({ url: u, o });
    const m = o.method || "GET";
    const pfad = u.searchParams.get("pfad") || "";
    if (m === "POST") { for (const z of JSON.parse(o.body)) zeilen.set(z.pfad, z); return { ok: true }; }
    if (m === "DELETE") { [...pfad.slice(4, -1).matchAll(/"((?:[^"\\]|\\.)*)"/g)].forEach((x) => zeilen.delete(x[1].replace(/\\(.)/g, "$1"))); return { ok: true }; }
    let treffer = [...zeilen.values()].sort((a, b) => a.pfad.localeCompare(b.pfad));
    if (pfad.startsWith("eq.")) treffer = treffer.filter((z) => z.pfad === pfad.slice(3));
    if (pfad.startsWith("like.")) { const vorn = pfad.slice(5, -1).replace(/\\(.)/g, "$1"); treffer = treffer.filter((z) => z.pfad.startsWith(vorn)); }
    const start = Number(u.searchParams.get("offset") || 0);
    const stueck = treffer.slice(start, start + Math.min(seite, Number(u.searchParams.get("limit") || seite)));
    const spalten = u.searchParams.get("select").split(",");
    return { ok: true, status: 200, json: async () => stueck.map((z) => Object.fromEntries(spalten.map((s) => [s, z[s]]))) };
  };
  return { zeilen, anfragen, ende: () => { global.fetch = alt.fetch; for (const [k, v] of [["SUPABASE_URL", alt.url], ["SUPABASE_SECRET_KEY", alt.key]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } } };
}
const B = require("../api/_lib/blob");
const T = require("../api/_lib/liga-renntag");
const K = require("../api/_lib/liga-regeln");

const tests = {
  "Eventreihe: Siegerliste, und die Bestenliste zählt nur endgültige Ergebnisse": () => {
    const E = require("../api/_lib/liga-events");
    const zeile = (name, pid, platz, status = "OK") => ({ name, pid, gesamt: { platz, status } });
    const tab = (start, namen) => ({ rennen: [{ start, ergebnisse: [{ fahrzeugklasse: "GT3", zeilen: namen }] }] });
    const a = [zeile("Anna", "a", 1), zeile("Ben", "b", 2), zeile("Cem", "c", 3), zeile("Dia", "d", 4)];
    const b = [zeile("Ben", "b", 1), zeile("Anna", "a", 2), zeile("Eva", "e", null, "DNF")];
    const serien = [{ id: "e25", name: "6h 2025" }, { id: "e26", name: "6h 2026" }, { id: "e27", name: "6h 2027" }];
    const tabellen = new Map([["e25", tab("2025-05-01T18:00:00Z", a)], ["e26", tab("2026-05-01T18:00:00Z", b)], ["e27", tab("2027-05-01T18:00:00Z", b)]]);
    const r = E.eventReihe("6h", serien, tabellen, (s) => s.id === "e27");
    assert.deepStrictEqual(r.ausgaben.map((x) => [x.jahr, x.vorlaeufig]), [["2027", true], ["2026", false], ["2025", false]]);
    assert.deepStrictEqual(r.bestenliste.map((f) => [f.name, f.p1, f.p2, f.p3]), [["Anna", 1, 1, 0], ["Ben", 1, 1, 0], ["Cem", 0, 0, 1]]);
    assert.strictEqual(r.ausgaben[2].klassen[0].podium.length, 3);
  },
  "Eventreihe: Erfolge fürs Profil und Tabellen ohne Ergebnis": () => {
    const E = require("../api/_lib/liga-events");
    const zeile = (pid, platz) => ({ name: pid, pid, gesamt: { platz, status: "OK" } });
    const tab = { rennen: [{ start: "2026-05-01T18:00:00Z", ergebnisse: [{ fahrzeugklasse: "GT3", zeilen: [zeile("a", 1), zeile("b", 2)] }] }] };
    const serien = [{ id: "e", name: "Einmal", typ: "event", eventReihe: "6h Spa" }, { id: "l", name: "Liga", typ: "liga" }];
    assert.deepStrictEqual(E.eventErfolge(serien, new Map([["e", tab], ["l", tab]]), "b").map((x) => [x.titel, x.platz]), [["6h Spa 2026", 2]]);
    assert.strictEqual(E.podienVon(null), null);
    assert.deepStrictEqual(E.eventReihe("x", [{ id: "e" }], new Map(), () => false), { name: "x", ausgaben: [], bestenliste: [] });
  },
  "Sortierung: Nummern stehen an der richtigen Stelle": () => {
    const F = require("../assets/liga-reglement-format.js");
    assert.deepStrictEqual(["5.10", "4.3", "", "5.8", "04.0", "5"].sort(F.nummerVergleich), ["04.0", "4.3", "5", "5.8", "5.10", ""]);
    const zeile = (nr) => ({ nr, vergehen: "A", erklaerung: "b", min: "5 Sek." });
    assert.deepStrictEqual(K.pruefeKatalog({ eintraege: [zeile("5.8"), zeile("4.3"), zeile("01.0")], strafpunkte: [{ strafe: "DT", punkte: 3 }] }).eintraege.map((x) => x.nr), ["01.0", "4.3", "5.8"]);
  },
  "Reglement: Text und Blöcke lassen sich verlustfrei umwandeln": () => {
    const F = require("../assets/liga-reglement-format.js");
    const bloecke = [{ art: "p", text: "Ein **Satz**." }, { art: "ul", items: ["a", "b"] }, { art: "zeilen", items: ["x", "y"] }, { art: "tabelle", kopf: ["A", "B"], zeilen: [["1", "2"]] }, { art: "bild", src: "img/regeln/rennstart.png", text: "Titel", alt: "Beschreibung" }];
    assert.deepStrictEqual(F.textZuBloecke(F.bloeckeZuText(bloecke)), bloecke);
    assert.strictEqual(F.textZuBloecke("[bild https://boese.example/x.png | a | b]")[0].art, "p");
  },
  "Reglement: wird geprüft und nach Nummern sortiert": () => {
    const u = (nr) => ({ nr, titel: "T", text: "x" });
    const r = K.pruefeReglement({ titel: "R", version: "1.2", abschnitte: [{ nr: "5", titel: "B", unter: [u("5.10"), u("5.8")] }, { nr: "4", titel: "A", unter: [u("4.3")] }] }, new Date(Date.UTC(2026, 10, 10)));
    assert.deepStrictEqual(r.abschnitte.map((h) => h.nr), ["4", "5"]);
    assert.deepStrictEqual(r.abschnitte[1].unter.map((x) => x.nr), ["5.8", "5.10"]);
    assert.strictEqual(r.stand, "10.11.2026");
    const verschoben = K.pruefeReglement({ version: "1", abschnitte: [{ nr: "4", titel: "A", unter: [u("4.5")] }, { nr: "5", titel: "B", unter: [u("4.3"), u("5.1")] }] });
    assert.deepStrictEqual(verschoben.abschnitte.map((h) => h.unter.map((x) => x.nr)), [["4.3", "4.5"], ["5.1"]]);
    assert.strictEqual(verschoben.abschnitte[0].offen, undefined);
    assert.throws(() => K.pruefeReglement({ version: "1", abschnitte: [{ nr: "5", titel: "B", unter: [u("5.8"), u("5.8")] }] }), /mehrfach/);
    assert.throws(() => K.pruefeReglement({ version: "", abschnitte: [{ nr: "5", titel: "B", unter: [] }] }), /Version/);
    assert.throws(() => K.pruefeReglement({ version: "1", abschnitte: [] }), /Abschnitt/);
  },
  "Strafenkatalog: PDF-Stand ist vollständig und gültig": () => {
    const k = K.pruefeKatalog(K.STANDARD, new Date(Date.UTC(2026, 10, 10)));
    assert.strictEqual(k.eintraege.length, 42);
    assert.strictEqual(new Set(k.eintraege.map((x) => x.nr)).size, 42);
    assert.strictEqual(k.strafpunkte.length, 13);
    assert.deepStrictEqual(k.strafpunkte.find((p) => p.strafe === "DQ"), { strafe: "DQ", punkte: 5 });
    assert.strictEqual(k.stand, "2026-11-10");
  },
  "Strafenkatalog: Eingaben werden geprüft": () => {
    const zeile = { nr: "1", vergehen: "A", erklaerung: "b", min: "5 Sek.", max: "", hinweis: "", kommentar: "" };
    const p = [{ strafe: "DT", punkte: "3" }];
    assert.strictEqual(K.pruefeKatalog({ eintraege: [zeile], strafpunkte: p }).strafpunkte[0].punkte, 3);
    assert.throws(() => K.pruefeKatalog({ eintraege: [], strafpunkte: p }), /mindestens einen/);
    assert.throws(() => K.pruefeKatalog({ eintraege: [zeile, zeile], strafpunkte: p }), /mehrfach/);
    assert.throws(() => K.pruefeKatalog({ eintraege: [{ ...zeile, nr: "" }], strafpunkte: p }), /Nummer/);
    assert.throws(() => K.pruefeKatalog({ eintraege: [zeile], strafpunkte: [{ strafe: "DT", punkte: "" }] }), /ganze Zahl/);
    assert.throws(() => K.pruefeKatalog({ eintraege: [zeile], strafpunkte: [{ strafe: "", punkte: 1 }] }), /Namen/);
  },
  "Zugang: nur Events und Serien mit ein oder zwei Rennen brauchen Zugangsdaten": () => {
    const stand = (serie) => A.baueRennen([SERIENRENNEN], [], { ...OPT, serien: { gt3: { name: "GT3", ...serie } } })[0].zugangNoetig;
    assert.strictEqual(stand({ typ: "liga", rennenGesamt: 8 }), false);
    assert.strictEqual(stand({ typ: "liga", rennenGesamt: 3 }), false);
    assert.strictEqual(stand({ typ: "liga", rennenGesamt: 2 }), true);
    assert.strictEqual(stand({ typ: "event", rennenGesamt: 8 }), true);
    const basis = { id: "r1", titel: "Runde 1", serieName: "GT3", start: iso(START), ende: iso(START + 36e5), status: "geplant", ich: { status: "starter", platz: 1 } };
    assert.ok(T.kalenderIcs([{ ...basis, zugangNoetig: false }], START).includes("bei unserer Liga"));
    assert.ok(T.kalenderIcs([{ ...basis, zugangNoetig: true }], START).replace(/\r\n /g, "").includes("Server und Passwort"));
  },
  "Ergebnis: vorläufig bis die Fristen abgelaufen sind": () => {
    const start = Date.UTC(2026, 10, 10, 19);
    const ctx = (o) => ({ serie: { id: "gt3", reportStunden: 24, einspruchStunden: 48 }, rennen: [{ serie: "gt3", datum: "2026-11-10", startzeit: "20:00", renndauer: "60 min" }], reports: [], privat: {}, jetzt: start + 36e5, ...o });
    const s = iso(start);
    assert.strictEqual(R.ergebnisStand(s, ctx()), "vorlaeufig");
    assert.strictEqual(R.ergebnisStand(s, ctx({ jetzt: start + 73 * 36e5 })), "vorlaeufig");
    assert.strictEqual(R.ergebnisStand(s, ctx({ jetzt: start + 73 * 36e5 + 1 })), "endgueltig");
  },
  "Ergebnis: offene Reports und Einsprüche halten es vorläufig, auch nach einer Freigabe": () => {
    const start = Date.UTC(2026, 10, 10, 19);
    const s = iso(start);
    const spaet = start + 30 * 864e5;
    const basis = { serie: { id: "gt3", reportStunden: 24, einspruchStunden: 48 }, rennen: [], privat: { endgueltig: [s] }, jetzt: spaet };
    const report = (o) => ({ serie: "gt3", start: s, einsprueche: [], ...o });
    assert.strictEqual(R.ergebnisStand(s, { ...basis, reports: [report({ urteil: null })] }), "vorlaeufig");
    assert.strictEqual(R.ergebnisStand(s, { ...basis, reports: [report({ urteil: { zeit: s }, einsprueche: [{}] })] }), "vorlaeufig");
    assert.strictEqual(R.ergebnisStand(s, { ...basis, reports: [report({ urteil: { zeit: s }, einsprueche: [{}], endgueltig: true })] }), "endgueltig");
    assert.strictEqual(R.ergebnisStand(s, { ...basis, reports: [report({ serie: "andere", urteil: null })] }), "endgueltig");
  },
  "Einspruch: ist abgeschaltet und verlängert keine Frist": () => {
    assert.strictEqual(R.sichtFahrer(ENTSCHIEDEN, [], "2", 2000, {}).kannEinspruch, false);
    const start = Date.UTC(2026, 10, 10, 19);
    const s = iso(start);
    const stand = R.ergebnisStand(s, { serie: { id: "gt3", reportStunden: 24, einspruchStunden: 48 }, rennen: [], reports: [{ serie: "gt3", start: s, einsprueche: [], urteil: { zeit: iso(start + 20 * 36e5) } }], privat: {}, jetzt: start + 75 * 36e5 });
    assert.strictEqual(stand, "endgueltig");
  },
  "Ergebnis: Freigabe von Hand und Einspruchsfrist nach einem Urteil": () => mitEinspruch(() => {
    const start = Date.UTC(2026, 10, 10, 19);
    const s = iso(start);
    const urteilZeit = start + 20 * 36e5;
    const basis = { serie: { id: "gt3", reportStunden: 24, einspruchStunden: 48 }, rennen: [], reports: [{ serie: "gt3", start: s, einsprueche: [], urteil: { zeit: iso(urteilZeit) } }], privat: {} };
    assert.strictEqual(R.ergebnisStand(s, { ...basis, jetzt: start + 40 * 36e5 }), "vorlaeufig");
    assert.strictEqual(R.ergebnisStand(s, { ...basis, jetzt: start + 75 * 36e5 }), "endgueltig");
    assert.strictEqual(R.ergebnisStand(s, { ...basis, privat: { endgueltig: [s] }, jetzt: start + 36e5 }), "endgueltig");
    const t = { rennen: [{ start: s, strecke: "Spa" }] };
    R.staendeSetzen(t, { ...basis, jetzt: start + 36e5 });
    assert.strictEqual(t.rennen[0].vorlaeufig, true);
  }),
  "Urteile: gehen nur in den eigenen Kanal und nur bei einer Strafe": async () => {
    const alt = { fetch: global.fetch, liga: process.env.LIGA_DISCORD_WEBHOOK, urteile: process.env.LIGA_DISCORD_WEBHOOK_URTEILE };
    const aufrufe = [];
    global.fetch = async (url, o) => { aufrufe.push([url, JSON.parse(o.body)]); return { ok: true }; };
    const report = { rennenTitel: "Runde 3", gegen: { name: "Tom Muster" } };
    try {
      process.env.LIGA_DISCORD_WEBHOOK = "https://discord.example/liga";
      delete process.env.LIGA_DISCORD_WEBHOOK_URTEILE;
      await R.discordMelden(report, { art: "strafpunkte", punkte: 6 });
      assert.strictEqual(aufrufe.length, 0);
      process.env.LIGA_DISCORD_WEBHOOK_URTEILE = "https://discord.example/urteile";
      await R.discordMelden(report, { art: "verwarnung" });
      await R.discordMelden(report, { art: "kein-vergehen" });
      assert.strictEqual(aufrufe.length, 0);
      await R.discordMelden(report, { art: "strafpunkte", punkte: 6 });
      assert.strictEqual(aufrufe.length, 1);
      assert.strictEqual(aufrufe[0][0], "https://discord.example/urteile");
      assert.ok(aufrufe[0][1].content.includes("6 Strafpunkte"));
      assert.deepStrictEqual(aufrufe[0][1].allowed_mentions, { parse: [] });
    } finally {
      global.fetch = alt.fetch;
      for (const [k, v] of [["LIGA_DISCORD_WEBHOOK", alt.liga], ["LIGA_DISCORD_WEBHOOK_URTEILE", alt.urteile]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  },
  "Kalender: Link ist signiert, fremde oder veränderte Links gelten nicht": () => {
    const k = S.kalenderSchluessel("123456789");
    assert.strictEqual(S.kalenderPruefen(k), "123456789");
    assert.strictEqual(S.kalenderPruefen(k.replace("123456789", "123456780")), null);
    assert.strictEqual(S.kalenderPruefen("123456789-abc"), null);
    assert.strictEqual(S.kalenderPruefen(""), null);
  },
  "Kalender: enthält nur eigene Rennen und kein Passwort, Absagen sind markiert": () => {
    const basis = { id: "r1", titel: "Runde 1, Spa; Test", serieName: "GT3", strecke: "Spa", start: iso(START), ende: iso(START + 36e5), status: "geplant", passwort: "geheim123", ich: { status: "starter", platz: 1 } };
    const ics = T.kalenderIcs([basis, { ...basis, id: "r2", status: "abgesagt" }, { ...basis, id: "r3", ich: null }], START - 1000);
    assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
    assert.ok(ics.includes("UID:r1@") && ics.includes("UID:r2@") && !ics.includes("UID:r3@"));
    assert.ok(ics.includes("SUMMARY:GT3: Runde 1\\, Spa\\; Test"));
    assert.ok(ics.includes("STATUS:CANCELLED"));
    assert.ok(!ics.includes("geheim123"));
    assert.ok(ics.split("\r\n").every((z) => z.length <= 61));
  },
  "Erinnerung: nur heutige Rennen laufender Serien, nie vor dem Morgen und nur einmal": async () => {
    const heute = Date.UTC(2026, 11, 10, 12, 0);
    const r = (id, serie, start, status = "geplant") => ({ id, serie, start: iso(start), status });
    const serien = { a: { status: "laeuft" }, b: { status: "geplant" }, c: { status: "beendet" } };
    assert.deepStrictEqual(T.rennenHeute([r("1", "a", heute + 36e5), r("2", "b", heute), r("3", "c", heute), r("4", "a", heute + 2 * 864e5), r("5", "a", heute, "abgesagt")], serien, heute).map((x) => x.id), ["1"]);
    const k = T.erinnerungKarte({ titel: "Runde 1", serieName: "GT3", strecke: "Spa", start: iso(heute), plaetze: 40, starter: [{}, {}], passwort: "geheim123" });
    assert.ok(!JSON.stringify(k).includes("geheim123"));
    assert.ok(JSON.stringify(k).includes("2 von 40"));
    const alt = process.env.LIGA_DISCORD_WEBHOOK;
    delete process.env.LIGA_DISCORD_WEBHOOK;
    assert.strictEqual(await T.erinnern(heute), false);
    if (alt !== undefined) process.env.LIGA_DISCORD_WEBHOOK = alt;
  },
  "Rennbericht: Rundenzeit und Karte aus dem Bericht": () => {
    assert.strictEqual(T.rundenzeit(1234560), "2:03.456");
    assert.strictEqual(T.rundenzeit(null), "");
    const karte = T.berichtKarte({ serie: "gt3", serieName: "GT3 Sprint", titel: "Runde 2", strecke: "Spa", klassen: [{ fahrzeugklasse: "GT3", podium: ["A", "B", "C"], schnellste: { name: "A", zeit: "2:03.456" }, aufholer: { name: "C", plaetze: 5 } }] }, true);
    assert.ok(karte.description.includes("1. A") && karte.description.includes("3. C"));
    assert.strictEqual(karte.image.url, "attachment://rennbericht.jpg");
    assert.ok(karte.fields.some((f) => f.name === "Fahrer des Tages" && f.value.includes("C")));
    assert.ok(karte.fields.every((f) => f.value.length >= 1));
  },
  "Prüfung nach dem Rennen: No-Shows und auffällige Incidents": () => {
    const fahrer = (cust, incidents) => ({ cust, name: `F${cust}`, incidents });
    const ruhig = Array.from({ length: 9 }, (_, i) => fahrer(String(i + 1), 1));
    const p = D.pruefungNachRennen({ fahrer: [...ruhig, fahrer("99", 12)] }, [{ name: "F1", cust: "1", discordId: "a" }, { name: "Weg", cust: "50", discordId: "b" }, { name: "Ohne ID", cust: "", discordId: "c" }]);
    assert.deepStrictEqual(p.noShows, [{ name: "Weg", discordId: "b" }]);
    assert.deepStrictEqual(p.incidents.map((f) => f.cust), ["99"]);
    assert.strictEqual(p.erledigt, false);
    assert.strictEqual(D.pruefungNachRennen({ fahrer: ruhig }, [{ name: "F1", cust: "1" }]), null);
  },
  "Strafpunktekonto: meldet nur erreichte Grenzen": () => {
    const privat = { strafen: [{ cust: "1", name: "A", punkte: 6 }, { cust: "1", name: "A", punkte: 6 }, { cust: "2", name: "B", punkte: 5 }] };
    assert.deepStrictEqual(D.strafkonten({ id: "s", name: "S", strafpunkteGrenze: 10 }, privat).map((k) => [k.cust, k.punkte]), [["1", 12]]);
    assert.deepStrictEqual(D.strafkonten({ id: "s", name: "S", strafpunkteGrenze: 0 }, privat), []);
    assert.deepStrictEqual(D.strafkonten({ id: "s", name: "S" }, privat), []);
  },
  "Abstimmung: Stimmen bleiben verborgen, bis man selbst abgestimmt hat": () => {
    const r = { von: { discordId: "1" }, gegen: { discordId: "2" } };
    R.stimmeSetzen(r, { id: "10", name: "Anna" }, { art: "strafpunkte", punkte: 3, notiz: "" });
    const fremd = R.stimmenSicht(r, "11");
    assert.deepStrictEqual([fremd.anzahl, fremd.liste, fremd.mehrheit, fremd.eigene], [1, null, null, null]);
    assert.ok(!JSON.stringify(fremd).includes("Anna"));
    R.stimmeSetzen(r, { id: "10", name: "Anna" }, { art: "verwarnung", notiz: "" });
    assert.strictEqual(r.stimmen.length, 1);
    assert.strictEqual(r.stimmen[0].art, "verwarnung");
    R.stimmeSetzen(r, { id: "11", name: "Ben" }, { art: "verwarnung", notiz: "" });
    const eigen = R.stimmenSicht(r, "11");
    assert.strictEqual(eigen.liste.length, 2);
    assert.ok(eigen.liste.every((s) => s.von === undefined));
    assert.strictEqual(eigen.mehrheit.art, "verwarnung");
  },
  "Abstimmung: Mehrheit braucht zwei gleiche Stimmen, bei Gleichstand gibt es keine": () => {
    const s = (art, punkte) => ({ art, punkte });
    assert.strictEqual(R.mehrheit([s("verwarnung")]), null);
    assert.strictEqual(R.mehrheit([s("verwarnung"), s("dsq")]), null);
    assert.strictEqual(R.mehrheit([s("verwarnung"), s("verwarnung"), s("dsq"), s("dsq")]), null);
    const m = R.mehrheit([s("strafpunkte", 3), s("strafpunkte", 3), s("strafpunkte", 6), s("dsq")]);
    assert.deepStrictEqual([m.art, m.anzahl, m.punkte], ["strafpunkte", 3, 3]);
  },
  "Abstimmung: Stimme wird wie ein Urteil geprüft": () => {
    assert.throws(() => R.pruefeStimme({ art: "strafpunkte" }), /ganze Zahl/);
    assert.throws(() => R.pruefeStimme({ art: "unsinn" }), /Entscheidung/);
    assert.deepStrictEqual(R.pruefeStimme({ art: "zeitstrafe", sekunden: "5", notiz: " x " }), { art: "zeitstrafe", sekunden: 5, notiz: "x" });
  },
  "Fallakte: Rennkontext aus dem passenden Ergebnis, Vorlage bleibt am Urteil": () => {
    const start = Date.UTC(2026, 10, 10, 19);
    const ergebnis = (id, t) => ({ id, start: iso(t), fahrer: [{ cust: "1", name: "A", start: 3, gesamt: 1, runden: 30, incidents: 2, besteRunde: 1 }, { cust: "2", name: "B", start: 1, gesamt: 2, runden: 30, incidents: 6, besteRunde: 2 }] });
    const k = R.rennKontext({ start: iso(start), von: { cust: "1" }, gegen: { cust: "2" } }, [ergebnis("alt", start - 7 * 864e5), ergebnis("neu", start + 6e5)]);
    assert.strictEqual(k.ergebnis, "neu");
    assert.deepStrictEqual([k.von.ziel, k.gegen.incidents], [1, 6]);
    assert.strictEqual(R.rennKontext({ start: iso(start), von: { cust: "1" }, gegen: { cust: "2" } }, [ergebnis("alt", start - 7 * 864e5)]), null);
    assert.strictEqual(R.pruefeUrteil({ art: "verwarnung", begruendung: "Leichter Kontakt", vergehen: "kontakt-leicht" }).vergehen, "kontakt-leicht");
  },
  "Geplant: Anmeldung ist zu, ein Termin startet die Serie nicht von selbst": () => {
    assert.strictEqual(D.wirksamerStatus({ id: "gt3", status: "geplant" }, [SERIENRENNEN], START + 1), "geplant");
    const serien = { gt3: { status: "geplant", anmeldungOffen: true, name: "GT3" } };
    const r = A.baueRennen([SERIENRENNEN], [], { ...OPT, serien })[0];
    assert.strictEqual(r.anmeldungZu, true);
    assert.strictEqual(r.anmeldungFolgt, true);
    const [s] = A.baueSerien([{ id: "gt3", name: "GT3", status: "geplant", anmeldungOffen: true, klassen: [] }], [], { discordId: "2", profil: null, klasseFuer: () => null });
    assert.strictEqual(s.status, "geplant");
    assert.strictEqual(s.anmeldungOffen, false);
    const offen = A.baueRennen([SERIENRENNEN], [], { ...OPT, serien: { gt3: { status: "anmeldung", name: "GT3" } } })[0];
    assert.strictEqual(offen.anmeldungZu, false);
    assert.strictEqual(offen.anmeldungFolgt, false);
  },
  "Season: Wer für die Season gemeldet ist, steht in allen Runden": () => {
    const runden = Array.from({ length: 8 }, (_, i) => ({ ...SERIENRENNEN, id: `r${i + 1}`, titel: `Runde ${i + 1}`, datum: `2026-12-${String(10 + i).padStart(2, "0")}`, plaetze: 40 }));
    const stand = A.baueRennen(runden, [mitglied("gt3", "2", 100)], { ...OPT, discordId: "2" });
    assert.strictEqual(stand.length, 8);
    assert.ok(stand.every((r) => r.ich && r.ich.status === "starter" && r.ich.quelle === "serie" && r.starter.length === 1));
  },
  "Season: Eine Einzelmeldung gilt nur für dieses eine Rennen": () => {
    const runden = [{ ...SERIENRENNEN, id: "r1", plaetze: 40 }, { ...SERIENRENNEN, id: "r2", datum: "2026-12-17", plaetze: 40 }];
    const [eins, zwei] = A.baueRennen(runden, [eintrag("r1", "2", 100)], { ...OPT, discordId: "2" });
    assert.strictEqual(eins.ich.quelle, "rennen");
    assert.strictEqual(zwei.ich, null);
  },
  "Speicher: Text und Bilder kommen unverändert zurück, fehlende Dateien sind null": async () => {
    const a = supabaseAttrappe();
    try {
      await B.blobPut("liga/daten/a.json", '{"ä":1}', "application/json");
      const bild = Buffer.from([0xff, 0xd8, 0xff, 0, 1, 2, 255]);
      await B.blobPut("liga/daten/bilder/x", bild, "image/jpeg");
      assert.strictEqual(await B.blobGet("liga/daten/a.json"), '{"ä":1}');
      assert.ok((await B.blobGetBinaer("liga/daten/bilder/x")).equals(bild));
      assert.strictEqual(await B.blobGet("liga/fehlt"), null);
      assert.strictEqual(await B.blobGetBinaer("liga/fehlt"), null);
      const schreiben = a.anfragen.find((x) => x.o.method === "POST");
      assert.strictEqual(schreiben.o.headers.apikey, "sb_secret_test");
      assert.strictEqual(schreiben.o.headers.authorization, undefined);
      assert.strictEqual(schreiben.url.searchParams.get("on_conflict"), "pfad");
      assert.ok(schreiben.o.headers.prefer.includes("merge-duplicates"));
      assert.ok(schreiben.url.href.startsWith("https://projekt.supabase.co/rest/v1/dateien?"));
    } finally { a.ende(); }
  },
  "Speicher: Überschreiben ersetzt die Datei, die Auflistung liefert Pfad und Datum": async () => {
    const a = supabaseAttrappe();
    try {
      await B.blobPut("liga/reports/a.json", "1", "text/plain");
      await B.blobPut("liga/reports/a.json", "2", "text/plain");
      await B.blobPut("liga/reportsx/b.json", "3", "text/plain");
      const liste = await B.blobList("liga/reports/");
      assert.strictEqual(liste.length, 1);
      assert.deepStrictEqual(Object.keys(liste[0]), ["pathname", "uploadedAt"]);
      assert.ok(!Number.isNaN(Date.parse(liste[0].uploadedAt)));
      assert.deepStrictEqual(await B.blobInhalte("liga/reports/"), [["liga/reports/a.json", "2"]]);
    } finally { a.ende(); }
  },
  "Speicher: Auflistung holt alle Seiten über 1.000 Zeilen hinaus": async () => {
    const a = supabaseAttrappe();
    try {
      for (let i = 0; i < 2300; i++) a.zeilen.set("liga/x/" + String(i).padStart(5, "0"), { pfad: "liga/x/" + String(i).padStart(5, "0"), inhalt: "1", binaer: false, geaendert: "2026-11-10T08:00:00+00:00" });
      const liste = await B.blobList("liga/x/");
      assert.strictEqual(liste.length, 2300);
      assert.strictEqual(new Set(liste.map((b) => b.pathname)).size, 2300);
      assert.strictEqual(a.anfragen.length, 3);
      assert.strictEqual(liste[0].uploadedAt, "2026-11-10T08:00:00.000Z");
    } finally { a.ende(); }
  },
  "Speicher: Löschen trifft genau die Pfade, auch viele und mit Sonderzeichen": async () => {
    const a = supabaseAttrappe();
    try {
      const pfade = Array.from({ length: 60 }, (_, i) => "liga/anmeldungen/r1/" + i + "~a_b~c-d");
      for (const p of pfade) await B.blobPut(p, "1", "text/plain");
      await B.blobPut("liga/bleibt", "1", "text/plain");
      await B.blobDelete(pfade);
      await B.blobDelete([]);
      assert.deepStrictEqual([...a.zeilen.keys()], ["liga/bleibt"]);
      assert.strictEqual(a.anfragen.filter((x) => x.o.method === "DELETE").length, 3);
    } finally { a.ende(); }
  },
  "Speicher: Unterstriche im Pfad wirken nicht als Platzhalter": async () => {
    const a = supabaseAttrappe();
    try {
      await B.blobList("liga/a_b/");
      assert.strictEqual(a.anfragen[0].url.searchParams.get("pfad"), "like.liga/a\\_b/*");
    } finally { a.ende(); }
  },
  "Speicher: ohne Zugangsdaten gibt es eine klare Fehlermeldung": async () => {
    const a = supabaseAttrappe();
    a.ende();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    await assert.rejects(() => B.blobGet("x"), /SUPABASE_URL/);
  },
  "Streckenimport: Kennungen sind eindeutig, ungültige Einträge fehlen": () => {
    const liste = G.importListe(new Map([[1, { name: "Spa", variant: "Grand Prix" }], [2, { name: "Spa", variant: "Grand-Prix" }], [3, { name: "x", variant: "" }], [4, { name: "Nürburgring", variant: "" }]]));
    assert.deepStrictEqual(liste.map((s) => s.id), ["spa-grand-prix", "spa-grand-prix-2", "nuerburgring"]);
    assert.strictEqual(liste[0].g61, 1);
  },
  "Streckenimport: eigene Strecken haben Vorrang vor der Importliste": () => {
    const eigene = [{ id: "spa-grand-prix", name: "Spa", variante: "Grand Prix", kartenVersion: 5 }, { id: "imola-von-hand", name: "Imola", variante: "" }];
    const s = D.streckenZusammen(eigene, [{ id: "spa-grand-prix", name: "Spa", variante: "Grand Prix", g61: 1 }, { id: "imola-kopie", name: "imola", variante: "", g61: 2 }, { id: "monza", name: "Monza", variante: "", g61: 3 }]);
    assert.deepStrictEqual(s.map((x) => x.id), ["spa-grand-prix", "imola-von-hand", "monza"]);
    assert.strictEqual(s[0].kartenVersion, 5);
    assert.strictEqual(s[0].importiert, undefined);
    assert.strictEqual(s[2].importiert, true);
    assert.strictEqual(s[2].notiz, "");
  },
  "Streckenkarte: Zuordnung und Rundenwahl": () => {
    const g = new Map([[7, { name: "Spa", variant: "Grand Prix" }]]);
    assert.strictEqual(G.zuordnung({ name: "SPA", variante: "grand prix" }, g), 7);
    assert.strictEqual(G.zuordnung({ name: "Spa", variante: "" }, g), null);
    const runden = G.besteRunden([{ id: "a", lapTime: 90, canViewTelemetry: true }, { id: "b", lapTime: 80, canViewTelemetry: false }, { id: "c", lapTime: 95, clean: true, canViewTelemetry: true }, { id: "d", lapTime: 0, canViewTelemetry: true }]);
    assert.deepStrictEqual(runden.map((r) => r.id), ["c", "a"]);
  },
  "Streckenkarte: CSV liefert nur die eine Runde": () => {
    const csv = "Speed,LapDistPct,Lat,Lon\n1,0.99,50,6\n1,0.001,50.1,6.1\n1,0.5,50.2,6.2\n1,0.5,50.3,6.3\n1,0.6,0,0\n1,0.999,50.4,6.4\n1,0.002,50.5,6.5";
    assert.deepStrictEqual(G.gpsAusCsv(csv), [{ d: 0.001, lat: 50.1, lon: 6.1 }, { d: 0.5, lat: 50.2, lon: 6.2 }, { d: 0.999, lat: 50.4, lon: 6.4 }]);
    assert.deepStrictEqual(G.gpsAusCsv("a,b\n1,2"), []);
  },
  "Streckenkarte: Linie ist begrenzt, passt in 0 bis 1000 und erkennt Rundkurse": () => {
    const u = G.umriss(gpsRunde(6000));
    assert.ok(u.punkte.length <= 1201);
    assert.ok(u.punkte.every(([x, y]) => x >= 0 && x <= 1000 && y >= 0 && y <= 1000));
    assert.strictEqual(u.geschlossen, true);
    const gerade = Array.from({ length: 500 }, (_, i) => ({ d: i / 499, lat: 50 + i * 0.0001, lon: 6 }));
    assert.strictEqual(G.umriss(gerade).geschlossen, false);
  },
  "Streckenkarte: unvollständige und springende Runden ergeben keine Karte": () => {
    assert.strictEqual(G.umriss([]), null);
    assert.strictEqual(G.umriss(gpsRunde(1000).slice(0, 800)), null);
    const sprung = gpsRunde(1000);
    sprung[500] = { ...sprung[500], lat: 51 };
    assert.strictEqual(G.umriss(sprung), null);
  },

  "Kennung: stabil, je iRacing-ID verschieden und ohne die ID selbst": () => {
    const a = S.fahrerKennung("123456");
    assert.ok(/^[0-9a-f]{16}$/.test(a));
    assert.strictEqual(a, S.fahrerKennung("123456"));
    assert.notStrictEqual(a, S.fahrerKennung("123457"));
    assert.ok(!a.includes("123456"));
  },
  "Eigene Karten: Kennung schlägt den Namen": () => {
    const t = new Map([["gt3", { klassen: [{ id: "pro", name: "Pro", fahrer: [{ name: "Lena", pid: "aaaa", pos: 1, punkte: 5, rennen: [], karte: { rating: 90 } }] }] }]]);
    const serien = [{ id: "gt3", name: "GT3" }];
    assert.strictEqual(A.eigeneKarten(serien, t, "Lena", "bbbb").length, 0);
    assert.strictEqual(A.eigeneKarten(serien, t, "Falscher Name", "aaaa").length, 1);
  },
  "Extras: leere Felder sind erlaubt": () => {
    assert.deepStrictEqual(A.pruefeExtras({}), { nummer: null, land: "", team: "", kanal: "", zeigeBild: false });
  },
  "Extras: gültige Angaben werden übernommen": () => {
    assert.deepStrictEqual(A.pruefeExtras({ nummer: " 46 ", land: "DE", team: " Team X ", kanal: "https://www.twitch.tv/test", zeigeBild: true }), { nummer: 46, land: "DE", team: "Team X", kanal: "https://www.twitch.tv/test", zeigeBild: true });
    assert.strictEqual(A.pruefeExtras({ kanal: "https://youtu.be/abc" }).kanal, "https://youtu.be/abc");
  },
  "Länder: alle ISO-Länder mit deutschem Namen und vorhandener Flagge": () => {
    const F = require("../assets/liga-flaggen.js");
    const fs = require("fs");
    const path = require("path");
    assert.ok(F.LAENDER.length > 240);
    assert.deepStrictEqual(F.LAENDER.slice(0, 3).map(([c]) => c), ["DE", "AT", "CH"]);
    assert.strictEqual(F.name("BR"), "Brasilien");
    assert.strictEqual(F.name("PT"), "Portugal");
    assert.strictEqual(F.quelle("XX"), "");
    for (const [code, name] of F.LAENDER) {
      assert.ok(name && name !== code, `Name fehlt: ${code}`);
      assert.ok(fs.existsSync(path.join(__dirname, "..", F.quelle(code))), `Flagge fehlt: ${code}`);
    }
    assert.strictEqual(A.pruefeExtras({ land: "BR" }).land, "BR");
  },
  "Extras: ungültige Angaben werden abgelehnt": () => {
    for (const n of ["0", "1000", "4a", "-1"]) assert.throws(() => A.pruefeExtras({ nummer: n }), /Startnummer/);
    assert.throws(() => A.pruefeExtras({ land: "XX" }), /Land/);
    assert.throws(() => A.pruefeExtras({ land: "__proto__" }), /Land/);
    for (const k of ["http://twitch.tv/a", "https://boese.de/twitch.tv", "javascript:alert(1)", "https://twitch.tv.boese.de/a", "nur text"]) assert.throws(() => A.pruefeExtras({ kanal: k }), /Twitch/);
  },
  "Profil: Angaben kommen unversehrt aus dem Dateinamen zurück, der Besitzer bleibt intern": () => {
    const pfad = P.profilPfad("0123456789abcdef", { o: "geheim", n: 46, l: "DE", t: "Äöü Team", k: "", b: "abc" });
    const p = P.leseProfil({ pathname: pfad });
    assert.deepStrictEqual([p.pid, p.n, p.l, p.t], ["0123456789abcdef", 46, "DE", "Äöü Team"]);
    assert.ok(!JSON.stringify(P.oeffentlich(p)).includes("geheim"));
    assert.strictEqual(P.leseProfil({ pathname: "liga/fahrerprofile/kaputt" }), null);
  },
  "Profil: fremde iRacing-ID und vergebene Startnummer werden abgelehnt": () => {
    const alle = [{ pid: "p1", o: "x", n: 46 }];
    assert.throws(() => P.pruefeKonflikte(alle, "p1", "y", null), /iRacing-ID/);
    assert.throws(() => P.pruefeKonflikte(alle, "p2", "y", 46), /Startnummer 46/);
    assert.doesNotThrow(() => P.pruefeKonflikte(alle, "p1", "x", 46));
    assert.doesNotThrow(() => P.pruefeKonflikte(alle, "p2", "y", 7));
  },
  "Profil: Entscheidung zur Startnummer nennt Nummer und Grund": () => {
    assert.match(P.nummerEntscheid("bestaetigt", 42).text, /auf #42 geändert/);
    const ab = P.nummerEntscheid("abgelehnt", 42, 31, "Nummer ist reserviert");
    assert.strictEqual(ab.art, "abgelehnt");
    assert.match(ab.text, /#42 abgelehnt\. Du fährst weiter mit #31\. Grund: Nummer ist reserviert/);
    assert.ok(!P.nummerEntscheid("abgelehnt", 42, 31, "").text.includes("Grund"));
  },
  "Discord: Direktnachricht geht an den Fahrer, ohne Erwähnungen und ohne Absturz": async () => {
    const Dc = require("../api/_lib/liga-discord");
    const alt = { fetch: global.fetch, env: { ...process.env } };
    Object.assign(process.env, { DISCORD_BOT_TOKEN: "t", DISCORD_GUILD_ID: "100", LIGA_ROLLE_INTERESSENT: "1", LIGA_ROLLE_FAHRER: "2" });
    const aufrufe = [];
    let gesperrt = false;
    global.fetch = async (url, init) => {
      aufrufe.push([String(url).replace("https://discord.com/api/v10", ""), JSON.parse(init.body)]);
      if (String(url).endsWith("/users/@me/channels")) return { ok: true, status: 200, json: async () => ({ id: "555" }) };
      return { ok: !gesperrt, status: gesperrt ? 403 : 200 };
    };
    const warn = console.warn;
    console.warn = () => {};
    try {
      assert.strictEqual(await Dc.nachricht("9", "Hallo @everyone"), true);
      assert.deepStrictEqual(aufrufe, [["/users/@me/channels", { recipient_id: "9" }], ["/channels/555/messages", { content: "Hallo @everyone", allowed_mentions: { parse: [] } }]]);
      gesperrt = true;
      assert.strictEqual(await Dc.nachricht("9", "x"), false);
      global.fetch = async () => { throw new Error("weg"); };
      assert.strictEqual(await Dc.nachricht("9", "x"), false);
    } finally {
      console.warn = warn;
      global.fetch = alt.fetch;
      for (const k of ["DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID", "LIGA_ROLLE_INTERESSENT", "LIGA_ROLLE_FAHRER"]) { if (alt.env[k] === undefined) delete process.env[k]; else process.env[k] = alt.env[k]; }
    }
  },
  "Profil: Startnummer ist Pflicht": () => {
    assert.throws(() => A.nummerPflicht(A.pruefeExtras({})), /Startnummer/);
    assert.doesNotThrow(() => A.nummerPflicht(A.pruefeExtras({ nummer: "31" })));
  },
  "Profil: beantragte Startnummer ist für andere reserviert": () => {
    const wuensche = [{ discordId: "1", nach: 42 }];
    assert.strictEqual(P.istBeantragt(wuensche, 42, "2"), true);
    assert.strictEqual(P.istBeantragt(wuensche, 42, "1"), false);
    assert.strictEqual(P.istBeantragt(wuensche, 7, "2"), false);
  },
  "Discord: Rollen und Name folgen Profil und Liga-Anmeldung": () => {
    const Dc = require("../api/_lib/liga-discord");
    const profil = { iracingName: "Max Mustermann", custId: "1", nummer: 31 };
    const serien = [{ id: "l", typ: "liga", status: "laeuft" }, { id: "e", typ: "event", status: "laeuft" }, { id: "alt", typ: "liga", status: "beendet" }];
    const inSerie = (serieId) => [{ typ: "serie", discordId: "9", serieId }];
    assert.deepStrictEqual(Dc.soll("9", { iracingName: "A", custId: "1", nummer: null }, [], serien), { i: false, f: false, n: "" });
    assert.deepStrictEqual(Dc.soll("9", profil, [], serien), { i: true, f: false, n: "" });
    assert.deepStrictEqual(Dc.soll("9", profil, inSerie("l"), serien), { i: true, f: true, n: "#31 Max Mustermann" });
    for (const id of ["e", "alt"]) assert.strictEqual(Dc.soll("9", profil, inSerie(id), serien).f, false);
    assert.strictEqual(Dc.soll("9", profil, [{ typ: "serie", discordId: "8", serieId: "l" }], serien).f, false);
    assert.ok(Dc.servername(999, "X".repeat(40)).length <= 32);
  },
  "Discord: nur nötige Schritte, ohne Liga verschwindet die Nummer": () => {
    const Dc = require("../api/_lib/liga-discord");
    const arten = (l) => l.map((s) => s.art);
    assert.deepStrictEqual(arten(Dc.schritte({}, { i: true, f: false, n: "" }, "Max")), ["interessent"]);
    assert.deepStrictEqual(arten(Dc.schritte({ i: true }, { i: true, f: true, n: "#31 Max" }, "Max")), ["fahrer", "name"]);
    assert.deepStrictEqual(Dc.schritte({ i: true, f: true, n: "#31 Max" }, { i: true, f: true, n: "#31 Max" }, "Max"), []);
    assert.deepStrictEqual(arten(Dc.schritte({ i: true, f: true, n: "#31 Max" }, { i: true, f: true, n: "#7 Max" }, "Max")), ["name"]);
    const raus = Dc.schritte({ i: true, f: true, n: "#31 Max" }, { i: true, f: false, n: "" }, "Max");
    assert.deepStrictEqual(raus.map((s) => [s.art, s.weg, s.wert]), [["fahrer", true, undefined], ["name", undefined, "Max"]]);
    assert.deepStrictEqual(Dc.schritte({ i: true, f: false, n: "" }, { i: false, f: false, n: "" }, "Max"), []);
  },
  "Discord: Abgleich ruft die richtigen Adressen und speichert nur Erfolge": async () => {
    const Dc = require("../api/_lib/liga-discord");
    const alt = { fetch: global.fetch, env: { ...process.env } };
    Object.assign(process.env, { DISCORD_BOT_TOKEN: "t", DISCORD_GUILD_ID: "100", LIGA_ROLLE_INTERESSENT: "1", LIGA_ROLLE_FAHRER: "2", SUPABASE_URL: "https://speicher.example", SUPABASE_SECRET_KEY: "k" });
    const aufrufe = [];
    const gespeichert = [];
    let lehneNameAb = true;
    global.fetch = async (url, init) => {
      if (String(url).startsWith("https://speicher.example")) { gespeichert.push(JSON.parse(JSON.parse(init.body)[0].inhalt)); return { ok: true, text: async () => "" }; }
      aufrufe.push(`${init.method} ${url}${init.body ? ` ${init.body}` : ""}`);
      return { ok: !(lehneNameAb && init.method === "PATCH"), status: 403 };
    };
    const warn = console.warn;
    console.warn = () => {};
    try {
      const profil = { iracingName: "Max Mustermann", custId: "1", nummer: 31 };
      const alle = [{ typ: "serie", discordId: "9", serieId: "l" }];
      const serien = [{ id: "l", typ: "liga", status: "laeuft" }];
      const erst = await Dc.abgleichen("9", profil, alle, serien);
      assert.deepStrictEqual(aufrufe, [
        "PUT https://discord.com/api/v10/guilds/100/members/9/roles/1",
        "PUT https://discord.com/api/v10/guilds/100/members/9/roles/2",
        'PATCH https://discord.com/api/v10/guilds/100/members/9 {"nick":"#31 Max Mustermann"}',
      ]);
      assert.deepStrictEqual(erst.discord, { i: true, f: true });
      assert.deepStrictEqual(gespeichert[0].discord, { i: true, f: true });
      aufrufe.length = 0;
      lehneNameAb = false;
      const zweit = await Dc.abgleichen("9", erst, alle, serien);
      assert.deepStrictEqual(aufrufe.map((a) => a.split(" ")[0]), ["PATCH"]);
      assert.strictEqual(zweit.discord.n, "#31 Max Mustermann");
      aufrufe.length = 0;
      await Dc.abgleichen("9", zweit, alle, serien);
      assert.deepStrictEqual(aufrufe, []);
    } finally {
      console.warn = warn;
      global.fetch = alt.fetch;
      for (const k of ["DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID", "LIGA_ROLLE_INTERESSENT", "LIGA_ROLLE_FAHRER", "SUPABASE_URL", "SUPABASE_SECRET_KEY"]) { if (alt.env[k] === undefined) delete process.env[k]; else process.env[k] = alt.env[k]; }
    }
  },
  "Profil: Bild wird nur bei eigenem Eintrag und neuer Version nachgezogen": () => {
    assert.strictEqual(P.bildVeraltet({ o: "ich", b: "" }, "ich", "abcd1234"), true);
    assert.strictEqual(P.bildVeraltet({ o: "ich", b: "alt" }, "ich", "abcd1234"), true);
    assert.strictEqual(P.bildVeraltet({ o: "ich", b: "abcd1234" }, "ich", "abcd1234"), false);
    assert.strictEqual(P.bildVeraltet({ o: "fremd", b: "" }, "ich", "abcd1234"), false);
    assert.strictEqual(P.bildVeraltet(undefined, "ich", "abcd1234"), false);
    assert.strictEqual(P.bildVeraltet({ o: "ich", b: "" }, "ich", ""), false);
  },
  "Profil: Discord-Bild nur mit gültigen Werten": () => {
    assert.strictEqual(P.avatarUrl("123456789012", "0123456789abcdef0123456789abcdef"), "https://cdn.discordapp.com/avatars/123456789012/0123456789abcdef0123456789abcdef.webp?size=256");
    assert.strictEqual(P.avatarUrl("1/../x", "0123456789abcdef0123456789abcdef"), null);
    assert.strictEqual(P.avatarUrl("123456789012", "../boese"), null);
  },
  "Akte: Bilanz und Verlauf über alle Serien, neuestes Rennen zuerst": () => {
    const a = P.fahrerAkte(akteSerien, akteDaten(), "aaaaaaaaaaaaaaaa");
    assert.deepStrictEqual(a.bilanz, { starts: 3, siege: 1, podien: 2, poles: 1, schnellste: 1, ausfaelle: 1 });
    assert.deepStrictEqual(a.verlauf.map((r) => r.strecke), ["Nordschleife", "Imola", "Spa"]);
    assert.strictEqual(a.karten.length, 2);
    assert.strictEqual(a.verlauf[0].platz, null);
  },
  "Akte: unbekannte Kennung ergibt nichts, fremde Fahrer zählen nicht": () => {
    assert.strictEqual(P.fahrerAkte(akteSerien, akteDaten(), "cccccccccccccccc"), null);
    assert.strictEqual(P.fahrerAkte(akteSerien, akteDaten(), "bbbbbbbbbbbbbbbb").bilanz.starts, 1);
  },
  "Eigene Karten: Treffer unabhängig von Groß- und Kleinschreibung, ohne iRating": () => {
    const [k, ...rest] = A.eigeneKarten([{ id: "gt3", name: "GT3" }, { id: "leer", name: "Leer" }], kartenTabelle(), " lena beispiel ");
    assert.strictEqual(rest.length, 0);
    assert.deepStrictEqual([k.serie, k.klasseId, k.pos, k.punkte, k.karte.rating], ["gt3", "pro", 1, 50, 90]);
    assert.strictEqual(k.irating, undefined);
  },
  "Eigene Karten: kein Treffer ohne Namen, ohne Karte oder bei fremdem Namen": () => {
    const serien = [{ id: "gt3", name: "GT3" }];
    assert.deepStrictEqual(A.eigeneKarten(serien, kartenTabelle(), ""), []);
    assert.deepStrictEqual(A.eigeneKarten(serien, kartenTabelle(), "Tom Muster"), []);
    assert.deepStrictEqual(A.eigeneKarten(serien, kartenTabelle(), "Niemand"), []);
  },
  "Datum: rechnet über Monats- und Jahresgrenzen": () => {
    assert.strictEqual(D.datumPlus("2026-12-28", 7), "2027-01-04");
    assert.strictEqual(D.datumPlus("2026-03-01", -1), "2026-02-28");
    assert.throws(() => D.datumPlus("kaputt", 1), /Datum/);
  },
  "Ergebnis fehlt: nur gefahrene Rennen ohne passendes Ergebnis": () => {
    const R1 = { id: "a", titel: "A", serie: "s", datum: "2026-10-01", startzeit: "20:00", renndauer: "60 min" };
    const jetzt = Date.UTC(2026, 9, 1, 18, 30); // 20:30 deutscher Zeit, das Rennen läuft bis 21:00
    assert.deepStrictEqual(D.rennenOhneErgebnis([R1], new Map(), jetzt).length, 0, "läuft noch");
    const spaeter = jetzt + 3600e3 * 2;
    assert.deepStrictEqual(D.rennenOhneErgebnis([R1], new Map(), spaeter).map((r) => r.id), ["a"]);
    assert.strictEqual(D.rennenOhneErgebnis([{ ...R1, status: "abgesagt" }], new Map(), spaeter).length, 0);
    assert.strictEqual(D.rennenOhneErgebnis([R1], new Map([["s", [{ start: "2026-10-01T17:30:00Z" }]]]), spaeter).length, 0, "Ergebnis passt");
    assert.strictEqual(D.rennenOhneErgebnis([R1], new Map([["s", [{ start: "2026-10-08T18:00:00Z" }]]]), spaeter).length, 1, "anderes Rennen");
  },
  "Akte: Fälle, Strafen und Summen gehören nur zu diesem Fahrer": () => {
    const rep = (id, von, gegen, urteil) => ({ id, rennenTitel: "R", serieName: "S", erstellt: "2026-10-01", status: urteil ? "entschieden" : "offen", von, gegen, urteil });
    const ich = { name: "Ich", cust: "1", discordId: "d1" };
    const du = { name: "Du", cust: "2", discordId: "d2" };
    const reports = [rep("a", du, ich, { art: "verwarnung" }), rep("b", ich, du, null), rep("c", du, { name: "X", cust: "3", discordId: "d3" }, null)];
    const privat = [{ serieName: "S", privat: { strafen: [{ cust: "1", punkte: 5, grund: "x" }, { cust: "2", punkte: 9 }], zeitstrafen: [{ cust: "1", sekunden: 10, reportId: "a" }], disqualifikationen: [{ cust: "1" }] } }];
    const a = R.fahrerAkte(reports, privat, { cust: "1", discordId: "d1" });
    assert.deepStrictEqual(a.faelle.map((f) => [f.id, f.rolle]), [["a", "gemeldet"], ["b", "melder"]]);
    assert.deepStrictEqual(a.summen, { gemeldet: 1, selbstGemeldet: 1, verwarnungen: 1, strafpunkte: 5, zeitstrafen: 1, disqualifikationen: 1 });
    assert.strictEqual(a.strafen.length, 3);
    assert.strictEqual(R.fahrerAkte(reports, privat, { cust: "", discordId: "" }).faelle.length, 0);
  },
  "Protokoll: Eintrag kommt unversehrt aus dem Dateinamen zurück": () => {
    const Adm = require("../api/_lib/liga-admin");
    const p = Adm.protokollPfad(1794260000000, "ab12cd", { wer: "Äöü", text: "Rennen gelöscht: Spa · Runde 1" });
    const e = Adm.leseProtokoll({ pathname: p });
    assert.deepStrictEqual([e.wer, e.text, e.zeit], ["Äöü", "Rennen gelöscht: Spa · Runde 1", new Date(1794260000000).toISOString()]);
    assert.strictEqual(Adm.leseProtokoll({ pathname: "liga-protokoll/kaputt" }), null);
  },
  "Protokoll: Texte nennen Namen statt Kennungen": async () => {
    const Adm = require("../api/_lib/liga-admin");
    const kat = { serien: [{ id: "s", name: "GT3 Sprint" }], rennen: [{ id: "r", titel: "Runde 1" }], strecken: [] };
    assert.strictEqual(await Adm.protokollText({ aktion: "rennen-loeschen", id: "r" }, kat), "Rennen gelöscht: Runde 1");
    assert.strictEqual(await Adm.protokollText({ aktion: "passwort-setzen", serie: "s" }, kat), "Passwort für alle kommenden Rennen gesetzt: GT3 Sprint");
    assert.strictEqual(await Adm.protokollText({ aktion: "ergebnis-vorschau" }, kat), "");
  },
  "Discord: ohne Webhook keine Meldung, mit Webhook Ping nur der Rolle": async () => {
    const original = global.fetch;
    const aufrufe = [];
    global.fetch = async (url, o) => { aufrufe.push([url, JSON.parse(o.body)]); return { ok: true }; };
    delete process.env.LIGA_DISCORD_WEBHOOK_TEAM;
    assert.strictEqual(await R.teamMelden(R.einspruchKarte({ text: "x" })), false);
    assert.strictEqual(aufrufe.length, 0);
    process.env.LIGA_DISCORD_WEBHOOK_TEAM = "https://discord.example/hook";
    process.env.LIGA_ADMIN_ROLE_IDS = "123,456";
    assert.strictEqual(await R.teamMelden(R.reportKarte({ von: "@everyone", gegen: "B" })), true);
    delete process.env.LIGA_DISCORD_WEBHOOK_TEAM;
    delete process.env.LIGA_ADMIN_ROLE_IDS;
    global.fetch = original;
    const [url, body] = aufrufe[0];
    assert.strictEqual(url, "https://discord.example/hook");
    assert.strictEqual(body.content, "<@&123>");
    assert.strictEqual(body.embeds.length, 1);
    assert.deepStrictEqual(body.allowed_mentions, { roles: ["123"] });
  },
  "Discord-Karte: Report mit allen Feldern, Beispiel klar gekennzeichnet": () => {
    const d = { serie: "GT3", rennen: "R3", stelle: "Runde 5", von: "A", gegen: "B", beschreibung: "Text", clip: "https://x.test/1" };
    const k = R.reportKarte(d);
    assert.strictEqual(k.title, "Neuer Report");
    assert.strictEqual(k.footer, undefined);
    assert.deepStrictEqual(k.fields.map((f) => [f.name, f.value]), [["Serie", "GT3"], ["Rennen", "R3"], ["Stelle", "Runde 5"], ["Melder", "A"], ["Gemeldet", "B"], ["Clip", "https://x.test/1"]]);
    const b = R.reportKarte(d, true);
    assert.ok(b.title.startsWith("Beispiel"));
    assert.ok(b.footer.text.includes("kein echter Report"));
  },
  "Discord-Karte: hält die Grenzen von Discord ein": () => {
    const k = R.reportKarte({ von: "x".repeat(2000), beschreibung: "y".repeat(5000) });
    assert.ok(k.description.length <= 500 && k.description.endsWith("…"));
    assert.ok(k.fields.every((f) => f.value.length >= 1 && f.value.length <= 1024));
    assert.strictEqual(k.fields.find((f) => f.name === "Serie").value, "–");
    assert.ok(!k.fields.some((f) => f.name === "Clip"));
    assert.strictEqual(R.einspruchKarte({ text: "Bitte prüfen", gegen: "B" }).title, "Neuer Einspruch");
  },
  "Ohne Klassen: Formular legt genau eine offene Klasse an und ignoriert Klassen-Eingaben": () => {
    const eingabe = { name: "Offen", typ: "event", ohneKlassen: true, klassen: [{ name: "kaputt", min: "x", max: "y" }], punkte: "30, 26", rennenGesamt: 1, gewerteteRennen: 1, anmeldeschlussMinuten: 60, punkteDanach: 0, bonusPole: 0, bonusSchnellsteRunde: 0, mindestRundenProzent: 75 };
    const s = D.pruefeSerie(eingabe);
    assert.deepStrictEqual(s.klassen, [{ id: "offen", name: "Offen", min: 0, max: null }]);
    assert.strictEqual(s.ohneKlassen, true);
    assert.strictEqual(D.pruefeSerie({ ...eingabe, ohneKlassen: false, klassen: [{ name: "Alle", min: 0, max: "" }] }).ohneKlassen, false);
  },
  "Ohne Klassen: Fahrerbereich nennt keine iRating-Klasse": () => {
    const { klasseFuer } = require("../assets/liga-wertung.js");
    const [s] = A.baueSerien([{ id: "e", name: "E", kategorie: "Formula", ohneKlassen: true, klassen: [{ id: "offen", name: "Offen", min: 0, max: null }] }], [], { discordId: "2", profil: { irating: 2000 }, klasseFuer });
    assert.deepStrictEqual([s.klasse, s.einstufungDurchRennleitung], ["", false]);
  },
  "Gast: nicht in der Season gemeldet ist Gast, Season-Fahrer nicht": () => {
    const f = (c) => ({ cust: c, name: `F${c}`, gesamt: 1 });
    const { ergebnis } = D.abgleichen({ fahrer: [f("1"), f("2"), f("3")] }, new Map([["1", "A"], ["2", "B"]]), ["3"], new Set(["1"]));
    assert.deepStrictEqual(ergebnis.fahrer.map((x) => !!x.gast), [false, true, true]);
  },
  "Gast: bei Events gibt es keine Gäste": () => {
    const { ergebnis } = D.abgleichen({ fahrer: [{ cust: "1", name: "A", gesamt: 1 }] }, new Map([["1", "A"]]), [], null);
    assert.strictEqual(ergebnis.fahrer[0].gast, undefined);
    const serien = { gt3: { name: "E", typ: "event" } };
    assert.strictEqual(A.baueRennen([SERIENRENNEN], [eintrag("s1r", "5", 100)], { ...OPT, serien })[0].starter[0].gast, false);
  },
  "Gast: Einzelmeldung ist in der Starterliste Gast, ein Season-Rückkehrer nicht": () => {
    const serien = { gt3: { name: "S", typ: "liga" } };
    const liste = [mitglied("gt3", "1", 100), A.leseEintrag({ pathname: A.abmeldungPfad("s1r", "1"), uploadedAt: iso(200) }), eintrag("s1r", "1", 300, "M1"), eintrag("s1r", "5", 250)];
    const r = A.baueRennen([SERIENRENNEN], liste, { ...OPT, serien })[0];
    assert.deepStrictEqual(r.starter.map((f) => [f.name, f.gast]), [["F5", true], ["M1", false]]);
  },
  "Rückkehrer: reiht sich hinter alle bereits Gemeldeten ein": () => {
    const serien = { gt3: { name: "S", typ: "liga" } };
    const voll = { ...SERIENRENNEN, plaetze: 1 };
    const zurueck = A.baueRennen([voll], [mitglied("gt3", "2", 100), mitglied("gt3", "1", 200), A.leseEintrag({ pathname: A.abmeldungPfad("s1r", "2"), uploadedAt: iso(300) }), eintrag("s1r", "2", 400, "M2")], { ...OPT, discordId: "2", serien })[0];
    assert.deepStrictEqual(zurueck.starter.map((f) => f.name), ["M1"]);
    assert.deepStrictEqual(zurueck.warteliste.map((f) => f.name), ["M2"]);
    assert.strictEqual(zurueck.ich.status, "warteliste");
  },
  "Status: vor dem ersten Start bleibt die Serie in der Anmeldung": () => {
    assert.strictEqual(D.wirksamerStatus({ id: "gt3", status: "anmeldung" }, [SERIENRENNEN], START - 1), "anmeldung");
    assert.strictEqual(D.wirksamerStatus({ id: "gt3", status: "anmeldung" }, [], START), "anmeldung");
  },
  "Status: mit dem ersten Start läuft die Serie": () => {
    assert.strictEqual(D.wirksamerStatus({ id: "gt3", status: "anmeldung" }, [SERIENRENNEN], START), "laeuft");
  },
  "Status: abgesagte Rennen und Rennen anderer Serien zählen nicht": () => {
    assert.strictEqual(D.wirksamerStatus({ id: "gt3", status: "anmeldung" }, [{ ...SERIENRENNEN, status: "abgesagt" }], START + 1), "anmeldung");
    assert.strictEqual(D.wirksamerStatus({ id: "andere", status: "anmeldung" }, [SERIENRENNEN], START + 1), "anmeldung");
  },
  "Status: Beendet wird nie automatisch verändert": () => {
    assert.strictEqual(D.wirksamerStatus({ id: "gt3", status: "beendet" }, [SERIENRENNEN], START + 1), "beendet");
    assert.strictEqual(D.wirksamerStatus({ id: "gt3", status: "laeuft" }, [], 0), "laeuft");
  },
  "Strecke: gültige Angaben werden vereinheitlicht": () => {
    assert.deepStrictEqual(D.pruefeStrecke({ name: " Spa ", variante: "GP", land: "BE", laengeKm: "7,004", kurven: "20", notiz: "" }), { name: "Spa", variante: "GP", land: "BE", laengeKm: 7.004, kurven: 20, notiz: "" });
    assert.deepStrictEqual(D.pruefeStrecke({ name: "Monza" }), { name: "Monza", variante: "", land: "", laengeKm: null, kurven: null, notiz: "" });
  },
  "Strecke: ungültige Angaben werden abgelehnt": () => {
    assert.throws(() => D.pruefeStrecke({ name: "x" }), /Namen/);
    assert.throws(() => D.pruefeStrecke({ name: "Spa", land: "XX" }), /Land/);
    assert.throws(() => D.pruefeStrecke({ name: "Spa", laengeKm: "viel" }), /Kilometern/);
    assert.throws(() => D.pruefeStrecke({ name: "Spa", laengeKm: "0" }), /Kilometern/);
    assert.throws(() => D.pruefeStrecke({ name: "Spa", kurven: "0" }), /Kurven/);
  },
  "Rennen: Streckenkarte und gültige Strecken-Kennung werden übernommen": () => {
    const basis = { titel: "Runde 1", serie: "gt3", datum: "2026-12-10", startzeit: "20:00", plaetze: 30 };
    assert.strictEqual(D.pruefeRennen({ ...basis, streckeId: "spa-gp" }, ["gt3"]).streckeId, "spa-gp");
    assert.strictEqual(D.pruefeRennen({ ...basis, streckeId: "../boese" }, ["gt3"]).streckeId, "");
    const r = A.baueRennen([{ ...SERIENRENNEN, streckenBild: { k: "strecke-spa", v: 5 } }], [], OPT)[0];
    assert.deepStrictEqual(r.streckenBild, { k: "strecke-spa", v: 5 });
    assert.strictEqual(A.baueRennen([SERIENRENNEN], [], OPT)[0].streckenBild, null);
  },
  "Anmeldung: in einer beendeten Serie ist kein Rennen mehr offen": () => {
    const r = A.baueRennen([SERIENRENNEN], [], { ...OPT, serien: { gt3: { name: "GT3", status: "beendet" } } })[0];
    assert.strictEqual(r.offen, false);
  },
  "Anmeldung: läuft die Serie, bleibt das Rennen offen": () => {
    for (const status of ["anmeldung", "laeuft"]) assert.strictEqual(A.baueRennen([SERIENRENNEN], [], { ...OPT, serien: { gt3: { name: "GT3", status } } })[0].offen, true);
  },
  "Anmeldung: ist nur die Anmeldung der Serie zu, bleibt die Abmeldung möglich": () => {
    const r = A.baueRennen([SERIENRENNEN], [], { ...OPT, serien: { gt3: { name: "GT3", status: "laeuft", anmeldungOffen: false } } })[0];
    assert.deepStrictEqual([r.offen, r.anmeldungZu], [true, true]);
    assert.strictEqual(A.baueRennen([SERIENRENNEN], [], { ...OPT, serien: { gt3: { name: "GT3", status: "laeuft" } } })[0].anmeldungZu, false);
  },
  "Teilen: Vorschau enthält Rating, Platz, Werte und Abzeichen": () => {
    const html = teilen.baueSeite(TEILEN_SERIE, TEILEN_GRUPPE, teilenFahrer());
    assert.ok(html.includes('og:title" content="Lena Beispiel · Darkline Rating 88"'));
    assert.ok(html.includes("GT3 Sprint · Pro · P2 · 77 Punkte"));
    assert.ok(html.includes("Speed 90 · Sauberkeit 80 · Racecraft 85"));
    assert.ok(!html.includes("Konstanz"));
    assert.ok(html.includes("Hattrick"));
    assert.ok(html.includes('content="#ffd966"'));
  },
  "Teilen: ohne Rating steht nur der Name im Titel": () => {
    const html = teilen.baueSeite(TEILEN_SERIE, TEILEN_GRUPPE, teilenFahrer({ rating: null }));
    assert.ok(html.includes("<title>Lena Beispiel</title>"));
  },
  "Teilen: Bild und Weiterleitung passen zur Serie": () => {
    const eigen = teilen.baueSeite({ ...TEILEN_SERIE, bildVersion: 5 }, TEILEN_GRUPPE, teilenFahrer());
    assert.ok(eigen.includes("/api/liga?r=bild&amp;k=serie-gt3&amp;v=5"));
    assert.ok(eigen.includes('url=/liga?serie=gt3#fahrer/pro/Lena%20Beispiel"'));
    assert.ok(/img\/cars\/(porsche|ferrari|bmw|amg|ford)\.webp/.test(teilen.baueSeite(TEILEN_SERIE, TEILEN_GRUPPE, teilenFahrer())));
  },
  "Teilen: Namen werden sicher ausgegeben": () => {
    const html = teilen.baueSeite(TEILEN_SERIE, TEILEN_GRUPPE, { ...teilenFahrer(), name: '<script>"x"' });
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;script&gt;&quot;x&quot;"));
  },
  "Dateiname enthält alle Angaben, auch Umlaute": () => {
    const e = eintrag("2026-12-spa", "123", 5000, "Jörg Müller~/", "GT3");
    assert.deepStrictEqual([e.rennenId, e.discordId, e.name, e.fahrzeugklasse, e.zeit], ["2026-12-spa", "123", "Jörg Müller~/", "GT3", 5000]);
  },
  "Fremde Dateien werden ignoriert": () => {
    assert.strictEqual(A.leseEintrag({ pathname: "liga/fahrer/1.json", uploadedAt: iso(0) }), null);
  },
  "Deutsche Zeit im Sommer und Winter": () => {
    assert.strictEqual(iso(A.berlinNachUtc("2026-07-01", "20:00")), "2026-07-01T18:00:00.000Z");
    assert.strictEqual(iso(A.berlinNachUtc("2026-12-01", "20:00")), "2026-12-01T19:00:00.000Z");
  },
  "Zeitumstellung": () => {
    assert.strictEqual(iso(A.berlinNachUtc("2026-10-25", "12:00")), "2026-10-25T11:00:00.000Z");
    assert.strictEqual(iso(A.berlinNachUtc("2026-03-29", "12:00")), "2026-03-29T10:00:00.000Z");
  },
  "Ungültige Termine ergeben null": () => {
    assert.strictEqual(A.berlinNachUtc("", "20:00"), null);
    assert.strictEqual(A.berlinNachUtc("2026-12-01", ""), null);
  },
  "Wer zuerst kommt, startet, der Rest wartet": () => {
    const r = baue([eintrag("r1", "3", 300), eintrag("r1", "1", 100), eintrag("r1", "2", 200)]);
    assert.deepStrictEqual(r.starter.map((x) => x.name), ["F1", "F2"]);
    assert.deepStrictEqual(r.warteliste.map((x) => x.name), ["F3"]);
    assert.deepStrictEqual(r.ich, { status: "starter", platz: 2, fahrzeugklasse: "", quelle: "rennen" });
  },
  "Warteliste rückt beim Abmelden nach": () => {
    const r = baue([eintrag("r1", "3", 300), eintrag("r1", "2", 200)], { discordId: "3" });
    assert.strictEqual(r.ich.status, "starter");
    assert.strictEqual(r.warteliste.length, 0);
  },
  "Gleiche Uhrzeit ergibt immer dieselbe Reihenfolge": () => {
    const a = A.ordne([eintrag("r1", "9", 100), eintrag("r1", "5", 100)], 1);
    const b = A.ordne([eintrag("r1", "5", 100), eintrag("r1", "9", 100)], 1);
    assert.strictEqual(a.starter[0].discordId, b.starter[0].discordId);
  },
  "Doppelte Anmeldung zählt nur einmal": () => {
    assert.strictEqual(A.ordne([eintrag("r1", "1", 100), eintrag("r1", "1", 500)], 5).starter.length, 1);
  },
  "Anmeldeschluss eine Stunde vor dem Start": () => {
    assert.strictEqual(baue([], { jetzt: START - 3600e3 - 1 }).offen, true);
    assert.strictEqual(baue([], { jetzt: START - 3600e3 }).offen, false);
  },
  "Abgesagte Rennen sind geschlossen": () => {
    const r = A.baueRennen([{ ...RENNEN, status: "abgesagt" }], [], OPT)[0];
    assert.strictEqual(r.offen, false);
    assert.strictEqual(r.status, "abgesagt");
  },
  "Passwort nur mit Startplatz": () => {
    const e = [eintrag("r1", "1", 100), eintrag("r1", "2", 200), eintrag("r1", "3", 300)];
    const mitPasswort = (id) => A.baueRennen([{ ...RENNEN, passwort: "x" }], e, { ...OPT, discordId: id })[0].passwort;
    assert.strictEqual(mitPasswort("1"), "x");
    assert.strictEqual(mitPasswort("3"), "");
    assert.strictEqual(mitPasswort("99"), "");
  },
  "Andere Fahrer sehen keine IDs": () => {
    assert.ok(!JSON.stringify(baue([eintrag("r1", "777888999", 100, "Anna")], { discordId: "1" })).includes("777888999"));
  },
  "Vergangene Rennen verschwinden": () => {
    assert.strictEqual(A.baueRennen([RENNEN], [], { ...OPT, jetzt: START + 3 * 3600e3 + 1 }).length, 0);
  },
  "Profil wird geprüft": () => {
    assert.deepStrictEqual(A.pruefeProfil({ iracingName: " Max Muster ", custId: "123456", irating: "1850" }), { iracingName: "Max Muster", custId: "123456", irating: 1850 });
    assert.throws(() => A.pruefeProfil({ iracingName: "M", custId: "1", irating: "1" }), /Namen/);
    assert.throws(() => A.pruefeProfil({ iracingName: "Max", custId: "12a", irating: "1" }), /iRacing-ID/);
    assert.throws(() => A.pruefeProfil({ iracingName: "Max", custId: "12", irating: "viel" }), /iRating/);
  },
  "Renndauer wird erkannt": () => {
    assert.deepStrictEqual(["60 min", "6h", "2:40h", "1h30", ""].map(A.dauerMinuten), [60, 360, 160, 90, 120]);
  },
  "Serienfahrer stehen automatisch auf der Liste und gehen vor": () => {
    const r = A.baueRennen([SERIENRENNEN], [eintrag("s1r", "1", 100), mitglied("gt3", "2", 500)], { ...OPT, discordId: "2" })[0];
    assert.deepStrictEqual(r.starter.map((x) => x.name), ["M2", "F1"]);
    assert.strictEqual(r.ich.quelle, "serie");
  },
  "Serienfahrer kann ein einzelnes Rennen auslassen": () => {
    const e = A.leseEintrag({ pathname: A.abmeldungPfad("s1r", "2"), uploadedAt: iso(600) });
    const r = A.baueRennen([SERIENRENNEN], [mitglied("gt3", "2", 500), e], { ...OPT, discordId: "2" })[0];
    assert.strictEqual(r.ich, null);
    assert.strictEqual(r.starter.length, 0);
  },
  "Beitritt nach dem Anmeldeschluss zählt erst fürs nächste Rennen": () => {
    const schluss = START - 3600e3;
    const r = A.baueRennen([SERIENRENNEN], [mitglied("gt3", "2", schluss + 1)], { ...OPT, jetzt: schluss - 1 })[0];
    assert.strictEqual(r.starter.length, 0);
  },
  "Überschneidung wird erkannt": () => {
    const a = { ...RENNEN, id: "a", renndauer: "60 min" };
    const b = { ...RENNEN, id: "b", titel: "Parallel", startzeit: "20:30", renndauer: "60 min" };
    const c = { ...RENNEN, id: "c", titel: "Danach", startzeit: "21:00", renndauer: "60 min" };
    const e = [eintrag("a", "2", 100), eintrag("b", "2", 200), eintrag("c", "2", 300)];
    const r = A.baueRennen([a, b, c], e, OPT);
    assert.deepStrictEqual(r[0].konflikt, ["Parallel"]);
    assert.deepStrictEqual(r[2].konflikt, ["Parallel"]);
    assert.deepStrictEqual(A.kollisionen([a, b, c], "b", [eintrag("a", "2", 100)], OPT), ["Test"]);
    assert.deepStrictEqual(A.kollisionen([a, b, c], "c", [eintrag("a", "2", 100)], OPT), []);
  },
  "Serienstatus zeigt Mitgliedschaft und Klasse": () => {
    const { klasseFuer } = require("../assets/liga-wertung.js");
    const klassen = [{ id: "am", name: "Am", min: 0, max: 1499 }, { id: "pro", name: "Pro", min: 1500, max: null }];
    const [gt3, formel] = A.baueSerien([{ id: "gt3", name: "GT3", klassen }, { id: "f", name: "Formel", kategorie: "Formula", klassen }], [mitglied("gt3", "2", 100)], { discordId: "2", profil: { irating: 2000 }, klasseFuer });
    assert.deepStrictEqual([gt3.ich, gt3.klasse, gt3.fahrer], [true, "Pro", 1]);
    assert.deepStrictEqual([formel.ich, formel.klasse, formel.einstufungDurchRennleitung], [false, "", true]);
  },
  "Liga-Cookie öffnet nicht den Teambereich": () => {
    const r = res();
    S.createLigaSession(r, { id: "1", name: "A" });
    const v = wert(r);
    assert.strictEqual(S.getLigaSession(anfrage("dpm_liga", v)).id, "1");
    assert.strictEqual(S.getSession(anfrage("dpm_liga", v)), null);
    assert.strictEqual(S.getSession(anfrage("dpm_team", v)), null); // auch umbenannt nicht
  },
  "Team-Cookie gilt nicht als Liga-Anmeldung": () => {
    const r = res();
    S.createSession(r, { id: "1", name: "A" });
    const v = wert(r);
    assert.strictEqual(S.getSession(anfrage("dpm_team", v)).id, "1");
    assert.strictEqual(S.getLigaSession(anfrage("dpm_liga", v)), null);
  },
  "Admin-Cookie gilt nur im Liga-Admin": () => {
    const r = res();
    S.createLigaAdminSession(r, { id: "1", name: "A" });
    const v = wert(r);
    assert.strictEqual(S.getLigaAdminSession(anfrage("dpm_liga_admin", v)).id, "1");
    assert.strictEqual(S.getSession(anfrage("dpm_team", v)), null);
    assert.strictEqual(S.getLigaSession(anfrage("dpm_liga", v)), null);
  },
  "Fahrer- und Team-Cookie öffnen den Liga-Admin nicht": () => {
    const a = res();
    S.createLigaSession(a, { id: "1", name: "A" });
    const b = res();
    S.createSession(b, { id: "1", name: "A" });
    assert.strictEqual(S.getLigaAdminSession(anfrage("dpm_liga_admin", wert(a))), null);
    assert.strictEqual(S.getLigaAdminSession(anfrage("dpm_liga_admin", wert(b))), null);
  },
  "Serie wird geprüft und vereinheitlicht": () => {
    const eingabe = { name: "GT3 Sprint", rennenGesamt: "8", gewerteteRennen: "7", anmeldeschlussMinuten: "60", punkte: "30, 26 23", punkteDanach: "1", bonusPole: "1", bonusSchnellsteRunde: "1", mindestRundenProzent: "75", fahrzeugklassen: "GTP, GT3", klassen: [{ name: "Am", min: "0", max: "1499" }, { name: "Pro", min: "1500", max: "" }] };
    const s = D.pruefeSerie(eingabe);
    assert.deepStrictEqual(s.punkte, [30, 26, 23]);
    assert.deepStrictEqual(s.fahrzeugklassen, ["GTP", "GT3"]);
    assert.deepStrictEqual(s.klassen.map((k) => [k.id, k.max]), [["pro", null], ["am", 1499]]);
    assert.throws(() => D.pruefeSerie({ ...eingabe, klassen: [{ name: "Am", min: 0, max: 1000 }, { name: "Pro", min: 1500, max: "" }] }), /Lücke/);
    assert.throws(() => D.pruefeSerie({ ...eingabe, name: "" }), /Namen/);
  },
  "Rennen wird geprüft, das Passwort bleibt intern": () => {
    const e = { titel: "Runde 1", serie: "gt3", datum: "2026-12-10", startzeit: "20:00", plaetze: "30", passwort: "geheim", briefing: "B", server: "S" };
    const r = D.pruefeRennen(e, ["gt3"]);
    assert.strictEqual(r.plaetze, 30);
    assert.throws(() => D.pruefeRennen({ ...e, serie: "x" }, ["gt3"]), /Serie/);
    assert.throws(() => D.pruefeRennen({ ...e, startzeit: "abends" }, ["gt3"]), /Startzeit/);
    const o = D.oeffentlichesRennen(r);
    assert.deepStrictEqual([o.passwort, o.briefing, o.server, o.titel], [undefined, undefined, undefined, "Runde 1"]);
  },
  "Kennungen können keine Pfade verlassen": () => {
    assert.strictEqual(D.istId("../geheim"), false);
    assert.strictEqual(D.istId("gt3-sprint"), true);
    assert.throws(() => D.brauchtId("a/b"), /Ungültige/);
  },
  "Fahrer sehen keine IDs, die Rennleitung schon": () => {
    assert.strictEqual(baue([eintrag("r1", "5", 100, "Anna")], { discordId: "1" }).starter[0].discordId, undefined);
    assert.strictEqual(baue([eintrag("r1", "5", 100, "Anna")], { discordId: "", mitIds: true }).starter[0].discordId, "5");
  },
  "Import: nur gemeldete Fahrer werden übernommen": () => {
    const e = { id: "1", fahrer: [{ cust: "1", name: "A", gesamt: 1 }, { cust: "2", name: "B", gesamt: 2 }, { cust: "3", name: "C", gesamt: 3 }] };
    const r = D.abgleichen(e, new Map([["1", "A"], ["3", "C"], ["9", "Fehlt"]]));
    assert.deepStrictEqual(r.ergebnis.fahrer.map((f) => f.name), ["A", "C"]);
    assert.deepStrictEqual(r.fremde.map((f) => f.name), ["B"]);
    assert.deepStrictEqual(r.fehlend, ["Fehlt"]);
    assert.strictEqual(e.fahrer.length, 3);
  },
  "Import: Gäste werden nur auf Wunsch gewertet": () => {
    const e = { id: "1", fahrer: [{ cust: "1", name: "A", gesamt: 1 }, { cust: "2", name: "B", gesamt: 2 }] };
    const r = D.abgleichen(e, new Map([["1", "A"]]), ["2"]);
    assert.strictEqual(r.ergebnis.fahrer.length, 2);
    assert.strictEqual(r.fremde[0].gast, true);
  },
  "Import: ohne Anmeldungen bleibt niemand übrig": () => {
    assert.strictEqual(D.abgleichen({ id: "1", fahrer: [{ cust: "1", name: "A", gesamt: 1 }] }, new Map()).ergebnis.fahrer.length, 0);
  },
  "Bild: echte JPEG- und WebP-Dateien werden angenommen": () => {
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(20)]);
    assert.strictEqual(D.bildTyp(D.pruefeBild(`data:image/jpeg;base64,${jpg.toString("base64")}`)), "image/jpeg");
    assert.strictEqual(D.bildTyp(D.pruefeBild(`data:image/webp;base64,${webp.toString("base64")}`)), "image/webp");
  },
  "Bild: falscher Inhalt wird abgelehnt, auch wenn das Format behauptet wird": () => {
    const html = Buffer.from("<script>alert(1)</script><svg></svg>");
    assert.throws(() => D.pruefeBild(`data:image/jpeg;base64,${html.toString("base64")}`), /kein gültiges Bild/);
    assert.throws(() => D.pruefeBild(`data:image/svg+xml;base64,${html.toString("base64")}`), /JPG, PNG oder WebP/);
    assert.throws(() => D.pruefeBild(""), /JPG, PNG oder WebP/);
  },
  "Bild: zu große Dateien werden abgelehnt": () => {
    const gross = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(3 * 1024 * 1024)]);
    assert.throws(() => D.pruefeBild(`data:image/jpeg;base64,${gross.toString("base64")}`), /zu groß/);
  },
  "Report wird geprüft": () => {
    assert.deepStrictEqual(R.pruefeMeldung({ stelle: "Runde 5, T3", beschreibung: "Er hat mich gedreht.", clip: "" }), { stelle: "Runde 5, T3", beschreibung: "Er hat mich gedreht.", clip: "" });
    assert.throws(() => R.pruefeMeldung({ stelle: "", beschreibung: "Er hat mich gedreht." }), /wann und wo/);
    assert.throws(() => R.pruefeMeldung({ stelle: "R5", beschreibung: "kurz" }), /Satz/);
    assert.throws(() => R.pruefeMeldung({ stelle: "R5", beschreibung: "Er hat mich gedreht.", clip: "javascript:alert(1)" }), /https/);
  },
  "Urteil wird geprüft": () => {
    assert.strictEqual(R.pruefeUrteil({ art: "zeitstrafe", sekunden: "5", begruendung: "Kollision" }).sekunden, 5);
    assert.throws(() => R.pruefeUrteil({ art: "zeitstrafe", sekunden: "x", begruendung: "Kollision" }), /Sekunden/);
    assert.throws(() => R.pruefeUrteil({ art: "gibtsnicht", begruendung: "Kollision" }), /Entscheidung/);
    assert.throws(() => R.pruefeUrteil({ art: "verwarnung", begruendung: "" }), /begründe/);
  },
  "Neues Urteil ersetzt die Wirkung des alten": () => {
    const ziel = { rennen: "9", cust: "7", name: "A" };
    const p = { strafen: [{ id: "m", punkte: 2 }], zeitstrafen: [], disqualifikationen: [] };
    R.urteilAnwenden(p, "r1", { art: "strafpunkte", punkte: 4, begruendung: "x" }, ziel);
    assert.strictEqual(p.strafen.length, 2);
    R.urteilAnwenden(p, "r1", { art: "zeitstrafe", sekunden: 5, begruendung: "x" }, ziel);
    assert.deepStrictEqual([p.strafen.length, p.zeitstrafen.length], [1, 1]);
    R.urteilAnwenden(p, "r1", { art: "kein-vergehen", begruendung: "x" }, null);
    assert.deepStrictEqual([p.strafen.map((s) => s.id), p.zeitstrafen.length], [["m"], 0]);
  },
  "Fahrer sehen keine internen Notizen und keine IDs": () => {
    const s = JSON.stringify(R.sichtFahrer(REPORT, [], "1", 5000, {}));
    assert.ok(!s.includes("intern geheim"));
    assert.ok(!s.includes("discordId"));
    assert.strictEqual(R.sichtFahrer(REPORT, [], "1", 5000, {}).rolle, "melder");
    assert.strictEqual(R.sichtFahrer(REPORT, [], "2", 5000, {}).rolle, "gemeldet");
    assert.strictEqual(R.sichtFahrer(REPORT, [], "3", 5000, {}).beteiligt, false);
  },
  "Einspruch nur für Beteiligte, einmal und innerhalb der Frist": () => mitEinspruch(() => {
    const in48h = 1000 + 48 * 3600e3;
    assert.strictEqual(R.sichtFahrer(ENTSCHIEDEN, [], "2", in48h, {}).kannEinspruch, true);
    assert.strictEqual(R.sichtFahrer(ENTSCHIEDEN, [], "2", in48h + 1, {}).kannEinspruch, false);
    assert.strictEqual(R.sichtFahrer(ENTSCHIEDEN, [], "3", 2000, {}).kannEinspruch, false);
    assert.strictEqual(R.sichtFahrer(ENTSCHIEDEN, [{ discordId: "2", text: "x" }], "2", 2000, {}).kannEinspruch, false);
    assert.strictEqual(R.sichtFahrer({ ...ENTSCHIEDEN, endgueltig: true }, [], "2", 2000, {}).kannEinspruch, false);
    assert.strictEqual(R.sichtFahrer(ENTSCHIEDEN, [], "2", 2 * 3600e3 + 1, { einspruchStunden: 1 }).kannEinspruch, false);
  }),
  "Beteiligte erkennt das System": () => {
    assert.ok(R.beteiligt(REPORT, "1") && R.beteiligt(REPORT, "2") && !R.beteiligt(REPORT, "3"));
  },
  "Melden nur als Starter und innerhalb der Frist": () => {
    const start = 100 * 3600e3;
    const ende = start + 3600e3;
    const r = (o) => ({ id: "x", titel: "T", status: "geplant", serie: "s", start: iso(start), ende: iso(ende), ich: { status: "starter", discordId: "1" }, starter: [{ name: "Ich", discordId: "1" }, { name: "Du", discordId: "2" }], ...o });
    assert.strictEqual(R.meldbareRennen([r()], ende + 30 * 6e4 - 1, {}).length, 0);
    assert.deepStrictEqual(R.meldbareRennen([r()], ende + 30 * 6e4, {})[0].fahrer, ["Du"]);
    assert.strictEqual(R.cooldownBis([r()], ende), iso(ende + 30 * 6e4));
    assert.strictEqual(R.cooldownBis([r()], start - 1), null);
    assert.strictEqual(R.cooldownBis([r()], ende + 30 * 6e4), null);
    assert.strictEqual(R.meldbareRennen([r()], ende + 24 * 3600e3, {}).length, 1);
    assert.strictEqual(R.meldbareRennen([r()], ende + 24 * 3600e3 + 1, {}).length, 0);
    assert.strictEqual(R.meldbareRennen([r()], start - 1, {}).length, 0);
    assert.strictEqual(R.meldbareRennen([r({ ich: { status: "warteliste", discordId: "1" } })], ende + 36e5, {}).length, 0);
    assert.strictEqual(R.meldbareRennen([r({ status: "abgesagt" })], ende + 36e5, {}).length, 0);
  },
  "Manipuliertes Cookie wird abgelehnt": () => {
    const r = res();
    S.createLigaSession(r, { id: "1", name: "A" });
    const [p, s] = wert(r).split(".");
    const falsch = Buffer.from(JSON.stringify({ id: "2", exp: 9e9 })).toString("base64url");
    assert.strictEqual(S.getLigaSession(anfrage("dpm_liga", `${falsch}.${s}`)), null);
    assert.ok(p);
  },
};

(async () => {
  let fehler = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try { await fn(); console.log(`ok    ${name}`); } catch (e) { fehler++; console.log(`FEHLER ${name}\n      ${e.message}`); }
  }
  console.log(`\n${Object.keys(tests).length - fehler} von ${Object.keys(tests).length} Tests bestanden`);
  process.exit(fehler ? 1 : 0);
})();
