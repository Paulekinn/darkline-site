// Öffentliche Fahrerprofile. Die freiwilligen Angaben stehen im Dateinamen, damit eine einzige Abfrage alle Profile liefert:
//   liga/fahrerprofile/<kennung>~<angaben base64url>
// Die Kennung ist anonym, Discord-ID und iRacing-ID stehen hier nicht. "o" ist nur ein Prüfwert, wem der Eintrag gehört, und wird nie ausgeliefert.
const crypto = require("crypto");
const { blobPut, blobGet, blobDelete, blobList, blobInhalte } = require("./blob");
const D = require("./liga-daten");
const { fahrerKennung } = require("./session");
const { Hinweis } = D;
const { eventErfolge } = require("./liga-events");

const PREFIX = "liga/fahrerprofile/";
const PID = /^[0-9a-f]{16}$/;

const profilPfad = (pid, daten) => `${PREFIX}${pid}~${Buffer.from(JSON.stringify(daten), "utf8").toString("base64url")}`;

function leseProfil(blob) {
  const m = new RegExp(`^${PREFIX}([0-9a-f]{16})~([A-Za-z0-9_-]+)$`).exec(blob.pathname || "");
  if (!m) return null;
  try {
    return { pfad: blob.pathname, pid: m[1], ...JSON.parse(Buffer.from(m[2], "base64url").toString("utf8")) };
  } catch (e) {
    return null;
  }
}

// Was öffentlich sichtbar ist
const oeffentlich = (p) => (p ? { nummer: p.n || null, land: p.l || "", team: p.t || "", kanal: p.k || "", bild: p.b || "" } : null);

const avatarUrl = (id, hash) => (/^\d{5,25}$/.test(String(id)) && /^(a_)?[0-9a-f]{32}$/.test(String(hash)) ? `https://cdn.discordapp.com/avatars/${id}/${hash}.webp?size=256` : null);

let cache = { bis: 0, wert: null };
async function alleProfile(frisch) {
  if (!frisch && cache.wert && cache.bis > Date.now()) return cache.wert;
  const wert = (await blobList(PREFIX)).map(leseProfil).filter(Boolean);
  cache = { bis: Date.now() + 30000, wert };
  return wert;
}

async function oeffentlicheProfile() {
  try {
    return Object.fromEntries((await alleProfile(false)).map((p) => [p.pid, oeffentlich(p)]));
  } catch (e) {
    return {}; // Ohne Zusatzangaben bleibt die Seite trotzdem nutzbar.
  }
}

// Holt das Discord-Bild auf den eigenen Speicher, damit Besucher keine Verbindung zu Discord aufbauen.
async function avatarSichern(pid, s) {
  const url = avatarUrl(s.id, s.avatar);
  if (!url) return false;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return false;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 3 * 1024 * 1024 || !D.bildTyp(buf)) return false;
    await D.bildSpeichern(`fahrer-${pid}`, buf);
    return true;
  } catch (e) {
    console.warn("Liga: Discord-Bild konnte nicht übernommen werden:", e.message);
    return false;
  }
}

const besitzerVon = (s) => crypto.createHash("sha256").update(`liga-besitzer:${s.id}:${process.env.SESSION_SECRET}`).digest("hex").slice(0, 16);
const bildVeraltet = (p, besitzer, version) => !!p && p.o === besitzer && !!version && p.b !== version;

// Ein fehlgeschlagener Abruf wird pro Funktionsinstanz nur einmal versucht, damit der Fahrerbereich nicht jedes Mal wartet.
const bildVersuche = new Set();

// Beim Öffnen des Fahrerbereichs: nach dem Login steht das aktuelle Discord-Bild bereit, das Profil muss dafür nicht neu gespeichert werden.
async function bildNachziehen(s, profil) {
  if (!profil || profil.zeigeBild !== true || !s.avatar) return;
  const pid = fahrerKennung(profil.custId);
  const version = String(s.avatar).slice(-8);
  const p = (await alleProfile(false)).find((x) => x.pid === pid);
  if (!bildVeraltet(p, besitzerVon(s), version) || bildVersuche.has(`${pid}:${version}`)) return;
  bildVersuche.add(`${pid}:${version}`);
  if (!await avatarSichern(pid, s)) return;
  const { pfad, pid: kennung, ...daten } = p;
  await blobPut(profilPfad(pid, { ...daten, b: version }), "1", "text/plain");
  await blobDelete([pfad]);
  cache = { bis: 0, wert: null };
}

