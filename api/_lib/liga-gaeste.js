// Gaststarter (Reglement 2.2): Wer nicht in einer Season ist, fragt für ein einzelnes Rennen an, die Rennleitung gibt frei oder lehnt ab.
//   liga/daten/gastanfragen/<discordId>/<rennen>.json   offene Anfrage { name, custId, irating, fahrzeugklasse, nachricht, seit }
//   liga/daten/gaeste/<rennen>/<discordId>.json         freigegebener Gast { name, custId, freigegeben, inLiga, entfernt }
// Mit der Freigabe wird aus der Anfrage eine normale Einzelmeldung für genau dieses Rennen. Der Gast-Eintrag merkt sich,
// ob die Rennleitung ihn in die iRacing-Liga aufgenommen und nach dem Rennen wieder entfernt hat (iRacing kennt keine Einladung je Rennen).
const { blobInhalte, blobDelete, blobGet, blobPut, blobList } = require("./blob");
const D = require("./liga-daten");
const { berlinNachUtc } = require("./liga-anmeldung");

const ANFRAGEN = "liga/daten/gastanfragen/";
const GAESTE = "liga/daten/gaeste/";
const anfragePfad = (discordId, rennenId) => `${ANFRAGEN}${D.brauchtId(discordId)}/${D.brauchtId(rennenId)}.json`;
const gastPfad = (rennenId, discordId) => `${GAESTE}${D.brauchtId(rennenId)}/${D.brauchtId(discordId)}.json`;
const json = (t) => (t ? JSON.parse(t) : null);

const anfrageLesen = async (discordId, rennenId) => json(await blobGet(anfragePfad(discordId, rennenId)));
const anfrageSpeichern = (discordId, rennenId, daten) => blobPut(anfragePfad(discordId, rennenId), JSON.stringify({ ...daten, seit: new Date().toISOString() }), "application/json");
const anfrageLoeschen = (discordId, rennenId) => blobDelete([anfragePfad(discordId, rennenId)]);
// Die eigenen offenen Anfragen: Set der Rennen-IDs, mit einer einzigen Liste je Fahrer
async function eigeneAnfragen(discordId) {
  const liste = await blobList(`${ANFRAGEN}${D.brauchtId(discordId)}/`);
  return new Set(liste.map((b) => b.pathname.split("/").pop().replace(/\.json$/, "")));
}
// Alle offenen Anfragen für das Cockpit, älteste zuerst
async function alleAnfragen() {
  return (await blobInhalte(ANFRAGEN)).map(([p, t]) => { const [discordId, datei] = p.slice(ANFRAGEN.length).split("/"); return { discordId, rennen: datei.replace(/\.json$/, ""), ...JSON.parse(t) }; }).sort((a, b) => String(a.seit).localeCompare(String(b.seit)));
}
// Anfragen zu einem gelöschten Rennen gehen mit
async function anfragenDesRennens(rennenId) {
  const weg = (await blobList(ANFRAGEN)).map((b) => b.pathname).filter((p) => p.endsWith(`/${rennenId}.json`));
  if (weg.length) await blobDelete(weg);
}

const gastSpeichern = (rennenId, discordId, daten) => blobPut(gastPfad(rennenId, discordId), JSON.stringify(daten), "application/json");
const gastLesen = async (rennenId, discordId) => json(await blobGet(gastPfad(rennenId, discordId)));
async function alleGaeste() {
  return (await blobInhalte(GAESTE)).map(([p, t]) => { const [rennen, datei] = p.slice(GAESTE.length).split("/"); return { rennen, discordId: datei.replace(/\.json$/, ""), ...JSON.parse(t) }; });
}
async function gaesteDesRennens(rennenId) {
  const p = (await blobList(`${GAESTE}${D.brauchtId(rennenId)}/`)).map((b) => b.pathname);
  if (p.length) await blobDelete(p);
}

// Ist ein Fahrer in irgendeiner laufenden Season, ist er ohnehin in der iRacing-Liga: Aufnehmen und Entfernen entfallen dann.
const ligaMitglied = (discordId, alle, serien) => serien.some((s) => s.status !== "beendet" && s.typ !== "event" && s.typ !== "community" && alle.some((e) => e.typ === "serie" && e.serieId === s.id && e.discordId === discordId));

