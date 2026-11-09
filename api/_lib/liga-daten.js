// Datenhaltung der Liga im privaten Blob-Speicher, unabhängig von Repository und Website-Admin.
//   liga/daten/serien/<id>.json       Serie oder Event mit Regeln
//   liga/daten/rennen/<id>.json       Rennen, enthält auch das Session-Passwort
//   liga/daten/tabellen/<serie>.json  fertige Tabelle ohne iRacing-IDs
//   liga/daten/ergebnisse/<serie>/<subsession>.json  eingelesene Ergebnisse
//   liga/daten/privat/<serie>.json    Einstufungen und Strafen
const crypto = require("crypto");
const { blobPut, blobGet, blobGetBinaer, blobDelete, blobList, blobInhalte } = require("./blob");
const { pruefeRegeln, berechneTabelle } = require("../../assets/liga-wertung.js");
const { fahrerKennung } = require("./session");
const { berlinNachUtc, dauerMinuten } = require("./liga-anmeldung");
const { gueltig: landGueltig } = require("../../assets/liga-flaggen.js");

const WURZEL = "liga/daten/";
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

class Hinweis extends Error {}

const istId = (s) => ID.test(String(s || ""));
function brauchtId(s) {
  if (!istId(s)) throw new Hinweis("Ungültige Kennung.");
  return s;
}

