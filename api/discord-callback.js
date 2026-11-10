// Nimmt die Antwort von Discord entgegen, prüft Servermitgliedschaft und Rolle und meldet im Teambereich an.
// Beginnt der Status mit "liga.", geht es um den Fahrerbereich: Dort reicht die Servermitgliedschaft, und es gibt nur das Liga-Cookie.
// Beginnt er mit "liga-admin.", geht es um die Rennleitung: Dort ist eine Rolle aus LIGA_ADMIN_ROLE_IDS Pflicht.
const { appendCookie, readCookie, createSession, createLigaSession, createLigaAdminSession } = require("./_lib/session");

module.exports = async (req, res) => {
  const origin = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
  const saved = readCookie(req, "discord_state");
  const liga = saved.startsWith("liga.");
  const ligaAdmin = saved.startsWith("liga-admin.");
  const ziel = ligaAdmin ? "/liga-admin" : liga ? "/fahrerbereich" : "/team";
  // Fehler werden als kurzer Code an die Seite übergeben, die dazu den passenden Text zeigt.
  const fail = (code) => res.redirect(302, `${ziel}?fehler=${code}`);
  try {
    const { code, state } = req.query || {};
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

    if (ligaAdmin) {
      // Ohne eingetragene Rollen kommt niemand hinein.
      const rollen = (process.env.LIGA_ADMIN_ROLE_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!rollen.length) return fail("konfiguration");
      if (!(member.roles || []).some((r) => rollen.includes(r))) return fail("keine-rolle");
      const admin = member.user || {};
      createLigaAdminSession(res, { id: admin.id, name: member.nick || admin.global_name || admin.username || "Rennleitung" });
      return res.redirect(302, ziel);
    }

    if (liga) {
      const fahrer = member.user || {};
      // Nur für die Navigation: Mitglieder der Rennleitung sehen den Weg zu /liga-admin. Zugang gibt das nicht, dort wird die Rolle erneut geprüft.
      const leitungsRollen = (process.env.LIGA_ADMIN_ROLE_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
      const leitung = (member.roles || []).some((r) => leitungsRollen.includes(r));
      createLigaSession(res, { id: fahrer.id, name: member.nick || fahrer.global_name || fahrer.username || "Fahrer", avatar: fahrer.avatar || "", ...(leitung ? { leitung: true } : {}) });
      return res.redirect(302, ziel);
    }

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