// Erinnerungen fürs Cockpit: vor dem Rennen „aufnehmen“, danach „wieder entfernen“. Erledigtes und Altes fällt weg.
function ligaHinweise(gaeste, { rennen, alle, serien, jetzt }) {
  const nachId = new Map(rennen.map((r) => [r.id, r]));
  const hinweise = [];
  for (const g of gaeste) {
    const r = nachId.get(g.rennen);
    if (!r || g.entfernt) continue;
    const start = berlinNachUtc(r.datum, r.startzeit);
    if (start === null) continue;
    if (ligaMitglied(g.discordId, alle, serien)) continue;
    const vorbei = jetzt > start + 4 * 3600e3;
    // Nach zwei Wochen erinnert das Cockpit nicht mehr, auch wenn nichts abgehakt wurde.
    if (jetzt > start + 14 * 864e5) continue;
    const gemeldet = alle.some((e) => e.typ === "rennen" && e.rennenId === r.id && e.discordId === g.discordId);
    const basis = { rennen: r.id, discordId: g.discordId, name: g.name, custId: g.custId || "", rennenTitel: r.titel || r.strecke || "Rennen", serie: r.serie, datum: r.datum, startzeit: r.startzeit };
    if (!vorbei && gemeldet && !g.inLiga) hinweise.push({ ...basis, schritt: "aufnehmen" });
    else if (vorbei && (g.inLiga || gemeldet)) hinweise.push({ ...basis, schritt: "entfernen" });
  }
  return hinweise.sort((a, b) => `${a.datum} ${a.startzeit}`.localeCompare(`${b.datum} ${b.startzeit}`));
}

// Texte der Direktnachrichten
const termin = (r) => [r.datum ? r.datum.split("-").reverse().join(".") : "", r.startzeit ? `${r.startzeit} Uhr` : ""].filter(Boolean).join(", ");
function freigabeText(serie, r, ligaLink) {
  const liga = ligaLink
    ? `Damit du in die Session kommst, brauchst du unsere iRacing-Liga. Falls du noch nicht drin bist, fordere den Beitritt hier an, wir bestätigen ihn: ${ligaLink}`
    : "Damit du in die Session kommst, nimmt dich die Rennleitung vor dem Rennen in unsere iRacing-Liga auf. Bitte nimm die Einladung in iRacing an.";
  return `✅ Deine Gastanfrage für **${serie.name} · ${r.titel || r.strecke}** (${termin(r)}) ist freigegeben. Du bist als Gast gemeldet, ohne Punkte für die Season.\n${liga}\nDie Freigabe gilt nur für dieses Rennen. Alles Weitere findest du im Fahrerbereich: https://darklineperformance.de/fahrerbereich`;
}
const ablehnungText = (serie, r, grund) => `❌ Deine Gastanfrage für **${serie.name} · ${r.titel || r.strecke}** wurde abgelehnt.${grund ? `\nGrund: ${grund}` : ""}\nBei Fragen melde dich im Discord bei der Rennleitung.`;

// Karte für den Rennleitungs-Kanal
const meldungKarte = (serie, r, a) => ({
  title: "Gastanfrage", url: "https://darklineperformance.de/liga-admin", color: 0xd3121b,
  fields: [
    { name: "Fahrer", value: a.name || "Unbekannt", inline: true },
    { name: "Rennen", value: `${serie.name} · ${r.titel || r.strecke}`, inline: true },
    { name: "Termin", value: termin(r) || "–", inline: true },
    ...(a.irating ? [{ name: "iRating", value: String(a.irating), inline: true }] : []),
    ...(a.fahrzeugklasse ? [{ name: "Klasse", value: a.fahrzeugklasse, inline: true }] : []),
    ...(a.nachricht ? [{ name: "Nachricht", value: a.nachricht }] : []),
  ],
});

// Link zur iRacing-Liga: nur iRacing-Adressen, damit in der Direktnachricht kein fremder Link landet
function ligaLinkPruefen(wert) {
  const t = String(wert || "").trim();
  if (!t) return "";
  let u;
  try { u = new URL(t); } catch (e) { throw new D.Hinweis("Bitte gib den vollständigen Link zur iRacing-Liga an, beginnend mit https://."); }
  if (u.protocol !== "https:" || !/(^|\.)iracing\.com$/i.test(u.hostname)) throw new D.Hinweis("Der Link muss zu iracing.com führen.");
  return u.toString().slice(0, 300);
}

module.exports = {
  anfrageLesen, anfrageSpeichern, anfrageLoeschen, eigeneAnfragen, alleAnfragen, anfragenDesRennens,
  gastSpeichern, gastLesen, alleGaeste, gaesteDesRennens, ligaMitglied, ligaHinweise,
  freigabeText, ablehnungText, meldungKarte, ligaLinkPruefen,
};
