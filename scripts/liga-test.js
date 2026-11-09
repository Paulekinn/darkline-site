// Prüft die Ligawertung. Aufruf: node scripts/liga-test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { leseErgebnis, pruefeRegeln, klasseFuer, berechneTabelle } = require("../assets/liga-wertung.js");

const REGELN = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "liga-regeln-test.json"), "utf8"));
const OHNE_BONUS = { ...REGELN, bonusPole: 0, bonusSchnellsteRunde: 0 };
const EINE_KLASSE = { ...OHNE_BONUS, kategorie: "", klassen: [{ id: "a", name: "A", min: 0, max: null }] };

// Baut eine Ergebnisdatei wie von iRacing. Die Reihenfolge der Zeilen ist der Zieleinlauf.
// Zeile: { c: iRacing-ID, ir, l: Runden, b: beste Runde, s: Startplatz ab 0, i: Incidents, out: Ausfallgrund }
function datei(id, tag, zeilen) {
  return {
    type: "event_result",
    data: {
      subsession_id: id,
      start_time: `2026-11-${String(tag).padStart(2, "0")}T19:00:00Z`,
      license_category: "Sports_Car",
      official_session: false,
      track: { track_name: "Teststrecke", config_name: "GP" },
      session_results: [
        { simsession_number: -1, simsession_type: 4, results: [] },
        {
          simsession_number: 0,
          simsession_type: 6,
          results: zeilen.map((z, p) => ({
            cust_id: z.c,
            display_name: z.n || `F${z.c}`,
            oldi_rating: z.ir === undefined ? 2000 : z.ir,
            finish_position: p,
            starting_position: z.s === undefined ? p : z.s,
            laps_complete: z.l === undefined ? 12 : z.l,
            best_lap_time: z.b === undefined ? 1000000 + p : z.b,
            incidents: z.i || 0,
            reason_out: z.out || "Running",
            class_interval: z.ab === undefined ? p * 10000 : z.ab,
            car_class_id: z.fz === undefined ? 2708 : z.fz,
            car_class_short_name: z.fzn === undefined ? "GT3 Class" : z.fzn,
          })),
        },
      ],
    },
  };
}
const lies = (d) => leseErgebnis(d);
const tabelle = (dateien, regeln, privat) => berechneTabelle(dateien.map(lies), regeln, privat);
const klasse = (t, id) => t.klassen.find((k) => k.id === id);
const fahrer = (k, name) => k.fahrer.find((f) => f.name === name);

// Fünf Fahrer in fester Reihenfolge, in jedem Rennen derselbe Zieleinlauf
const FUENF = [{ c: 1, n: "A" }, { c: 2, n: "B" }, { c: 3, n: "C" }, { c: 4, n: "D" }, { c: 5, n: "E" }];
const TITEL = { ...EINE_KLASSE, punkte: [25, 18, 15, 12, 10], punkteDanach: 0, rennenGesamt: 3, gewerteteRennen: 3 };
const rennenMit = (anzahl, feld) => Array.from({ length: anzahl }, (_, i) => datei(i + 1, i + 1, feld));

const OHNE_KATEGORIE = { ...OHNE_BONUS, kategorie: "" };

