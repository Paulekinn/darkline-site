// Prüft den Abgleich der Website-Termine mit den Discord-Events. Aufruf: node scripts/discord-events-test.js
const assert = require("assert");
const E = require("../api/_lib/discord-events");

const JETZT = Date.UTC(2026, 10, 13, 12, 0); // 13.11.2026, 13:00 in Berlin
const TEAM = { id: "2026-11-imsa", titel: "IMSA Endurance Series", status: "geplant", datum: "2026-11-15", startzeit: "15:00", dauer: "2:40h", strecke: "Suzuka", serie: "IMSA", klasse: "GT3", fahrzeug: "BMW M4 GT3", crew: ["Pascal", "Vanessa (Gast)"], banner: "/img/races/x.png" };
const KAT = {
  serien: [{ id: "gt3", name: "GT3 Sprint", status: "laeuft" }, { id: "alt", name: "Alte Serie", status: "beendet" }],
  rennen: [
    { id: "r1", serie: "gt3", titel: "Runde 4", datum: "2026-11-20", startzeit: "20:00", strecke: "Spa", renndauer: "60 min", training: "19:30", qualifying: "19:50" },
    { id: "r2", serie: "gt3", titel: "Runde 5", datum: "2026-11-27", startzeit: "20:00", strecke: "Monza", status: "abgesagt" },
    { id: "r3", serie: "alt", titel: "Finale", datum: "2026-11-21", startzeit: "20:00" },
    { id: "r4", serie: "gt3", titel: "Sichtung", datum: "2026-11-18", startzeit: "19:00", sichtung: true },
  ],
};

/* ---------- Termine ---------- */
{
  const [t] = E.teamTermine([TEAM]);
  assert.strictEqual(t.schluessel, "team:2026-11-imsa");
  assert.strictEqual(new Date(t.start).toISOString(), "2026-11-15T14:00:00.000Z", "Startzeit gilt in deutscher Zeit");
  assert.strictEqual(t.ende - t.start, 160 * 60e3, "Dauer 2:40h");
  assert.strictEqual(t.ort, "Suzuka (iRacing)");
  assert.ok(t.name.includes("IMSA Endurance Series"));
  assert.ok(t.beschreibung.includes("Fahrer: Pascal, Vanessa (Gast)") && t.beschreibung.includes("https://darklineperformance.de/rennen/2026-11-imsa"));
  assert.deepStrictEqual(E.teamTermine([{ ...TEAM, status: "abgeschlossen" }, { ...TEAM, startzeit: "" }]), [], "Abgeschlossen oder ohne Startzeit: kein Event");
}
{
  const t = E.ligaTermine(KAT);
  assert.deepStrictEqual(t.map((x) => x.schluessel), ["liga:r1", "liga:r4"], "Abgesagt und beendete Serie fallen weg");
  assert.ok(t[0].name.includes("GT3 Sprint: Runde 4"));
  assert.ok(t[0].beschreibung.includes("Training 19:30") && t[0].beschreibung.includes("/liga?serie=gt3"));
  assert.strictEqual(t[0].ende - t[0].start, 60 * 60e3);
  assert.ok(t[1].name.endsWith("(Sichtung)"));
  assert.ok(E.ligaTermine({ serien: [], rennen: [{ id: "x", titel: "A".repeat(200), datum: "2026-11-20", startzeit: "20:00" }] })[0].name.length <= 100, "Discord erlaubt 100 Zeichen");
}

/* ---------- Planung ---------- */
const termin = (schluessel, tageSpaeter, extra = {}) => ({ schluessel, start: JETZT + tageSpaeter * 864e5, ende: JETZT + tageSpaeter * 864e5 + 3600e3, name: schluessel, ort: "Spa (iRacing)", beschreibung: "", bild: "", ...extra });
const ev = (id, status = 1) => [id, { id, status }];
{
  const a = termin("liga:a", 2);
  const s = E.planen([a], {}, new Map(), JETZT);
  assert.deepStrictEqual(s.map((x) => x.art), ["anlegen"]);
  // Unverändert: nichts zu tun. Geändert: ändern.
  assert.deepStrictEqual(E.planen([a], { "liga:a": { id: "1", summe: E.pruefsumme(a) } }, new Map([ev("1")]), JETZT), []);
  assert.deepStrictEqual(E.planen([{ ...a, name: "neu" }], { "liga:a": { id: "1", summe: E.pruefsumme(a) } }, new Map([ev("1")]), JETZT).map((x) => x.art), ["aendern"]);
  // Von Hand in Discord gelöscht: wird neu angelegt.
  assert.deepStrictEqual(E.planen([a], { "liga:a": { id: "1", summe: E.pruefsumme(a) } }, new Map(), JETZT).map((x) => x.art), ["anlegen"]);
}
{
  const z = { "liga:weg": { id: "1" }, "liga:laeuft": { id: "2" }, "liga:vorbei": { id: "3" }, "liga:aktiv": { id: "4" }, "liga:fern": { id: "5" }, "liga:discordweg": { id: "6" } };
  const termine = [
    termin("liga:laeuft", 0, { start: JETZT - 600e3, ende: JETZT + 3000e3 }),
    termin("liga:vorbei", -1),
    termin("liga:aktiv", -1),
    termin("liga:fern", 90),
  ];
  const s = E.planen(termine, z, new Map([ev("1"), ev("2"), ev("3"), ev("4", 2), ev("5")]), JETZT);
  const nach = Object.fromEntries(s.map((x) => [x.schluessel, x.art]));
  assert.strictEqual(nach["liga:weg"], "entfernen", "Gelöscht oder abgesagt");
  assert.strictEqual(nach["liga:laeuft"], undefined, "Ein laufendes Rennen behält sein Event");
  assert.strictEqual(nach["liga:vorbei"], "entfernen", "Nie gestartetes, vorbeigegangenes Event");
  assert.strictEqual(nach["liga:aktiv"], "beenden", "Von Hand gestartetes Event wird beendet");
  assert.strictEqual(nach["liga:fern"], "entfernen", "Mehr als 60 Tage verschoben");
  assert.strictEqual(nach["liga:discordweg"], "vergessen");
}
{
  // Ist eine Quelle nicht lesbar, bleiben ihre Events stehen.
  const s = E.planen([], { "team:a": { id: "1" }, "liga:b": { id: "2" } }, new Map([ev("1"), ev("2")]), JETZT, ["team:"]);
  assert.deepStrictEqual(s.map((x) => x.schluessel), ["liga:b"]);
  // Höchstens 40 Events, die frühesten zuerst
  const viele = Array.from({ length: 50 }, (_, i) => termin(`liga:${i}`, 1 + i / 2));
  const angelegt = E.planen(viele, {}, new Map(), JETZT);
  assert.strictEqual(angelegt.length, 40);
  assert.strictEqual(angelegt[0].schluessel, "liga:0");
}

