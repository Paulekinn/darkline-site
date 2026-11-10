// Discord-Rollen und Servername der Fahrer. Ohne DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, LIGA_ROLLE_INTERESSENT und LIGA_ROLLE_FAHRER passiert nichts.
// Was in Discord angekommen ist, steht im privaten Profil unter "discord". Ein fehlgeschlagener Aufruf wird deshalb beim nächsten Öffnen des Fahrerbereichs nachgeholt.
// Ein Fehler hier darf nie eine Anmeldung oder das Speichern eines Profils verhindern.
const { blobPut } = require("./blob");
const A = require("./liga-anmeldung");

const API = "https://discord.com/api/v10";
const MAX_NAME = 32;

function zugang() {
  const { DISCORD_BOT_TOKEN: token, DISCORD_GUILD_ID: server, LIGA_ROLLE_INTERESSENT: interessent, LIGA_ROLLE_FAHRER: fahrer } = process.env;
  return token && server && interessent && fahrer ? { token, server, interessent, fahrer } : null;
}
const aktiv = () => !!zugang();

const servername = (nummer, name) => `#${nummer} ${name}`.slice(0, MAX_NAME).trim();
const istLaufendeLiga = (s) => !!s && s.typ !== "event" && s.status !== "beendet";

// Der gewünschte Stand: Rolle Interessent ab vollständigem Profil, Rolle Fahrer und Name mit Nummer nur in einer laufenden Liga.
function soll(discordId, profil, alle, serien) {
  const komplett = !!(profil.iracingName && profil.custId && profil.nummer);
  const nachId = new Map(serien.map((s) => [s.id, s]));
  const fahrer = komplett && alle.some((e) => e.typ === "serie" && e.discordId === discordId && istLaufendeLiga(nachId.get(e.serieId)));
  return { i: komplett, f: fahrer, n: fahrer ? servername(profil.nummer, profil.iracingName) : "" };
}

// Nötige Schritte vom bisherigen zum gewünschten Stand. Die Rolle Interessent wird nur vergeben, nie entzogen.
// Wer keine Liga mehr fährt, verliert die Nummer im Namen und behält den Fahrernamen.
function schritte(vorher, ziel, name) {
  const liste = [];
  if (ziel.i && !vorher.i) liste.push({ art: "interessent", weg: false, neu: { i: true } });
  if (ziel.f !== !!vorher.f) liste.push({ art: "fahrer", weg: !ziel.f, neu: { f: ziel.f } });
  if (ziel.f && vorher.n !== ziel.n) liste.push({ art: "name", wert: ziel.n, neu: { n: ziel.n } });
  if (!ziel.f && vorher.f) liste.push({ art: "name", wert: String(name).slice(0, MAX_NAME), neu: { n: "" } });
  return liste;
}

async function ausfuehren(z, discordId, s) {
  const mitglied = `${API}/guilds/${z.server}/members/${discordId}`;
  const url = s.art === "name" ? mitglied : `${mitglied}/roles/${z[s.art]}`;
  const methode = s.art === "name" ? "PATCH" : s.weg ? "DELETE" : "PUT";
  const r = await fetch(url, {
    method: methode,
    headers: { Authorization: `Bot ${z.token}`, ...(s.art === "name" ? { "Content-Type": "application/json" } : {}) },
    ...(s.art === "name" ? { body: JSON.stringify({ nick: s.wert }) } : {}),
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) console.warn(`Liga: Discord lehnt ${s.art} ab (Code ${r.status}).`);
  return r.ok;
}

// Gibt das Profil mit dem neuen Discord-Stand zurück. Ist alles aktuell, geht keine Anfrage an Discord.
async function abgleichen(discordId, profil, alle, serien) {
  const z = zugang();
  if (!z || !profil) return profil;
  try {
    const vorher = profil.discord || {};
    const offen = schritte(vorher, soll(discordId, profil, alle, serien), profil.iracingName);
    if (!offen.length) return profil;
    let neu = { ...vorher };
    for (const s of offen) if (await ausfuehren(z, discordId, s).catch((e) => { console.warn("Liga: Discord nicht erreichbar:", e.message); return false; })) neu = { ...neu, ...s.neu };
    if (JSON.stringify(neu) === JSON.stringify(vorher)) return profil;
    const aktualisiert = { ...profil, discord: neu };
    await blobPut(A.profilPfad(discordId), JSON.stringify(aktualisiert), "application/json");
    return aktualisiert;
  } catch (e) {
    console.warn("Liga: Discord-Abgleich fehlgeschlagen:", e.message);
    return profil;
  }
}

module.exports = { aktiv, abgleichen, soll, schritte, servername };
