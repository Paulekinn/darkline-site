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

// Für die Daten-Funktionen: antwortet ohne gültige Anmeldung mit 401 und gibt null zurück.
function requireSession(req, res) {
  const s = getSession(req);
  if (!s) res.status(401).json({ error: "Nicht angemeldet" });
  return s;
}

module.exports = { appendCookie, readCookie, createSession, clearSession, getSession, requireSession };
