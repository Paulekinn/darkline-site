// Reports und Urteile der Liga. Jeder Report und jeder Einspruch ist eine eigene Datei im privaten Blob-Speicher.
//   liga/daten/reports/<id>.json                     Vorfall, Status, interne Notizen, Urteil
//   liga/daten/einsprueche/<report>/<discordId>.json Einspruch eines Beteiligten
const crypto = require("crypto");
const { blobPut, blobGet, blobDelete, blobList } = require("./blob");
const D = require("./liga-daten");
const A = require("./liga-anmeldung");
const { Hinweis } = D;

const R = "liga/daten/reports/";
const E = "liga/daten/einsprueche/";
const REPORT_STUNDEN = 24;
const EINSPRUCH_STUNDEN = 48;
const MAX_JE_RENNEN = 15;
const ARTEN = ["kein-vergehen", "verwarnung", "strafpunkte", "zeitstrafe", "dsq"];
const STRAFEND = ["strafpunkte", "zeitstrafe", "dsq"];

const text = (v, max) => String(v ?? "").trim().slice(0, max);
const reportStunden = (serie) => (serie && Number.isFinite(serie.reportStunden) ? serie.reportStunden : REPORT_STUNDEN);
const einspruchStunden = (serie) => (serie && Number.isFinite(serie.einspruchStunden) ? serie.einspruchStunden : EINSPRUCH_STUNDEN);

/* ---------- Prüfungen ---------- */
function pruefeMeldung(e) {
  const beschreibung = text(e.beschreibung, 2000);
  const stelle = text(e.stelle, 120);
  const clip = text(e.clip, 300);
  if (stelle.length < 2) throw new Hinweis("Bitte gib an, wann und wo es passiert ist, zum Beispiel Runde 5, Kurve 3.");
  if (beschreibung.length < 10) throw new Hinweis("Bitte beschreibe den Vorfall in mindestens einem Satz.");
  if (clip && !/^https:\/\/[^\s]+$/.test(clip)) throw new Hinweis("Bitte gib beim Clip einen vollständigen Link an, der mit https:// beginnt.");
  return { stelle, beschreibung, clip };
}

function pruefeUrteil(e) {
  const art = String(e.art || "");
  if (!ARTEN.includes(art)) throw new Hinweis("Bitte wähle eine Entscheidung aus.");
  const begruendung = text(e.begruendung, 2000);
  if (begruendung.length < 5) throw new Hinweis("Bitte begründe die Entscheidung.");
  const urteil = { art, begruendung };
  if (art === "strafpunkte") {
    urteil.punkte = Number(e.punkte);
    if (!Number.isInteger(urteil.punkte) || urteil.punkte < 1 || urteil.punkte > 1000) throw new Hinweis("Bitte gib die Strafpunkte als ganze Zahl an.");
  }
  if (art === "zeitstrafe") {
    urteil.sekunden = Number(e.sekunden);
    if (!Number.isInteger(urteil.sekunden) || urteil.sekunden < 1 || urteil.sekunden > 3600) throw new Hinweis("Bitte gib die Zeitstrafe in ganzen Sekunden an.");
  }
  return urteil;
}

const istStrafend = (urteil) => STRAFEND.includes(urteil.art);

// Ersetzt die Wirkung eines früheren Urteils durch die des neuen. Reine Änderung am übergebenen Objekt.
function urteilAnwenden(privat, reportId, urteil, ziel) {
  const ohne = (liste) => (liste || []).filter((x) => x.reportId !== reportId);
  privat.strafen = ohne(privat.strafen);
  privat.zeitstrafen = ohne(privat.zeitstrafen);
  privat.disqualifikationen = ohne(privat.disqualifikationen);
  if (!istStrafend(urteil)) return privat;
  const eintrag = { id: `r-${reportId}`, reportId, rennen: ziel.rennen, cust: ziel.cust, name: ziel.name };
  if (urteil.art === "strafpunkte") privat.strafen.push({ ...eintrag, punkte: urteil.punkte, grund: urteil.begruendung.slice(0, 200) });
  if (urteil.art === "zeitstrafe") privat.zeitstrafen.push({ ...eintrag, sekunden: urteil.sekunden });
  if (urteil.art === "dsq") privat.disqualifikationen.push(eintrag);
  return privat;
}

const beteiligt = (report, discordId) => report.von.discordId === discordId || report.gegen.discordId === discordId;

// Rennen, für die ein Fahrer gerade einen Vorfall melden darf: selbst gestartet und innerhalb der Frist.
function meldbareRennen(rennen, jetzt, serien) {
  return rennen
    .filter((r) => r.status !== "abgesagt" && r.ich && r.ich.status === "starter" && new Date(r.start).getTime() <= jetzt)
    .map((r) => ({ r, frist: new Date(r.ende).getTime() + reportStunden(serien[r.serie]) * 3600e3 }))
    .filter((x) => jetzt <= x.frist)
    .map(({ r, frist }) => ({ id: r.id, titel: r.titel, serie: r.serie, serieName: r.serieName, start: r.start, frist: new Date(frist).toISOString(), fahrer: r.starter.filter((f) => f.discordId !== r.ich.discordId).map((f) => f.name) }));
}

