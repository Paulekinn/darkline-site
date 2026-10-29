// GET: Wer ist angemeldet? (401, wenn niemand) · POST: abmelden
const { getSession, clearSession } = require("../_lib/session");

module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "POST") {
      clearSession(res);
      return res.status(200).json({ ok: true });
    }
    const s = getSession(req);
    if (!s) return res.status(401).json({ error: "Nicht angemeldet" });
    return res.status(200).json({ id: s.id, name: s.name });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
