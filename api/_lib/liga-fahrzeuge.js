// Fahrzeugwahl in einer Season: Bei der Anmeldung wählt jeder Fahrer sein Modell aus der Liste der Season.
// Wechsel während der Season: so viele frei, wie die Season erlaubt, jeder weitere nur mit Zustimmung der Rennleitung.
// Je Fahrer und Season eine Datei: liga/daten/fahrzeuge/<serie>/<discordId>.json
//   { modell, seit, wechsel: [{ von, nach, zeit, art: "frei"|"genehmigt"|"rennleitung" }], antrag: { nach, seit } | null }
const { blobInhalte, blobDelete, blobGet } = require("./blob");
const D = require("./liga-daten");
const { Hinweis } = D;

const WURZEL = "liga/daten/fahrzeuge/";
const pfad = (serieId, discordId) => `${WURZEL}${D.brauchtId(serieId)}/${D.brauchtId(discordId)}.json`;
const MAX_MODELLE = 60;

// Liste der erlaubten Modelle aus dem Admin-Formular: eine Zeile je Modell, doppelte fallen weg.
function pruefeModelle(eingabe) {
  const liste = (Array.isArray(eingabe) ? eingabe : String(eingabe || "").split(/\r?\n/)).map((x) => String(x).trim().replace(/\s+/g, " ").slice(0, 60)).filter(Boolean);
  // Bei doppelten Einträgen gilt die erste Schreibweise.
  const eindeutig = liste.filter((m, i) => liste.findIndex((x) => x.toLowerCase() === m.toLowerCase()) === i);
  if (eindeutig.length > MAX_MODELLE) throw new Hinweis(`Bitte höchstens ${MAX_MODELLE} Fahrzeuge eintragen.`);
  return eindeutig;
}

// Ob ein Fahrzeug aus der iRacing-Datei dem gemeldeten Modell entspricht. Groß- und Kleinschreibung, Leer- und Sonderzeichen zählen nicht.
// Bewusst kein „enthält“: „BMW M4 GT3“ und „BMW M4 GT3 EVO“ sind verschiedene Autos. Im Zweifel prüft die Rennleitung.
const kern = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const gleichesModell = (a, b) => !!kern(a) && kern(a) === kern(b);

function modellPruefen(serie, modell) {
  const liste = serie.modelle || [];
  if (!liste.length) return "";
  // Auch die Schreibweise aus der iRacing-Datei wird erkannt, etwa beim nachträglichen Genehmigen.
  const treffer = liste.find((m) => m === modell) || liste.find((m) => gleichesModell(m, modell));
  if (!treffer) throw new Hinweis("Bitte wähle dein Fahrzeug für diese Season aus.");
  return treffer;
}
const freiUebrig = (serie, eintrag) => Math.max(0, (serie.freieWechsel || 0) - ((eintrag && eintrag.wechsel) || []).filter((w) => w.art === "frei").length);

const lesen = async (serieId, discordId) => { const t = await blobGet(pfad(serieId, discordId)); return t ? JSON.parse(t) : null; };
// Alle Fahrzeuge einer Season: Map discordId → Eintrag
const derSerie = async (serieId) => new Map((await blobInhalte(`${WURZEL}${D.brauchtId(serieId)}/`)).map(([p, t]) => [p.split("/").pop().replace(/\.json$/, ""), JSON.parse(t)]));
// Offene Anträge aller Seasons für das Cockpit
async function offeneAntraege() {
  return (await blobInhalte(WURZEL)).map(([p, t]) => { const [serie, datei] = p.slice(WURZEL.length).split("/"); return { serie, discordId: datei.replace(/\.json$/, ""), ...JSON.parse(t) }; }).filter((e) => e.antrag);
}

