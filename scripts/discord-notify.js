// Läuft als GitHub Action nach jedem Push (.github/workflows/discord.yml) und postet in den Discord-Ankündigungskanal:
// 1. neue News (Rennvorschau, Rennbericht, Team …); ein Rennbericht bekommt das Ergebnis des verknüpften Rennens dazu
// 2. neu angelegte, geplante Rennen (Termin im Kalender)
// Das Abschließen eines Rennens postet nichts: Das Ergebnis kommt erst mit dem Rennbericht.
// Neu gepostet wird nur, was in diesem Push NEU ist. Eine Rennvorschau zu einem Rennen (Feld "Zugehöriges Rennen") postet nichts,
// das Rennen wurde schon beim Anlegen angekündigt. Gehört eine andere neue News zu einem gerade angelegten Rennen, postet nur die News.
// Nachziehen: Die ID jeder geposteten Nachricht steht in .github/discord-posts.json. Wird ein Eintrag später geändert,
// bearbeitet das Skript dieselbe Discord-Nachricht (ohne neuen Ping). Ändert sich ein Rennen, ziehen auch die
// Rennberichte nach, die es verknüpfen (Ergebnisfelder). Einträge ohne "hash" (von Hand nachgetragen) werden bei jedem Lauf nachgezogen.
// Auf anderen Branches als main läuft alles als Probelauf: Posts und Änderungen werden nur im Log angezeigt.
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE = "https://darklineperformance.de";
const BRAND = "Darkline Performance Motorsport";
const RED = 0xd3121b;
const STORE = ".github/discord-posts.json";
const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const BEFORE = process.env.BEFORE_SHA || "";
const AFTER = process.env.AFTER_SHA || "HEAD";
const DRY = process.env.DRY_RUN === "1";
// Hierhin schreibt das Skript den neuen Stand der Nachrichten-IDs; der Workflow committet ihn.
const STORE_OUT = process.env.STORE_OUT || "";
// Rolle, die bei jedem Post erwähnt wird (z. B. @Community): Rollen-ID als Actions-Variable DISCORD_PING_ROLE
const PING = /^\d{15,25}$/.test(process.env.DISCORD_PING_ROLE || "") ? process.env.DISCORD_PING_ROLE : "";

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
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
const idOf = (file) => path.basename(file, ".json");
const fileOf = (key) => { const [art, id] = key.split("/"); return `content/${art === "news" ? "news" : "races"}/${id}.json`; };

// ---------- Gemerkte Nachrichten: { "news/<id>": { nachricht, hash }, "rennen/<id>": { … } } ----------
// Gelesen wird der neueste Stand von main, nicht der Stand dieses Pushs: Ein vorheriger Lauf kann die Datei inzwischen ergänzt haben.
function loadStore() {
  try { git("fetch", "-q", "origin", "main"); } catch (e) { /* lokal ohne Remote */ }
  return readAt("origin/main", STORE) || readAt(AFTER, STORE) || {};
}
function saveStore(store) {
  if (DRY || !STORE_OUT) return;
  const sorted = Object.fromEntries(Object.keys(store).sort().map((k) => [k, store[k]]));
  fs.writeFileSync(STORE_OUT, JSON.stringify(sorted, null, 2) + "\n");
}

// ---------- Was hat sich in diesem Push getan? ----------
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

function collect(store) {
  const news = [], races = [], edits = new Set();
  for (const c of changes()) {
    const art = c.file.startsWith("content/news/") ? "news" : "rennen";
    const id = idOf(c.file);
    const now = readAt(AFTER, c.file);
    if (!now) continue;
    if (c.status === "A") {
      if (art === "news") news.push({ id, ...now });
      else if (!done(now)) races.push({ id, ...now });
      continue;
    }
    // Geändert oder umbenannt: gemerkte Nachricht mitnehmen und nachziehen
    const key = `${art}/${id}`, oldKey = `${art}/${idOf(c.old)}`;
    if (oldKey !== key && store[oldKey]) { store[key] = store[oldKey]; delete store[oldKey]; }
    edits.add(key);
    // Ein geändertes Rennen ändert auch die Ergebnisfelder der Rennberichte dazu
    if (art === "rennen") {
      for (const k of Object.keys(store)) {
        if (!k.startsWith("news/")) continue;
        const p = readAt(AFTER, fileOf(k));
        if (p && p.rennen === id) edits.add(k);
      }
    }
  }
  // Von Hand nachgetragene Nachrichten (ohne hash) einmal auf den aktuellen Stand bringen
  for (const k of Object.keys(store)) if (!store[k].hash) edits.add(k);
  const posts = news.filter((p) => !(p.kategorie === "Rennvorschau" && p.rennen));
  const linked = new Set(posts.map((p) => p.rennen).filter(Boolean));
  return { news: posts, races: races.filter((r) => !linked.has(r.id)), edits: [...edits] };
}

