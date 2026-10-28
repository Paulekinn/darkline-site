// Startet den GitHub-Login für den Admin-Bereich (Sveltia CMS).
const crypto = require("crypto");

module.exports = (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    res.status(500).send("GITHUB_CLIENT_ID fehlt in den Vercel-Umgebungsvariablen.");
    return;
  }
  const origin = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
  const state = crypto.randomBytes(16).toString("hex");
  res.setHeader("Set-Cookie", `oauth_state=${state}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/api/callback`,
    scope: "repo",
    state,
  });
  res.redirect(302, `https://github.com/login/oauth/authorize?${params}`);
};
