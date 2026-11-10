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
// Laut Reglement 8.6 ist ein Einspruch ausgeschlossen. Mit LIGA_EINSPRUCH=1 ließe er sich wieder einschalten.
const einspruchAktiv = () => process.env.LIGA_EINSPRUCH === "1";
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
  const vergehen = text(e.vergehen, 60);
  if (vergehen) urteil.vergehen = vergehen;
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

/* ---------- Vorläufiges oder endgültiges Ergebnis ---------- */
const einspruchOffen = (r) => (r.einsprueche || []).length > 0 && !r.endgueltig;

// Vorläufig, solange noch etwas offen ist oder die Fristen laufen. Ein offener Fall geht immer vor, auch vor einer Freigabe von Hand.
// ctx: { serie, rennen (Kalender), reports (mit einsprueche), privat, jetzt }
function ergebnisStand(start, ctx) {
  const t = new Date(start).getTime();
  const naehe = (w) => Math.abs(w - t);
  const faelle = ctx.reports.filter((r) => r.serie === ctx.serie.id && naehe(new Date(r.start).getTime()) <= 12 * 3600e3);
  if (faelle.some((r) => !r.urteil || einspruchOffen(r))) return "vorlaeufig";
  if (((ctx.privat || {}).endgueltig || []).includes(start)) return "endgueltig";
  const kalender = ctx.rennen.filter((r) => r.serie === ctx.serie.id).map((r) => ({ r, ms: A.berlinNachUtc(r.datum, r.startzeit) })).filter((x) => x.ms !== null && naehe(x.ms) <= 12 * 3600e3).sort((a, b) => naehe(a.ms) - naehe(b.ms))[0];
  const ende = kalender ? kalender.ms + A.dauerMinuten(kalender.r.renndauer) * 60e3 : t + 120 * 60e3;
  // Reglement 8.3: Das Protestverfahren ist 72 Stunden nach Veranstaltungsende abgeschlossen.
  const fristen = [ende + Math.max(72, reportStunden(ctx.serie)) * 3600e3, ...faelle.filter((r) => einspruchAktiv() && !r.endgueltig).map((r) => new Date(r.urteil.zeit).getTime() + einspruchStunden(ctx.serie) * 3600e3)];
  return ctx.jetzt > Math.max(...fristen) ? "endgueltig" : "vorlaeufig";
}

// Ergänzt jedes Rennen einer gelesenen Tabelle um seinen aktuellen Stand.
function staendeSetzen(tabelle, ctx) {
  if (tabelle && Array.isArray(tabelle.rennen)) tabelle.rennen.forEach((r) => { r.vorlaeufig = ergebnisStand(r.start, ctx) === "vorlaeufig"; });
  return tabelle;
}

/* ---------- Abstimmung der Stewards ---------- */
const STIMMEN_NOETIG = 2;

function pruefeStimme(e) {
  const { art, punkte, sekunden } = pruefeUrteil({ ...e, begruendung: "Stimme" });
  return { art, ...(punkte ? { punkte } : {}), ...(sekunden ? { sekunden } : {}), notiz: text(e.notiz, 300) };
}

// Eine Stimme je Steward, eine neue ersetzt die alte. Reine Änderung am übergebenen Objekt.
function stimmeSetzen(report, wer, stimme) {
  report.stimmen = [...(report.stimmen || []).filter((x) => x.von !== wer.id), { ...stimme, von: wer.id, name: wer.name, zeit: new Date().toISOString() }];
  return report;
}

const haeufigster = (werte) => { const je = new Map(); werte.forEach((w) => je.set(w, (je.get(w) || 0) + 1)); return [...je.entries()].sort((a, b) => b[1] - a[1]); };

// Mehrheit: eine Entscheidung mit genügend Stimmen und ohne Gleichstand. Das Strafmaß ist der häufigste Vorschlag.
function mehrheit(stimmen) {
  const [erste, zweite] = haeufigster(stimmen.map((s) => s.art));
  if (!erste || erste[1] < STIMMEN_NOETIG || (zweite && zweite[1] === erste[1])) return null;
  const dafuer = stimmen.filter((s) => s.art === erste[0]);
  const wert = (feld) => { const liste = dafuer.map((s) => s[feld]).filter(Boolean); return liste.length ? haeufigster(liste)[0][0] : undefined; };
  return { art: erste[0], anzahl: erste[1], punkte: wert("punkte"), sekunden: wert("sekunden") };
}

// Solange jemand nicht selbst abgestimmt hat, sieht er nur die Anzahl. So beeinflussen sich die Stewards nicht.
function stimmenSicht(report, discordId) {
  const stimmen = report.stimmen || [];
  const eigene = stimmen.find((s) => s.von === discordId) || null;
  return { anzahl: stimmen.length, noetig: STIMMEN_NOETIG, eigene, liste: eigene ? stimmen.map(({ von, ...s }) => s) : null, mehrheit: eigene ? mehrheit(stimmen) : null };
}

