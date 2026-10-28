// Nimmt die Antwort von GitHub entgegen und übergibt den Zugang an das Admin-Fenster.
const page = (status, content, origin) => `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Anmeldung</title></head>
<body style="background:#08090a;color:#e8ecea;font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0">
<p>${status === "success" ? "Anmeldung erfolgreich – dieses Fenster schließt sich." : "Anmeldung fehlgeschlagen."}</p>
<script>
(function () {
  var msg = "authorization:github:${status}:" + ${JSON.stringify(JSON.stringify(content))};
  function receive(e) {
    if (e.origin !== ${JSON.stringify(origin)}) return;
    window.opener.postMessage(msg, e.origin);
    window.removeEventListener("message", receive);
    setTimeout(function () { window.close(); }, 400);
  }
  window.addEventListener("message", receive, false);
  if (window.opener) window.opener.postMessage("authorizing:github", ${JSON.stringify(origin)});
})();
</script></body></html>`;

module.exports = async (req, res) => {
  const origin = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const fail = (message) => res.status(200).send(page("error", { message }, origin));
  try {
    const { code, state } = req.query || {};
    const cookie = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith("oauth_state="));
    if (!code || !state || !cookie || cookie.split("=")[1] !== state) return fail("Ungültige Anfrage. Bitte erneut anmelden.");
    res.setHeader("Set-Cookie", "oauth_state=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=0");

    const r = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${origin}/api/callback`,
      }),
    });
    const data = await r.json();
    if (!data.access_token) return fail(data.error_description || "GitHub hat keinen Zugang ausgestellt.");

    // Optional: nur bestimmte GitHub-Konten zulassen (Komma-getrennt, z. B. "Paulekinn,pascal-r")
    const allowed = (process.env.ALLOWED_GITHUB_USERS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (allowed.length) {
      const u = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${data.access_token}`, "User-Agent": "darkline-admin" } }).then((x) => x.json());
      if (!u.login || !allowed.includes(u.login.toLowerCase())) return fail(`Das Konto ${u.login || ""} ist für den Admin nicht freigeschaltet.`);
    }
    return res.status(200).send(page("success", { token: data.access_token, provider: "github" }, origin));
  } catch (e) {
    return fail("Technischer Fehler bei der Anmeldung.");
  }
};
