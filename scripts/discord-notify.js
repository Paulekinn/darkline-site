// Läuft als GitHub Action nach jedem Push (.github/workflows/discord.yml) und postet in den Discord-Ankündigungskanal:
// 1. neue News (Rennvorschau, Rennbericht, Team …)
// 2. neu angelegte, geplante Rennen (Termin im Kalender)
// 3. Rennen, die gerade abgeschlossen wurden (Ergebnis)
// Gepostet wird nur, was in diesem Push NEU ist. Spätere Korrekturen an bestehenden Einträgen lösen keinen Post aus.
// Gehört eine neue News zu einem Rennen (Feld "Zugehöriges Rennen"), postet nur die News, damit nichts doppelt kommt.
// Auf anderen Branches als main läuft alles als Probelauf: die Posts werden nur im Log angezeigt.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE = "https://darklineperformance.de";
const BRAND = "Darkline Performance Motorsport";
const RED = 0xd3121b;
const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const BEFORE = process.env.BEFORE_SHA || "";
const AFTER = process.env.AFTER_SHA || "HEAD";
const DRY = process.env.DRY_RUN === "1";

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
const readAt = (sha, file) => {
  try {
    return JSON.parse(git("show", `${sha}:${file}`));
  } catch (e) {
    return null; // Datei gab es in diesem Stand nicht
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fmt = (d) => { const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : ""; };
const plain = (md, n) => {
  const t = String(md || "").replace(/[#*_>`\[\]()!]/g, " ").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + " …" : t;
};
// Bild für die Karte: wie bei den Vorschaukarten (scripts/build-content.js) bevorzugt das JPG aus img/og/
function image(img) {
  if (!img) return `${SITE}/img/og/default.jpg`;
  const base = path.basename(img).replace(/\.[^.]+$/, "");
  if (fs.existsSync(path.join(ROOT, "img", "og", base + ".jpg"))) return `${SITE}/img/og/${base}.jpg`;
  return SITE + (img.startsWith("/") ? img : "/" + img);
}
const done = (r) => r && r.status === "abgeschlossen" && r.ziel;

// ---------- Was ist in diesem Push neu? ----------
function changes() {
  const zero = !BEFORE || /^0+$/.test(BEFORE);
  const out = zero
    ? git("diff-tree", "--no-commit-id", "--name-status", "-r", "--root", AFTER, "--", "content/news", "content/races")
    : git("diff", "--name-status", BEFORE, AFTER, "--", "content/news", "content/races");
  return out.trim().split("\n").filter(Boolean).map((line) => {
    const f = line.split("\t");
    return { status: f[0][0], file: f[f.length - 1], old: f.length > 2 ? f[1] : f[f.length - 1] };
  }).filter((c) => c.file.endsWith(".json") && c.status !== "D");
}

function collect() {
  const before = BEFORE && !/^0+$/.test(BEFORE) ? BEFORE : null;
  const news = [], races = [];
  for (const c of changes()) {
    const id = path.basename(c.file, ".json");
    const now = readAt(AFTER, c.file);
    if (!now) continue;
    const prev = before && c.status !== "A" ? readAt(before, c.old) : null;
    if (c.file.startsWith("content/news/")) {
      if (c.status === "A") news.push({ id, ...now });
    } else if (c.file.startsWith("content/races/")) {
      if (c.status === "A") races.push({ id, kind: done(now) ? "ergebnis" : "termin", ...now });
      else if (done(now) && !done(prev)) races.push({ id, kind: "ergebnis", ...now });
    }
  }
  const linked = new Set(news.map((p) => p.rennen).filter(Boolean));
  return { news, races: races.filter((r) => !linked.has(r.id)) };
}

// ---------- Karten für Discord ----------
function newsCard(p) {
  const kat = p.kategorie || "News";
  return {
    content: `**${kat === "Rennbericht" ? "Neuer Rennbericht" : kat === "Rennvorschau" ? "Rennvorschau" : "News aus der Box"}**`,
    embed: {
      author: { name: [kat, fmt(p.datum)].filter(Boolean).join(" · ") },
      title: p.titel,
      url: `${SITE}/news/${p.id}`,
      description: (p.teaser || plain(p.inhalt, 300)) + `\n\n**[Weiterlesen →](${SITE}/news/${p.id})**`,
      image: { url: image(p.bild) },
    },
    check: { file: "news.json", key: "posts", ok: (x) => x.id === p.id },
  };
}

function raceCard(r) {
  const url = `${SITE}/rennen/${r.id}`;
  const crew = (r.crew || []).join(", ");
  if (r.kind === "ergebnis") {
    const gain = r.start ? r.start - r.ziel : null;
    return {
      content: "**Rennergebnis**",
      embed: {
        author: { name: [r.serie, r.klasse].filter(Boolean).join(" · ") || "Ergebnis" },
        title: `${r.titel} – P${r.ziel}`,
        url,
        description: (r.fazit || plain(r.bericht, 300) || "Das Ergebnis ist da.") + `\n\n**[Zum Rennbericht →](${url})**`,
        fields: [
          { name: "Start", value: r.start ? `P${r.start}` : "–", inline: true },
          { name: "Ziel", value: `P${r.ziel}`, inline: true },
          { name: "Plätze", value: gain == null ? "–" : `${gain >= 0 ? "+" : "−"}${Math.abs(gain)}`, inline: true },
          ...(crew ? [{ name: "Fahrer", value: crew }] : []),
        ],
        image: { url: image(r.banner) },
      },
      check: { file: "races.json", key: "races", ok: (x) => x.id === r.id && done(x) },
    };
  }
  return {
    content: "**Neues Rennen im Kalender**",
    embed: {
      author: { name: [r.serie, r.klasse].filter(Boolean).join(" · ") || "Rennkalender" },
      title: r.titel,
      url,
      description: (plain(r.bericht, 300) || [r.strecke, "Termin vormerken und live dabei sein."].filter(Boolean).join(" · ")) + `\n\n**[Zur Rennvorschau →](${url})**`,
      fields: [
        { name: "Datum", value: [fmt(r.datum) || "folgt", r.startzeit ? `${r.startzeit} Uhr` : ""].filter(Boolean).join(" · "), inline: true },
        ...(r.dauer ? [{ name: "Dauer", value: r.dauer, inline: true }] : []),
        ...(r.fahrzeug ? [{ name: "Fahrzeug", value: r.fahrzeug, inline: true }] : []),
        ...(crew ? [{ name: "Fahrer", value: crew }] : []),
      ],
      image: { url: image(r.banner) },
    },
    check: { file: "races.json", key: "races", ok: (x) => x.id === r.id },
  };
}

// ---------- Warten, bis der Eintrag live ist (Vercel braucht nach dem Push ca. 30–60 Sekunden) ----------
async function waitLive(check) {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${SITE}/content/${check.file}?t=${Date.now()}`, { cache: "no-store" });
      if (r.ok && ((await r.json())[check.key] || []).some(check.ok)) return true;
    } catch (e) { /* nächster Versuch */ }
    await sleep(15000);
  }
  return false;
}

async function post(card) {
  const embed = { color: RED, footer: { text: BRAND }, timestamp: new Date().toISOString(), ...card.embed };
  const body = { content: card.content, embeds: [embed], allowed_mentions: { parse: [] } };
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${WEBHOOK}?wait=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) return;
    if (r.status === 429) { await sleep(((await r.json()).retry_after || 2) * 1000); continue; }
    throw new Error(`Discord antwortet mit ${r.status}: ${await r.text()}`);
  }
}

(async () => {
  const { news, races } = collect();
  const cards = [...races.map(raceCard), ...news.map(newsCard)];
  if (!cards.length) return console.log("Nichts Neues für Discord.");
  for (const card of cards) {
    console.log(`${DRY ? "[Probelauf] " : ""}${card.content} – ${card.embed.title}`);
    if (DRY) { console.log(JSON.stringify(card.embed, null, 2)); continue; }
    if (!WEBHOOK) { console.log("DISCORD_WEBHOOK_URL fehlt (GitHub → Settings → Secrets and variables → Actions)."); return; }
    if (!(await waitLive(card.check))) console.log("Nicht rechtzeitig live – poste trotzdem.");
    await post(card);
    console.log("→ gepostet");
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