const slug = (s) => String(s || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

const text = (v, max) => String(v ?? "").trim().slice(0, max);
function ganzzahl(v, name, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Hinweis(`${name}: bitte eine ganze Zahl von ${min} bis ${max} eingeben.`);
  return n;
}

const FARBEN = ["rot", "blau", "lila", "gruen", "gelb", "tuerkis"];
const KATEGORIEN = ["Sports_Car", "Formula", "Oval", "Dirt_Road", "Dirt_Oval"];

// Prüft und vereinheitlicht die Eingaben für eine Serie.
function pruefeSerie(e) {
  const name = text(e.name, 60);
  if (name.length < 2) throw new Hinweis("Bitte gib der Serie einen Namen.");
  const ohneKlassen = e.ohneKlassen === true || e.ohneKlassen === "true";
  // Ohne iRating-Klassen gibt es intern genau eine offene Klasse für alle.
  const klassen = ohneKlassen ? [{ id: "offen", name: "Offen", min: 0, max: null }] : (Array.isArray(e.klassen) ? e.klassen : []).map((k) => ({
    id: slug(k.name),
    name: text(k.name, 30),
    min: ganzzahl(k.min, `Klasse ${text(k.name, 30)}, Von`, 0, 20000),
    max: k.max === "" || k.max === null || k.max === undefined ? null : ganzzahl(k.max, `Klasse ${text(k.name, 30)}, Bis`, 0, 20000),
  })).sort((a, b) => b.min - a.min);
  if (klassen.some((k) => !k.id)) throw new Hinweis("Jede Klasse braucht einen Namen.");
  const punkte = (Array.isArray(e.punkte) ? e.punkte : String(e.punkte || "").split(/[\s,;]+/).filter(Boolean)).map((p) => ganzzahl(p, "Punktetabelle", 0, 1000));
  const serie = {
    name,
    typ: e.typ === "event" ? "event" : "liga",
    saison: text(e.saison, 40),
    status: ["anmeldung", "laeuft", "beendet"].includes(e.status) ? e.status : "anmeldung",
    anmeldungOffen: e.anmeldungOffen !== false && e.anmeldungOffen !== "false",
    farbe: FARBEN.includes(e.farbe) ? e.farbe : "rot",
    beschreibung: text(e.beschreibung, 400),
    briefingVorlage: text(e.briefingVorlage, 10000),
    kategorie: KATEGORIEN.includes(e.kategorie) ? e.kategorie : "Sports_Car",
    fahrzeugklassen: (Array.isArray(e.fahrzeugklassen) ? e.fahrzeugklassen : String(e.fahrzeugklassen || "").split(",")).map((x) => text(x, 20)).filter(Boolean),
    rennenGesamt: ganzzahl(e.rennenGesamt, "Rennen gesamt", 1, 100),
    gewerteteRennen: ganzzahl(e.gewerteteRennen, "Gewertete Rennen", 1, 100),
    anmeldeschlussMinuten: ganzzahl(e.anmeldeschlussMinuten, "Anmeldeschluss", 0, 10080),
    reportStunden: ganzzahl(e.reportStunden ?? 24, "Report-Frist", 1, 720),
    einspruchStunden: ganzzahl(e.einspruchStunden ?? 48, "Einspruchsfrist", 1, 720),
    klassen,
    ohneKlassen,
    fahrzeugklassenNamen: { "GT3 Class": "GT3", IMSA23: "GT3" },
    punkte,
    punkteDanach: ganzzahl(e.punkteDanach, "Punkte danach", 0, 1000),
    bonusPole: ganzzahl(e.bonusPole, "Bonus Pole", 0, 100),
    bonusSchnellsteRunde: ganzzahl(e.bonusSchnellsteRunde, "Bonus schnellste Runde", 0, 100),
    mindestRundenProzent: ganzzahl(e.mindestRundenProzent, "Mindestrunden", 0, 100),
  };
  pruefeRegeln(serie);
  return serie;
}

// Prüft und vereinheitlicht die Eingaben für ein Rennen.
function pruefeRennen(e, serienIds) {
  const titel = text(e.titel, 80);
  if (titel.length < 2) throw new Hinweis("Bitte gib dem Rennen einen Titel.");
  if (!serienIds.includes(e.serie)) throw new Hinweis("Bitte wähle eine Serie aus.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.datum || ""))) throw new Hinweis("Bitte gib ein Datum an.");
  if (!/^\d{1,2}:\d{2}$/.test(String(e.startzeit || "").trim())) throw new Hinweis("Bitte gib die Startzeit als 20:00 an.");
  return {
    titel, serie: e.serie, status: e.status === "abgesagt" ? "abgesagt" : "geplant", datum: e.datum, startzeit: String(e.startzeit).trim(),
    strecke: text(e.strecke, 80), streckeId: istId(e.streckeId) ? e.streckeId : "", fahrzeuge: text(e.fahrzeuge, 80), plaetze: ganzzahl(e.plaetze, "Startplätze", 1, 200),
    training: text(e.training, 20), qualifying: text(e.qualifying, 20), renndauer: text(e.renndauer, 20), wetter: text(e.wetter, 60), server: text(e.server, 60),
    passwort: text(e.passwort, 60), briefing: text(e.briefing, 10000),
  };
}

// Prüft eine Strecke aus der Streckenbibliothek. Länge und Kurven sind freiwillig.
function pruefeStrecke(e) {
  const name = text(e.name, 80);
  if (name.length < 2) throw new Hinweis("Bitte gib der Strecke einen Namen.");
  const land = String(e.land || "");
  if (land && !landGueltig(land)) throw new Hinweis("Bitte wähle ein Land aus der Liste.");
  const laengeText = String(e.laengeKm ?? "").trim().replace(",", ".");
  const laengeKm = laengeText ? Number(laengeText) : null;
  if (laengeKm !== null && !(laengeKm > 0 && laengeKm <= 50)) throw new Hinweis("Bitte gib die Länge in Kilometern an, zum Beispiel 7,004.");
  const kurvenText = String(e.kurven ?? "").trim();
  return { name, variante: text(e.variante, 60), land, laengeKm, kurven: kurvenText ? ganzzahl(kurvenText, "Kurven", 1, 200) : null, notiz: text(e.notiz, 300) };
}

// Gleicht ein Ergebnis mit den Anmeldungen ab. Gewertet und gespeichert werden nur gemeldete Fahrer und ausdrücklich zugelassene Gäste.
// gemeldet: Map iRacing-ID → Name. stammfahrer: iRacing-IDs der Season-Fahrer, alle anderen gelten als Gast. Bei Events null, dort gibt es keine Gäste.
function abgleichen(ergebnis, gemeldet, zugelassen, stammfahrer) {
  const gaeste = new Set((zugelassen || []).map(String));
  const imRennen = new Set(ergebnis.fahrer.map((f) => f.cust));
  return {
    ergebnis: { ...ergebnis, fahrer: ergebnis.fahrer.filter((f) => gemeldet.has(f.cust) || gaeste.has(f.cust)).map((f) => (stammfahrer && !stammfahrer.has(f.cust) ? { ...f, gast: true } : f)) },
    fremde: ergebnis.fahrer.filter((f) => !gemeldet.has(f.cust)).map((f) => ({ cust: f.cust, name: f.name, gesamt: f.gesamt, gast: gaeste.has(f.cust) })),
    fehlend: [...gemeldet].filter(([cust]) => !imRennen.has(cust)).map(([, name]) => name),
  };
}

const MAX_BILD_BYTES = 3 * 1024 * 1024;
// Erkennt das Bildformat an den ersten Bytes, null wenn es weder JPEG noch WebP ist.
function bildTyp(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

// Prüft ein hochgeladenes Bild (data:-URL) anhand des echten Inhalts und gibt es als Buffer zurück.
function pruefeBild(daten) {
  const m = /^data:image\/(?:webp|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(daten || ""));
  if (!m) throw new Hinweis("Bitte wähle ein Bild im Format JPG, PNG oder WebP aus.");
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > MAX_BILD_BYTES) throw new Hinweis("Das Bild ist zu groß. Bitte wähle ein kleineres aus.");
  if (!bildTyp(buf)) throw new Hinweis("Die Datei ist kein gültiges Bild.");
  return buf;
}

// Öffentliche Sicht: Passwort, Session-Name und Briefing bleiben intern.
const oeffentlichesRennen = ({ passwort, briefing, server, ...rest }) => rest;

const zufall = () => crypto.randomBytes(3).toString("hex");
const neueRennenId = (e) => `${String(e.datum).slice(0, 7)}-${slug(e.titel).slice(0, 50) || "rennen"}-${zufall()}`;

/* ---------- Speicher ---------- */
const idAus = (p) => p.split("/").pop().replace(/\.json$/, "");
const leseJson = async (p) => { const t = await blobGet(p); return t ? JSON.parse(t) : null; };
const schreibe = (p, o) => blobPut(p, JSON.stringify(o), "application/json");

async function ordner(prefix) {
  return (await blobInhalte(prefix)).map(([pfad, inhalt]) => ({ id: idAus(pfad), ...JSON.parse(inhalt) }));
}

// Eine Serie läuft automatisch, sobald ihr erstes nicht abgesagtes Rennen gestartet ist. „Beendet“ bleibt immer eine Entscheidung der Rennleitung.
function wirksamerStatus(serie, rennen, jetzt) {
  if (serie.status !== "anmeldung") return serie.status;
  const gestartet = rennen.some((r) => {
    const start = r.serie === serie.id && r.status !== "abgesagt" ? berlinNachUtc(r.datum, r.startzeit) : null;
    return start !== null && start <= jetzt;
  });
  return gestartet ? "laeuft" : serie.status;
}

// Rechnet ein Datum (JJJJ-MM-TT) um eine Anzahl Tage weiter.
function datumPlus(datum, tage) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(datum || ""));
  if (!m) throw new Hinweis("Dieses Rennen hat kein gültiges Datum.");
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + tage)).toISOString().slice(0, 10);
}

