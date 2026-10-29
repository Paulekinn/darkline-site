// Startet die Discord-Anmeldung für den Teambereich (/team).
const crypto = require("crypto");

module.exports = (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    res.status(500).send("DISCORD_CLIENT_ID fehlt in den Vercel-Umgebungsvariablen.");
    return;
  }
  const origin = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
  const state = crypto.randomBytes(16).toString("hex");
  res.setHeader("Set-Cookie", `discord_state=${state}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/api/discord-callback`,
    response_type: "code",
    // identify: Discord-ID und Name; guilds.members.read: Mitgliedschaft und Rollen auf unserem Server
    scope: "identify guilds.members.read",
    state,
  });
  res.redirect(302, `https://discord.com/oauth2/authorize?${params}`);
};
