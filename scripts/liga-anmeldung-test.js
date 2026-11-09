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

const tests = {
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
  "Einspruch nur für Beteiligte, einmal und innerhalb der Frist": () => {
    const in48h = 1000 + 48 * 3600e3;
    assert.strictEqual(R.sichtFahrer(ENTSCHIEDEN, [], "2", in48h, {}).kannEinspruch, true);
    assert.strictEqual(R.sichtFahrer(ENTSCHIEDEN, [], "2", in48h + 1, {}).kannEinspruch, false);
    assert.strictEqual(R.sichtFahrer(ENTSCHIEDEN, [], "3", 2000, {}).kannEinspruch, false);
    assert.strictEqual(R.sichtFahrer(ENTSCHIEDEN, [{ discordId: "2", text: "x" }], "2", 2000, {}).kannEinspruch, false);
    assert.strictEqual(R.sichtFahrer({ ...ENTSCHIEDEN, endgueltig: true }, [], "2", 2000, {}).kannEinspruch, false);
    assert.strictEqual(R.sichtFahrer(ENTSCHIEDEN, [], "2", 2 * 3600e3 + 1, { einspruchStunden: 1 }).kannEinspruch, false);
  },
  "Beteiligte erkennt das System": () => {
    assert.ok(R.beteiligt(REPORT, "1") && R.beteiligt(REPORT, "2") && !R.beteiligt(REPORT, "3"));
  },
  "Melden nur als Starter und innerhalb der Frist": () => {
    const start = 100 * 3600e3;
    const ende = start + 3600e3;
    const r = (o) => ({ id: "x", titel: "T", status: "geplant", serie: "s", start: iso(start), ende: iso(ende), ich: { status: "starter", discordId: "1" }, starter: [{ name: "Ich", discordId: "1" }, { name: "Du", discordId: "2" }], ...o });
    assert.deepStrictEqual(R.meldbareRennen([r()], ende, {})[0].fahrer, ["Du"]);
    assert.strictEqual(R.meldbareRennen([r()], ende + 24 * 3600e3, {}).length, 1);
    assert.strictEqual(R.meldbareRennen([r()], ende + 24 * 3600e3 + 1, {}).length, 0);
    assert.strictEqual(R.meldbareRennen([r()], start - 1, {}).length, 0);
    assert.strictEqual(R.meldbareRennen([r({ ich: { status: "warteliste", discordId: "1" } })], ende, {}).length, 0);
    assert.strictEqual(R.meldbareRennen([r({ status: "abgesagt" })], ende, {}).length, 0);
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

let fehler = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log(`ok    ${name}`); } catch (e) { fehler++; console.log(`FEHLER ${name}\n      ${e.message}`); }
}
console.log(`\n${Object.keys(tests).length - fehler} von ${Object.keys(tests).length} Tests bestanden`);
process.exit(fehler ? 1 : 0);
