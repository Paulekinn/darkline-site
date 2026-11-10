// Rund um den Renntag: Kalender-Abo der Fahrer, tägliche Erinnerung und Rennbericht im Discord-Kanal der Liga.
// Ohne LIGA_DISCORD_WEBHOOK passiert im Discord nichts. Passwörter und Discord-IDs verlassen diese Datei nicht.
const { blobGet, blobPut, blobList } = require("./blob");
const { kalenderPruefen } = require("./session");
const A = require("./liga-anmeldung");
const D = require("./liga-daten");

const LINK = "https://darklineperformance.de";
const FARBE = 0xd3121b;
const STUNDE_AB = 8;
const STUNDEN_12 = 12 * 3600e3;
const berlin = (t) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
const berlinStunde = (t) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(new Date(t)));
const berlinUhr = (t) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(new Date(t));
const serienMap = (liste) => Object.fromEntries(liste.map((s) => [s.id, s]));
const alleEintraege = async () => (await blobList(A.PREFIX)).map(A.leseEintrag).filter(Boolean);
const feld = (name, value, inline = true) => ({ name, value: String(value || "–").slice(0, 1024), inline });

/* ---------- Kalender ---------- */
const icsZeit = (t) => new Date(t).toISOString().replace(/[-:]|\.\d{3}/g, "");
const icsText = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// Lange Zeilen werden nach dem Kalenderstandard umbrochen.
function falte(zeile) {
  const teile = [];
  let rest = zeile;
  while (rest.length > 60) { teile.push(rest.slice(0, 60)); rest = ` ${rest.slice(60)}`; }
  teile.push(rest);
  return teile.join("\r\n");
}

// Nur Rennen, für die der Fahrer gemeldet ist oder auf der Warteliste steht.
function kalenderIcs(rennen, jetzt) {
  const zeilen = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Darkline Performance//Liga//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Darkline Simracing Series", "X-WR-TIMEZONE:Europe/Berlin", "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"];
  rennen.filter((r) => r.ich).forEach((r) => {
    const info = r.ich.status !== "starter" ? `Du stehst auf Platz ${r.ich.platz} der Warteliste.` : r.zugangNoetig ? "Du bist gemeldet. Server und Passwort stehen im Fahrerbereich." : "Du bist gemeldet. Die Session findest du in iRacing bei unserer Liga.";
    zeilen.push("BEGIN:VEVENT", `UID:${r.id}@darklineperformance.de`, `DTSTAMP:${icsZeit(jetzt)}`, `DTSTART:${icsZeit(r.start)}`, `DTEND:${icsZeit(r.ende)}`, `SUMMARY:${icsText([r.serieName, r.titel].filter(Boolean).join(": "))}`, ...(r.strecke ? [`LOCATION:${icsText(r.strecke)}`] : []), `DESCRIPTION:${icsText(info)}`, `URL:${LINK}/fahrerbereich`, `STATUS:${r.status === "abgesagt" ? "CANCELLED" : "CONFIRMED"}`, "END:VEVENT");
  });
  zeilen.push("END:VCALENDAR");
  return `${zeilen.map(falte).join("\r\n")}\r\n`;
}

async function kalender(req, res) {
  const discordId = kalenderPruefen((req.query || {}).k);
  if (!discordId) return res.status(404).json({ error: "Nicht gefunden" });
  const [kat, alle] = await Promise.all([D.katalog(false), alleEintraege()]);
  const jetzt = Date.now();
  const rennen = A.baueRennen(kat.rennen, alle, { jetzt, schlussMinuten: 60, discordId, serien: serienMap(kat.serien), auchVergangene: true }).filter((r) => new Date(r.start).getTime() > jetzt - 30 * 864e5);
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Cache-Control", "private, max-age=1800");
  res.end(kalenderIcs(rennen, jetzt));
}

/* ---------- Erinnerung am Renntag ---------- */
function rennenHeute(rennen, serien, jetzt) {
  const heute = berlin(jetzt);
  return rennen.filter((r) => {
    const s = serien[r.serie];
    return r.status !== "abgesagt" && berlin(r.start) === heute && (!s || (s.status !== "beendet" && s.status !== "geplant"));
  });
}