// Gefahrene Rennen ohne eingelesenes Ergebnis. Ein Ergebnis gehört zum Rennen, wenn es höchstens zwölf Stunden daneben liegt.
function rennenOhneErgebnis(rennen, ergebnisseJeSerie, jetzt) {
  return rennen.filter((r) => {
    if (r.status === "abgesagt") return false;
    const start = berlinNachUtc(r.datum, r.startzeit);
    if (start === null || start + dauerMinuten(r.renndauer) * 60e3 > jetzt) return false;
    return !(ergebnisseJeSerie.get(r.serie) || []).some((e) => Math.abs(new Date(e.start).getTime() - start) <= 12 * 3600e3);
  }).map((r) => ({ id: r.id, titel: r.titel, serie: r.serie, datum: r.datum }));
}

// Die importierte Streckenliste liegt in einer einzigen Datei, damit der Katalog nicht hunderte Dateien lesen muss.
// Eine eigene Datei unter strecken/ entsteht erst, wenn eine Strecke bearbeitet wird oder eine Karte bekommt, und hat dann Vorrang.
const STRECKEN_IMPORT = `${WURZEL}strecken-import.json`;
function streckenZusammen(eigene, importiert) {
  const name = (s) => [s.name, s.variante].filter(Boolean).join(" ").toLowerCase();
  const ids = new Set(eigene.map((s) => s.id));
  const namen = new Set(eigene.map(name));
  return [...eigene, ...importiert.filter((s) => !ids.has(s.id) && !namen.has(name(s))).map((s) => ({ land: "", laengeKm: null, kurven: null, notiz: "", ...s, importiert: true }))];
}