function pruefeKonflikte(alle, pid, besitzer, nummer) {
  if (alle.some((p) => p.pid === pid && p.o !== besitzer)) throw new Hinweis("Diese iRacing-ID gehört bereits zu einem anderen Profil. Bitte wende dich an die Rennleitung.");
  if (nummer && alle.some((p) => p.n === nummer && p.o !== besitzer)) throw new Hinweis(`Die Startnummer ${nummer} ist schon vergeben. Bitte wähle eine andere.`);
}

/* ---------- Anträge auf eine andere Startnummer: Der Fahrer stellt sie, die Rennleitung bestätigt oder lehnt ab ---------- */
const WUNSCH_PREFIX = "liga/nummernwuensche/";
const wunschPfad = (discordId) => `${WUNSCH_PREFIX}${discordId}`;

async function wunschLesen(discordId) {
  const t = await blobGet(wunschPfad(discordId));
  return t ? JSON.parse(t) : null;
}
const wuenscheLesen = async () => (await blobInhalte(WUNSCH_PREFIX)).map(([, t]) => JSON.parse(t)).sort((a, b) => String(a.seit).localeCompare(String(b.seit)));
const wunschLoeschen = (discordId) => blobDelete([wunschPfad(discordId)]);

// Eine beantragte Nummer ist für alle anderen reserviert.
const istBeantragt = (wuensche, nummer, discordId) => wuensche.some((w) => w.nach === nummer && w.discordId !== discordId);

// Gibt true zurück, wenn der Antrag neu ist. Wer denselben Antrag noch einmal speichert, löst keine weitere Meldung aus.
async function wunschSetzen(s, name, von, nach) {
  const [alle, wuensche] = await Promise.all([alleProfile(true), wuenscheLesen()]);
  if (alle.some((p) => p.n === nach && p.o !== besitzerVon(s)) || istBeantragt(wuensche, nach, s.id)) throw new Hinweis(`Die Startnummer ${nach} ist schon vergeben. Bitte wähle eine andere.`);
  if (wuensche.some((w) => w.discordId === s.id && w.nach === nach)) return false;
  await blobPut(wunschPfad(s.id), JSON.stringify({ discordId: s.id, name, von, nach, seit: new Date().toISOString() }), "application/json");
  return true;
}

// Speichert die öffentlichen Angaben eines Fahrers. Wirft einen Hinweis, wenn iRacing-ID oder Startnummer schon vergeben sind.
async function speichern(s, profil, extras) {
  const [alle, wuensche] = await Promise.all([alleProfile(true), wuenscheLesen()]);
  const pid = fahrerKennung(profil.custId);
  const besitzer = besitzerVon(s);
  pruefeKonflikte(alle, pid, besitzer, extras.nummer);
  if (extras.nummer && istBeantragt(wuensche, extras.nummer, s.id)) throw new Hinweis(`Die Startnummer ${extras.nummer} ist schon vergeben. Bitte wähle eine andere.`);
  const eigene = alle.filter((p) => p.o === besitzer);
  const vorher = eigene.find((p) => p.pid === pid);
  let bild = (vorher && vorher.b) || "";
  if (extras.zeigeBild) {
    const version = String(s.avatar || "").slice(-8);
    if (version && version !== bild && await avatarSichern(pid, s)) bild = version;
  } else {
    if (bild) await D.bildLoeschen(`fahrer-${pid}`).catch(() => {});
    bild = "";
  }
  const pfad = profilPfad(pid, { o: besitzer, n: extras.nummer, l: extras.land, t: extras.team, k: extras.kanal, b: bild });
  await blobPut(pfad, "1", "text/plain");
  // Alte Einträge weg, auch wenn sich die iRacing-ID geändert hat
  const veraltet = eigene.filter((p) => p.pfad !== pfad);
  if (veraltet.length) await blobDelete(veraltet.map((p) => p.pfad));
  for (const p of veraltet) if (p.pid !== pid && p.b) await D.bildLoeschen(`fahrer-${p.pid}`).catch(() => {});
  cache = { bis: 0, wert: null };
}

