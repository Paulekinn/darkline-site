// Läuft bei jedem Vercel-Deploy:
// 1. fasst die einzelnen Rennen und News (je eine Datei, gepflegt im Admin) zu content/races.json und content/news.json zusammen
// 2. erzeugt für jeden Rennbericht und jede News eine eigene Seite (/rennen/<id>, /news/<id>)
//    mit passender Vorschaukarte für Discord, WhatsApp, Instagram usw.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE = (process.env.SITE_URL || "https://darklineperformance.de").replace(/\/$/, "");
const BRAND = "Darkline Performance Motorsport";

function collect(dir, out, key) {
  const abs = path.join(ROOT, "content", dir);
  const items = fs.existsSync(abs)
    ? fs.readdirSync(abs).filter((f) => f.endsWith(".json")).map((f) => {
        const data = JSON.parse(fs.readFileSync(path.join(abs, f), "utf8"));
        return { id: f.replace(/\.json$/, ""), ...data };
      })
    : [];
  fs.writeFileSync(path.join(ROOT, "content", out), JSON.stringify({ [key]: items }, null, 2));
  console.log(`${out}: ${items.length} Einträge`);
  return items;
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const plain = (md, n = 180) => {
  const t = String(md || "").replace(/[#*_>`\[\]()!-]/g, " ").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + " …" : t;
};
const fmt = (d) => { const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : ""; };
function ogImage(img) {
  if (!img) return `${SITE}/img/og/default.jpg`;
  const base = path.basename(img).replace(/\.[^.]+$/, "");
  if (fs.existsSync(path.join(ROOT, "img", "og", base + ".jpg"))) return `${SITE}/img/og/${base}.jpg`;
  return SITE + (img.startsWith("/") ? img : "/" + img);
}

const template = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const slugify = (s) => String(s || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
function writePage(dir, id, meta) {
  const url = `${SITE}/${dir}/${id}`;
  const tags = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}">`,
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:site_name" content="${BRAND}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="${esc(meta.description)}">`,
    `<meta property="og:image" content="${esc(meta.image)}">`,
    `<meta name="twitter:card" content="${meta.card || "summary_large_image"}">`,
    `<meta name="theme-color" content="#d3121b">`,
  ].join("\n");
  const html = template
    .replace(/<title>[\s\S]*?<\/title>\n?/, "")
    .replace(/<meta name="description"[^>]*>\n?/, "")
    .replace(/<link rel="canonical"[^>]*>\n?/, "")
    .replace(/<meta property="og:[^>]*>\n?/g, "")
    .replace(/<meta name="twitter:card"[^>]*>\n?/, "")
    .replace(/<meta name="theme-color"[^>]*>\n?/, "")
    .replace('<base href="/">', '<base href="/">\n' + tags);
  const out = path.join(ROOT, dir, id);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "index.html"), html);
}

const races = collect("races", "races.json", "races");
const posts = collect("news", "news.json", "posts");

for (const dir of ["rennen", "news", "fahrer"]) fs.rmSync(path.join(ROOT, dir), { recursive: true, force: true });

for (const r of races) {
  const done = r.status === "abgeschlossen" && r.ziel;
  const gain = done && r.start ? r.start - r.ziel : null;
  const facts = done
    ? [`P${r.ziel}`, r.start ? `Start P${r.start}` : "", gain > 0 ? `+${gain} Plätze` : ""]
    : ["Rennvorschau", fmt(r.datum), r.startzeit ? `${r.startzeit} Uhr` : ""];
  const description = [facts.filter(Boolean).join(" · "), r.fazit || plain(r.bericht, 140), [r.serie, r.klasse].filter(Boolean).join(" · ")].filter(Boolean).join(" – ");
  writePage("rennen", r.id, {
    title: `${r.titel}${done ? " – P" + r.ziel : ""} · ${BRAND}`,
    description,
    image: ogImage(r.banner),
  });
}
for (const p of posts) {
  writePage("news", p.id, {
    title: `${p.titel} · ${BRAND}`,
    description: [p.kategorie, fmt(p.datum)].filter(Boolean).join(" · ") + " – " + (p.teaser || plain(p.inhalt)),
    image: ogImage(p.bild),
  });
}
const drivers = (JSON.parse(fs.readFileSync(path.join(ROOT, "content", "drivers.json"), "utf8")).drivers || []);
const clean = (c) => String(c).replace(/\s*\(.*\)$/, "").trim();
for (const d of drivers) {
  const mine = races.filter((r) => r.status === "abgeschlossen" && r.ziel && (r.crew || []).some((c) => clean(c) === d.name));
  const best = mine.length ? Math.min(...mine.map((r) => +r.ziel)) : null;
  const facts = [d.rolle, (d.klassen || []).join(" / "), mine.length ? `${mine.length} Rennen` : "", best ? `Bestes Ergebnis P${best}` : ""].filter(Boolean).join(" · ");
  writePage("fahrer", slugify(d.name), {
    title: `${d.name} · ${BRAND}`,
    description: facts + (d.zitat ? ` – „${d.zitat}“` : ""),
    image: ogImage(d.foto),
    card: "summary",
  });
}
console.log(`Seiten: ${races.length} Rennen, ${posts.length} News, ${drivers.length} Fahrer`);

// ---------- Sitemap für Suchmaschinen: /sitemap.xml ----------
const sitemapUrls = [
  { loc: `${SITE}/` },
  ...races.map((r) => ({ loc: `${SITE}/rennen/${r.id}`, lastmod: r.datum })),
  ...posts.map((p) => ({ loc: `${SITE}/news/${p.id}`, lastmod: p.datum })),
  ...drivers.map((d) => ({ loc: `${SITE}/fahrer/${slugify(d.name)}` })),
  { loc: `${SITE}/impressum` },
  { loc: `${SITE}/datenschutz` },
];
fs.writeFileSync(path.join(ROOT, "sitemap.xml"), [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...sitemapUrls.map((u) => {
    const lm = String(u.lastmod || "").match(/^\d{4}-\d{2}-\d{2}/);
    return `  <url><loc>${esc(u.loc)}</loc>${lm ? `<lastmod>${lm[0]}</lastmod>` : ""}</url>`;
  }),
  "</urlset>",
].join("\n") + "\n");
console.log(`sitemap.xml: ${sitemapUrls.length} Adressen`);

// ---------- Kalender zum Abonnieren: /kalender.ics ----------
function parseDur(v) {
  const t = String(v || "").toLowerCase().replace(",", ".").trim(); if (!t) return null; let m;
  if ((m = t.match(/^(\d+)\s*[:.]\s*(\d{1,2})\s*h?/))) return +m[1] * 60 + +m[2];
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*h\w*\s*(?:(\d+)\s*m\w*)?$/))) return Math.round(+m[1] * 60) + (+m[2] || 0);
  if ((m = t.match(/^(\d+)\s*m/))) return +m[1];
  if ((m = t.match(/^(\d+(?:\.\d+)?)$/))) return Math.round(+m[1] * 60);
  return null;
}
const icsEsc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fold = (line) => { const out = []; let cur = ""; for (const ch of line) { if (Buffer.byteLength(cur + ch) > 74) { out.push(cur); cur = " " + ch; } else cur += ch; } out.push(cur); return out.join("\r\n"); };
const pad = (n) => String(n).padStart(2, "0");
const localStamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
const dateStamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;

function buildIcs(races) {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Darkline Performance Motorsport//Rennkalender//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Darkline Performance Motorsport", "X-WR-TIMEZONE:Europe/Berlin", "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
    "BEGIN:VTIMEZONE", "TZID:Europe/Berlin",
    "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
    "END:VTIMEZONE",
  ];
  let n = 0;
  for (const r of races) {
    const dm = String(r.datum || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!dm) continue;
    const done = r.status === "abgeschlossen" && r.ziel;
    const tm = String(r.startzeit || "").match(/(\d{1,2})[:.](\d{2})/);
    const dur = parseDur(r.dauer);
    const ev = ["BEGIN:VEVENT", `UID:${r.id}@darklineperformance.de`, `DTSTAMP:${stamp}`];
    if (tm) {
      // Zeiten als lokale Zeit Europe/Berlin (Date wird nur als Rechenhilfe in UTC benutzt)
      const start = new Date(Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]));
      const end = new Date(start.getTime() + (dur || 120) * 60000);
      ev.push(`DTSTART;TZID=Europe/Berlin:${localStamp(start)}`, `DTEND;TZID=Europe/Berlin:${localStamp(end)}`);
    } else {
      const day = new Date(Date.UTC(+dm[1], +dm[2] - 1, +dm[3]));
      const days = dur ? Math.max(1, Math.ceil(dur / 1440)) : 1;
      ev.push(`DTSTART;VALUE=DATE:${dateStamp(day)}`, `DTEND;VALUE=DATE:${dateStamp(new Date(day.getTime() + days * 864e5))}`);
    }
    const title = `DPM · ${r.titel}${done ? ` (P${r.ziel})` : ""}`;
    const desc = [
      [r.serie, r.klasse, r.dauer ? `Dauer ${r.dauer}` : ""].filter(Boolean).join(" · "),
      (r.crew || []).length ? `Fahrer: ${r.crew.join(", ")}` : "",
      r.fahrzeug ? `Fahrzeug: ${r.fahrzeug}` : "",
      done ? `Ergebnis: P${r.ziel}${r.start ? ` (Start P${r.start})` : ""}` : "",
      `${SITE}/rennen/${r.id}`,
    ].filter(Boolean).join("\n");
    ev.push(`SUMMARY:${icsEsc(title)}`, `DESCRIPTION:${icsEsc(desc)}`, `URL:${SITE}/rennen/${r.id}`);
    if (r.strecke) ev.push(`LOCATION:${icsEsc(r.strecke + " (iRacing)")}`);
    if (!done) ev.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(r.titel + " startet in 1 Stunde")}`, "TRIGGER:-PT1H", "END:VALARM");
    ev.push("END:VEVENT");
    lines.push(...ev); n++;
  }
  lines.push("END:VCALENDAR");
  fs.writeFileSync(path.join(ROOT, "kalender.ics"), lines.map(fold).join("\r\n") + "\r\n");
  console.log(`kalender.ics: ${n} Termine`);
}
buildIcs(races);