// Serien und Rennen, kurz pro Funktionsinstanz zwischengespeichert. Nach eigenen Änderungen wird neu gelesen.
let katalogCache = { bis: 0, wert: null };
async function katalog(frisch) {
  if (!frisch && katalogCache.wert && katalogCache.bis > Date.now()) return katalogCache.wert;
  const [serienRoh, rennenRoh, eigeneStrecken, importiert, einstellungen] = await Promise.all([ordner(`${WURZEL}serien/`), ordner(`${WURZEL}rennen/`), ordner(`${WURZEL}strecken/`), leseJson(STRECKEN_IMPORT), leseJson(`${WURZEL}einstellungen.json`)]);
  const strecken = streckenZusammen(eigeneStrecken, importiert || []);
  // Streckenkarte direkt am Rennen, damit jede Ansicht sie ohne weiteren Abruf zeigen kann
  const rennen = rennenRoh.map((r) => {
    const s = r.streckeId && strecken.find((x) => x.id === r.streckeId);
    return s && s.kartenVersion ? { ...r, streckenBild: { k: `strecke-${s.id}`, v: s.kartenVersion } } : r;
  });
  const serien = serienRoh.map((s) => ({ ...s, status: wirksamerStatus(s, rennen, Date.now()) }));
  katalogCache = { bis: Date.now() + 60000, wert: { serien, rennen, strecken, einstellungen: einstellungen || {} } };
  return katalogCache.wert;
}
const katalogVerwerfen = () => { katalogCache = { bis: 0, wert: null }; };

const einstellungenSpeichern = (d) => { katalogVerwerfen(); return schreibe(`${WURZEL}einstellungen.json`, d); };
const bildPfad = (schluessel) => `${WURZEL}bilder/${brauchtId(schluessel)}`;
const bildSpeichern = (schluessel, buf) => blobPut(bildPfad(schluessel), buf, bildTyp(buf));
const bildLesen = (schluessel) => blobGetBinaer(bildPfad(schluessel));
const bildLoeschen = (schluessel) => blobDelete([bildPfad(schluessel)]);

