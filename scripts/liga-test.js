// Prüft die Ligawertung. Aufruf: node scripts/liga-test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { leseErgebnis, pruefeRegeln, klasseFuer, berechneTabelle } = require("../assets/liga-wertung.js");

const REGELN = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "liga-regeln-test.json"), "utf8"));
const OHNE_BONUS = { ...REGELN, bonusPole: 0, bonusSchnellsteRunde: 0 };
const EINE_KLASSE = { ...OHNE_BONUS, kategorie: "", klassen: [{ id: "a", name: "A", min: 0, max: null }] };

// Baut eine Ergebnisdatei wie von iRacing. Die Reihenfolge der Zeilen ist der Zieleinlauf.
// Zeile: { c: Kundennummer, ir, l: Runden, b: beste Runde, s: Startplatz ab 0, i: Incidents, out: Ausfallgrund }
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

const tests = {
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
  "Öffentliche Tabelle enthält keine Kundennummern": () => {
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
