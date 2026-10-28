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
