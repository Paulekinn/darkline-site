// Discord-Rollen und Servername der Fahrer. Ohne DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, LIGA_ROLLE_INTERESSENT und LIGA_ROLLE_FAHRER passiert nichts.
// Was in Discord angekommen ist, steht im privaten Profil unter "discord". Ein fehlgeschlagener Aufruf wird deshalb beim nächsten Öffnen des Fahrerbereichs nachgeholt.
// Ein Fehler hier darf nie eine Anmeldung oder das Speichern eines Profils verhindern.
const A = require("./liga-anmeldung");
const D = require("./liga-daten");

const API = "https://discord.com/api/v10";
const MAX_NAME = 32;

function zugang() {
  const { DISCORD_BOT_TOKEN: token, DISCORD_GUILD_ID: server, LIGA_ROLLE_INTERESSENT: interessent, LIGA_ROLLE_FAHRER: fahrer } = process.env;
  return token && server && interessent && fahrer ? { token, server, interessent, fahrer } : null;
}
const aktiv = () => !!zugang();

const servername = (nummer, name) => `#${nummer} ${name}`.slice(0, MAX_NAME).trim();
const istLaufendeLiga = (s) => !!s && s.typ !== "event" && s.status !== "beendet";

// Der gewünschte Stand: Vollständiges Profil gibt die Rolle Interessent und den Fahrernamen, die Nummer davor nur eine laufende Liga.
function soll(discordId, profil, alle, serien) {
  const komplett = !!(profil.iracingName && profil.custId && profil.nummer);
  const nachId = new Map(serien.map((s) => [s.id, s]));
  const fahrer = komplett && alle.some((e) => e.typ === "serie" && e.discordId === discordId && istLaufendeLiga(nachId.get(e.serieId)));
  const name = !komplett ? "" : fahrer ? servername(profil.nummer, profil.iracingName) : String(profil.iracingName).slice(0, MAX_NAME).trim();
  return { i: komplett, f: fahrer, n: name };
}

