// Anmeldung für den Teambereich: signiertes Cookie, ohne Datenbank.
// Dateien in api/_lib werden von Vercel nicht als eigene Funktion veröffentlicht.
const crypto = require("crypto");

const COOKIE = "dpm_team";
const MAX_AGE = 7 * 24 * 3600; // 7 Tage, danach erneut mit Discord anmelden

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET fehlt in den Vercel-Umgebungsvariablen (mindestens 32 Zeichen).");
  return s;
}

const sign = (data) => crypto.createHmac("sha256", secret()).update(data).digest("base64url");

function appendCookie(res, cookie) {
  const prev = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", prev ? [].concat(prev, cookie) : cookie);
}

function readCookie(req, name) {
  const c = (req.headers.cookie || "").split(/;\s*/).find((x) => x.startsWith(`${name}=`));
  return c ? c.slice(name.length + 1) : "";
}

function createSession(res, user) {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString("base64url");
  appendCookie(res, `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`);
}

function clearSession(res) {
  appendCookie(res, `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

// Gibt die angemeldete Person zurück ({ id, name }) oder null.
function getSession(req) {
  const [payload, sig] = readCookie(req, COOKIE).split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.exp > Date.now() / 1000 ? data : null;
  } catch (e) {
    return null;
  }
}

// Ligafahrer: eigenes Cookie mit eigener Signatur. Es gilt nur im Fahrerbereich und nie im Teambereich.
const LIGA_COOKIE = "dpm_liga";
const signLiga = (data) => sign(`liga:${data}`);

function createLigaSession(res, user) {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString("base64url");
  appendCookie(res, `${LIGA_COOKIE}=${payload}.${signLiga(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`);
}

function clearLigaSession(res) {
  appendCookie(res, `${LIGA_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

function getLigaSession(req) {
  const [payload, sig] = readCookie(req, LIGA_COOKIE).split(".");
  if (!payload || !sig) return null;
  const expected = signLiga(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.exp > Date.now() / 1000 ? data : null;
  } catch (e) {
    return null;
  }
}

// Liga-Admin (/liga-admin): eigenes Cookie, eigene Signatur, kurze Laufzeit. Es gilt nirgendwo sonst.
const LIGA_ADMIN_COOKIE = "dpm_liga_admin";
const LIGA_ADMIN_MAX_AGE = 12 * 3600;
const signLigaAdmin = (data) => sign(`liga-admin:${data}`);

function createLigaAdminSession(res, user) {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + LIGA_ADMIN_MAX_AGE })).toString("base64url");
  appendCookie(res, `${LIGA_ADMIN_COOKIE}=${payload}.${signLigaAdmin(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${LIGA_ADMIN_MAX_AGE}`);
}

function clearLigaAdminSession(res) {
  appendCookie(res, `${LIGA_ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

function getLigaAdminSession(req) {
  const [payload, sig] = readCookie(req, LIGA_ADMIN_COOKIE).split(".");
  if (!payload || !sig) return null;
  const expected = signLigaAdmin(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.exp > Date.now() / 1000 ? data : null;
  } catch (e) {
    return null;
  }
}

// Anonyme Fahrerkennung für öffentliche Daten: gleiche iRacing-ID ergibt immer dieselbe Kennung, zurückrechnen lässt sie sich ohne das Geheimnis nicht.
const fahrerKennung = (cust) => crypto.createHmac("sha256", secret()).update(`liga-fahrer:${cust}`).digest("hex").slice(0, 16);

// Für die Daten-Funktionen: antwortet ohne gültige Anmeldung mit 401 und gibt null zurück.
function requireSession(req, res) {
  const s = getSession(req);
  if (!s) res.status(401).json({ error: "Nicht angemeldet" });
  return s;
}

module.exports = { fahrerKennung, appendCookie, readCookie, createSession, clearSession, getSession, requireSession, createLigaSession, clearLigaSession, getLigaSession, createLigaAdminSession, clearLigaAdminSession, getLigaAdminSession };