// Alles Wichtige zum Renntag auf einen Blick, mit Frist für An- und Abmeldung und dem Stand der Meldungen.
function erinnerungKarte(r) {
  const bereich = `[Fahrerbereich](${LINK}/fahrerbereich)`;
  const warte = (r.warteliste || []).length;
  const gemeldet = `${r.plaetze ? `${r.starter.length} von ${r.plaetze}` : r.starter.length}${warte ? `, ${warte} auf der Warteliste` : ""}`;
  const ablauf = [r.training && `Training ${r.training}`, r.qualifying && `Qualifying ${r.qualifying}`, r.renndauer && `Rennen ${r.renndauer}`].filter(Boolean).join(" · ");
  return {
    title: `Heute Renntag: ${r.titel}`.slice(0, 256), url: `${LINK}/fahrerbereich`, color: FARBE,
    description: r.schluss ? `An- oder abmelden kannst du dich noch bis **${berlinUhr(r.schluss)} Uhr** im ${bereich}.` : `An- und Abmeldung im ${bereich}.`,
    fields: [
      feld("Serie", r.serieName), feld("Start", `${berlinUhr(r.start)} Uhr`), feld("Strecke", r.strecke), feld("Gemeldet", gemeldet),
      ...(ablauf ? [feld("Ablauf", ablauf, false)] : []),
      ...(r.fahrzeuge ? [feld("Fahrzeuge", r.fahrzeuge, false)] : []),
    ],
    footer: { text: r.zugangNoetig ? "Server und Passwort stehen im Fahrerbereich." : "Die Session findest du in iRacing bei unserer Liga." },
  };
}

// Läuft über den täglichen Zeitplan. Der Merker verhindert doppelte Nachrichten, auch wenn die Adresse mehrfach aufgerufen wird.
async function erinnern(jetzt = Date.now()) {
  const url = process.env.LIGA_DISCORD_WEBHOOK;
  if (!url || berlinStunde(jetzt) < STUNDE_AB) return false;
  const merker = `liga/daten/erinnert/${berlin(jetzt)}`;
  if (await blobGet(merker)) return false;
  const [kat, alle] = await Promise.all([D.katalog(true), alleEintraege()]);
  const serien = serienMap(kat.serien);
  const heute = rennenHeute(A.baueRennen(kat.rennen, alle, { jetzt, schlussMinuten: 60, discordId: "", serien, auchVergangene: true }), serien, jetzt);
  if (!heute.length) return false;
  const antwort = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(6000), body: JSON.stringify({ embeds: heute.slice(0, 10).map(erinnerungKarte), allowed_mentions: { parse: [] } }) });
  if (!antwort.ok) { console.error("Discord-Erinnerung abgelehnt:", antwort.status); return false; }
  await blobPut(merker, "1", "text/plain");
  return true;
}