const tests = {
  "Gesamtwertung: Punkte nach Zieleinlauf statt Summe der Klassenpunkte": () => {
    const t = tabelle([datei(1, 1, [
      { c: 1, n: "Pro1", ir: 3000 }, { c: 2, n: "Pro2", ir: 2900 }, { c: 3, n: "Am1", ir: 1000 }, { c: 4, n: "Am2", ir: 900 },
    ])], OHNE_KATEGORIE);
    const [g] = t.gesamt;
    assert.strictEqual(g.name, "Gesamt");
    assert.deepStrictEqual(g.fahrer.map((f) => [f.name, f.pos, f.punkte]), [["Pro1", 1, 30], ["Pro2", 2, 26], ["Am1", 3, 23], ["Am2", 4, 21]]);
    assert.strictEqual(fahrer(klasse(t, "am"), "Am1").punkte, 30);
    assert.deepStrictEqual(g.fahrer[2].klasse, { id: "am", name: "Am" });
    assert.strictEqual(g.fahrer[2].klassenPos, 1);
    assert.strictEqual(g.fahrer[3].klassenPos, 2);
  },
  "Gesamtwertung: Bonus gilt für die ganze Fahrzeugklasse": () => {
    const t = tabelle([datei(1, 1, [{ c: 1, n: "Pro", ir: 3000, s: 1, b: 200 }, { c: 2, n: "Am", ir: 1000, s: 0, b: 100 }])], { ...REGELN, kategorie: "" });
    const [g] = t.gesamt;
    assert.strictEqual(fahrer(g, "Pro").punkte, 30);
    assert.strictEqual(fahrer(g, "Am").punkte, 28);
    assert.strictEqual(fahrer(klasse(t, "pro"), "Pro").punkte, 32);
  },
  "Gesamtwertung: je Fahrzeugklasse getrennt, nie gemischt": () => {
    const t = tabelle([datei(1, 1, [
      { c: 1, n: "A", ir: 3000, fz: 1, fzn: "GTP" }, { c: 2, n: "B", ir: 1000, fz: 1, fzn: "GTP" }, { c: 3, n: "C", ir: 3000 }, { c: 4, n: "D", ir: 1000 },
    ])], OHNE_KATEGORIE);
    assert.deepStrictEqual(t.gesamt.map((g) => g.name), ["GTP Gesamt", "GT3 Gesamt"]);
    assert.deepStrictEqual(t.gesamt[1].fahrer.map((f) => [f.name, f.punkte]), [["C", 30], ["D", 26]]);
  },
  "Gesamtwertung: Strafen und Streichergebnisse gelten auch hier": () => {
    const privat = { strafen: [{ rennen: "1", cust: "1", punkte: 5 }], disqualifikationen: [{ rennen: "2", cust: "2" }] };
    const t = tabelle([datei(1, 1, [{ c: 1, n: "A", ir: 3000 }, { c: 2, n: "B", ir: 1000 }]), datei(2, 2, [{ c: 1, n: "A", ir: 3000 }, { c: 2, n: "B", ir: 1000 }])], { ...OHNE_KATEGORIE, rennenGesamt: 2, gewerteteRennen: 1 }, privat);
    const [g] = t.gesamt;
    assert.strictEqual(fahrer(g, "A").punkte, 25);
    assert.strictEqual(fahrer(g, "A").strafpunkte, 5);
    assert.strictEqual(fahrer(g, "B").rennen[1].status, "DSQ");
    assert.strictEqual(fahrer(g, "B").punkte, 26);
  },
  "Gesamtwertung: entfällt, wenn es nur eine Fahrerklasse gibt": () => {
    assert.deepStrictEqual(tabelle([datei(1, 1, FUENF)], EINE_KLASSE).gesamt, []);
  },
  "Rennergebnis: enthält Start, Ziel, Abstand und beide Wertungen": () => {
    const [e] = tabelle([datei(1, 1, [
      { c: 1, n: "A", ir: 3000, s: 1, b: 1000, i: 2, ab: 0 },
      { c: 2, n: "B", ir: 1000, s: 0, b: 900, i: 1, ab: 25000 },
      { c: 3, n: "C", ir: 900, s: 2, b: 1100, ab: -1, l: 11 },
    ])], OHNE_KATEGORIE).rennen[0].ergebnisse;
    assert.strictEqual(e.fahrzeugklasse, "GT3");
    const [a, b, c] = e.zeilen;
    assert.deepStrictEqual([a.name, a.start, a.ziel, a.abstand, a.incidents], ["A", 2, 1, 0, 2]);
    assert.deepStrictEqual([b.name, b.start, b.ziel, b.abstand, b.besteRunde], ["B", 1, 2, 25000, 900]);
    assert.strictEqual(b.gesamt.punkte, 26);
    assert.deepStrictEqual([b.wertung.platz, b.wertung.punkte], [1, 30]);
    assert.strictEqual(b.klasse, "am");
    assert.deepStrictEqual([c.abstand, c.runden], [null, 11]);
    assert.strictEqual(c.klassenPos, 2);
  },
  "Rennergebnis: Zeitstrafe verschiebt Platz und Abstand": () => {
    const privat = { zeitstrafen: [{ rennen: "1", cust: "1", sekunden: 5 }] };
    const [e] = tabelle([datei(1, 1, [{ c: 1, n: "A", ab: 0 }, { c: 2, n: "B", ab: 10000 }])], EINE_KLASSE, privat).rennen[0].ergebnisse;
    assert.deepStrictEqual(e.zeilen.map((z) => [z.name, z.ziel, z.abstand, z.zeitstrafe]), [["B", 1, 0, 0], ["A", 2, 40000, 5]]);
  },
  "Rennergebnis: Disqualifizierte stehen am Ende ohne Abstand": () => {
    const [e] = tabelle([datei(1, 1, [{ c: 1, n: "A", out: "Disqualified", ab: 0 }, { c: 2, n: "B", ab: 10000 }])], EINE_KLASSE).rennen[0].ergebnisse;
    assert.deepStrictEqual(e.zeilen.map((z) => [z.name, z.ziel, z.abstand, z.gesamt.status]), [["B", 1, 0, "OK"], ["A", 2, null, "DSQ"]]);
  },
  "Gesamtwertung und Rennergebnis enthalten keine iRacing-IDs": () => {
    const text = JSON.stringify(tabelle([datei(1, 1, [{ c: 777123, n: "A", ir: 3000 }, { c: 888456, n: "B", ir: 1000 }])], OHNE_KATEGORIE));
    assert.ok(!text.includes("777123") && !text.includes("888456") && !text.includes('"cust"'));
  },
  "Titelkampf: Matchball und nötige Plätze stimmen rechnerisch": () => {
    const k = tabelle(rennenMit(2, FUENF), TITEL).klassen[0];
    assert.deepStrictEqual(k.fahrer.map((f) => f.punkte), [50, 36, 30, 24, 20]);
    assert.strictEqual(fahrer(k, "A").titel.text, "Titel mit P4 sicher");
    assert.strictEqual(fahrer(k, "B").titel.text, "Braucht mindestens P3");
    assert.strictEqual(fahrer(k, "C").titel.text, "Braucht einen Sieg");
    assert.strictEqual(fahrer(k, "D").titel.status, "raus");
    assert.strictEqual(fahrer(k, "B").titel.maxEnde, 61);
  },
  "Titelkampf: Streichergebnis kann den Titel vorzeitig entscheiden": () => {
    const t = tabelle(rennenMit(3, FUENF.slice(0, 2)), { ...TITEL, rennenGesamt: 4, gewerteteRennen: 3 });
    assert.strictEqual(t.restRennen, 1);
    assert.strictEqual(fahrer(t.klassen[0], "A").titel.status, "meister");
    assert.strictEqual(fahrer(t.klassen[0], "B").titel.maxEnde, 61);
  },
  "Titelkampf: ohne Streichergebnis ist derselbe Stand noch nicht entschieden": () => {
    const t = tabelle(rennenMit(3, FUENF.slice(0, 2)), { ...TITEL, rennenGesamt: 4, gewerteteRennen: 4 });
    assert.notStrictEqual(fahrer(t.klassen[0], "A").titel.status, "meister");
  },
  "Titelkampf: Punktgleichheit gilt nicht als entschieden": () => {
    // A hat 50 Punkte, B kann mit zwei Siegen genau 50 erreichen.
    const k = tabelle(rennenMit(2, FUENF.slice(0, 2)), { ...TITEL, punkte: [25, 0], rennenGesamt: 4, gewerteteRennen: 4 }).klassen[0];
    assert.strictEqual(fahrer(k, "A").punkte, 50);
    assert.strictEqual(fahrer(k, "B").titel.maxEnde, 50);
    assert.notStrictEqual(fahrer(k, "A").titel.status, "meister");
    assert.notStrictEqual(fahrer(k, "B").titel.status, "raus");
  },
  "Titelkampf: ein neuer Fahrer wird mitgerechnet": () => {
    const k = tabelle(rennenMit(1, FUENF.slice(0, 1)), { ...TITEL, rennenGesamt: 4, gewerteteRennen: 4 }).klassen[0];
    assert.notStrictEqual(k.fahrer[0].titel.status, "meister");
  },
  "Titelkampf: wer alles gewinnt, hat es in der eigenen Hand": () => {
    const k = tabelle(rennenMit(1, FUENF.slice(0, 2)), { ...TITEL, rennenGesamt: 4, gewerteteRennen: 4 }).klassen[0];
    assert.strictEqual(fahrer(k, "A").titel.status, "eigen");
    assert.strictEqual(fahrer(k, "B").titel.status, "eigen");
  },
  "Titelkampf: am Saisonende steht der Meister fest": () => {
    const t = tabelle(rennenMit(3, FUENF), TITEL);
    assert.strictEqual(t.restRennen, 0);
    assert.strictEqual(fahrer(t.klassen[0], "A").titel.text, "Meister");
    assert.strictEqual(fahrer(t.klassen[0], "B").titel.text, "");
    assert.strictEqual(fahrer(t.klassen[0], "B").titel.maxEnde, 54);
  },
  "Titelkampf: Strafpunkte zählen mit": () => {
    const privat = { strafen: [{ rennen: "1", cust: "1", punkte: 20 }] };
    const k = tabelle(rennenMit(2, FUENF), TITEL, privat).klassen[0];
    assert.strictEqual(fahrer(k, "A").punkte, 30);
    assert.strictEqual(fahrer(k, "A").titel.maxEnde, 55);
  },
  "Fahrerkarte: Speed folgt dem Abstand zur schnellsten Runde der Fahrzeugklasse": () => {
    const k = tabelle([datei(1, 1, [{ c: 1, n: "A", b: 1000000 }, { c: 2, n: "B", b: 1010000 }])], EINE_KLASSE).klassen[0];
    assert.strictEqual(fahrer(k, "A").karte.speed, 99);
    assert.strictEqual(fahrer(k, "B").karte.speed, 86);
  },
  "Fahrerkarte: Sauberkeit folgt den Incidents je Runde und fällt nie unter 40": () => {
    const k = tabelle([datei(1, 1, [{ c: 1, n: "A", i: 1 }, { c: 2, n: "B", i: 12 }])], EINE_KLASSE).klassen[0];
    assert.strictEqual(fahrer(k, "A").karte.sauberkeit, 89);
    assert.strictEqual(fahrer(k, "B").karte.sauberkeit, 40);
  },
  "Fahrerkarte: Disqualifikation kostet Sauberkeit": () => {
    const k = tabelle([datei(1, 1, [{ c: 1, n: "A" }, { c: 2, n: "B", out: "Disqualified" }, { c: 3, n: "C" }])], EINE_KLASSE).klassen[0];
    assert.strictEqual(fahrer(k, "A").karte.sauberkeit, 99);
    assert.strictEqual(fahrer(k, "B").karte.sauberkeit, 94);
  },
  "Fahrerkarte: das Rating erscheint erst ab drei Rennen": () => {
    assert.strictEqual(tabelle(rennenMit(2, FUENF), TITEL).klassen[0].fahrer[0].karte.rating, null);
    const karte = tabelle(rennenMit(3, FUENF), TITEL).klassen[0].fahrer[0].karte;
    assert.ok(karte.rating >= 40 && karte.rating <= 99);
    assert.strictEqual(karte.konstanz, 99);
    assert.strictEqual(karte.podien, 3);
  },
  "Fahrerkarte: Abzeichen werden korrekt vergeben": () => {
    const k = tabelle([datei(1, 1, [{ c: 1, n: "A", s: 0, b: 900000 }, { c: 2, n: "B", s: 7 }, { c: 3, n: "C", s: 1 }, { c: 4, n: "D", s: 2 }, { c: 5, n: "E", s: 3 }, { c: 6, n: "F", s: 4 }, { c: 7, n: "G", s: 5 }, { c: 8, n: "H", s: 6 }])], { ...EINE_KLASSE, rennenGesamt: 8 }).klassen[0];
    const texte = (n) => fahrer(k, n).karte.abzeichen.map((a) => a.text);
    assert.ok(texte("A").includes("Hattrick"));
    assert.ok(texte("B").includes("Comeback +6"));
    assert.ok(!texte("C").some((t) => t.startsWith("Comeback")));
  },
  "Fahrerkarte: ein ausgelassenes Rennen beendet die Serie und Immer im Ziel": () => {
    const k = tabelle([datei(1, 1, FUENF), datei(2, 2, FUENF), datei(3, 3, FUENF.slice(1)), datei(4, 4, FUENF)], { ...TITEL, rennenGesamt: 8, gewerteteRennen: 8 }).klassen[0];
    const a = fahrer(k, "A").karte.abzeichen.map((x) => x.text);
    assert.ok(!a.includes("3 Siege in Folge"));
    assert.ok(!a.includes("Immer im Ziel"));
    assert.ok(fahrer(k, "C").karte.abzeichen.some((x) => x.text === "4× Podest in Folge"));
    assert.ok(fahrer(k, "B").karte.abzeichen.some((x) => x.text === "Immer im Ziel"));
  },
  "Rennbericht: Kategorien je Fahrzeugklasse": () => {
    const t = tabelle([datei(1, 1, [
      { c: 1, n: "A", fz: 1, fzn: "GTP", s: 1, b: 900000, i: 4 },
      { c: 2, n: "B", fz: 1, fzn: "GTP", s: 0, b: 910000, i: 0 },
      { c: 3, n: "C", s: 4, b: 1000000, i: 2 },
      { c: 4, n: "D", s: 2, b: 990000, i: 1 },
      { c: 5, n: "E", s: 3, b: 995000, i: 1 },
    ])], EINE_KLASSE);
    const [gtp, gt3] = t.rennen[0].bericht;
    assert.deepStrictEqual(gtp.podium, ["A", "B"]);
    assert.strictEqual(gtp.starter, 2);
    assert.deepStrictEqual(gtp.aufholer, { name: "A", plaetze: 1 });
    assert.deepStrictEqual(gtp.schnellste, { name: "A", zeit: 900000 });
    assert.deepStrictEqual(gtp.sauberster, { name: "B", incidents: 0 });
    assert.strictEqual(gt3.fahrzeugklasse, "GT3");
    assert.deepStrictEqual(gt3.aufholer, { name: "C", plaetze: 2 });
    assert.deepStrictEqual(gt3.schnellste, { name: "D", zeit: 990000 });
    assert.deepStrictEqual(gt3.sauberster, { name: "D", incidents: 1 });
  },
  "Rennbericht: Disqualifizierte und Ausfälle bekommen keine Auszeichnung": () => {
    const b = tabelle([datei(1, 1, [
      { c: 1, n: "A", s: 1, b: 1000000, i: 3 },
      { c: 2, n: "B", s: 2, b: 900000, i: 0, out: "Disqualified" },
      { c: 3, n: "C", s: 3, b: 1010000, i: 2, l: 1 },
      { c: 4, n: "D", s: 0, b: 1020000, i: 5 },
    ])], EINE_KLASSE).rennen[0].bericht[0];
    assert.deepStrictEqual(b.podium, ["A", "D"]);
    assert.strictEqual(b.schnellste.name, "A");
    assert.strictEqual(b.sauberster.name, "A");
    assert.strictEqual(b.aufholer.name, "A");
  },
  "Rennbericht: eine Zeitstrafe ändert den Sieger": () => {
    const privat = { zeitstrafen: [{ rennen: "1", cust: "1", sekunden: 5 }] };
    const b = tabelle([datei(1, 1, [{ c: 1, n: "A", ab: 0 }, { c: 2, n: "B", ab: 10000 }])], EINE_KLASSE, privat).rennen[0].bericht[0];
    assert.deepStrictEqual(b.podium, ["B", "A"]);
  },
  "Rennbericht: ohne Platzgewinn gibt es keinen Aufholer": () => {
    const b = tabelle([datei(1, 1, FUENF)], EINE_KLASSE).rennen[0].bericht[0];
    assert.strictEqual(b.aufholer, null);
  },
  "Karten und Berichte enthalten keine iRacing-IDs": () => {
    const t = tabelle(rennenMit(3, [{ c: 777123, n: "A" }, { c: 888456, n: "B" }]), TITEL);
    const text = JSON.stringify(t);
    assert.ok(!text.includes("777123") && !text.includes("888456"));
    assert.ok(!text.includes('"cust"'));
  },
  "Platzierungen aus der Datei beginnen bei 1 statt 0": () => {
    const r = lies(datei(1, 1, [{ c: 1 }, { c: 2 }]));
    assert.deepStrictEqual(r.fahrer.map((f) => f.gesamt), [1, 2]);
    assert.strictEqual(r.fahrer[0].start, 1);
  },
  "Datei ohne Platz 0 wird abgelehnt": () => {
    const d = datei(1, 1, [{ c: 1 }]);
    d.data.session_results[1].results[0].finish_position = 1;
    assert.throws(() => lies(d), /Unerwartete Platzierungen/);
  },
  "Klassengrenzen sind lückenlos": () => {
    const k = REGELN.klassen;
    assert.strictEqual(klasseFuer(0, k).id, "am");
    assert.strictEqual(klasseFuer(1499, k).id, "am");
    assert.strictEqual(klasseFuer(1500, k).id, "proam");
    assert.strictEqual(klasseFuer(2499, k).id, "proam");
    assert.strictEqual(klasseFuer(2500, k).id, "pro");
    assert.strictEqual(klasseFuer(9000, k).id, "pro");
  },
  "Regeln mit Lücke werden abgelehnt": () => {
    assert.throws(() => pruefeRegeln({ ...REGELN, klassen: [{ id: "a", name: "A", min: 0, max: 1000 }, { id: "b", name: "B", min: 1002, max: null }] }), /Lücke/);
  },
  "Platz und Bonus gelten je Klasse": () => {
    const t = tabelle([datei(1, 1, [
      { c: 1, n: "A", ir: 3000, s: 1, b: 100 },
      { c: 2, n: "B", ir: 1000, s: 2, b: 300 },
      { c: 3, n: "C", ir: 2000, s: 3, b: 200 },
      { c: 4, n: "D", ir: 2600, s: 0, b: 150 },
      { c: 5, n: "E", ir: 1200, s: 4, b: 250 },
    ])], REGELN);
    assert.strictEqual(fahrer(klasse(t, "pro"), "A").punkte, 31); // P1 30 + schnellste Runde
    assert.strictEqual(fahrer(klasse(t, "pro"), "D").punkte, 27); // P2 26 + Pole
    assert.strictEqual(fahrer(klasse(t, "proam"), "C").punkte, 32); // P1 30 + beide Boni
    assert.strictEqual(fahrer(klasse(t, "am"), "B").punkte, 31); // P1 30 + Pole
    assert.strictEqual(fahrer(klasse(t, "am"), "E").punkte, 27); // P2 26 + schnellste Runde
  },
  "75-Prozent-Grenze, Bonus verfällt bei Nichtwertung": () => {
    const t = tabelle([datei(1, 1, [{ c: 1, n: "X", l: 12, s: 1, b: 200 }, { c: 2, n: "Y", l: 9, s: 2, b: 300 }, { c: 3, n: "Z", l: 8, s: 0, b: 100 }])], { ...REGELN, kategorie: "", klassen: EINE_KLASSE.klassen });
    const k = t.klassen[0];
    assert.strictEqual(fahrer(k, "X").punkte, 30);
    assert.strictEqual(fahrer(k, "Y").punkte, 26);
    assert.strictEqual(fahrer(k, "Y").rennen[0].platz, 2);
    assert.strictEqual(fahrer(k, "Z").punkte, 0);
    assert.strictEqual(fahrer(k, "Z").rennen[0].status, "DNF");
  },
  "Disqualifizierter Fahrer bekommt nichts und zählt nicht als Sieger": () => {
    const t = tabelle([datei(1, 1, [{ c: 1, n: "D", out: "Disqualified" }, { c: 2, n: "W" }])], EINE_KLASSE);
    const k = t.klassen[0];
    assert.strictEqual(fahrer(k, "D").punkte, 0);
    assert.strictEqual(fahrer(k, "D").rennen[0].status, "DSQ");
    assert.strictEqual(fahrer(k, "W").rennen[0].platz, 1);
    assert.strictEqual(fahrer(k, "W").punkte, 30);
  },
  "Schlechtestes Rennen wird gestrichen, Strafen bleiben": () => {
    const regeln = { ...EINE_KLASSE, rennenGesamt: 3, gewerteteRennen: 2 };
    const t = tabelle([
      datei(1, 1, [{ c: 1, n: "K" }, { c: 2 }, { c: 3 }]),
      datei(2, 2, [{ c: 2 }, { c: 3 }, { c: 1, n: "K" }]),
      datei(3, 3, [{ c: 2 }, { c: 1, n: "K" }, { c: 3 }]),
    ], regeln, { strafen: [{ rennen: 2, cust: 1, punkte: 4 }] });
    const k = fahrer(t.klassen[0], "K");
    assert.strictEqual(k.rennen[1].gestrichen, true);
    assert.strictEqual(k.strafpunkte, 4);
    assert.strictEqual(k.punkte, 30 + 26 - 4);
  },
  "Gleichstand: mehr Siege gehen vor": () => {
    const t = tabelle([
      datei(1, 1, [{ c: 1, n: "A" }, { c: 2, n: "B" }, { c: 3 }, { c: 4 }, { c: 5 }]),
      datei(2, 2, [{ c: 3 }, { c: 4 }, { c: 2, n: "B" }, { c: 5 }, { c: 1, n: "A" }]),
    ], EINE_KLASSE);
    const k = t.klassen[0];
    assert.strictEqual(fahrer(k, "A").punkte, 49);
    assert.strictEqual(fahrer(k, "B").punkte, 49);
    assert.ok(fahrer(k, "A").pos < fahrer(k, "B").pos);
  },
  "Gleichstand: zuletzt entscheidet das jüngste Rennen": () => {
    const t = tabelle([datei(1, 1, [{ c: 1, n: "P" }, { c: 2, n: "Q" }]), datei(2, 2, [{ c: 2, n: "Q" }, { c: 1, n: "P" }])], EINE_KLASSE);
    assert.deepStrictEqual(t.klassen[0].fahrer.map((f) => f.name), ["Q", "P"]);
  },
  "Klasse bleibt die ganze Saison gleich": () => {
    const t = tabelle([datei(1, 1, [{ c: 1, n: "R", ir: 1499 }]), datei(2, 2, [{ c: 1, n: "R", ir: 2600 }])], REGELN);
    assert.strictEqual(fahrer(klasse(t, "am"), "R").irating, 1499);
    assert.strictEqual(klasse(t, "pro").fahrer.length, 0);
  },
  "Manuelle Einstufung hat Vorrang": () => {
    const t = tabelle([datei(1, 1, [{ c: 1, n: "S", ir: 1000 }])], REGELN, { einstufung: { 1: "pro" } });
    assert.ok(fahrer(klasse(t, "pro"), "S"));
  },
  "Multiclass: Wertung je Fahrzeugklasse und iRating-Klasse": () => {
    const GTP = { fz: 10, fzn: "GTP" };
    const GT3 = { fz: 20, fzn: "IMSA23" };
    const t = tabelle([datei(1, 1, [
      { c: 1, n: "G1", ir: 2000, ...GTP },
      { c: 2, n: "G2", ir: 1000, ...GTP },
      { c: 3, n: "T1", ir: 2000, ...GT3 },
      { c: 4, n: "T2", ir: 1000, ...GT3 },
      { c: 5, n: "T3", ir: 2100, ...GT3 },
    ])], OHNE_BONUS);
    assert.deepStrictEqual(t.klassen.map((k) => k.id), ["10-pro", "10-proam", "10-am", "20-pro", "20-proam", "20-am"]);
    assert.strictEqual(klasse(t, "20-proam").name, "GT3 Pro-Am");
    assert.strictEqual(fahrer(klasse(t, "10-proam"), "G1").punkte, 30);
    assert.strictEqual(fahrer(klasse(t, "10-am"), "G2").punkte, 30);
    assert.strictEqual(fahrer(klasse(t, "20-proam"), "T1").punkte, 30); // Sieger trotz GTP davor
    assert.strictEqual(fahrer(klasse(t, "20-proam"), "T3").punkte, 26);
    assert.strictEqual(fahrer(klasse(t, "20-am"), "T2").punkte, 30);
  },
  "Multiclass: Bonus und 75 Prozent gelten je Gruppe": () => {
    const GTP = { fz: 10, fzn: "GTP", ir: 2000 };
    const GT3 = { fz: 20, fzn: "GT3", ir: 2000 };
    const t = tabelle([datei(1, 1, [
      { c: 1, n: "G", l: 20, s: 0, b: 100, ...GTP },
      { c: 2, n: "T", l: 14, s: 1, b: 200, ...GT3 },
    ])], REGELN);
    assert.strictEqual(fahrer(klasse(t, "20-proam"), "T").rennen[0].status, "OK");
    assert.strictEqual(fahrer(klasse(t, "20-proam"), "T").punkte, 32); // P1, Pole und schnellste Runde der eigenen Gruppe
  },
  "Multiclass: Wechsel der Fahrzeugklasse wird getrennt gewertet und gemeldet": () => {
    const t = tabelle([
      datei(1, 1, [{ c: 1, n: "W", fz: 10, fzn: "GTP" }, { c: 2, n: "X", fz: 20, fzn: "GT3" }]),
      datei(2, 2, [{ c: 2, n: "X", fz: 20, fzn: "GT3" }, { c: 1, n: "W", fz: 20, fzn: "GT3" }]),
    ], OHNE_BONUS);
    assert.strictEqual(fahrer(klasse(t, "10-proam"), "W").punkte, 30);
    assert.strictEqual(fahrer(klasse(t, "10-proam"), "W").rennen[1], null);
    assert.strictEqual(fahrer(klasse(t, "20-proam"), "W").punkte, 26);
    assert.strictEqual(fahrer(klasse(t, "20-proam"), "W").rennen[0], null);
    assert.ok(t.warnungen.some((w) => w.includes("2 Fahrzeugklassen")));
  },
  "Eine Fahrzeugklasse behält die einfachen Namen": () => {
    const t = tabelle([datei(1, 1, [{ c: 1, n: "E" }])], OHNE_BONUS);
    assert.deepStrictEqual(t.klassen.map((k) => k.name), ["Pro", "Pro-Am", "Am"]);
    assert.strictEqual(t.klassen[0].fahrzeugklasse, "GT3");
  },
  "Zeitstrafe verschiebt den Fahrer nach Abstand": () => {
    const t = tabelle([datei(1, 1, [{ c: 1, n: "A", ab: 0 }, { c: 2, n: "B", ab: 30000 }, { c: 3, n: "C", ab: 50000 }])], EINE_KLASSE, { zeitstrafen: [{ rennen: 1, cust: 1, sekunden: 4 }] });
    const k = t.klassen[0];
    assert.deepStrictEqual(["B", "A", "C"].map((n) => fahrer(k, n).punkte), [30, 26, 23]);
    assert.strictEqual(fahrer(k, "A").rennen[0].zeitstrafe, 4);
    assert.strictEqual(fahrer(k, "B").rennen[0].zeitstrafe, 0);
  },
  "Kleine Zeitstrafe ändert die Reihenfolge nicht": () => {
    const t = tabelle([datei(1, 1, [{ c: 1, n: "A", ab: 0 }, { c: 2, n: "B", ab: 30000 }])], EINE_KLASSE, { zeitstrafen: [{ rennen: 1, cust: 1, sekunden: 2 }] });
    assert.strictEqual(fahrer(t.klassen[0], "A").punkte, 30);
  },
  "Zeitstrafe bei Überrundeten wird gemeldet und nicht angewendet": () => {
    const t = tabelle([datei(1, 1, [{ c: 1, n: "A", ab: 0 }, { c: 2, n: "B", ab: 30000 }, { c: 3, n: "L", ab: -1, l: 11 }])], EINE_KLASSE, { zeitstrafen: [{ rennen: 1, cust: 3, sekunden: 30 }] });
    assert.strictEqual(fahrer(t.klassen[0], "L").punkte, 23);
    assert.ok(t.warnungen.some((w) => w.includes("Führungsrunde")));
  },
  "Überrundeter bleibt hinter der Führungsrunde, auch bei Zeitstrafe davor": () => {
    const t = tabelle([datei(1, 1, [{ c: 1, n: "A", ab: 0 }, { c: 2, n: "L", ab: -1, l: 11 }])], EINE_KLASSE, { zeitstrafen: [{ rennen: 1, cust: 1, sekunden: 500 }] });
    assert.strictEqual(fahrer(t.klassen[0], "A").punkte, 30);
    assert.strictEqual(fahrer(t.klassen[0], "L").punkte, 26);
  },
  "Multiclass: Zeitstrafe wirkt nur in der eigenen Fahrzeugklasse": () => {
    const GTP = { fz: 10, fzn: "GTP" };
    const GT3 = { fz: 20, fzn: "GT3" };
    const t = tabelle([datei(1, 1, [{ c: 1, n: "G1", ab: 0, ...GTP }, { c: 2, n: "T1", ab: 0, ...GT3 }, { c: 3, n: "G2", ab: 10000, ...GTP }, { c: 4, n: "T2", ab: 10000, ...GT3 }])], OHNE_BONUS, { zeitstrafen: [{ rennen: 1, cust: 1, sekunden: 5 }] });
    assert.strictEqual(fahrer(klasse(t, "10-proam"), "G2").punkte, 30);
    assert.strictEqual(fahrer(klasse(t, "10-proam"), "G1").punkte, 26);
    assert.strictEqual(fahrer(klasse(t, "20-proam"), "T1").punkte, 30);
  },
  "Disqualifikation durch die Rennleitung": () => {
    const t = tabelle([datei(1, 1, [{ c: 1, n: "A" }, { c: 2, n: "B" }])], EINE_KLASSE, { disqualifikationen: [{ rennen: 1, cust: 1 }] });
    const k = t.klassen[0];
    assert.strictEqual(fahrer(k, "A").rennen[0].status, "DSQ");
    assert.strictEqual(fahrer(k, "A").punkte, 0);
    assert.strictEqual(fahrer(k, "B").punkte, 30);
  },
  "Strafen anderer Rennen haben keine Wirkung": () => {
    const t = tabelle([datei(1, 1, [{ c: 1, n: "A", ab: 0 }, { c: 2, n: "B", ab: 10000 }])], EINE_KLASSE, { zeitstrafen: [{ rennen: 99, cust: 1, sekunden: 50 }], disqualifikationen: [{ rennen: 99, cust: 1 }] });
    assert.strictEqual(fahrer(t.klassen[0], "A").punkte, 30);
  },
  "Rennen werden nach Datum sortiert": () => {
    const t = tabelle([datei(2, 9, [{ c: 1, n: "T" }]), datei(1, 2, [{ c: 1, n: "T" }])], EINE_KLASSE);
    assert.deepStrictEqual(t.rennen.map((r) => r.start.slice(8, 10)), ["02", "09"]);
  },
  "Doppeltes Rennen wird abgelehnt": () => {
    assert.throws(() => tabelle([datei(1, 1, [{ c: 1 }]), datei(1, 2, [{ c: 1 }])], EINE_KLASSE), /doppelt/);
  },
  "Teamrennen wird abgelehnt": () => {
    assert.throws(() => lies(datei(1, 1, [{ c: -5 }])), /Teamrennen/);
  },
  "Öffentliche Tabelle enthält keine iRacing-IDs": () => {
    const t = tabelle([datei(987654321, 1, [{ c: 7654321, n: "V" }])], EINE_KLASSE);
    assert.ok(!JSON.stringify(t).includes("7654321"));
  },
  "Anonymisierte echte Datei": () => {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "liga-eventresult-anonym.json"), "utf8"));
    const r = lies(d);
    assert.strictEqual(r.fahrer.length, 19);
    assert.strictEqual(r.fahrer[0].name, "Fahrer 01");
    assert.strictEqual(r.fahrer[0].gesamt, 1);
    const t = berechneTabelle([r], { ...REGELN, kategorie: "Sports_Car" });
    const k = klasse(t, "proam");
    assert.strictEqual(k.fahrer.length, 19);
    assert.strictEqual(k.fahrer[0].name, "Fahrer 01");
    assert.ok(k.fahrer[0].punkte >= 30);
    assert.strictEqual(fahrer(k, "Fahrer 19").rennen[0].status, "DNF");
    assert.strictEqual(fahrer(k, "Fahrer 19").punkte, 0);
  },
};

let fehler = 0;
for (const [name, fn] of Object.entries(tests)) {
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (e) {
    fehler++;
    console.log(`FEHLER ${name}\n      ${e.message}`);
  }
}
console.log(`\n${Object.keys(tests).length - fehler} von ${Object.keys(tests).length} Tests bestanden`);
process.exit(fehler ? 1 : 0);