// Bei der Anmeldung zur Season
// name: iRacing-Name des Fahrers, damit das Cockpit Anträge ohne weitere Abfrage zeigen kann
function waehlen(serie, discordId, modell, name) {
  const gewaehlt = modellPruefen(serie, modell);
  if (!gewaehlt) return null;
  return D.jsonAendern(pfad(serie.id, discordId), (alt) => (alt ? undefined : { name: String(name || "").slice(0, 80), modell: gewaehlt, seit: new Date().toISOString(), wechsel: [], antrag: null }));
}

// Wechselwunsch des Fahrers: frei, solange die Season das erlaubt, sonst als Antrag an die Rennleitung.
// Liefert { art: "frei"|"antrag"|"zurueck"|"gleich", eintrag }
async function wechseln(serie, discordId, modell) {
  const nach = modellPruefen(serie, modell);
  if (!nach) throw new Hinweis("In dieser Season gibt es keine Fahrzeugwahl.");
  let art = "gleich";
  const eintrag = await D.jsonAendern(pfad(serie.id, discordId), (alt) => {
    if (!alt) throw new Hinweis("Du bist für diese Season nicht angemeldet.");
    if (nach === alt.modell) { art = alt.antrag ? "zurueck" : "gleich"; return alt.antrag ? { ...alt, antrag: null } : undefined; }
    if (freiUebrig(serie, alt) > 0) { art = "frei"; return { ...alt, modell: nach, antrag: null, wechsel: [...(alt.wechsel || []), { von: alt.modell, nach, zeit: new Date().toISOString(), art: "frei" }] }; }
    art = "antrag";
    return { ...alt, antrag: { nach, seit: new Date().toISOString() } };
  });
  return { art, eintrag };
}

// Entscheidung der Rennleitung über einen Antrag
function entscheiden(serie, discordId, ja) {
  return D.jsonAendern(pfad(serie.id, discordId), (alt) => {
    if (!alt || !alt.antrag) throw new Hinweis("Dieser Antrag liegt nicht mehr vor.");
    if (!ja) return { ...alt, antrag: null };
    return { ...alt, modell: alt.antrag.nach, antrag: null, wechsel: [...(alt.wechsel || []), { von: alt.modell, nach: alt.antrag.nach, zeit: new Date().toISOString(), art: "genehmigt" }] };
  });
}

// Die Rennleitung setzt das Fahrzeug direkt, etwa nach einem genehmigten Wechsel im Rennen.
function setzen(serie, discordId, modell) {
  const nach = modellPruefen(serie, modell);
  if (!nach) throw new Hinweis("In dieser Season gibt es keine Fahrzeugwahl.");
  return D.jsonAendern(pfad(serie.id, discordId), (alt) => {
    if (alt && alt.modell === nach) return alt.antrag ? { ...alt, antrag: null } : undefined;
    return { modell: nach, seit: (alt && alt.seit) || new Date().toISOString(), antrag: null, wechsel: alt ? [...(alt.wechsel || []), { von: alt.modell, nach, zeit: new Date().toISOString(), art: "rennleitung" }] : [] };
  });
}

const loeschen = (serieId, discordId) => blobDelete([pfad(serieId, discordId)]);

// Fahrer im Ergebnis mit einem anderen Auto als gemeldet. discordVon: Map iRacing-ID → Discord-ID, fahrzeuge: Map Discord-ID → Eintrag
function abweichungen(ergebnis, discordVon, fahrzeuge) {
  return ergebnis.fahrer.flatMap((f) => {
    const eintrag = fahrzeuge.get(discordVon.get(String(f.cust)));
    if (!eintrag || !f.fahrzeug || gleichesModell(f.fahrzeug, eintrag.modell)) return [];
    return [{ name: f.name, cust: f.cust, discordId: discordVon.get(String(f.cust)), gemeldet: eintrag.modell, gefahren: f.fahrzeug }];
  });
}

module.exports = { pruefeModelle, gleichesModell, modellPruefen, freiUebrig, lesen, derSerie, offeneAntraege, waehlen, wechseln, entscheiden, setzen, loeschen, abweichungen };