/* ---------- Rennbericht ---------- */
// iRacing speichert Rundenzeiten in 1/10000 Sekunden.
function rundenzeit(z) {
  if (!(z > 0)) return "";
  const ms = Math.round(z / 10);
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

const rennenZumErgebnis = (kalenderRennen, serieId, ergebnis) => {
  const start = new Date(ergebnis.start).getTime();
  return kalenderRennen.filter((r) => r.serie === serieId).map((r) => ({ r, ab: Math.abs(A.berlinNachUtc(r.datum, r.startzeit) - start) })).filter((x) => x.ab <= STUNDEN_12).sort((a, b) => a.ab - b.ab).map((x) => x.r)[0] || null;
};

// Alles, was die Grafik und die Nachricht brauchen, aus der fertig berechneten Tabelle.
function berichtDaten(serie, ergebnis, tabelle, kalenderRennen) {
  const eintrag = ((tabelle && tabelle.rennen) || []).find((r) => r.start === ergebnis.start);
  if (!eintrag || !eintrag.bericht || !eintrag.bericht.length) return null;
  const rennen = rennenZumErgebnis(kalenderRennen, serie.id, ergebnis);
  return {
    serie: serie.id, bildVersion: serie.bildVersion || 0, serieName: serie.name, titel: rennen ? rennen.titel : `Runde ${eintrag.nr}`, strecke: [ergebnis.strecke, ergebnis.variante].filter(Boolean).join(" · "),
    klassen: eintrag.bericht.map((k) => ({ ...k, schnellste: k.schnellste ? { name: k.schnellste.name, zeit: rundenzeit(k.schnellste.zeit) } : null })),
  };
}

const MEDAILLEN = ["🥇", "🥈", "🥉"];

// Je Fahrzeugklasse Podium, schnellste Runde und Fahrer des Tages. erwaehnungen ordnet Fahrernamen einer Discord-ID zu,
// dann erscheint der Name als Erwähnung mit Servernamen. In Karten pingt Discord dabei niemanden an.
function berichtKarte(b, mitBild) {
  const wer = (name) => (b.erwaehnungen && /^\d{5,25}$/.test(String(b.erwaehnungen[name] || "")) ? `<@${b.erwaehnungen[name]}>` : name);
  const mehrere = b.klassen.length > 1;
  const block = (k) => [
    ...(mehrere ? [`**${k.fahrzeugklasse}**`] : []),
    ...k.podium.map((n, i) => `${MEDAILLEN[i] || `${i + 1}.`} ${wer(n)}`),
    ...(k.schnellste ? [`⏱️ Schnellste Runde: ${wer(k.schnellste.name)}, ${k.schnellste.zeit}`] : []),
    ...(k.aufholer ? [`📈 Fahrer des Tages: ${wer(k.aufholer.name)}, ${k.aufholer.plaetze} Plätze gutgemacht`] : []),
  ].join("\n");
  return {
    title: `${b.vorlaeufig ? "Vorläufiges Ergebnis" : "Ergebnis"}: ${b.titel}`.slice(0, 256), ...(b.vorlaeufig ? { footer: { text: "Strafen der Rennleitung können das Ergebnis noch ändern." } } : {}), url: `${LINK}/liga?serie=${encodeURIComponent(b.serie)}`, color: FARBE,
    description: b.klassen.map(block).join("\n\n").slice(0, 4000),
    fields: [feld("Serie", b.serieName), feld("Strecke", b.strecke)],
    ...(mitBild ? { image: { url: "attachment://rennbericht.jpg" } } : {}),
  };
}

const berichtMerker = (id) => `liga/daten/berichte/${D.brauchtId(id)}`;
const berichtSchonGepostet = async (id) => !!(await blobGet(berichtMerker(id)));

// bild ist optional: Schlägt die Grafik fehl, geht die Nachricht ohne Bild raus.
async function berichtPosten(b, id, bild) {
  const url = process.env.LIGA_DISCORD_WEBHOOK;
  if (!url) return false;
  const nutzlast = { embeds: [berichtKarte(b, !!bild)], allowed_mentions: { parse: [] } };
  const anfrage = { method: "POST", signal: AbortSignal.timeout(10000) };
  if (bild) {
    const form = new FormData();
    form.append("payload_json", JSON.stringify({ ...nutzlast, attachments: [{ id: 0, filename: "rennbericht.jpg" }] }));
    form.append("files[0]", new Blob([bild], { type: "image/jpeg" }), "rennbericht.jpg");
    anfrage.body = form;
  } else {
    anfrage.headers = { "Content-Type": "application/json" };
    anfrage.body = JSON.stringify(nutzlast);
  }
  const antwort = await fetch(url, anfrage);
  if (!antwort.ok) { console.error("Discord-Rennbericht abgelehnt:", antwort.status); return false; }
  await blobPut(berichtMerker(id), "1", "text/plain");
  return true;
}

module.exports = { kalender, kalenderIcs, rennenHeute, erinnerungKarte, erinnern, rundenzeit, rennenZumErgebnis, berichtDaten, berichtKarte, berichtSchonGepostet, berichtPosten };