// Position, Runden und Incidents beider Fahrer aus dem Ergebnis des Rennens.
function rennKontext(report, ergebnisse) {
  const start = new Date(report.start).getTime();
  const passend = ergebnisse.map((e) => ({ e, ab: Math.abs(new Date(e.start).getTime() - start) })).filter((x) => x.ab <= 12 * 3600e3).sort((a, b) => a.ab - b.ab)[0];
  if (!passend) return null;
  const zeile = (p) => { const f = passend.e.fahrer.find((x) => x.cust === String(p.cust || "")); return f ? { name: f.name, start: f.start, ziel: f.gesamt, runden: f.runden, incidents: f.incidents, besteRunde: f.besteRunde } : null; };
  return { ergebnis: passend.e.id, von: zeile(report.von), gegen: zeile(report.gegen) };
}

// Rennen, für die ein Fahrer gerade einen Vorfall melden darf: selbst gestartet und innerhalb der Frist.
// Reglement 8.3: Nach dem Rennende gilt eine Cooldownphase von 30 Minuten, bis dahin ist kein Protest möglich.
const COOLDOWN_MS = 30 * 60e3;
const cooldownEnde = (r) => new Date(r.ende).getTime() + COOLDOWN_MS;

// Bis wann eigene gefahrene Rennen noch in der Cooldownphase sind, sonst null.
function cooldownBis(rennen, jetzt) {
  const laufend = rennen.filter((r) => r.status !== "abgesagt" && r.ich && r.ich.status === "starter" && new Date(r.start).getTime() <= jetzt && jetzt < cooldownEnde(r));
  return laufend.length ? new Date(Math.max(...laufend.map(cooldownEnde))).toISOString() : null;
}

function meldbareRennen(rennen, jetzt, serien) {
  return rennen
    .filter((r) => r.status !== "abgesagt" && r.ich && r.ich.status === "starter" && jetzt >= cooldownEnde(r))
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
    kannEinspruch: !!(einspruchAktiv() && report.urteil && !report.endgueltig && beteiligt(report, discordId) && !eigene.length && jetzt <= frist),
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

const ADMIN_LINK = "https://darklineperformance.de/liga-admin";
const FARBE_REPORT = 0xd3121b;
const FARBE_EINSPRUCH = 0xffb020;
// Discord lehnt leere Felder ab und begrenzt die Länge.
const feldWert = (v) => String(v || "–").slice(0, 1024);
const kuerzen = (t, max) => { const s = String(t || "").trim(); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };

// Karte für den internen Kanal. beispiel kennzeichnet eine Testnachricht deutlich.
function reportKarte(d, beispiel) {
  const felder = [["Serie", d.serie], ["Rennen", d.rennen], ["Stelle", d.stelle], ["Melder", d.von], ["Gemeldet", d.gegen]].map(([name, wert]) => ({ name, value: feldWert(wert), inline: true }));
  if (d.clip) felder.push({ name: "Clip", value: feldWert(d.clip), inline: false });
  return { title: beispiel ? "Beispiel: Neuer Report" : "Neuer Report", url: ADMIN_LINK, color: FARBE_REPORT, description: kuerzen(d.beschreibung, 500), fields: felder, ...(beispiel ? { footer: { text: "Nur ein Test der Rennleitung, kein echter Report." } } : {}) };
}

function einspruchKarte(d) {
  return { title: "Neuer Einspruch", url: ADMIN_LINK, color: FARBE_EINSPRUCH, description: kuerzen(d.text, 500), fields: [["Serie", d.serie], ["Rennen", d.rennen], ["Einspruch von", d.von], ["Gemeldet", d.gegen]].map(([name, wert]) => ({ name, value: feldWert(wert), inline: true })) };
}

// Meldung in den internen Kanal der Rennleitung, mit Ping der Rolle. Ohne eingetragenen Webhook passiert nichts.
async function teamMelden(karte) {
  const url = process.env.LIGA_DISCORD_WEBHOOK_TEAM;
  if (!url) return false;
  const rolle = (process.env.LIGA_ADMIN_ROLE_IDS || "").split(",").map((s) => s.trim()).find((s) => /^\d+$/.test(s));
  try {
    const antwort = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(4000), body: JSON.stringify({ ...(rolle ? { content: `<@&${rolle}>` } : {}), embeds: [karte], allowed_mentions: rolle ? { roles: [rolle] } : { parse: [] } }) });
    if (!antwort.ok) console.error("Discord-Meldung an die Rennleitung abgelehnt:", antwort.status);
    return antwort.ok;
  } catch (e) {
    console.error("Discord-Meldung an die Rennleitung fehlgeschlagen:", e.message);
    return false;
  }
}

