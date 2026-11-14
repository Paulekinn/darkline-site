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
    const auswahl = (liste) => { const sp = (u.searchParams.get("select") || "pfad").split(","); return liste.map((z) => Object.fromEntries(sp.map((s) => [s, z[s]]))); };
    if (m === "POST" && String(o.headers.prefer).includes("ignore-duplicates")) {
      const neu = JSON.parse(o.body).filter((z) => !zeilen.has(z.pfad));
      neu.forEach((z) => zeilen.set(z.pfad, z));
      return { ok: true, status: 201, json: async () => auswahl(neu) };
    }
    if (m === "POST") { for (const z of JSON.parse(o.body)) zeilen.set(z.pfad, z); return { ok: true }; }
    if (m === "PATCH") {
      const z = zeilen.get(pfad.slice(3));
      const passt = z && "eq." + z.geaendert === u.searchParams.get("geaendert");
      if (passt) zeilen.set(z.pfad, { ...z, ...JSON.parse(o.body) });
      return { ok: true, status: 200, json: async () => auswahl(passt ? [zeilen.get(z.pfad)] : []) };
    }
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
    const report = { serieName: "DSRS", rennenTitel: "Runde 3", gegen: { name: "Tom Muster" } };
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
      const karte = aufrufe[0][1].embeds[0];
      assert.strictEqual(karte.title, "Urteil · DSRS · Runde 3");
      assert.deepStrictEqual(karte.fields.map((f) => f.value), ["Tom Muster", "6 Strafpunkte"]);
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
    assert.ok(!JSON.stringify(k).includes("Warteliste") && !k.fields.some((f) => f.name === "Ablauf"));
    const voll = T.erinnerungKarte({ titel: "Runde 1", serieName: "GT3", strecke: "Spa", start: iso(heute), schluss: iso(heute - 36e5), plaetze: 2, starter: [{}, {}], warteliste: [{}], training: "70 Min", renndauer: "65 Min" });
    assert.match(voll.description, /bis \*\*\d\d:\d\d Uhr\*\*.*fahrerbereich/);
    assert.strictEqual(voll.fields.find((f) => f.name === "Gemeldet").value, "2 von 2, 1 auf der Warteliste");
    assert.strictEqual(voll.fields.find((f) => f.name === "Ablauf").value, "Training 70 Min · Rennen 65 Min");
    const alt = process.env.LIGA_DISCORD_WEBHOOK;
    delete process.env.LIGA_DISCORD_WEBHOOK;
    assert.strictEqual(await T.erinnern(heute), false);
    if (alt !== undefined) process.env.LIGA_DISCORD_WEBHOOK = alt;
  },
  "Rennbericht: Rundenzeit und Karte aus dem Bericht": () => {
    assert.strictEqual(T.rundenzeit(1234560), "2:03.456");
    assert.strictEqual(T.rundenzeit(null), "");
    const karte = T.berichtKarte({ serie: "gt3", serieName: "GT3 Sprint", titel: "Runde 2", strecke: "Spa", klassen: [{ fahrzeugklasse: "GT3", podium: ["A", "B", "C"], schnellste: { name: "A", zeit: "2:03.456" }, aufholer: { name: "C", plaetze: 5 } }] }, true);
    assert.strictEqual(karte.description, "🥇 A\n🥈 B\n🥉 C\n⏱️ Schnellste Runde: A, 2:03.456\n📈 Fahrer des Tages: C, 5 Plätze gutgemacht");
    assert.strictEqual(karte.image.url, "attachment://rennbericht.jpg");
    assert.ok(karte.fields.every((f) => f.value.length >= 1));
  },
  "Rennbericht: jede Klasse mit eigener schnellster Runde, Namen als Erwähnung": () => {
    const karte = T.berichtKarte({
      serie: "s", serieName: "Multi", titel: "Runde 1", strecke: "Spa", erwaehnungen: { A: "123456789012345678", D: "kaputt" },
      klassen: [
        { fahrzeugklasse: "GT3", podium: ["A", "B", "C"], schnellste: { name: "B", zeit: "2:03.456" }, aufholer: null },
        { fahrzeugklasse: "GT4", podium: ["D", "E"], schnellste: { name: "E", zeit: "2:20.000" }, aufholer: { name: "D", plaetze: 3 } },
      ],
    }, false);
    const [gt3, gt4] = karte.description.split("\n\n");
    assert.strictEqual(gt3, "**GT3**\n🥇 <@123456789012345678>\n🥈 B\n🥉 C\n⏱️ Schnellste Runde: B, 2:03.456");
    assert.strictEqual(gt4, "**GT4**\n🥇 D\n🥈 E\n⏱️ Schnellste Runde: E, 2:20.000\n📈 Fahrer des Tages: D, 3 Plätze gutgemacht");
    assert.deepStrictEqual(karte.fields.map((f) => f.name), ["Serie", "Strecke"]);
    assert.ok(!karte.image);
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
  "Private Season: Anfrage statt Anmeldung, keine Gäste, Voraussetzungen nur mit Haken": () => {
    const basis = { name: "GT3", rennenGesamt: 8, gewerteteRennen: 8, punkte: "25 18", punkteDanach: 0, bonusPole: 0, bonusSchnellsteRunde: 0, mindestRundenProzent: 75, anmeldeschlussMinuten: 60, klassen: [{ name: "Alle", min: 0, max: "" }] };
    assert.deepStrictEqual([D.pruefeSerie(basis).aufAnfrage, D.pruefeSerie(basis).voraussetzungen], [false, ""]);
    assert.deepStrictEqual([D.pruefeSerie({ ...basis, aufAnfrage: true, voraussetzungen: " iRating ab 1500 " }).aufAnfrage, D.pruefeSerie({ ...basis, aufAnfrage: true, voraussetzungen: " iRating ab 1500 " }).voraussetzungen], [true, "iRating ab 1500"]);
    assert.strictEqual(D.pruefeSerie({ ...basis, voraussetzungen: "x" }).voraussetzungen, "", "Ohne Haken keine Voraussetzungen");
    assert.strictEqual(D.pruefeSerie({ ...basis, typ: "event", aufAnfrage: true }).aufAnfrage, false, "Events sind nie privat");
    const serien = { gt3: { status: "anmeldung", name: "GT3", aufAnfrage: true } };
    assert.strictEqual(A.baueRennen([SERIENRENNEN], [], { ...OPT, discordId: "2", serien })[0].nurFreigegeben, true, "Ohne Freigabe kein Gaststart");
    assert.strictEqual(A.baueRennen([SERIENRENNEN], [mitglied("gt3", "2", 100)], { ...OPT, discordId: "2", serien })[0].nurFreigegeben, false, "Freigegebene Fahrer sind normal dabei");
    assert.strictEqual(A.baueRennen([SERIENRENNEN], [], { ...OPT, discordId: "2", serien: { gt3: { status: "anmeldung", name: "GT3" } } })[0].nurFreigegeben, false);
    const liste = [{ id: "gt3", name: "GT3", status: "anmeldung", aufAnfrage: true, voraussetzungen: "Pre-Test", klassen: [] }];
    const [mitAnfrage] = A.baueSerien(liste, [], { discordId: "2", profil: null, klasseFuer: () => null, anfragen: new Set(["gt3"]) });
    assert.deepStrictEqual([mitAnfrage.aufAnfrage, mitAnfrage.voraussetzungen, mitAnfrage.anfrage], [true, "Pre-Test", true]);
    const [dabei] = A.baueSerien(liste, [mitglied("gt3", "2", 100)], { discordId: "2", profil: null, klasseFuer: () => null, anfragen: new Set(["gt3"]) });
    assert.strictEqual(dabei.anfrage, false, "Wer schon dabei ist, hat keine offene Anfrage mehr");
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
  "Speicher: Bedingtes Schreiben greift nur beim gelesenen Stand": async () => {
    const a = supabaseAttrappe();
    try {
      assert.strictEqual(await B.blobPutWenn("liga/x.json", "1", "application/json", null), true);
      assert.strictEqual(await B.blobPutWenn("liga/x.json", "2", "application/json", null), false, "Anlegen nur, wenn es die Datei noch nicht gibt");
      const { text, stand } = await B.blobGetMitStand("liga/x.json");
      assert.strictEqual(text, "1");
      assert.strictEqual(await B.blobPutWenn("liga/x.json", "3", "application/json", stand), true);
      assert.strictEqual(await B.blobPutWenn("liga/x.json", "4", "application/json", stand), false, "Alter Stand darf nicht mehr schreiben");
      assert.strictEqual(await B.blobGet("liga/x.json"), "3");
      assert.notStrictEqual((await B.blobGetMitStand("liga/x.json")).stand, stand);
      assert.deepStrictEqual(await B.blobGetMitStand("liga/fehlt"), { text: null, stand: null });
    } finally { a.ende(); }
  },
  "Gleichzeitig: Zwei Strafen in derselben Serie gehen beide nicht verloren": async () => {
    const a = supabaseAttrappe();
    try {
      await Promise.all(["a", "b", "c"].map((id) => D.privatAendern("gt3", (p) => ({ ...p, strafen: [...p.strafen, { id }] }))));
      const p = await D.privatLesen("gt3");
      assert.deepStrictEqual(p.strafen.map((s) => s.id).sort(), ["a", "b", "c"]);
      assert.deepStrictEqual(p.einstufung, {});
      // Eine Prüfung in der Änderung läuft gegen den aktuellen Stand und bricht ab, ohne zu schreiben.
      await assert.rejects(() => D.privatAendern("gt3", () => { throw new D.Hinweis("nein"); }), /nein/);
      assert.strictEqual((await D.privatLesen("gt3")).strafen.length, 3);
    } finally { a.ende(); }
  },
  "Gleichzeitig: Zwei Stewards stimmen ab, beide Stimmen bleiben": async () => {
    const a = supabaseAttrappe();
    try {
      await B.blobPut("liga/daten/reports/r1.json", JSON.stringify({ serie: "gt3", notizen: "x" }), "application/json");
      await Promise.all([{ id: "1", name: "A" }, { id: "2", name: "B" }].map((wer) => R.aendern("r1", (r) => { R.stimmeSetzen(r, wer, { art: "verwarnung" }); })));
      const r = await R.lesen("r1");
      assert.deepStrictEqual(r.stimmen.map((s) => s.von).sort(), ["1", "2"]);
      assert.strictEqual(r.notizen, "x");
      assert.strictEqual(r.id, "r1");
      assert.strictEqual(JSON.parse(a.zeilen.get("liga/daten/reports/r1.json").inhalt).id, undefined, "Die Kennung steht nur im Pfad");
      await assert.rejects(() => R.aendern("fehlt", () => {}), /gibt es nicht/);
    } finally { a.ende(); }
  },
  "Fahrzeug: Liste der Season, Vergleich mit der iRacing-Datei und Prüfung nach dem Rennen": () => {
    const F = require("../api/_lib/liga-fahrzeuge");
    assert.deepStrictEqual(F.pruefeModelle("BMW M4 GT3\n  Porsche 911 GT3 R (992) \n\nbmw m4 gt3"), ["BMW M4 GT3", "Porsche 911 GT3 R (992)"]);
    assert.deepStrictEqual(F.pruefeModelle(""), []);
    assert.strictEqual(F.gleichesModell("BMW M4 GT3", "bmw  m4-gt3"), true);
    assert.strictEqual(F.gleichesModell("BMW M4 GT3", "BMW M4 GT3 EVO"), false, "Ähnlicher Name ist ein anderes Auto");
    const serie = { modelle: ["BMW M4 GT3", "Ferrari 296 GT3"] };
    assert.strictEqual(F.modellPruefen(serie, "Ferrari 296 GT3"), "Ferrari 296 GT3");
    assert.strictEqual(F.modellPruefen(serie, "ferrari 296 gt3"), "Ferrari 296 GT3", "Schreibweise aus der Datei wird erkannt");
    assert.throws(() => F.modellPruefen(serie, ""), /Fahrzeug/);
    assert.strictEqual(F.modellPruefen({ modelle: [] }, ""), "", "Ohne Liste keine Wahl");
    const ergebnis = { fahrer: [{ cust: "1", name: "Anna", fahrzeug: "BMW M4 GT3" }, { cust: "2", name: "Ben", fahrzeug: "Ferrari 296 GT3" }, { cust: "3", name: "Cem", fahrzeug: "" }, { cust: "4", name: "Gast", fahrzeug: "Audi R8 LMS EVO II GT3" }] };
    const discord = new Map([["1", "d1"], ["2", "d2"], ["3", "d3"]]);
    const fahrzeuge = new Map([["d1", { modell: "BMW M4 GT3" }], ["d2", { modell: "BMW M4 GT3" }], ["d3", { modell: "BMW M4 GT3" }]]);
    assert.deepStrictEqual(F.abweichungen(ergebnis, discord, fahrzeuge), [{ name: "Ben", cust: "2", discordId: "d2", gemeldet: "BMW M4 GT3", gefahren: "Ferrari 296 GT3" }], "Ohne Fahrzeug in der Datei und ohne Meldung keine Abweichung");
    const p = D.pruefungNachRennen({ fahrer: [{ cust: "1", name: "A", incidents: 0 }] }, [], [{ name: "Ben" }]);
    assert.strictEqual(p.fahrzeuge.length, 1);
    assert.strictEqual(D.pruefungNachRennen({ fahrer: [{ cust: "1", name: "A", incidents: 0 }] }, []), null);
    const basis = { name: "GT3", rennenGesamt: 8, gewerteteRennen: 8, punkte: "25 18", punkteDanach: 0, bonusPole: 0, bonusSchnellsteRunde: 0, mindestRundenProzent: 75, anmeldeschlussMinuten: 60, klassen: [{ name: "Alle", min: 0, max: "" }] };
    assert.deepStrictEqual([D.pruefeSerie(basis).modelle, D.pruefeSerie(basis).freieWechsel], [[], 0]);
    assert.deepStrictEqual([D.pruefeSerie({ ...basis, modelle: "BMW M4 GT3", freieWechsel: "1" }).modelle, D.pruefeSerie({ ...basis, freieWechsel: "1" }).freieWechsel], [["BMW M4 GT3"], 1]);
  },
  "Fahrzeug: ein freier Wechsel, danach nur per Antrag, Rennleitung entscheidet": async () => {
    const F = require("../api/_lib/liga-fahrzeuge");
    const a = supabaseAttrappe();
    try {
      const serie = { id: "gt3", modelle: ["BMW M4 GT3", "Ferrari 296 GT3", "Porsche 911 GT3 R (992)"], freieWechsel: 1 };
      await assert.rejects(() => F.wechseln(serie, "11", "Ferrari 296 GT3"), /nicht angemeldet/);
      await F.waehlen(serie, "11", "BMW M4 GT3", "Anna");
      await F.waehlen(serie, "11", "Ferrari 296 GT3", "Anna");
      assert.strictEqual((await F.lesen("gt3", "11")).modell, "BMW M4 GT3", "Die erste Wahl bleibt, eine zweite Anmeldung ändert nichts");
      assert.strictEqual((await F.wechseln(serie, "11", "BMW M4 GT3")).art, "gleich");
      const frei = await F.wechseln(serie, "11", "Ferrari 296 GT3");
      assert.deepStrictEqual([frei.art, frei.eintrag.modell, F.freiUebrig(serie, frei.eintrag)], ["frei", "Ferrari 296 GT3", 0]);
      const antrag = await F.wechseln(serie, "11", "Porsche 911 GT3 R (992)");
      assert.deepStrictEqual([antrag.art, antrag.eintrag.modell, antrag.eintrag.antrag.nach], ["antrag", "Ferrari 296 GT3", "Porsche 911 GT3 R (992)"]);
      assert.deepStrictEqual((await F.offeneAntraege()).map((x) => [x.serie, x.discordId, x.name]), [["gt3", "11", "Anna"]]);
      assert.strictEqual((await F.wechseln(serie, "11", "Ferrari 296 GT3")).art, "zurueck", "Zurück zum eigenen Auto zieht den Antrag zurück");
      assert.strictEqual((await F.lesen("gt3", "11")).antrag, null);
      await F.wechseln(serie, "11", "Porsche 911 GT3 R (992)");
      await F.entscheiden(serie, "11", false);
      assert.deepStrictEqual([(await F.lesen("gt3", "11")).modell, (await F.lesen("gt3", "11")).antrag], ["Ferrari 296 GT3", null]);
      await F.wechseln(serie, "11", "Porsche 911 GT3 R (992)");
      const ja = await F.entscheiden(serie, "11", true);
      assert.deepStrictEqual([ja.modell, ja.wechsel.map((w) => w.art)], ["Porsche 911 GT3 R (992)", ["frei", "genehmigt"]]);
      await assert.rejects(() => F.entscheiden(serie, "11", true), /nicht mehr vor/);
      const gesetzt = await F.setzen(serie, "11", "bmw m4 gt3");
      assert.deepStrictEqual([gesetzt.modell, gesetzt.wechsel.slice(-1)[0].art], ["BMW M4 GT3", "rennleitung"]);
      assert.strictEqual((await F.derSerie("gt3")).get("11").modell, "BMW M4 GT3");
      await F.loeschen("gt3", "11");
      assert.strictEqual(await F.lesen("gt3", "11"), null);
    } finally { a.ende(); }
  },
  "Sichtung: Season wählt iRating oder Sichtung, Pace-Grenzen werden geprüft": () => {
    const basis = { name: "GT3", rennenGesamt: 8, gewerteteRennen: 8, punkte: "25 18", punkteDanach: 0, bonusPole: 0, bonusSchnellsteRunde: 0, mindestRundenProzent: 75, anmeldeschlussMinuten: 60, klassen: [{ name: "Pro", min: 2500, max: "" }, { name: "Pro-Am", min: 1500, max: 2499 }, { name: "Am", min: 0, max: 1499 }] };
    assert.deepStrictEqual(D.pruefeSerie(basis).einstufungArt, "irating");
    assert.strictEqual(D.pruefeSerie(basis).sichtungGrenzen, undefined);
    assert.deepStrictEqual(D.pruefeSerie({ ...basis, einstufungArt: "sichtung" }).sichtungGrenzen, [101.5, 103], "Leer heißt Standardwerte");
    assert.deepStrictEqual(D.pruefeSerie({ ...basis, einstufungArt: "sichtung", sichtungGrenzen: "101,2 / 102,8" }).sichtungGrenzen, [101.2, 102.8]);
    assert.deepStrictEqual(D.pruefeSerie({ ...basis, einstufungArt: "sichtung", sichtungGrenzen: "101.2, 103" }).sichtungGrenzen, [101.2, 103]);
    assert.throws(() => D.pruefeSerie({ ...basis, einstufungArt: "sichtung", sichtungGrenzen: "102" }), /2 Pace-Grenzen/);
    assert.throws(() => D.pruefeSerie({ ...basis, einstufungArt: "sichtung", sichtungGrenzen: "103 / 101" }), /steigen/);
    assert.strictEqual(D.pruefeSerie({ ...basis, einstufungArt: "sichtung", ohneKlassen: true }).einstufungArt, "irating", "Ohne Klassen gibt es nichts einzustufen");
  },
  "Sichtung: Einrichtung mit Zeitraum, Strecken, Runden, Wertung, Temperatur und Steckbrief": () => {
    const basis = { name: "GT3", rennenGesamt: 8, gewerteteRennen: 8, punkte: "25 18", punkteDanach: 0, bonusPole: 0, bonusSchnellsteRunde: 0, mindestRundenProzent: 75, anmeldeschlussMinuten: 60, klassen: [{ name: "Pro", min: 2500, max: "" }, { name: "Am", min: 0, max: 2499 }], einstufungArt: "sichtung" };
    const leer = D.pruefeSerie(basis);
    assert.deepStrictEqual([leer.sichtungRunden, leer.sichtungWertung, leer.sichtungStrecken, leer.sichtungVon, leer.sichtungTempMin], [7, "beste", [], "", null], "Standardwerte");
    const s = D.pruefeSerie({ ...basis, sichtungVon: "2026-12-01", sichtungBis: "2026-12-14", sichtungRunden: "5", sichtungWertung: "schnitt", sichtungTempMin: "20", sichtungTempMax: "35",
      sichtungStrecken: [{ bib: "spa-gp", name: "Spa", g61: "12" }, { name: "Monza", iracing: "239" }, { name: "", g61: "" }], sichtungSteckbrief: { uhrzeit: "14:00", wetter: "Klar", unsinn: "weg" } });
    assert.deepStrictEqual(s.sichtungStrecken, [{ key: "spa-gp", bib: "spa-gp", name: "Spa", g61: 12, iracing: null }, { key: "ir-239", bib: "", name: "Monza", g61: null, iracing: 239 }], "Leere Zeilen fallen weg");
    assert.deepStrictEqual([s.sichtungRunden, s.sichtungWertung, s.sichtungTempMin, s.sichtungTempMax], [5, "schnitt", 20, 35]);
    assert.deepStrictEqual(s.sichtungSteckbrief, { uhrzeit: "14:00", wetter: "Klar", zustand: "", setup: "", temperatur: "" });
    assert.throws(() => D.pruefeSerie({ ...basis, sichtungVon: "2026-12-10", sichtungBis: "2026-12-01" }), /vor ihrem Beginn/);
    assert.throws(() => D.pruefeSerie({ ...basis, sichtungStrecken: [{ name: "Spa" }] }), /iRacing-Strecken-ID/);
    assert.throws(() => D.pruefeSerie({ ...basis, sichtungStrecken: [{ name: "Spa", iracing: 1 }, { name: "Spa 2", iracing: 1 }] }), /nur einmal/);
    assert.throws(() => D.pruefeSerie({ ...basis, sichtungTempMin: 40, sichtungTempMax: 20 }), /größer/);
    assert.throws(() => D.pruefeSerie({ ...basis, sichtungRunden: 0 }), /Saubere Runden/);
  },
  "Sichtung: Rundenserie, nur N saubere Runden am Stück in derselben Session und demselben Run": () => {
    const S = require("../api/_lib/liga-sichtung");
    const r = (lapNumber, lapTime, ok = true, extra) => ({ lapNumber, lapTime, ok, session: 1, run: 1, event: "e1", ...extra });
    // Runde 3 hat einen Fehler: 1–2 und 4–6 sind zu kurz für 3 am Stück, 4–7 reicht
    const runden = [r(1, 100), r(2, 99), r(3, 90, false), r(4, 101), r(5, 100.5), r(6, 100.2), r(7, 100.4)];
    assert.deepStrictEqual(S.besterVersuch(runden, 3, "beste"), { wert: 100.2, beste: 100.2, schnitt: 100.367, runden: [100.5, 100.2, 100.4], event: "e1", zeit: null }, "Bei gleicher bester Runde gewinnt der bessere Schnitt");
    assert.strictEqual(S.besterVersuch(runden, 3, "schnitt").wert, 100.367);
    assert.strictEqual(S.besterVersuch(runden, 5, "beste"), null, "Zu wenig Runden am Stück");
    // Lücke in den Rundennummern unterbricht die Serie, ebenso ein anderer Run
    assert.strictEqual(S.besterVersuch([r(1, 100), r(2, 100), r(4, 100)], 3, "beste"), null);
    assert.strictEqual(S.besterVersuch([r(1, 100), r(2, 100), r(3, 100, true, { run: 2 })], 3, "beste"), null);
    assert.strictEqual(S.besterVersuch([r(3, 100), r(1, 100), r(2, 99)], 3, "beste").wert, 99, "Reihenfolge der Lieferung egal");
    // Saubere Runde: In- und Outlap, Offtrack und unvollständige zählen nicht
    const l = { clean: true, lapTime: 100 };
    assert.strictEqual(S.sauber(l), true);
    ["pitIn", "pitOut", "offtrack", "incomplete"].forEach((k) => assert.strictEqual(S.sauber({ ...l, [k]: true }), false, k));
    assert.strictEqual(S.sauber({ ...l, clean: false }), false);
    const serie = { sichtungTempMin: 20, sichtungTempMax: 30 };
    assert.strictEqual(S.bedingungenOk({ trackTemp: 25, precipitation: 0, trackWetness: 1 }, serie), true);
    assert.strictEqual(S.bedingungenOk({ trackTemp: 31 }, serie), false, "Zu heiß");
    assert.strictEqual(S.bedingungenOk({ trackTemp: 25, precipitation: 0.2 }, serie), false, "Regen");
    assert.strictEqual(S.bedingungenOk({ trackTemp: 25, trackWetness: 3 }, serie), false, "Nasse Strecke");
    // Lufttemperatur aus den Vorgaben, ein Grad Spielraum
    const vorgabe = { ...serie, sichtungSteckbrief: { zustand: "60 %", temperatur: "22 °C" } };
    assert.strictEqual(S.bedingungenOk({ trackTemp: 25, airTemp: 22.4 }, vorgabe), true);
    assert.strictEqual(S.bedingungenOk({ trackTemp: 25, airTemp: 21.1 }, vorgabe), true);
    assert.strictEqual(S.bedingungenOk({ trackTemp: 25, airTemp: 25 }, vorgabe), false, "Zu warme Luft");
    assert.strictEqual(S.bedingungenOk({ trackTemp: 25, airTemp: 30 }, serie), true, "Ohne Vorgabe keine Prüfung");
  },
  "Sichtung: Auswertung aus Garage 61 nach Strecke, Zeitraum, Auto und Name": () => {
    const S = require("../api/_lib/liga-sichtung");
    const serie = { id: "gt4", modelle: ["BMW M4 GT4", "Porsche 718 Cayman GT4"], sichtungVon: "2026-12-01", sichtungBis: "2026-12-07", sichtungRunden: 3, sichtungWertung: "beste",
      sichtungStrecken: [{ key: "spa", name: "Spa", g61: 12, iracing: null }, { key: "ir-239", name: "Monza", g61: null, iracing: 239 }] };
    const fahrer = [{ discordId: "1", name: "Anna Weber", modell: "BMW M4 GT4" }, { discordId: "2", name: "Ben Ott", modell: "Porsche 718 Cayman GT4" }, { discordId: "3", name: "Max Muster", modell: "BMW M4 GT4" }, { discordId: "4", name: "Max Muster", modell: "BMW M4 GT4" }];
    const runde = (driver, n, t, track, car = "BMW M4 GT4", extra) => ({ driver, lapNumber: n, lapTime: t, clean: true, session: 1, run: 1, track, car: { name: car }, trackTemp: 25, ...extra });
    const anna = { slug: "anna-weber", firstName: "Anna", lastName: "Weber" };
    const ben = { slug: "ben-ott", firstName: "Ben", lastName: "Ott" };
    const max = { slug: "max-muster", firstName: "Max", lastName: "Muster" };
    const spa = { id: 12, platform_id: 163 };
    const monza = { id: 99, platform_id: 239 };
    const events = [
      { id: "a", startedAt: "2026-12-02T18:00:00Z", laps: [1, 2, 3].map((n) => runde(anna, n, 140 - n, spa)).concat([1, 2, 3, 4].map((n) => runde(ben, n, 139, spa, "BMW M4 GT4"))) },
      { id: "b", startedAt: "2026-12-03T18:00:00Z", laps: [1, 2, 3].map((n) => runde(anna, n, 108, monza)).concat([1, 2, 3].map((n) => runde(max, n, 107, monza))) },
      // Außerhalb des Zeitraums (8.12. 0 Uhr Berliner Zeit ist schon vorbei) und auf einer fremden Strecke
      { id: "c", startedAt: "2026-12-07T23:30:00Z", laps: [1, 2, 3].map((n) => runde(anna, n, 130, spa)) },
      { id: "d", startedAt: "2026-12-04T18:00:00Z", laps: [1, 2, 3].map((n) => runde(anna, n, 90, { id: 5, platform_id: 5 })) },
    ];
    const { versuche, unbekannt } = S.auswerten(serie, events, fahrer, {});
    const temp = { bedingungen: { strecke: [25, 25] } };
    assert.deepStrictEqual(versuche.get("1"), { spa: { wert: 137, beste: 137, schnitt: 138, runden: [139, 138, 137], event: "a", zeit: "2026-12-02T18:00:00Z", ...temp }, "ir-239": { wert: 108, beste: 108, schnitt: 108, runden: [108, 108, 108], event: "b", zeit: "2026-12-03T18:00:00Z", ...temp } });
    // Gemessene Bedingungen wie Garage 61 sie liefert: Gummi als Prozent
    const mitWerten = [1, 2, 3].map((n) => runde(anna, n, 130, spa, "BMW M4 GT4", { trackTemp: 20.55 + n, airTemp: 18.889, trackUsage: 55 + n }));
    assert.deepStrictEqual(S.auswerten(serie, [{ id: "w", startedAt: "2026-12-05T18:00:00Z", laps: mitWerten }], fahrer, {}).versuche.get("1").spa.bedingungen, { strecke: [21.6, 23.6], luft: [18.9, 18.9], gummi: [56, 58], gummiStart: [56, 56] });
    assert.deepStrictEqual(versuche.get("2"), {}, "Ben fuhr den BMW statt seines gemeldeten Porsche");
    assert.deepStrictEqual(unbekannt, [{ slug: "max-muster", name: "Max Muster", runden: 3 }], "Doppelter Name in der Season: nicht eindeutig");
    // Von Hand zugeordnet zählt es
    assert.strictEqual(S.auswerten(serie, events, fahrer, { "max-muster": "4" }).versuche.get("4")["ir-239"].wert, 107);
    // Mindest-Tank: zählt der Stand der Outlap, also des Stint-Starts
    const tankRunden = (start, run) => [0, 1, 2, 3].map((n) => runde(anna, n, n ? 131 + run : 200, spa, "BMW M4 GT4", { run, pitOut: n === 0, fuelLevel: start - n * 3 }));
    const tankSerie = { ...serie, sichtungTankMin: 40 };
    const tankAus = S.auswerten(tankSerie, [{ id: "t", startedAt: "2026-12-05T18:00:00Z", laps: [...tankRunden(30, 1), ...tankRunden(50, 2)] }], fahrer, {}).versuche.get("1").spa;
    assert.deepStrictEqual([tankAus.wert, tankAus.bedingungen.tank], [133, [50, 50]], "Der schnellere Stint mit 30 Litern zählt nicht");
    assert.strictEqual(S.auswerten(serie, [{ id: "t", startedAt: "2026-12-05T18:00:00Z", laps: tankRunden(30, 1) }], fahrer, {}).versuche.get("1").spa.wert, 132, "Ohne Vorgabe zählt jeder Tank");
    assert.strictEqual(D.pruefeSerie({ name: "GT4", rennenGesamt: 1, gewerteteRennen: 1, punkte: "1", punkteDanach: 0, bonusPole: 0, bonusSchnellsteRunde: 0, mindestRundenProzent: 0, anmeldeschlussMinuten: 0, klassen: [{ name: "Pro", min: 2500, max: "" }, { name: "Am", min: 0, max: 2499 }], einstufungArt: "sichtung", sichtungTankMin: "60" }).sichtungTankMin, 60);
    // Streckenzustand: Gummi beim Start der Session ±3 % zur Vorgabe, danach darf er steigen
    const gummiRunden = (session, start) => [0, 1, 2, 3].map((n) => runde(anna, n, n ? 129 + session : 200, spa, "BMW M4 GT4", { session, pitOut: n === 0, trackUsage: start + n * 4, startTime: `2026-12-05T18:0${n}:00Z` }));
    const gummiSerie = { ...serie, sichtungSteckbrief: { zustand: "60 %" } };
    const gummiAus = S.auswerten(gummiSerie, [{ id: "g", startedAt: "2026-12-05T18:00:00Z", laps: [...gummiRunden(1, 45), ...gummiRunden(2, 58)] }], fahrer, {}).versuche.get("1").spa;
    assert.deepStrictEqual([gummiAus.wert, gummiAus.bedingungen.gummiStart], [130, [45, 45]], "Gummi wird nur gemessen, nicht geprüft: die schnellere Session mit 45 % zählt");
    // Ohne gültigen Versuch sagt die Auswertung warum
    const kurz = [0, 1, 2, 3, 4].map((n) => runde(ben, n, 140, spa, "BMW M4 GT4", { pitOut: n === 0, offtrack: n === 2, airTemp: 25 }));
    const diag = S.auswerten({ ...serie, sichtungRunden: 3, sichtungSteckbrief: { temperatur: "22 °C" } }, [{ id: "k", startedAt: "2026-12-05T18:00:00Z", laps: kurz }], fahrer, {}).hinweise.get("2").spa;
    assert.deepStrictEqual([diag.runden, diag.laengste, Object.keys(diag.gruende)], [4, 0, ["auto"]], "Ben fuhr den BMW, Auto ist der erste Grund");
    const texte = S.hinweisTexte(diag, { ...serie, sichtungRunden: 3 });
    assert.ok(texte[0].includes("4 Runden gefunden") && texte[0].includes("0 von 3"), texte[0]);
    assert.ok(texte[1].includes("anderen Auto") && texte[1].includes("BMW M4 GT4"), texte[1]);
    const anna2 = [0, 1, 2, 3, 4].map((n) => runde(anna, n, 140, spa, "BMW M4 GT4", { pitOut: n === 0, offtrack: n === 2, airTemp: n === 4 ? 25 : 22 }));
    const t2 = S.hinweisTexte(S.auswerten({ ...serie, sichtungRunden: 3, sichtungSteckbrief: { temperatur: "22 °C" } }, [{ id: "k", startedAt: "2026-12-05T18:00:00Z", laps: anna2 }], fahrer, {}).hinweise.get("1").spa, { ...serie, sichtungRunden: 3, sichtungSteckbrief: { temperatur: "22 °C" } });
    assert.deepStrictEqual(t2, ["4 Runden gefunden, längste gültige Folge: 1 von 3 am Stück.", "1 Runde mit falscher Lufttemperatur (25 °C), vorgegeben ist 22 °C.", "1 Runde mit Zwischenfall (Offtrack, Incident oder unvollständig)."]);
    assert.ok(S.hinweisTexte(undefined, serie)[0].includes("keine Runden"));
    // Ohne Fahrzeugliste in der Season zählt jedes Auto
    assert.strictEqual(S.auswerten({ ...serie, modelle: [] }, events, fahrer, {}).versuche.get("2").spa.wert, 139);
  },
  "Sichtung: Klassenvorschlag aus den Abgaben, nur mit allen Strecken": () => {
    const serie = { id: "gt3", klassen: [{ id: "am", name: "Am", min: 0, max: 1499 }, { id: "pro", name: "Pro", min: 2500, max: null }, { id: "proam", name: "Pro-Am", min: 1500, max: 2499 }], sichtungGrenzen: [101.5, 103], sichtungRunden: 7,
      sichtungStrecken: [{ key: "spa", name: "Spa" }, { key: "monza", name: "Monza" }, { key: "imola", name: "Imola" }] };
    const e = (cust, irating, spa, monza, imola) => ({ cust, discordId: `d${cust}`, name: `Fahrer ${cust}`, irating, werte: { spa, monza, imola } });
    // Spa ~2:17, Monza ~1:47, Imola ~1:41: absolute Zeiten sind nicht vergleichbar, nur der Abstand je Strecke.
    const v = D.sichtungVorschlag(serie, [e("a", 1200, 137.0, 107.5, 101.0), e("b", 3000, 138.4, 107.0, 102.0), e("c", 2000, 141.0, 110.0, 103.0), e("d", 1800, 137.5, 107.1, undefined), e("e", 0)], { b: "proam" });
    const je = Object.fromEntries(v.fahrer.map((x) => [x.cust, x]));
    assert.deepStrictEqual(v.strecken, ["Spa", "Monza", "Imola"]);
    assert.deepStrictEqual(v.klassen.map((k) => k.id), ["pro", "proam", "am"], "Stärkste Klasse zuerst");
    assert.deepStrictEqual(je.a.zeiten.map((z) => z.prozent), [100, 100.5, 100]);
    assert.deepStrictEqual([je.a.prozent, je.a.vorschlag, je.a.nachIrating, je.a.vollstaendig], [100.2, "pro", "am", true], "Schnell trotz niedrigem iRating: Pro");
    assert.deepStrictEqual([je.b.prozent, je.b.vorschlag, je.b.fest], [100.7, "pro", "proam"]);
    assert.deepStrictEqual([je.c.prozent, je.c.vorschlag], [102.6, "proam"]);
    assert.deepStrictEqual([je.d.gewertet, je.d.vollstaendig, je.d.vorschlag, je.d.zeiten[2], je.d.nachIrating], [2, false, "", null, "proam"], "Fehlende Strecke: kein Vorschlag, dann gilt iRating");
    assert.deepStrictEqual([je.e.prozent, je.e.vorschlag, je.e.nachIrating], [null, "", ""]);
    assert.deepStrictEqual(v.fahrer.map((x) => x.cust), ["a", "b", "c", "d", "e"], "Vollständige zuerst, nach Schnitt");
  },
  "Sichtung: Abgabe friert den Wert ein, nur im Zeitraum, Zurücksetzen durch die Rennleitung": async () => {
    const a = supabaseAttrappe();
    try {
      const S = require("../api/_lib/liga-sichtung");
      const serie = { id: "gt3", name: "GT3", sichtungVon: "2026-12-01", sichtungBis: "2026-12-07", sichtungRunden: 7, sichtungWertung: "beste", sichtungStrecken: [{ key: "spa", name: "Spa" }, { key: "monza", name: "Monza" }] };
      const mitte = Date.UTC(2026, 11, 3, 12);
      const versuch = { wert: 137.5, beste: 137.5, schnitt: 138, runden: [138, 137.5], event: "e1", zeit: "2026-12-02T18:00:00Z" };
      await assert.rejects(() => S.abgeben(serie, "11", "spa", versuch, "Anna", Date.UTC(2026, 10, 30, 12)), /noch nicht begonnen/);
      await assert.rejects(() => S.abgeben(serie, "11", "spa", versuch, "Anna", Date.UTC(2026, 11, 7, 23, 30)), /vorbei/, "Ende des letzten Tages ist Mitternacht Berliner Zeit");
      await assert.rejects(() => S.abgeben(serie, "11", "spa", null, "Anna", mitte), /7 sauberen Runden/);
      await assert.rejects(() => S.abgeben(serie, "11", "nurburgring", versuch, "Anna", mitte), /gehört nicht/);
      const gespeichert = await S.abgeben(serie, "11", "spa", versuch, "Anna", mitte);
      assert.deepStrictEqual(gespeichert.abgaben.spa, { ...versuch, wertung: "beste", abgegeben: new Date(mitte).toISOString() });
      // Ein schnellerer Versuch später ändert nichts mehr
      await assert.rejects(() => S.abgeben(serie, "11", "spa", { ...versuch, wert: 130 }, "Anna", mitte + 1000), /schon abgegeben/);
      await S.abgeben(serie, "11", "monza", { ...versuch, wert: 107 }, "Anna", mitte);
      const alle = await S.lesenAlle("gt3");
      assert.deepStrictEqual(Object.keys(alle.get("11").abgaben).sort(), ["monza", "spa"]);
      assert.strictEqual(alle.get("11").abgaben.spa.wert, 137.5, "Eingefroren");
      // Fortschritt fürs Cockpit
      const meldung = (id) => A.leseEintrag({ pathname: A.mitgliedPfad("gt3", id, "", `M${id}`), uploadedAt: iso(0) });
      const fs = await S.fortschritt(serie, [meldung("11"), meldung("12")], mitte);
      assert.deepStrictEqual([fs.fahrer, fs.komplett, fs.teil, fs.laeuft, fs.eingerichtet], [2, 1, 0, true, true]);
      // Rennleitung setzt zurück, danach ist eine neue Abgabe möglich
      await S.zuruecksetzen("gt3", "11", "spa");
      await assert.rejects(() => S.zuruecksetzen("gt3", "11", "spa"), /gibt es nicht mehr/);
      assert.strictEqual((await S.abgeben(serie, "11", "spa", { ...versuch, wert: 130 }, "Anna", mitte)).abgaben.spa.wert, 130);
      // Vorschlag nur aus Abgaben
      const v = S.vorschlag({ ...serie, klassen: [{ id: "pro", name: "Pro", min: 2500, max: null }, { id: "am", name: "Am", min: 0, max: 2499 }], sichtungGrenzen: [102] }, [{ discordId: "11", cust: "501", name: "Anna", irating: 1000 }, { discordId: "12", cust: "502", name: "Ben", irating: 3000 }], await S.lesenAlle("gt3"));
      assert.deepStrictEqual(v.fahrer.map((f) => [f.cust, f.vorschlag, f.nachIrating]), [["501", "pro", "am"], ["502", "", "pro"]]);
      // Klick auf „Team beitreten“ wird nur einmal gemeldet und lässt die Abgaben stehen
      assert.strictEqual(await S.teamAnfrageMerken(serie, "11", "Anna", mitte), true);
      assert.strictEqual(await S.teamAnfrageMerken(serie, "11", "Anna", mitte + 1000), false);
      assert.strictEqual(await S.teamAnfrageMerken(serie, "13", "Cem", mitte), true, "Auch ohne bisherige Datei");
      const nachher = await S.lesenAlle("gt3");
      assert.deepStrictEqual([nachher.get("11").teamAnfrage, nachher.get("11").abgaben.spa.wert], [new Date(mitte).toISOString(), 130]);
      assert.deepStrictEqual(S.teamAnfrageKarte(serie, "Anna").fields.map((f) => f.value), ["Anna", "GT3", "Anna"]);
      await S.derSerieLoeschen("gt3");
      assert.strictEqual((await S.lesenAlle("gt3")).size, 0);
    } finally { a.ende(); }
  },
  "Sichtung: Direktnachricht nennt Team-Link, Strecken, Auto und Steckbrief": () => {
    const S = require("../api/_lib/liga-sichtung");
    const t = S.einladungText({ name: "GT4 Cup", sichtungVon: "2026-12-01", sichtungBis: "2026-12-07", sichtungRunden: 7, sichtungWertung: "schnitt", sichtungStrecken: [{ name: "Spa" }, { name: "Monza" }], sichtungSteckbrief: { uhrzeit: "14:00", wetter: "Klar" }, sichtungTempMin: 20, sichtungTempMax: 30 }, "BMW M4 GT4");
    ["vom 01.12.2026 bis 07.12.2026", "garage61.net/app/teams/darkline-simracing-series", "7 saubere Runden am Stück mit deinem **BMW M4 GT4**", "Durchschnitt der sauberen Runden", "**Strecken:** Spa, Monza", "**Uhrzeit:** 14:00", "**Temperatur:** 20 bis 30 °C Strecke"].forEach((teil) => assert.ok(t.includes(teil), teil));
    assert.ok(!t.includes("\n\n\n"));
  },
  "Gleichzeitig: Formular erkennt fremde Änderungen, Reihenfolge und Nebenfelder zählen nicht": () => {
    const s = { id: "gt3", name: "GT3", punkte: [25, 18], bildVersion: 1 };
    assert.strictEqual(D.nochAktuell({ punkte: [25, 18], name: "GT3", id: "gt3" }, s, ["bildVersion"]), true);
    assert.strictEqual(D.nochAktuell({ ...s, bildVersion: 9 }, s, ["bildVersion"]), true);
    assert.strictEqual(D.nochAktuell({ ...s, name: "GT3 alt" }, s, ["bildVersion"]), false);
    assert.strictEqual(D.nochAktuell(undefined, s), true, "Ältere Seiten ohne Stand werden nicht blockiert");
    assert.throws(() => D.nichtUeberschreiben({ ...s, name: "x" }, s, [], "Diese Serie"), (e) => e.konflikt === true && /jemand anderes/.test(e.message));
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
    assert.deepStrictEqual(A.pruefeExtras({}), { nummer: null, land: "", team: "", kanal: "", zeigeBild: false, uebersicht: false });
  },
  "Extras: Fahrerübersicht nur mit ausdrücklichem Haken": () => {
    assert.strictEqual(A.pruefeExtras({ uebersicht: true }).uebersicht, true);
    assert.strictEqual(A.pruefeExtras({ uebersicht: "true" }).uebersicht, false);
    assert.strictEqual(A.pruefeExtras({ uebersicht: 1 }).uebersicht, false);
  },
  "Öffentliches Profil: Name nur mit Zustimmung zur Fahrerübersicht": () => {
    const P = require("../api/_lib/liga-profil");
    assert.strictEqual(P.oeffentlich({ n: 7, o: "x" }).name, undefined);
    assert.strictEqual(P.oeffentlich({ n: 7, m: "Lena", o: "x" }).name, undefined);
    assert.deepStrictEqual(P.oeffentlich({ n: 7, v: 1, m: "Lena", o: "x" }), { nummer: 7, land: "", team: "", kanal: "", bild: "", uebersicht: true, name: "Lena" });
    assert.strictEqual(P.oeffentlich({ n: 7, v: 1, m: "Lena", o: "x" }).o, undefined);
  },
  "Fahrerübersicht: Fahrer mit Ergebnissen und registrierte mit Zustimmung, sonst niemand": () => {
    const P = require("../api/_lib/liga-profil");
    const a = "a".repeat(16), b = "b".repeat(16), c = "c".repeat(16), d = "d".repeat(16);
    const serien = [{ id: "s1", name: "GT3 Cup", status: "laeuft", farbe: "blau" }, { id: "s0", name: "Alt", status: "beendet" }];
    const tabellen = new Map([
      ["s1", { klassen: [{ fahrer: [{ pid: a, name: "Anna Racer", karte: {}, rennen: [{ platz: 1 }, null, { platz: 4 }] }, { pid: "kaputt", name: "X", karte: {}, rennen: [] }] }] }],
      ["s0", { klassen: [{ fahrer: [{ pid: a, name: "Anna Racer", karte: {}, rennen: [{ platz: 3 }] }] }] }],
    ]);
    const profile = [
      { pid: a, o: "x", n: 12, l: "DE", b: "v1" },
      { pid: b, o: "y", n: 7, v: 1, m: "Ben Neu" },
      { pid: c, o: "z", n: 3, m: "Ohne Zustimmung" },
      { pid: d, o: "w", n: 99 },
    ];
    const liste = P.fahrerListe(serien, tabellen, profile);
    assert.deepStrictEqual(liste.map((f) => f.name), ["Ben Neu", "Anna Racer"]);
    const anna = liste[1];
    assert.deepStrictEqual([anna.nummer, anna.land, anna.bild, anna.starts, anna.siege, anna.podien], [12, "DE", "v1", 3, 1, 2]);
    assert.deepStrictEqual(anna.serien.map((s) => s.id), ["s1"], "Beendete Serien erscheinen nicht als aktiv");
    assert.strictEqual(liste[0].starts, 0);
    assert.ok(!JSON.stringify(liste).includes('"o"'), "Der Besitzer-Prüfwert wird nie ausgeliefert");
  },
  "Stewards: der Server lässt nur Report-Aktionen zu und sperrt Protokoll und Teams": async () => {
    const S = require("../api/_lib/session");
    const Admin = require("../api/_lib/liga-admin");
    const alt = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "x".repeat(40);
    try {
      // Sitzungs-Cookie wie beim Login erzeugen
      const cookieFuer = (nutzer) => { let c = ""; S.createLigaAdminSession({ getHeader: () => null, setHeader: (k, v) => { c = String(v).split(";")[0]; } }, nutzer); return c; };
      const antwort = () => { const r = { code: 0, body: null, headers: {} }; return Object.assign(r, { setHeader: (k, v) => { r.headers[k] = v; }, status: (c) => { r.code = c; return r; }, json: (b) => { r.body = b; return r; } }); };
      const anfrage = (cookie, method, extra) => ({ method, headers: { cookie, origin: "https://darklineperformance.de", host: "darklineperformance.de" }, query: {}, ...extra });
      const steward = cookieFuer({ id: "111111", name: "Steward", rolle: "steward" });
      assert.strictEqual(Admin.istSteward(S.getLigaAdminSession({ headers: { cookie: steward } })), true);
      assert.strictEqual(Admin.istSteward(S.getLigaAdminSession({ headers: { cookie: cookieFuer({ id: "1", name: "Alt" }) } })), false, "Alte Sitzungen ohne Rolle sind volle Rennleitung");
      for (const aktion of ["serie-loeschen", "profil-bearbeiten", "ergebnis-veroeffentlichen", "team-admin-loeschen", "reglement-speichern", "strafe-hinzufuegen"]) {
        const r = antwort();
        await Admin(anfrage(steward, "POST", { body: { aktion } }), r);
        assert.strictEqual(r.code, 403, `${aktion} muss für Stewards gesperrt sein`);
      }
      for (const nur of ["protokoll", "teams"]) {
        const r = antwort();
        await Admin(anfrage(steward, "GET", { query: { nur } }), r);
        assert.strictEqual(r.code, 403, `nur=${nur} muss für Stewards gesperrt sein`);
      }
      assert.deepStrictEqual([...Admin.STEWARD_AKTIONEN].sort(), ["report-notiz", "report-status", "report-stimme", "report-urteil"]);
    } finally {
      if (alt === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = alt;
    }
  },
  "Stewards: werden nur bei Reports und Einsprüchen im internen Kanal gepingt": async () => {
    const R = require("../api/_lib/liga-reports");
    const alt = { fetch: global.fetch, env: { ...process.env } };
    Object.assign(process.env, { LIGA_DISCORD_WEBHOOK_TEAM: "https://discord.example/hook", LIGA_ADMIN_ROLE_IDS: "100", LIGA_STEWARD_ROLE_IDS: "200" });
    const gesendet = [];
    global.fetch = async (url, init) => { gesendet.push(JSON.parse(init.body)); return { ok: true }; };
    try {
      await R.teamMelden({ title: "Nummernwunsch" });
      await R.teamMelden({ title: "Report" }, { stewards: true });
      assert.deepStrictEqual(gesendet[0].allowed_mentions.roles, ["100"]);
      assert.deepStrictEqual(gesendet[1].allowed_mentions.roles, ["100", "200"]);
      assert.strictEqual(gesendet[1].content, "<@&100> <@&200>");
    } finally {
      global.fetch = alt.fetch;
      for (const k of ["LIGA_DISCORD_WEBHOOK_TEAM", "LIGA_ADMIN_ROLE_IDS", "LIGA_STEWARD_ROLE_IDS"]) { if (alt.env[k] === undefined) delete process.env[k]; else process.env[k] = alt.env[k]; }
    }
  },
  "Admin: Liste aller registrierten Fahrer, auch ohne Season": async () => {
    const Admin = require("../api/_lib/liga-admin");
    const alt = { fetch: global.fetch, env: { ...process.env } };
    Object.assign(process.env, { SUPABASE_URL: "https://speicher.example", SUPABASE_SECRET_KEY: "k" });
    const jetzt = "2026-11-14T10:00:00.000Z";
    const zeilenJe = {
      "liga/fahrer/": [
        { pfad: "liga/fahrer/111111.json", inhalt: JSON.stringify({ iracingName: "Anna Racer", custId: "11", irating: 2100, nummer: 12, uebersicht: true, g61Anfrage: jetzt, discord: { i: true, f: true, n: "#12 Anna Racer" } }), binaer: false },
        { pfad: "liga/fahrer/222222.json", inhalt: JSON.stringify({ iracingName: "Ben Neu", custId: "22", irating: 1500, nummer: 7 }), binaer: false },
        { pfad: "liga/fahrer/kaputt.json", inhalt: "{", binaer: false },
      ],
      "liga/": [{ pfad: `liga/serien/s1/111111~~Anna`, geaendert: jetzt }, { pfad: `liga/serien/s0/222222~~Ben`, geaendert: jetzt }],
    };
    global.fetch = async (url) => {
      const u = new URL(String(url));
      if (u.hostname !== "speicher.example") return { ok: false, status: 503, json: async () => ({}), text: async () => "" };
      const prefix = (u.searchParams.get("pfad") || "").replace(/^like\./, "").replace(/\*$/, "");
      return { ok: true, json: async () => zeilenJe[prefix] || [] };
    };
    const warn = console.warn; const fehler = console.error;
    console.warn = () => {}; console.error = () => {};
    try {
      const kat = { serien: [{ id: "s1", name: "GT3 Cup", status: "laeuft" }, { id: "s0", name: "Alt", status: "beendet" }] };
      const liste = await Admin.alleFahrer(kat);
      assert.deepStrictEqual(liste.map((f) => f.name), ["Ben Neu", "Anna Racer"], "Sortiert nach Startnummer, kaputte Einträge fehlen");
      const [ben, anna] = liste;
      assert.strictEqual(ben.uebersicht, null, "Ältere Profile: noch nicht gefragt");
      assert.deepStrictEqual(ben.serien.map((s) => [s.id, s.beendet]), [["s0", true]]);
      assert.strictEqual(anna.uebersicht, true);
      assert.strictEqual(anna.g61, "gemeldet");
      assert.deepStrictEqual(anna.discord, { rolle: true, fahrerRolle: true, name: "#12 Anna Racer" });
      assert.strictEqual(anna.discordId, "111111");
    } finally {
      console.warn = warn; console.error = fehler;
      global.fetch = alt.fetch;
      for (const k of ["SUPABASE_URL", "SUPABASE_SECRET_KEY"]) { if (alt.env[k] === undefined) delete process.env[k]; else process.env[k] = alt.env[k]; }
    }
  },
  "Teams: Eingaben werden geprüft, Name und Kürzel sind eindeutig": () => {
    const T = require("../api/_lib/liga-teams");
    const teams = [{ id: "aaaaaaaa", name: "Night Racers", kuerzel: "NR", farbe: "rot" }];
    assert.deepStrictEqual(T.pruefe({ name: "  Blue   Line ", kuerzel: "bl1", farbe: "blau" }, teams), { name: "Blue Line", kuerzel: "BL1", farbe: "blau" });
    assert.throws(() => T.pruefe({ name: "night racers", kuerzel: "XX" }, teams), /gibt es schon/);
    assert.throws(() => T.pruefe({ name: "Neu", kuerzel: "nr" }, teams), /vergeben/);
    assert.doesNotThrow(() => T.pruefe({ name: "Night Racers", kuerzel: "NR" }, teams, "aaaaaaaa"), "Das eigene Team zählt nicht als Doppel");
    assert.throws(() => T.pruefe({ name: "X", kuerzel: "AB" }, []), /2 bis 40/);
    assert.throws(() => T.pruefe({ name: "Gut", kuerzel: "A" }, []), /Kürzel/);
    assert.throws(() => T.pruefe({ name: "Gut", kuerzel: "AB", farbe: "pink" }, []), /Teamfarbe/);
  },
  "Teams: öffentliche Sicht ohne Discord-IDs, Einladung nur für den Teamchef": () => {
    const T = require("../api/_lib/liga-teams");
    const team = { id: "aaaaaaaa", name: "NR", kuerzel: "NR", farbe: "rot", chef: "111111", einladung: "f".repeat(16), anfragen: [{ discordId: "333333", name: "C" }], mitglieder: [{ discordId: "222222", pid: "b".repeat(16), name: "Ben", nummer: 7 }, { discordId: "111111", pid: "a".repeat(16), name: "Anna", nummer: 12 }] };
    const o = T.oeffentlich(team, { ["a".repeat(16)]: { land: "DE", bild: "v1" } });
    const text = JSON.stringify(o);
    assert.ok(!text.includes("111111") && !text.includes("ffff") && !text.includes("333333"), "Keine Discord-IDs, kein Code, keine Anfragen");
    assert.deepStrictEqual(o.mitglieder.map((m) => [m.name, m.chef, m.land]), [["Anna", true, "DE"], ["Ben", false, ""]]);
    assert.strictEqual(T.eigeneSicht(team, "111111").einladung, "f".repeat(16));
    assert.strictEqual(T.eigeneSicht(team, "222222").einladung, undefined);
    assert.strictEqual(T.eigeneSicht(team, "222222").anfragen, undefined);
    assert.deepStrictEqual(T.teamKurz(T.nachPid([team]).get("b".repeat(16))), { id: "aaaaaaaa", name: "NR", kuerzel: "NR", farbe: "rot", logo: "" });
  },
  "Teams: gründen, Link, Anfrage, Chefwechsel, verlassen": async () => {
    const T = require("../api/_lib/liga-teams");
    const alt = { fetch: global.fetch, env: { ...process.env } };
    Object.assign(process.env, { SUPABASE_URL: "https://speicher.example", SUPABASE_SECRET_KEY: "k" });
    // Kleiner Speicher im Arbeitsspeicher, der die Abfragen der Supabase-Schnittstelle nachbildet
    const db = new Map();
    let uhr = 0;
    global.fetch = async (url, init = {}) => {
      const u = new URL(String(url));
      const p = u.searchParams.get("pfad") || "";
      const antwort = (daten) => ({ ok: true, json: async () => daten, text: async () => "" });
      if (!init.method || init.method === "GET") {
        if (p.startsWith("like.")) { const pre = p.slice(5).replace(/\*$/, "").replace(/\\(.)/g, "$1"); return antwort([...db].filter(([k]) => k.startsWith(pre)).map(([pfad, z]) => ({ pfad, ...z }))); }
        const z = db.get(p.slice(3)); return antwort(z ? [z] : []);
      }
      if (init.method === "POST") { const [z] = JSON.parse(init.body); if (db.has(z.pfad)) return antwort([]); db.set(z.pfad, { inhalt: z.inhalt, binaer: false, geaendert: new Date(++uhr * 1000).toISOString() }); return antwort([{ pfad: z.pfad }]); }
      if (init.method === "PATCH") { const pfad = p.slice(3); const z = db.get(pfad); if (!z || `eq.${z.geaendert}` !== u.searchParams.get("geaendert")) return antwort([]); db.set(pfad, { ...z, ...JSON.parse(init.body), geaendert: new Date(++uhr * 1000).toISOString() }); return antwort([{ pfad }]); }
      if (init.method === "DELETE") { for (const k of [...db.keys()]) if (p.includes(`"${k}"`)) db.delete(k); return antwort([]); }
      throw new Error("unerwartet");
    };
    const profil = (name, nummer, cust) => ({ iracingName: name, nummer, custId: cust });
    try {
      await assert.rejects(T.aktion("team-gruenden", "111111", null, { name: "Night Racers", kuerzel: "NR" }), /registriere dich/);
      await T.aktion("team-gruenden", "111111", profil("Anna", 12, "11"), { name: "Night Racers", kuerzel: "nr", farbe: "blau" });
      let [team] = await T.alle(true);
      assert.deepStrictEqual([team.name, team.kuerzel, team.chef, team.mitglieder.length], ["Night Racers", "NR", "111111", 1]);
      await assert.rejects(T.aktion("team-gruenden", "111111", profil("Anna", 12, "11"), { name: "Zweites", kuerzel: "ZW" }), /schon im Team/);
      // Beitritt per Link, Nachricht an den Chef
      await assert.rejects(T.aktion("team-beitreten", "222222", profil("Ben", 7, "22"), { code: "0".repeat(16) }), /ungültig/);
      const n = await T.aktion("team-beitreten", "222222", profil("Ben", 7, "22"), { code: team.einladung });
      assert.strictEqual(n.an, "111111");
      // Anfrage: nur der Chef entscheidet
      await T.aktion("team-anfragen", "333333", profil("Carla", 21, "33"), { team: team.id });
      await assert.rejects(T.aktion("team-anfrage-entscheiden", "222222", profil("Ben", 7, "22"), { fahrer: "333333", ja: true }), /nur der Teamchef/);
      const ok = await T.aktion("team-anfrage-entscheiden", "111111", profil("Anna", 12, "11"), { fahrer: "333333", ja: true });
      assert.strictEqual(ok.an, "333333");
      [team] = await T.alle(true);
      assert.deepStrictEqual(team.mitglieder.map((m) => m.name), ["Anna", "Ben", "Carla"]);
      assert.strictEqual(team.anfragen.length, 0);
      // Chef kann nicht einfach gehen, nach der Übergabe schon
      await assert.rejects(T.aktion("team-verlassen", "111111", profil("Anna", 12, "11")), /übergib zuerst/);
      await T.aktion("team-chef", "111111", profil("Anna", 12, "11"), { fahrer: "222222" });
      await T.aktion("team-verlassen", "111111", profil("Anna", 12, "11"));
      // Neuer Link: der alte gilt nicht mehr
      const alterCode = (await T.alle(true))[0].einladung;
      await T.aktion("team-link-neu", "222222", profil("Ben", 7, "22"));
      await assert.rejects(T.aktion("team-beitreten", "111111", profil("Anna", 12, "11"), { code: alterCode }), /ungültig/);
      // Namensänderung wird im Team nachgezogen
      await T.mitgliedAktualisieren("333333", profil("Carla Neu", 22, "33"));
      [team] = await T.alle(true);
      assert.deepStrictEqual(team.mitglieder.map((m) => [m.name, m.nummer]), [["Ben", 7], ["Carla Neu", 22]]);
      // Teamlogo: nur der Teamchef, nur echte Bilder, Entfernen räumt das Bild weg
      const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(24)]);
      const logoDaten = `data:image/webp;base64,${webp.toString("base64")}`;
      const logoDa = () => [...db.keys()].some((k) => k.includes(`team-${team.id}`));
      await assert.rejects(T.aktion("team-logo", "333333", profil("Carla Neu", 22, "33"), { daten: logoDaten }), /nur der Teamchef/);
      await assert.rejects(T.aktion("team-logo", "222222", profil("Ben", 7, "22"), { daten: "data:image/webp;base64,AAAA" }), /kein gültiges Bild/);
      await T.aktion("team-logo", "222222", profil("Ben", 7, "22"), { daten: logoDaten });
      [team] = await T.alle(true);
      assert.ok(/^[0-9a-f]{6}$/.test(team.logo) && logoDa());
      assert.strictEqual(T.oeffentlich(team).logo, team.logo);
      await T.aktion("team-logo-weg", "222222", profil("Ben", 7, "22"));
      [team] = await T.alle(true);
      assert.ok(!team.logo && !logoDa());
      // Auflösen löscht das Team samt Logo
      await T.aktion("team-logo", "222222", profil("Ben", 7, "22"), { daten: logoDaten });
      await T.aktion("team-aufloesen", "222222", profil("Ben", 7, "22"));
      assert.strictEqual((await T.alle(true)).length, 0);
      assert.ok(!logoDa(), "Das Logo verschwindet mit dem Team");
    } finally {
      global.fetch = alt.fetch;
      for (const k of ["SUPABASE_URL", "SUPABASE_SECRET_KEY"]) { if (alt.env[k] === undefined) delete process.env[k]; else process.env[k] = alt.env[k]; }
    }
  },
  "Fahrerübersicht: Teammitglieder erscheinen mit Team, auch ohne Rennen": () => {
    const P = require("../api/_lib/liga-profil");
    const T = require("../api/_lib/liga-teams");
    const team = { id: "aaaaaaaa", name: "NR", kuerzel: "NR", farbe: "rot", mitglieder: [{ discordId: "1", pid: "e".repeat(16), name: "Eva", nummer: 5 }] };
    const liste = P.fahrerListe([], new Map(), [], T.nachPid([team]));
    assert.deepStrictEqual(liste.map((f) => [f.name, f.ligaTeam]), [["Eva", { id: "aaaaaaaa", name: "NR", kuerzel: "NR", farbe: "rot", logo: "" }]]);
  },
  "Sichtung: Garage-61-Beitritt aus dem Profil nennt Name und Startnummer": () => {
    const S = require("../api/_lib/liga-sichtung");
    const k = S.teamBeitrittKarte("Lena Test", 46);
    assert.ok(k.fields.some((f) => f.value === "#46"));
    assert.ok(k.fields.some((f) => f.value === "Lena Test"));
  },
  "Extras: gültige Angaben werden übernommen": () => {
    assert.deepStrictEqual(A.pruefeExtras({ nummer: " 46 ", land: "DE", team: " Team X ", kanal: "https://www.twitch.tv/test", zeigeBild: true }), { nummer: 46, land: "DE", team: "Team X", kanal: "https://www.twitch.tv/test", zeigeBild: true, uebersicht: false });
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
  "Urteile: Korrektur und Aufhebung werden als solche gemeldet": () => {
    const report = { serieName: "DSRS", rennenTitel: "Runde 3", gegen: { name: "Tom Muster" } };
    const punkte = { art: "strafpunkte", punkte: 6 };
    const zeit = { art: "zeitstrafe", sekunden: 5 };
    const korrigiert = R.urteilKarte(report, zeit, punkte);
    assert.strictEqual(korrigiert.title, "Korrigiert: Urteil · DSRS · Runde 3");
    assert.deepStrictEqual(korrigiert.fields.map((f) => [f.name, f.value]), [["Fahrer", "Tom Muster"], ["Strafe", "5 Sekunden Zeitstrafe"], ["Bisher", "6 Strafpunkte"]]);
    const aufgehoben = R.urteilKarte(report, { art: "kein-vergehen" }, punkte);
    assert.strictEqual(aufgehoben.title, "Strafe aufgehoben · DSRS · Runde 3");
    assert.deepStrictEqual(aufgehoben.fields.map((f) => f.name), ["Fahrer", "Bisher"]);
    assert.strictEqual(R.urteilKarte(report, { art: "strafpunkte", punkte: 2 }, { art: "verwarnung" }).title, "Urteil · DSRS · Runde 3");
    assert.strictEqual(R.urteilKarte(report, { art: "kein-vergehen" }, { art: "verwarnung" }), null);
    assert.strictEqual(R.urteilKarte({ rennenTitel: "Runde 3", gegen: { name: "X" } }, { art: "dsq" }).title, "Urteil · Runde 3");
    assert.strictEqual(R.urteilKarte({ rennenTitel: "R", gegen: { name: "X", discordId: "123456789012345678" } }, { art: "dsq" }).fields[0].value, "<@123456789012345678>");
    assert.strictEqual(R.urteilKarte({ rennenTitel: "R", gegen: { name: "X", discordId: "<@&1>" } }, { art: "dsq" }).fields[0].value, "X");
  },
  "Discord testen: jeder Webhook meldet ok, fehlt oder fehler": async () => {
    const alt = { fetch: global.fetch, env: { ...process.env } };
    Object.assign(process.env, { LIGA_DISCORD_WEBHOOK_TEAM: "https://hook.example/team", LIGA_DISCORD_WEBHOOK: "https://hook.example/renntag" });
    delete process.env.LIGA_DISCORD_WEBHOOK_URTEILE;
    const gesendet = [];
    global.fetch = async (url, init) => { gesendet.push([url, JSON.parse(init.body)]); return { ok: !String(url).endsWith("renntag"), status: 404 }; };
    const fehler = console.error;
    console.error = () => {};
    try {
      const ergebnis = await R.webhooksTesten("Leitung", { Reports: { title: "Beispiel" }, Renntag: [{ title: "Heute Renntag: Runde 3", fields: [], footer: { text: "Session in iRacing" } }, { title: "Ergebnis: Runde 3" }] });
      assert.deepStrictEqual(ergebnis, [{ kanal: "Reports", stand: "ok" }, { kanal: "Renntag", stand: "fehler" }, { kanal: "Urteile", stand: "fehlt" }]);
      assert.strictEqual(gesendet.length, 2);
      assert.deepStrictEqual(gesendet[1][1].embeds.map((k) => k.title), ["Test · Heute Renntag: Runde 3", "Test · Ergebnis: Runde 3"]);
      assert.match(gesendet[1][1].embeds[0].footer.text, /^Session in iRacing\n.*Leitung/);
      assert.match(gesendet[1][1].embeds[1].footer.text, /Leitung/);
      assert.deepStrictEqual(gesendet[1][1].allowed_mentions, { parse: [] });
    } finally {
      console.error = fehler;
      global.fetch = alt.fetch;
      for (const k of ["LIGA_DISCORD_WEBHOOK_TEAM", "LIGA_DISCORD_WEBHOOK", "LIGA_DISCORD_WEBHOOK_URTEILE"]) { if (alt.env[k] === undefined) delete process.env[k]; else process.env[k] = alt.env[k]; }
    }
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
    assert.deepStrictEqual(Dc.soll("9", profil, [], serien), { i: true, f: false, n: "Max Mustermann" });
    assert.strictEqual(Dc.soll("9", profil, inSerie("e"), serien).n, "Max Mustermann");
    assert.ok(Dc.soll("9", { ...profil, iracingName: "Y".repeat(40) }, [], serien).n.length <= 32);
    assert.deepStrictEqual(Dc.soll("9", profil, inSerie("l"), serien), { i: true, f: true, n: "#31 Max Mustermann" });
    for (const id of ["e", "alt"]) assert.strictEqual(Dc.soll("9", profil, inSerie(id), serien).f, false);
    assert.strictEqual(Dc.soll("9", profil, [{ typ: "serie", discordId: "8", serieId: "l" }], serien).f, false);
    assert.ok(Dc.servername(999, "X".repeat(40)).length <= 32);
  },
  "Discord: nur nötige Schritte, ohne Liga verschwindet die Nummer": () => {
    const Dc = require("../api/_lib/liga-discord");
    const arten = (l) => l.map((s) => s.art);
    assert.deepStrictEqual(arten(Dc.schritte({}, { i: true, f: false, n: "Max" })), ["interessent", "name"]);
    assert.deepStrictEqual(Dc.schritte({ i: true, n: "Max" }, { i: true, f: false, n: "Max" }), []);
    assert.deepStrictEqual(arten(Dc.schritte({ i: true, n: "Max" }, { i: true, f: true, n: "#31 Max" })), ["fahrer", "name"]);
    assert.deepStrictEqual(Dc.schritte({ i: true, f: true, n: "#31 Max" }, { i: true, f: true, n: "#31 Max" }), []);
    assert.deepStrictEqual(arten(Dc.schritte({ i: true, f: true, n: "#31 Max" }, { i: true, f: true, n: "#7 Max" })), ["name"]);
    const raus = Dc.schritte({ i: true, f: true, n: "#31 Max" }, { i: true, f: false, n: "Max" });
    assert.deepStrictEqual(raus.map((s) => [s.art, s.weg, s.wert]), [["fahrer", true, undefined], ["name", undefined, "Max"]]);
    assert.deepStrictEqual(Dc.schritte({ i: true, f: false, n: "Max" }, { i: false, f: false, n: "" }), []);
  },
  "Discord: Abgleich ruft die richtigen Adressen und speichert nur Erfolge": async () => {
    const Dc = require("../api/_lib/liga-discord");
    const alt = { fetch: global.fetch, env: { ...process.env } };
    Object.assign(process.env, { DISCORD_BOT_TOKEN: "t", DISCORD_GUILD_ID: "100", LIGA_ROLLE_INTERESSENT: "1", LIGA_ROLLE_FAHRER: "2", SUPABASE_URL: "https://speicher.example", SUPABASE_SECRET_KEY: "k" });
    const aufrufe = [];
    const gespeichert = [];
    let lehneNameAb = true;
    // Gespeichertes Profil. Das Team hat der Fahrer inzwischen geändert, der Abgleich darf es nicht zurückdrehen.
    let zeile = { inhalt: JSON.stringify({ iracingName: "Max Mustermann", custId: "1", nummer: 31, team: "Neu" }), binaer: false, geaendert: "2026-11-10T10:00:00.000Z" };
    global.fetch = async (url, init = {}) => {
      if (String(url).startsWith("https://speicher.example")) {
        if (init.method === "PATCH") { zeile = { ...zeile, ...JSON.parse(init.body) }; gespeichert.push(JSON.parse(zeile.inhalt)); return { ok: true, json: async () => [{ pfad: "x" }] }; }
        return { ok: true, json: async () => [zeile] };
      }
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
      assert.strictEqual(gespeichert[0].team, "Neu", "Eine Änderung während des Abgleichs bleibt erhalten");
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
  "Discord: Wer den Server verlassen hat und zurückkommt, bekommt Rolle und Namen wieder": async () => {
    const Dc = require("../api/_lib/liga-discord");
    const alt = { fetch: global.fetch, env: { ...process.env } };
    Object.assign(process.env, { DISCORD_BOT_TOKEN: "t", DISCORD_GUILD_ID: "100", LIGA_ROLLE_INTERESSENT: "1", LIGA_ROLLE_FAHRER: "2", SUPABASE_URL: "https://speicher.example", SUPABASE_SECRET_KEY: "k" });
    const aufrufe = [];
    let seit = "2026-11-14T10:00:00.000000+00:00";
    let nick = "";
    let mitglied = true;
    let zeile = { inhalt: JSON.stringify({ iracingName: "Max Mustermann", custId: "1", nummer: 31 }), binaer: false, geaendert: "2026-11-10T10:00:00.000Z" };
    global.fetch = async (url, init = {}) => {
      if (String(url).startsWith("https://speicher.example")) {
        if (init.method === "PATCH") { zeile = { ...zeile, ...JSON.parse(init.body) }; return { ok: true, json: async () => [{ pfad: "x" }] }; }
        return { ok: true, json: async () => [zeile] };
      }
      aufrufe.push(`${init.method || "GET"} ${url}${init.body ? ` ${init.body}` : ""}`);
      if (!init.method) return mitglied ? { ok: true, status: 200, json: async () => ({ joined_at: seit, nick, roles: ["1"] }) } : { ok: false, status: 404 };
      return { ok: true, status: 204 };
    };
    const NAME = 'PATCH https://discord.com/api/v10/guilds/100/members/77 {"nick":"Max Mustermann"}';
    try {
      const alt = { iracingName: "Max Mustermann", custId: "1", nummer: 31, discord: { i: true, f: false, n: "Max Mustermann" } };
      // Nicht auf dem Server: nur die Prüfung, nichts wird gesetzt
      mitglied = false;
      assert.strictEqual(await Dc.abgleichen("77", alt, [], [], { sofort: true }), alt);
      assert.deepStrictEqual(aufrufe, ["GET https://discord.com/api/v10/guilds/100/members/77"]);
      // Älteres Profil ohne Datum, der Name passt: nur das Beitrittsdatum wird gemerkt
      aufrufe.length = 0;
      mitglied = true;
      nick = "Max Mustermann";
      const gemerkt = await Dc.abgleichen("77", alt, [], [], { sofort: true });
      assert.deepStrictEqual(aufrufe.length, 1);
      assert.deepStrictEqual(gemerkt.discord, { i: true, f: false, n: "Max Mustermann", seit });
      // Gleiches Datum: nichts zu tun, auch ein eigener Spitzname bleibt unangetastet
      aufrufe.length = 0;
      nick = "Maxi";
      assert.strictEqual(await Dc.abgleichen("77", gemerkt, [], [], { sofort: true }), gemerkt);
      assert.deepStrictEqual(aufrufe.length, 1);
      // Server verlassen und wieder beigetreten (das Onboarding hat die Rolle schon vergeben): neues Datum, alles neu gesetzt
      aufrufe.length = 0;
      seit = "2026-11-15T18:00:00.000000+00:00";
      nick = "";
      const danach = await Dc.abgleichen("77", gemerkt, [], [], { sofort: true });
      assert.deepStrictEqual(aufrufe.slice(1), ["PUT https://discord.com/api/v10/guilds/100/members/77/roles/1", NAME]);
      assert.deepStrictEqual(danach.discord, { seit, i: true, n: "Max Mustermann" });
      // Ohne "sofort" fragt der Seitenaufruf höchstens alle 10 Minuten
      aufrufe.length = 0;
      await Dc.abgleichen("77", danach, [], []);
      assert.deepStrictEqual(aufrufe, []);
    } finally {
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
  "Serie: Übertragung nur als Twitch- oder YouTube-Link": () => {
    const eingabe = { name: "Offen", typ: "event", ohneKlassen: true, punkte: "30", rennenGesamt: 1, gewerteteRennen: 1, anmeldeschlussMinuten: 60, punkteDanach: 0, bonusPole: 0, bonusSchnellsteRunde: 0, mindestRundenProzent: 75 };
    assert.strictEqual(D.pruefeSerie(eingabe).uebertragung, "");
    assert.strictEqual(D.pruefeSerie({ ...eingabe, uebertragung: " https://www.twitch.tv/darkline " }).uebertragung, "https://www.twitch.tv/darkline");
    assert.strictEqual(D.pruefeSerie({ ...eingabe, uebertragung: "https://youtu.be/abc" }).uebertragung, "https://youtu.be/abc");
    for (const link of ["http://twitch.tv/a", "https://twitch.tv.boese.de/a", "javascript:alert(1)", "nur text"]) assert.throws(() => D.pruefeSerie({ ...eingabe, uebertragung: link }), /Übertragung/);
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
    const m = { session: "rennen", zeitstempel: "12:34", stelle: "Runde 5, T3", beschreibung: "Er hat mich gedreht." };
    assert.deepStrictEqual(R.pruefeMeldung({ ...m, clip: "" }), { ...m, clip: "" }, "Clip ist freiwillig");
    assert.strictEqual(R.pruefeMeldung({ ...m, session: "qualifying", zeitstempel: "1.12.34" }).zeitstempel, "1:12:34", "Punkt statt Doppelpunkt geht auch");
    assert.throws(() => R.pruefeMeldung({ ...m, session: "" }), /Training, im Qualifying oder im Rennen/);
    assert.throws(() => R.pruefeMeldung({ ...m, zeitstempel: "" }), /Zeit im Replay/);
    assert.throws(() => R.pruefeMeldung({ ...m, zeitstempel: "Runde 5" }), /Zeit im Replay/);
    assert.throws(() => R.pruefeMeldung({ ...m, stelle: "" }), /wo es passiert/);
    assert.throws(() => R.pruefeMeldung({ ...m, beschreibung: "kurz" }), /Satz/);
    assert.throws(() => R.pruefeMeldung({ ...m, clip: "javascript:alert(1)" }), /https/);
    assert.strictEqual(R.vorfallOrt({ ...m }), "Rennen · Replay 12:34 · Runde 5, T3");
    assert.strictEqual(R.vorfallOrt({ stelle: "Runde 5" }), "Runde 5", "Ältere Reports ohne Session");
    assert.deepStrictEqual(R.reportKarte({ serie: "GT3", rennen: "R1", ...m, von: "A", gegen: "B" }).fields.map((f) => f.name), ["Serie", "Rennen", "Session", "Zeit im Replay", "Stelle", "Melder", "Gemeldet"]);
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
