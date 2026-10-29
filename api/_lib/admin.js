// Zugang für Admin-Werkzeuge (z. B. /admin/rennbericht): dieselbe GitHub-Anmeldung wie im CMS.
// Erlaubt ist, wer in ALLOWED_GITHUB_USERS steht; ist die Liste leer, wer Schreibrechte im Website-Repository hat.
const crypto = require("crypto");

const REPO = process.env.GITHUB_REPO || "Paulekinn/darkline-site";
const seen = new Map(); // Token-Hash → { login, until }, damit nicht jede Anfrage GitHub fragt

async function github(path, token) {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "darkline-admin" },
  });
  return r.ok ? r.json() : null;
}

async function check(token) {
  const user = await github("/user", token);
  if (!user || !user.login) return null;
  const allowed = (process.env.ALLOWED_GITHUB_USERS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length) return allowed.includes(user.login.toLowerCase()) ? user.login : null;
  const repo = await github(`/repos/${REPO}`, token);
  return repo && repo.permissions && repo.permissions.push ? user.login : null;
}

// Antwortet bei fehlender oder ungültiger Anmeldung mit 401/403 und gibt null zurück, sonst den GitHub-Namen.
async function requireAdmin(req, res) {
  const token = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || "");
  if (!token) {
    res.status(401).json({ error: "Bitte mit GitHub anmelden." });
    return null;
  }
  const key = crypto.createHash("sha256").update(token[1]).digest("hex");
  const hit = seen.get(key);
  if (hit && hit.until > Date.now()) return hit.login;
  const login = await check(token[1]);
  if (!login) {
    res.status(403).json({ error: "Dieses GitHub-Konto hat keinen Zugang zum Admin-Bereich." });
    return null;
  }
  seen.set(key, { login, until: Date.now() + 10 * 60 * 1000 });
  return login;
}

module.exports = { requireAdmin };
