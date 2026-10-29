// Nimmt die Antwort von Discord entgegen, prüft Servermitgliedschaft und Rolle und meldet im Teambereich an.
const { appendCookie, readCookie, createSession } = require("./_lib/session");

module.exports = async (req, res) => {
  const origin = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
  // Fehler werden als kurzer Code an /team übergeben, team.js zeigt dazu den passenden Text.
  const fail = (code) => res.redirect(302, `/team?fehler=${code}`);
  try {
    const { code, state } = req.query || {};
    const saved = readCookie(req, "discord_state");
    appendCookie(res, "discord_state=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    if (req.query && req.query.error) return fail("abgebrochen");
    if (!code || !state || !saved || saved !== state) return fail("ungueltig");

    const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_GUILD_ID } = process.env;
    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_GUILD_ID) return fail("konfiguration");
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) return fail("konfiguration");

    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: `${origin}/api/discord-callback`,
      }),
    });
    const token = await tokenRes.json();
    if (!token.access_token) return fail("discord");

    const memberRes = await fetch(`https://discord.com/api/users/@me/guilds/${DISCORD_GUILD_ID}/member`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (memberRes.status === 404) return fail("kein-mitglied");
    if (!memberRes.ok) return fail("discord");
    const member = await memberRes.json();

    // Optional: nur bestimmte Rollen zulassen (Rollen-IDs, Komma-getrennt). Eine davon genügt.
    const allowed = (process.env.DISCORD_ROLE_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (allowed.length && !(member.roles || []).some((r) => allowed.includes(r))) return fail("keine-rolle");

    const user = member.user || {};
    createSession(res, { id: user.id, name: member.nick || user.global_name || user.username || "Teammitglied" });
    return res.redirect(302, "/team");
  } catch (e) {
    return fail("technik");
  }
};