// Knopf „Discord testen“: eine Probe an jeden eingerichteten Webhook, Ergebnis je Kanal "ok", "fehlt" oder "fehler".
const TEST_ZIELE = [["Reports", "LIGA_DISCORD_WEBHOOK_TEAM"], ["Renntag", "LIGA_DISCORD_WEBHOOK"], ["Urteile", "LIGA_DISCORD_WEBHOOK_URTEILE"]];
function webhooksTesten(wer, reportBeispiel) {
  return Promise.all(TEST_ZIELE.map(async ([kanal, schluessel]) => {
    const url = process.env[schluessel];
    if (!url) return { kanal, stand: "fehlt" };
    if (schluessel === "LIGA_DISCORD_WEBHOOK_TEAM") return { kanal, stand: (await teamMelden(reportBeispiel)) ? "ok" : "fehler" };
    try {
      const karte = { title: `Test: ${kanal}`, description: `Ausgelöst von ${wer} über den Knopf „Discord testen“. Diese Nachricht kann gelöscht werden.`, color: 0xd3121b };
      const antwort = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(4000), body: JSON.stringify({ embeds: [karte], allowed_mentions: { parse: [] } }) });
      if (!antwort.ok) console.error(`Discord-Test ${kanal} abgelehnt:`, antwort.status);
      return { kanal, stand: antwort.ok ? "ok" : "fehler" };
    } catch (e) {
      console.error(`Discord-Test ${kanal} fehlgeschlagen:`, e.message);
      return { kanal, stand: "fehler" };
    }
  }));
}

// Alles zu einem Fahrer für die Rennleitung: Fälle, Strafen und Summen. Gesucht wird über iRacing-ID oder Discord-ID.
function fahrerAkte(reports, privatJeSerie, { cust, discordId }) {
  const ist = (p) => (!!cust && String(p.cust || "") === cust) || (!!discordId && p.discordId === discordId);
  const faelle = reports.filter((r) => ist(r.von) || ist(r.gegen)).map((r) => ({ id: r.id, rolle: ist(r.gegen) ? "gemeldet" : "melder", rennenTitel: r.rennenTitel, serieName: r.serieName, erstellt: r.erstellt, von: r.von.name, gegen: r.gegen.name, status: r.status, urteil: r.urteil ? { art: r.urteil.art, punkte: r.urteil.punkte, sekunden: r.urteil.sekunden } : null }));
  const strafen = !cust ? [] : privatJeSerie.flatMap(({ serieName, privat }) => [
    ...(privat.strafen || []).map((s) => ({ ...s, typ: "punkte" })),
    ...(privat.zeitstrafen || []).map((s) => ({ ...s, typ: "zeit" })),
    ...(privat.disqualifikationen || []).map((s) => ({ ...s, typ: "dsq" })),
  ].filter((s) => String(s.cust) === cust).map((s) => ({ serieName, typ: s.typ, punkte: s.punkte, sekunden: s.sekunden, grund: s.grund || "", ausReport: !!s.reportId })));
  const gegen = faelle.filter((f) => f.rolle === "gemeldet");
  return {
    faelle, strafen,
    summen: { gemeldet: gegen.length, selbstGemeldet: faelle.length - gegen.length, verwarnungen: gegen.filter((f) => f.urteil && f.urteil.art === "verwarnung").length, strafpunkte: strafen.reduce((t, s) => t + (s.typ === "punkte" ? s.punkte : 0), 0), zeitstrafen: strafen.filter((s) => s.typ === "zeit").length, disqualifikationen: strafen.filter((s) => s.typ === "dsq").length },
  };
}

// Optionale kurze Meldung im eigenen Urteils-Kanal. Details stehen nur im Fahrerbereich, niemand wird angepingt.
// Bewusst ohne Rückgriff auf LIGA_DISCORD_WEBHOOK: Urteile sollen nie im allgemeinen Liga-Kanal landen.
async function discordMelden(report, urteil) {
  const url = process.env.LIGA_DISCORD_WEBHOOK_URTEILE;
  if (!url || !istStrafend(urteil)) return;
  const was = urteil.art === "strafpunkte" ? `${urteil.punkte} Strafpunkte` : urteil.art === "zeitstrafe" ? `${urteil.sekunden} Sekunden Zeitstrafe` : "Disqualifikation";
  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: `Urteil der Rennleitung · ${report.rennenTitel}: ${report.gegen.name} erhält ${was}. Details im Fahrerbereich.`, allowed_mentions: { parse: [] } }) });
  } catch (e) {
    console.error("Discord-Meldung fehlgeschlagen:", e.message);
  }
}

module.exports = { cooldownBis, ergebnisStand, staendeSetzen, pruefeStimme, stimmeSetzen, mehrheit, stimmenSicht, rennKontext, reportKarte, einspruchKarte, teamMelden, webhooksTesten, fahrerAkte, stand, derSerieLoeschen, MAX_JE_RENNEN, pruefeMeldung, pruefeUrteil, istStrafend, urteilAnwenden, beteiligt, meldbareRennen, sichtFahrer, einspruchStunden, alleReports, lesen, speichern, einspruchSpeichern, neueId, discordMelden };