// Was ein Fahrer von einem Report sehen darf. Interne Notizen und Discord-IDs bleiben bei der Rennleitung.
function sichtFahrer(report, einsprueche, discordId, jetzt, serie) {
  const eigene = einsprueche.filter((e) => e.discordId === discordId);
  const frist = report.urteil ? new Date(report.urteil.zeit).getTime() + einspruchStunden(serie) * 3600e3 : 0;
  const urteil = report.urteil ? { art: report.urteil.art, punkte: report.urteil.punkte, sekunden: report.urteil.sekunden, begruendung: report.urteil.begruendung, zeit: report.urteil.zeit } : null;
  return {
    id: report.id, rennenTitel: report.rennenTitel, serieName: report.serieName, serieFarbe: report.serieFarbe, start: report.start, erstellt: report.erstellt,
    von: report.von.name, gegen: report.gegen.name, stelle: report.stelle, beschreibung: report.beschreibung, clip: report.clip, status: report.status, urteil,
    endgueltig: !!report.endgueltig, beteiligt: beteiligt(report, discordId), rolle: report.von.discordId === discordId ? "melder" : report.gegen.discordId === discordId ? "gemeldet" : "",
    meinEinspruch: eigene[0] ? eigene[0].text : "",
    einspruchFrist: report.urteil ? new Date(frist).toISOString() : "",
    kannEinspruch: !!(report.urteil && !report.endgueltig && beteiligt(report, discordId) && !eigene.length && jetzt <= frist),
  };
}

/* ---------- Speicher ---------- */
let cache = { bis: 0, wert: null };
async function alleReports(frisch) {
  if (!frisch && cache.wert && cache.bis > Date.now()) return cache.wert;
  const [reports, einspruchsDateien] = await Promise.all([D.ordner(R), blobList(E)]);
  const einsprueche = (await Promise.all(einspruchsDateien.map(async (b) => {
    const t = await blobGet(b.pathname);
    return t ? { report: b.pathname.split("/").slice(-2)[0], ...JSON.parse(t) } : null;
  }))).filter(Boolean);
  const wert = reports.map((r) => ({ ...r, einsprueche: einsprueche.filter((e) => e.report === r.id) })).sort((a, b) => String(b.erstellt).localeCompare(String(a.erstellt)));
  cache = { bis: Date.now() + 15000, wert };
  return wert;
}
const verwerfen = () => { cache = { bis: 0, wert: null }; };

async function lesen(id) {
  D.brauchtId(id);
  const t = await blobGet(`${R}${id}.json`);
  if (!t) throw new Hinweis("Diesen Report gibt es nicht.");
  return { id, ...JSON.parse(t) };
}
async function speichern(report) {
  const { id, einsprueche, ...daten } = report;
  verwerfen();
  await blobPut(`${R}${D.brauchtId(id)}.json`, JSON.stringify(daten), "application/json");
}
async function einspruchSpeichern(reportId, discordId, inhalt) {
  verwerfen();
  await blobPut(`${E}${D.brauchtId(reportId)}/${D.brauchtId(discordId)}.json`, JSON.stringify(inhalt), "application/json");
}
const neueId = () => `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

// Kurzer Fingerabdruck für die Rennleitung: ändert sich bei jedem neuen oder geänderten Report. Braucht nur zwei Abfragen.
async function stand() {
  const dateien = (await Promise.all([blobList(R), blobList(E)])).flat();
  return `${dateien.length}:${dateien.map((b) => b.uploadedAt).sort().pop() || ""}`;
}

// Löscht alle Reports und Einsprüche einer Serie.
async function derSerieLoeschen(serieId) {
  verwerfen();
  const betroffen = (await alleReports(true)).filter((r) => r.serie === serieId).map((r) => r.id);
  if (!betroffen.length) return;
  const einsprueche = (await blobList(E)).map((b) => b.pathname).filter((p) => betroffen.includes(p.split("/").slice(-2)[0]));
  await blobDelete([...betroffen.map((id) => `${R}${id}.json`), ...einsprueche]);
  verwerfen();
}

// Optionale kurze Meldung im Discord-Kanal. Details stehen nur im Fahrerbereich, niemand wird angepingt.
async function discordMelden(report, urteil) {
  const url = process.env.LIGA_DISCORD_WEBHOOK;
  if (!url || !istStrafend(urteil)) return;
  const was = urteil.art === "strafpunkte" ? `${urteil.punkte} Strafpunkte` : urteil.art === "zeitstrafe" ? `${urteil.sekunden} Sekunden Zeitstrafe` : "Disqualifikation";
  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: `Urteil der Rennleitung · ${report.rennenTitel}: ${report.gegen.name} erhält ${was}. Details im Fahrerbereich.`, allowed_mentions: { parse: [] } }) });
  } catch (e) {
    console.error("Discord-Meldung fehlgeschlagen:", e.message);
  }
}

module.exports = { stand, derSerieLoeschen, MAX_JE_RENNEN, pruefeMeldung, pruefeUrteil, istStrafend, urteilAnwenden, beteiligt, meldbareRennen, sichtFahrer, einspruchStunden, alleReports, lesen, speichern, einspruchSpeichern, neueId, discordMelden };