/* ---------- Ganzer Abgleich mit nachgebautem Discord und Speicher ---------- */
(async () => {
  process.env.DISCORD_BOT_TOKEN = "t";
  process.env.DISCORD_GUILD_ID = "g";
  let datei = null;
  const aendern = async (pfad, f, leer) => { const neu = await f(datei || leer()); if (neu !== undefined) datei = neu; return datei; };
  const discord = new Map([["99", { id: "99", status: 1 }]]);
  const aufrufe = [];
  let nr = 100;
  const antwort = (status, daten) => ({ ok: status < 300, status, headers: { get: () => "image/png" }, json: async () => daten, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
  const holen = async (url, init = {}) => {
    const m = init.method || "GET";
    if (url.includes("/content/races.json")) return antwort(200, { races: [TEAM] });
    if (url.includes("/img/")) return antwort(200);
    aufrufe.push(`${m} ${url.replace(/^.*scheduled-events/, "")}`);
    if (m === "GET") return antwort(200, [...discord.values()]);
    if (m === "POST") { const id = String(nr++); const body = JSON.parse(init.body); discord.set(id, { id, status: 1, ...body }); return antwort(200, { id }); }
    const id = url.split("/").pop();
    if (m === "DELETE") { discord.delete(id); return antwort(204); }
    return antwort(200, { id });
  };
  datei = { events: { "liga:geloescht": { id: "99" } } };
  const opt = { jetzt: JETZT, holen, aendern, katalog: async () => KAT };
  const erst = await E.abgleichen({ ...opt, erzwingen: true });
  assert.deepStrictEqual(erst, { angelegt: 3, geaendert: 0, entfernt: 1, fehler: 0 });
  assert.ok(!discord.has("99"), "Event eines gelöschten Rennens ist weg");
  const team = [...discord.values()].find((x) => x.name && x.name.includes("IMSA"));
  assert.ok(team.image && team.image.startsWith("data:image/png;base64,"), "Team-Rennen bekommt sein Banner");
  assert.strictEqual(team.entity_type, 3);
  assert.strictEqual(team.entity_metadata.location, "Suzuka (iRacing)");
  assert.strictEqual(datei.sperre, 0, "Sperre wieder frei");
  assert.strictEqual(Object.keys(datei.events).length, 3);

  // Gleich danach ohne erzwingen: Pause greift, Discord wird nicht gefragt
  aufrufe.length = 0;
  assert.deepStrictEqual(await E.abgleichen({ ...opt, jetzt: JETZT + 10e3 }), { uebersprungen: true });
  assert.strictEqual(aufrufe.length, 0);

  // Nichts geändert: nur die Liste wird gelesen
  aufrufe.length = 0;
  assert.deepStrictEqual(await E.abgleichen({ ...opt, jetzt: JETZT + 120e3 }), { angelegt: 0, geaendert: 0, entfernt: 0, fehler: 0 });
  assert.deepStrictEqual(aufrufe, ["GET "]);

  // Läuft gerade ein Abgleich, startet kein zweiter
  datei.sperre = JETZT + 200e3;
  assert.deepStrictEqual(await E.abgleichen({ ...opt, jetzt: JETZT + 180e3, erzwingen: true }), { uebersprungen: true });

  // Ohne Zugangsdaten passiert nichts
  delete process.env.DISCORD_BOT_TOKEN;
  assert.strictEqual(await E.abgleichen(opt), null);
  console.log("Discord-Events: alle Prüfungen bestanden.");
})().catch((e) => { console.error(e); process.exit(1); });
