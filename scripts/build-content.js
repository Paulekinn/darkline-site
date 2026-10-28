// Fasst die einzelnen Rennen und News (je eine Datei, gepflegt im Admin)
// zu content/races.json und content/news.json zusammen. Läuft bei jedem Vercel-Deploy.
const fs = require("fs");
const path = require("path");

function collect(dir, out, key) {
  const abs = path.join(__dirname, "..", "content", dir);
  const items = fs.existsSync(abs)
    ? fs.readdirSync(abs).filter((f) => f.endsWith(".json")).map((f) => {
        const data = JSON.parse(fs.readFileSync(path.join(abs, f), "utf8"));
        return { id: f.replace(/\.json$/, ""), ...data };
      })
    : [];
  fs.writeFileSync(path.join(__dirname, "..", "content", out), JSON.stringify({ [key]: items }, null, 2));
  console.log(`${out}: ${items.length} Einträge`);
}

collect("races", "races.json", "races");
collect("news", "news.json", "posts");