async function angabenVon(pid) {
  return oeffentlich((await alleProfile(false)).find((p) => p.pid === pid));
}

// Alles zu einem Fahrer über alle Serien: Karten, Bilanz und Ergebnisverlauf
function fahrerAkte(serien, tabellen, pid) {
  const treffer = serien.flatMap((s) => {
    const t = tabellen.get(s.id);
    if (!t || !Array.isArray(t.klassen)) return [];
    return t.klassen.flatMap((k) => k.fahrer.filter((f) => f.pid === pid && f.karte).map((f) => ({ s, t, k, f })));
  });
  if (!treffer.length) return null;
  const verlauf = treffer.flatMap(({ s, t, k, f }) => f.rennen.map((r, i) => r && t.rennen[i] && {
    serie: s.id, serieName: s.name, serieFarbe: s.farbe || "rot", event: s.typ === "event", klasse: k.name, nr: t.rennen[i].nr, strecke: t.rennen[i].strecke, start: t.rennen[i].start,
    platz: r.platz, status: r.status, punkte: r.punkte, pole: r.pole, schnellsteRunde: r.schnellsteRunde, strafe: r.strafe, gestrichen: r.gestrichen, zeitstrafe: r.zeitstrafe,
  }).filter(Boolean)).sort((a, b) => String(b.start).localeCompare(String(a.start)));
  const anzahl = (bedingung) => verlauf.filter(bedingung).length;
  return {
    name: treffer[0].f.name,
    bilanz: { starts: verlauf.length, siege: anzahl((r) => r.platz === 1), podien: anzahl((r) => r.platz !== null && r.platz <= 3), poles: anzahl((r) => r.pole), schnellste: anzahl((r) => r.schnellsteRunde), ausfaelle: anzahl((r) => r.status !== "OK") },
    erfolge: eventErfolge(serien, tabellen, pid),
    karten: treffer.map(({ s, t, k, f }) => ({ pid, serie: s.id, serieName: s.name, serieTyp: s.typ || "liga", bildVersion: s.bildVersion || 0, rennenGesamt: t.rennenGesamt, klasseId: k.id, klasse: k.name, offen: k.offen, min: k.min, max: k.max, name: f.name, pos: f.pos, punkte: f.punkte, rennen: f.rennen, karte: f.karte })),
    verlauf,
  };
}

let tabellenCache = { bis: 0, wert: null };
async function alleTabellen(serien) {
  if (tabellenCache.wert && tabellenCache.bis > Date.now()) return tabellenCache.wert;
  const wert = new Map(await Promise.all(serien.map(async (s) => [s.id, await D.tabelleLesen(s.id).catch(() => null)])));
  tabellenCache = { bis: Date.now() + 30000, wert };
  return wert;
}

// ?r=profil&id=<kennung>
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Nicht erlaubt" });
  const pid = String((req.query || {}).id || "");
  if (!PID.test(pid)) return res.status(404).json({ error: "Nicht gefunden" });
  const { serien } = await D.katalog(false);
  const akte = fahrerAkte(serien, await alleTabellen(serien), pid);
  if (!akte) return res.status(404).json({ error: "Nicht gefunden" });
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
  return res.status(200).json({ pid, ...akte, profil: await angabenVon(pid) });
}

module.exports = handler;
Object.assign(module.exports, { bildNachziehen, bildVeraltet, oeffentlicheProfile, speichern, angabenVon, fahrerAkte, leseProfil, profilPfad, oeffentlich, avatarUrl, pruefeKonflikte, wunschLesen, wuenscheLesen, wunschLoeschen, wunschSetzen, istBeantragt });