// ---------- Karten für Discord ----------
function newsCard(p) {
  const kat = p.kategorie || "News";
  // Rennbericht mit verknüpftem, abgeschlossenem Rennen: Ergebnis als Felder in die Karte
  const race = kat === "Rennbericht" && p.rennen ? readAt(AFTER, `content/races/${p.rennen}.json`) : null;
  const gain = done(race) && race.start ? race.start - race.ziel : null;
  const fields = done(race) ? [
    { name: "Start", value: race.start ? `P${race.start}` : "–", inline: true },
    { name: "Ziel", value: `P${race.ziel}`, inline: true },
    { name: "Plätze", value: gain == null ? "–" : `${gain > 0 ? "+" : gain < 0 ? "−" : "±"}${Math.abs(gain)}`, inline: true },
    ...((race.crew || []).length ? [{ name: "Fahrer", value: race.crew.join(", ") }] : []),
  ] : [];
  return {
    key: `news/${p.id}`,
    content: `**${kat === "Rennbericht" ? "Neuer Rennbericht" : kat === "Rennvorschau" ? "Rennvorschau" : "News aus der Box"}**`,
    embed: {
      author: { name: [kat, race && race.serie, fmt(p.datum)].filter(Boolean).join(" · ") },
      title: p.titel,
      url: `${SITE}/news/${p.id}`,
      description: (p.teaser || plain(p.inhalt, 300)) + `\n\n**[Weiterlesen →](${SITE}/news/${p.id})**`,
      ...(fields.length ? { fields } : {}),
      image: { url: image(p.bild) },
    },
    check: { file: "news.json", key: "posts", ok: (x) => x.id === p.id },
  };
}

function raceCard(r) {
  const url = `${SITE}/rennen/${r.id}`;
  const crew = (r.crew || []).join(", ");
  return {
    key: `rennen/${r.id}`,
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

// Aktuelle Karte zu einer gemerkten Nachricht (null, wenn der Eintrag fehlt)
function cardFor(key) {
  const data = readAt(AFTER, fileOf(key));
  if (!data) return null;
  const id = key.split("/")[1];
  return key.startsWith("news/") ? newsCard({ id, ...data }) : raceCard({ id, ...data });
}
const hashOf = (card) => crypto.createHash("sha1").update(JSON.stringify([card.content, card.embed])).digest("hex").slice(0, 12);

// ---------- Warten, bis der Eintrag live ist (Vercel braucht nach dem Push ca. 30–60 Sekunden) ----------
async function waitLive(check) {
  if (process.env.NO_WAIT === "1") return true;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${SITE}/content/${check.file}?t=${Date.now()}`, { cache: "no-store" });
      if (r.ok && ((await r.json())[check.key] || []).some(check.ok)) return true;
    } catch (e) { /* nächster Versuch */ }
    await sleep(15000);
  }
  return false;
}

// Zeitstempel der Karte: beim Bearbeiten der Zeitpunkt des ursprünglichen Posts (steckt in der Nachrichten-ID)
const postTime = (id) => new Date(Number((BigInt(id) >> 22n) + 1420070400000n)).toISOString();

function payload(card, zeit) {
  const embed = { color: RED, footer: { text: BRAND }, timestamp: zeit, ...card.embed };
  // Nur die eingestellte Rolle darf pingen, Erwähnungen aus dem Text (@everyone usw.) bleiben stumm.
  // Beim Bearbeiten pingt Discord ohnehin nicht noch einmal.
  return { content: (PING ? `<@&${PING}> ` : "") + card.content, embeds: [embed], allowed_mentions: { parse: [], roles: PING ? [PING] : [] } };
}

async function send(method, url, body) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) return r.json();
    if (r.status === 404 && method === "PATCH") return null; // Nachricht wurde in Discord gelöscht
    if (r.status === 429) { await sleep(((await r.json()).retry_after || 2) * 1000); continue; }
    throw new Error(`Discord antwortet mit ${r.status}: ${await r.text()}`);
  }
  throw new Error("Discord bremst zu stark, bitte später erneut versuchen.");
}
const messageUrl = (id) => { const u = new URL(WEBHOOK); u.pathname = u.pathname.replace(/\/$/, "") + `/messages/${id}`; return u.toString(); };

(async () => {
  const store = loadStore();
  const { news, races, edits } = collect(store);
  const cards = [...races.map(raceCard), ...news.map(newsCard)];
  if (!cards.length && !edits.length) return console.log("Nichts Neues für Discord.");
  if (!DRY && !WEBHOOK) { console.log("DISCORD_WEBHOOK_URL fehlt (GitHub → Settings → Secrets and variables → Actions)."); return; }

  for (const card of cards) {
    console.log(`${DRY ? "[Probelauf] " : ""}${card.content} – ${card.embed.title}`);
    if (DRY) { console.log(JSON.stringify(card.embed, null, 2)); continue; }
    if (!(await waitLive(card.check))) console.log("Nicht rechtzeitig live – poste trotzdem.");
    const msg = await send("POST", `${WEBHOOK}${WEBHOOK.includes("?") ? "&" : "?"}wait=true`, payload(card, new Date().toISOString()));
    if (msg && msg.id) { store[card.key] = { nachricht: msg.id, hash: hashOf(card) }; saveStore(store); }
    console.log("→ gepostet");
  }

  for (const key of edits) {
    const eintrag = store[key];
    if (!eintrag || !/^\d{15,25}$/.test(String(eintrag.nachricht || ""))) { console.log(`${key}: geändert, aber keine Discord-Nachricht gemerkt – nichts nachzuziehen.`); continue; }
    const card = cardFor(key);
    if (!card) { console.log(`${key}: Eintrag nicht gefunden – übersprungen.`); continue; }
    const hash = hashOf(card);
    if (eintrag.hash === hash) { console.log(`${key}: Discord-Karte unverändert.`); continue; }
    console.log(`${DRY ? "[Probelauf] " : ""}Nachziehen – ${card.embed.title}`);
    if (DRY) { console.log(JSON.stringify(card.embed, null, 2)); continue; }
    const msg = await send("PATCH", messageUrl(eintrag.nachricht), payload(card, postTime(eintrag.nachricht)));
    if (!msg) { console.log("→ Nachricht gibt es in Discord nicht mehr, vergessen."); delete store[key]; }
    else { store[key] = { nachricht: String(eintrag.nachricht), hash }; console.log("→ bearbeitet"); }
    saveStore(store);
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