const serieSpeichern = (id, d) => { katalogVerwerfen(); return schreibe(`${WURZEL}serien/${brauchtId(id)}.json`, d); };
const rennenSpeichern = (id, d) => { katalogVerwerfen(); return schreibe(`${WURZEL}rennen/${brauchtId(id)}.json`, d); };
const serieLoeschen = (id) => { katalogVerwerfen(); return blobDelete([`${WURZEL}serien/${brauchtId(id)}.json`]); };
const rennenLoeschen = (id) => { katalogVerwerfen(); return blobDelete([`${WURZEL}rennen/${brauchtId(id)}.json`]); };
const streckeSpeichern = (id, { importiert, ...d }) => { katalogVerwerfen(); return schreibe(`${WURZEL}strecken/${brauchtId(id)}.json`, d); };
const streckenImportSpeichern = (liste) => { katalogVerwerfen(); return schreibe(STRECKEN_IMPORT, liste); };
// Nimmt eine Strecke aus der importierten Liste, damit sie nach dem Löschen nicht wieder auftaucht.
async function streckeAusImportEntfernen(id) {
  const liste = (await leseJson(STRECKEN_IMPORT)) || [];
  const rest = liste.filter((s) => s.id !== id);
  if (rest.length !== liste.length) await streckenImportSpeichern(rest);
}
const streckeLoeschen = (id) => { katalogVerwerfen(); return blobDelete([`${WURZEL}strecken/${brauchtId(id)}.json`]); };
// Löscht Ergebnisse, Tabelle sowie Einstufungen und Strafen einer Serie.
async function serieDatenLoeschen(id) {
  const ergebnisse = (await blobList(`${WURZEL}ergebnisse/${brauchtId(id)}/`)).map((b) => b.pathname);
  await blobDelete([...ergebnisse, `${WURZEL}tabellen/${id}.json`, `${WURZEL}privat/${id}.json`]);
}

const tabelleLesen = (serie) => leseJson(`${WURZEL}tabellen/${brauchtId(serie)}.json`);
const privatLesen = async (serie) => (await leseJson(`${WURZEL}privat/${brauchtId(serie)}.json`)) || { einstufung: {}, strafen: [] };
const privatSchreiben = (serie, d) => schreibe(`${WURZEL}privat/${brauchtId(serie)}.json`, d);
const ergebnisseLesen = (serie) => ordner(`${WURZEL}ergebnisse/${brauchtId(serie)}/`);
const ergebnisSpeichern = (serie, e) => schreibe(`${WURZEL}ergebnisse/${brauchtId(serie)}/${e.id}.json`, e);
const ergebnisLoeschen = (serie, id) => {
  if (!/^\d+$/.test(String(id))) throw new Hinweis("Ungültiges Ergebnis.");
  return blobDelete([`${WURZEL}ergebnisse/${brauchtId(serie)}/${id}.json`]);
};

// Rechnet die öffentliche Tabelle aus allen Ergebnissen, Einstufungen und Strafen neu.
async function tabelleNeu(serie, regeln, ergebnisse) {
  const pfad = `${WURZEL}tabellen/${brauchtId(serie)}.json`;
  if (!ergebnisse.length) return blobDelete([pfad]);
  const { warnungen, ...oeffentlich } = berechneTabelle(ergebnisse, regeln, { ...(await privatLesen(serie)), pid: fahrerKennung });
  await schreibe(pfad, oeffentlich);
  return warnungen;
}

module.exports = { streckenZusammen, streckenImportSpeichern, streckeAusImportEntfernen, datumPlus, rennenOhneErgebnis, wirksamerStatus, pruefeStrecke, streckeSpeichern, streckeLoeschen, serieDatenLoeschen, pruefeBild, bildTyp, einstellungenSpeichern, bildSpeichern, bildLesen, bildLoeschen, abgleichen, ordner, Hinweis, istId, brauchtId, slug, pruefeSerie, pruefeRennen, oeffentlichesRennen, neueRennenId, katalog, katalogVerwerfen, serieSpeichern, rennenSpeichern, serieLoeschen, rennenLoeschen, tabelleLesen, privatLesen, privatSchreiben, ergebnisseLesen, ergebnisSpeichern, ergebnisLoeschen, tabelleNeu };
