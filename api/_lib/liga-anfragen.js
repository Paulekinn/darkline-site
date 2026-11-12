// Beitrittsanfragen für private Seasons („Anmeldung auf Anfrage“): Der Fahrer fragt an, die Rennleitung gibt frei oder lehnt ab.
// Je Fahrer und Season eine Datei: liga/daten/anfragen/<serie>/<discordId>.json
//   { name, custId, irating, fahrzeugklasse, modell, nachricht, seit }
// Mit der Freigabe wird daraus eine normale Season-Anmeldung, die Datei verschwindet dann.
const { blobInhalte, blobDelete, blobGet, blobPut } = require("./blob");
const D = require("./liga-daten");

const WURZEL = "liga/daten/anfragen/";
const pfad = (serieId, discordId) => `${WURZEL}${D.brauchtId(serieId)}/${D.brauchtId(discordId)}.json`;

const lesen = async (serieId, discordId) => { const t = await blobGet(pfad(serieId, discordId)); return t ? JSON.parse(t) : null; };
// Die eigenen offenen Anfragen: Set der Serien-IDs. Gelesen wird nur bei Seasons mit Anmeldung auf Anfrage.
async function eigene(serien, discordId) {
  const privat = serien.filter((s) => s.aufAnfrage && s.status !== "beendet");
  const treffer = await Promise.all(privat.map(async (s) => ((await lesen(s.id, discordId).catch(() => null)) ? s.id : null)));
  return new Set(treffer.filter(Boolean));
}
// Alle offenen Anfragen aller Seasons für das Cockpit, älteste zuerst
async function alle() {
  return (await blobInhalte(WURZEL)).map(([p, t]) => { const [serie, datei] = p.slice(WURZEL.length).split("/"); return { serie, discordId: datei.replace(/\.json$/, ""), ...JSON.parse(t) }; }).sort((a, b) => String(a.seit).localeCompare(String(b.seit)));
}

const speichern = (serieId, discordId, daten) => blobPut(pfad(serieId, discordId), JSON.stringify({ ...daten, seit: new Date().toISOString() }), "application/json");
const loeschen = (serieId, discordId) => blobDelete([pfad(serieId, discordId)]);
const derSerieLoeschen = async (serieId) => { const p = (await blobInhalte(`${WURZEL}${D.brauchtId(serieId)}/`)).map(([x]) => x); if (p.length) await blobDelete(p); };

// Texte der Direktnachrichten nach der Entscheidung
const freigabeText = (serie) => `✅ Deine Beitrittsanfrage für **${serie.name}** ist freigegeben. Du bist jetzt für die Season angemeldet. Alles Weitere findest du im Fahrerbereich: https://darklineperformance.de/fahrerbereich`;
const ablehnungText = (serie, grund) => `❌ Deine Beitrittsanfrage für **${serie.name}** wurde abgelehnt.${grund ? `\nGrund: ${grund}` : ""}\nBei Fragen melde dich im Discord bei der Rennleitung.`;

// Karte für den Rennleitungs-Kanal
const meldungKarte = (serie, a) => ({
  title: "Beitrittsanfrage", url: "https://darklineperformance.de/liga-admin", color: 0xd3121b,
  fields: [
    { name: "Fahrer", value: a.name || "Unbekannt", inline: true },
    { name: "Season", value: serie.name, inline: true },
    ...(a.irating ? [{ name: "iRating", value: String(a.irating), inline: true }] : []),
    ...(a.modell ? [{ name: "Fahrzeug", value: a.modell, inline: true }] : []),
    ...(a.nachricht ? [{ name: "Nachricht", value: a.nachricht }] : []),
  ],
});

module.exports = { lesen, eigene, alle, speichern, loeschen, derSerieLoeschen, freigabeText, ablehnungText, meldungKarte };