// Nötige Schritte vom bisherigen zum gewünschten Stand. Die Rolle Interessent wird nur vergeben, nie entzogen.
function schritte(vorher, ziel) {
  const liste = [];
  if (ziel.i && !vorher.i) liste.push({ art: "interessent", weg: false, neu: { i: true } });
  if (ziel.f !== !!vorher.f) liste.push({ art: "fahrer", weg: !ziel.f, neu: { f: ziel.f } });
  if (ziel.n && vorher.n !== ziel.n) liste.push({ art: "name", wert: ziel.n, neu: { n: ziel.n } });
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

// Das Mitglied in Discord. null: nicht (mehr) auf dem Server. undefined: Discord hat nicht geantwortet.
async function mitgliedLesen(z, discordId) {
  try {
    const r = await fetch(`${API}/guilds/${z.server}/members/${discordId}`, { headers: { Authorization: `Bot ${z.token}` }, signal: AbortSignal.timeout(4000) });
    if (r.status === 404) return null;
    if (!r.ok) return undefined;
    const m = await r.json();
    return m && m.joined_at ? { seit: String(m.joined_at), nick: m.nick || "" } : undefined;
  } catch (e) {
    return undefined;
  }
}

// Wer den Server verlässt, verliert dort Rollen und Namen. Der gemerkte Stand stimmt dann nicht mehr.
// Merkmal ist das Beitrittsdatum ("seit"), nicht die Rolle: Die Rolle Interessent vergibt auch das Discord-Onboarding.
// Neues Beitrittsdatum: alles wird erneut gesetzt. Profile von vor dieser Prüfung haben noch kein Datum. Passt dort der
// Name, wird nur das Datum übernommen, sonst einmal alles neu gesetzt.
// Pro Funktionsinstanz höchstens alle 10 Minuten je Fahrer, damit nicht jeder Seitenaufruf Discord fragt.
const PRUEF_ABSTAND = 10 * 60 * 1000;
const geprueft = new Map();
function nachPruefung(vorher, m) {
  if (!m) return vorher;
  if (vorher.seit === m.seit) return vorher;
  if (!vorher.seit && vorher.n && m.nick === vorher.n) return { ...vorher, seit: m.seit };
  return { seit: m.seit };
}
async function gemerkterStand(z, discordId, vorher, sofort) {
  if (!vorher.i) return vorher;
  if (!sofort && (geprueft.get(discordId) || 0) > Date.now() - PRUEF_ABSTAND) return vorher;
  geprueft.set(discordId, Date.now());
  return nachPruefung(vorher, await mitgliedLesen(z, discordId));
}

// Gibt das Profil mit dem neuen Discord-Stand zurück. Ist alles aktuell, geht höchstens eine Prüfanfrage an Discord.
async function abgleichen(discordId, profil, alle, serien, { sofort = false } = {}) {
  const z = zugang();
  if (!z || !profil) return profil;
  try {
    const ziel = soll(discordId, profil, alle, serien);
    let vorher = profil.discord || {};
    let offen = schritte(vorher, ziel);
    if (!offen.length) {
      vorher = await gemerkterStand(z, discordId, vorher, sofort);
      offen = schritte(vorher, ziel);
    }
    // Nur das Beitrittsdatum ist neu: merken, ohne Discord zu ändern.
    if (!offen.length && vorher.seit !== (profil.discord || {}).seit) {
      return (await D.jsonAendern(A.profilPfad(discordId), (aktuell) => (aktuell ? { ...aktuell, discord: vorher } : undefined))) || profil;
    }
    if (!offen.length) return profil;
    geprueft.set(discordId, Date.now());
    let neu = { ...vorher };
    for (const s of offen) if (await ausfuehren(z, discordId, s).catch((e) => { console.warn("Liga: Discord nicht erreichbar:", e.message); return false; })) neu = { ...neu, ...s.neu };
    if (JSON.stringify(neu) === JSON.stringify(vorher)) return profil;
    // Discord antwortet in Sekunden. Gespeichert wird deshalb nur der Discord-Stand am aktuellen Profil, damit eine Änderung in der Zwischenzeit erhalten bleibt.
    // Wurde das Profil inzwischen gelöscht, wird es nicht neu angelegt.
    return (await D.jsonAendern(A.profilPfad(discordId), (aktuell) => (aktuell ? { ...aktuell, discord: neu } : undefined))) || profil;
  } catch (e) {
    console.warn("Liga: Discord-Abgleich fehlgeschlagen:", e.message);
    return profil;
  }
}

// Täglich über /api/wach: alle Profile mit Discord-Stand prüfen, damit wiederkehrende Mitglieder Rolle und Namen auch ohne Besuch der Website zurückbekommen.
// Drei gleichzeitig, damit Discord nicht bremst. Gibt die Zahl der neu gesetzten Fahrer zurück.
async function alleAbgleichen() {
  if (!zugang()) return 0;
  const { blobList, blobInhalte } = require("./blob");
  const [profile, alle, kat] = await Promise.all([blobInhalte("liga/fahrer/"), blobList(A.PREFIX), D.katalog(false)]);
  const eintraege = alle.map(A.leseEintrag).filter(Boolean);
  const liste = profile.map(([pfad, text]) => {
    const m = /^liga\/fahrer\/(\d{5,25})\.json$/.exec(pfad);
    try { return m ? [m[1], JSON.parse(text)] : null; } catch (e) { return null; }
  }).filter((x) => x && x[1] && x[1].discord && x[1].discord.i);
  let neu = 0;
  for (let i = 0; i < liste.length; i += 3) {
    await Promise.all(liste.slice(i, i + 3).map(async ([id, profil]) => {
      const danach = await abgleichen(id, profil, eintraege, kat.serien, { sofort: true });
      if (danach !== profil) neu++;
    }));
  }
  return neu;
}

// Direktnachricht an einen Fahrer. Sie kann scheitern, wenn er Nachrichten vom Server gesperrt hat. Der Hinweis im Fahrerbereich bleibt davon unberührt.
async function nachricht(discordId, text) {
  const z = zugang();
  if (!z) return false;
  const senden = (url, daten) => fetch(url, { method: "POST", headers: { Authorization: `Bot ${z.token}`, "Content-Type": "application/json" }, body: JSON.stringify(daten), signal: AbortSignal.timeout(4000) });
  try {
    const kanal = await senden(`${API}/users/@me/channels`, { recipient_id: discordId });
    if (!kanal.ok) { console.warn(`Liga: Discord öffnet keine Direktnachricht (Code ${kanal.status}).`); return false; }
    const r = await senden(`${API}/channels/${(await kanal.json()).id}/messages`, { content: String(text).slice(0, 1900), allowed_mentions: { parse: [] } });
    if (!r.ok) console.warn(`Liga: Discord lehnt die Direktnachricht ab (Code ${r.status}).`);
    return r.ok;
  } catch (e) {
    console.warn("Liga: Direktnachricht fehlgeschlagen:", e.message);
    return false;
  }
}

module.exports = { aktiv, abgleichen, alleAbgleichen, nachricht, soll, schritte, servername, nachPruefung };
