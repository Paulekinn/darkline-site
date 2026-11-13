// Termine der Website als Discord-Events (oben im Server unter „Events“): Team-Rennen aus dem Rennkalender und Liga-Renntage.
// Ein Abgleich legt fehlende Events an, ändert geänderte und entfernt abgesagte, gelöschte und vorbeigegangene.
// Er läuft täglich über /api/wach, nach Änderungen an Rennen oder Serien im Liga-Admin und nach einem Push mit neuen oder geänderten Rennen.
// Braucht DISCORD_BOT_TOKEN und DISCORD_GUILD_ID, der Bot das Recht „Events verwalten“. Fehlt etwas, passiert nichts.
// Welcher Termin zu welchem Discord-Event gehört, steht in liga/daten/discord-events.json. Ein in Discord von Hand gelöschtes Event legt der nächste Abgleich wieder an.
const crypto = require("crypto");
const A = require("./liga-anmeldung");
const D = require("./liga-daten");

const API = "https://discord.com/api/v10";
const SITE = "https://darklineperformance.de";
const ZUORDNUNG = "liga/daten/discord-events.json";
const TAGE_VORAUS = 60;
const MAX_EVENTS = 40; // Discord erlaubt 100 geplante Events je Server, der Rest bleibt für Events von Hand.
const VORLAUF_MS = 5 * 60e3; // Discord nimmt nur Events an, die noch nicht begonnen haben.
const PAUSE_MS = 60e3; // Öffentliche Aufrufe gleichen höchstens einmal pro Minute ab.
const SPERRE_MS = 90e3;
const GEPLANT = 1;
const LAEUFT = 2;
const BEENDET = 3;

function zugang() {
  const { DISCORD_BOT_TOKEN: token, DISCORD_GUILD_ID: server } = process.env;
  return token && server ? { token, server } : null;
}

const kurz = (t, n) => { const s = String(t || "").trim(); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; };
const ort = (strecke) => kurz(strecke ? `${strecke} (iRacing)` : "iRacing", 100);

/* ---------- Was in Discord stehen soll ---------- */
// races: Inhalt von /content/races.json. Abgeschlossene Rennen und Rennen ohne Startzeit bekommen kein Event.
function teamTermine(races) {
  return (races || []).map((r) => {
    if (!r || !r.id || r.status === "abgeschlossen" || r.status === "abgesagt") return null;
    const start = A.berlinNachUtc(r.datum, r.startzeit);
    if (start === null) return null;
    const url = `${SITE}/rennen/${r.id}`;
    return {
      schluessel: `team:${r.id}`, start, ende: start + A.dauerMinuten(r.dauer) * 60e3,
      name: kurz(`🏁 ${r.titel || "Rennen"}`, 100), ort: ort(r.strecke), bild: r.banner || "",
      beschreibung: kurz([
        [r.serie, r.klasse, r.dauer && `Dauer ${r.dauer}`].filter(Boolean).join(" · "),
        (r.crew || []).length ? `Fahrer: ${r.crew.join(", ")}` : "",
        r.fahrzeug ? `Fahrzeug: ${r.fahrzeug}` : "",
        `Rennvorschau: ${url}`,
      ].filter(Boolean).join("\n"), 1000),
    };
  }).filter(Boolean);
}

// Liga-Renntage aus dem Katalog. Abgesagte Rennen und Rennen beendeter Serien bekommen kein Event.
function ligaTermine(kat) {
  const serien = new Map((kat.serien || []).map((s) => [s.id, s]));
  return (kat.rennen || []).map((r) => {
    const serie = serien.get(r.serie) || {};
    if (r.status === "abgesagt" || serie.status === "beendet") return null;
    const start = A.berlinNachUtc(r.datum, r.startzeit);
    if (start === null) return null;
    const titel = r.titel || r.strecke || "Rennen";
    const ablauf = [r.training && `Training ${r.training}`, r.qualifying && `Qualifying ${r.qualifying}`, r.renndauer && `Rennen ${r.renndauer}`].filter(Boolean).join(" · ");
    return {
      schluessel: `liga:${r.id}`, start, ende: start + A.dauerMinuten(r.renndauer) * 60e3,
      name: kurz(`🏆 ${[serie.name, titel].filter(Boolean).join(": ")}${r.sichtung ? " (Sichtung)" : ""}`, 100), ort: ort(r.strecke), bild: "",
      beschreibung: kurz([
        serie.name ? `Serie: ${serie.name}` : "",
        ablauf,
        r.fahrzeuge ? `Fahrzeuge: ${r.fahrzeuge}` : "",
        `An- und Abmeldung im Fahrerbereich: ${SITE}/fahrerbereich`,
        `Alle Infos: ${SITE}/liga${r.serie ? `?serie=${encodeURIComponent(r.serie)}` : ""}`,
      ].filter(Boolean).join("\n"), 1000),
    };
  }).filter(Boolean);
}

const pruefsumme = (t) => crypto.createHash("sha1").update(JSON.stringify([t.name, t.ort, t.beschreibung, t.start, t.ende, t.bild])).digest("hex").slice(0, 16);

/* ---------- Vom bisherigen zum gewünschten Stand ---------- */
// termine: alle bekannten Termine. zuordnung: { schluessel: { id, summe, bild } }. bestehend: Map Event-ID → Discord-Event.
// unbekannt: Schlüssel-Präfixe, deren Quelle gerade nicht lesbar ist. Deren Events bleiben unangetastet.
function planen(termine, zuordnung, bestehend, jetzt, unbekannt = []) {
  const nachSchluessel = new Map(termine.map((t) => [t.schluessel, t]));
  const fenster = new Set(termine
    .filter((t) => t.start > jetzt + VORLAUF_MS && t.start < jetzt + TAGE_VORAUS * 864e5)
    .sort((a, b) => a.start - b.start).slice(0, MAX_EVENTS).map((t) => t.schluessel));
  const schritte = [];
  for (const schluessel of fenster) {
    const t = nachSchluessel.get(schluessel);
    const z = zuordnung[schluessel];
    const ev = z && bestehend.get(z.id);
    const summe = pruefsumme(t);
    if (!ev) schritte.push({ art: "anlegen", schluessel, termin: t, summe });
    else if (ev.status === GEPLANT && z.summe !== summe) schritte.push({ art: "aendern", schluessel, id: z.id, termin: t, summe, bildNeu: (z.bild || "") !== t.bild });
  }
  for (const [schluessel, z] of Object.entries(zuordnung)) {
    if (fenster.has(schluessel) || unbekannt.some((p) => schluessel.startsWith(p))) continue;
    const ev = bestehend.get(z.id);
    if (!ev) { schritte.push({ art: "vergessen", schluessel }); continue; }
    const t = nachSchluessel.get(schluessel);
    // Ein Rennen, das gleich beginnt oder gerade läuft, behält sein Event.
    if (t && t.start <= jetzt + VORLAUF_MS && t.ende > jetzt) continue;
    if (ev.status === GEPLANT) schritte.push({ art: "entfernen", schluessel, id: z.id });
    else if (ev.status === LAEUFT) schritte.push({ art: "beenden", schluessel, id: z.id });
  }
  return schritte;
}

/* ---------- Discord ---------- */
const koerper = (t) => ({
  name: t.name, description: t.beschreibung, privacy_level: 2, entity_type: 3, entity_metadata: { location: t.ort },
  scheduled_start_time: new Date(t.start).toISOString(), scheduled_end_time: new Date(t.ende).toISOString(),
});

function discord(z, holen) {
  return async (methode, pfad, daten) => {
    for (let versuch = 1; ; versuch++) {
      const r = await holen(`${API}${pfad}`, {
        method: methode, signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bot ${z.token}`, ...(daten ? { "Content-Type": "application/json" } : {}) },
        ...(daten ? { body: JSON.stringify(daten) } : {}),
      });
      if (r.status === 429 && versuch < 3) { const w = await r.json().catch(() => ({})); await new Promise((ok) => setTimeout(ok, Math.min(5, w.retry_after || 1) * 1000)); continue; }
      return r;
    }
  };
}

// Titelbild eines Team-Rennens als Daten-URL. Klappt das nicht, entsteht das Event ohne Bild.
async function bildAlsDaten(pfad, holen) {
  if (!pfad) return null;
  try {
    const r = await holen(SITE + (pfad.startsWith("/") ? pfad : `/${pfad}`), { signal: AbortSignal.timeout(6000) });
    const typ = String(r.headers.get("content-type") || "").split(";")[0].trim();
    if (!r.ok || !/^image\/(png|jpeg|gif)$/.test(typ)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length && buf.length < 7e6 ? `data:${typ};base64,${buf.toString("base64")}` : null;
  } catch (e) {
    return null;
  }
}

async function ausfuehren(s, rufe, holen) {
  if (s.art === "vergessen") return { weg: true };
  if (s.art === "anlegen" || s.art === "aendern") {
    const bild = (s.art === "anlegen" || s.bildNeu) && s.termin.bild ? await bildAlsDaten(s.termin.bild, holen) : null;
    const r = await rufe(s.art === "anlegen" ? "POST" : "PATCH", s.art === "anlegen" ? "" : `/${s.id}`, { ...koerper(s.termin), ...(bild ? { image: bild } : {}) });
    if (!r.ok) { console.warn(`Discord-Events: ${s.art} „${s.termin.name}“ abgelehnt (Code ${r.status}).`); return null; }
    const ev = await r.json();
    return { eintrag: { id: ev.id || s.id, summe: s.summe, bild: s.termin.bild } };
  }
  const r = s.art === "entfernen" ? await rufe("DELETE", `/${s.id}`) : await rufe("PATCH", `/${s.id}`, { status: BEENDET });
  if (r.ok || r.status === 404) return { weg: true };
  console.warn(`Discord-Events: ${s.art} abgelehnt (Code ${r.status}).`);
  return null;
}

/* ---------- Abgleich ---------- */
async function teamRennenLaden(holen) {
  try {
    const r = await holen(`${SITE}/content/races.json?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    return r.ok ? (await r.json()).races || [] : null;
  } catch (e) {
    return null;
  }
}

// erzwingen: ohne die Pause zwischen zwei Abgleichen (Liga-Admin, täglicher Lauf). Die Sperre gegen gleichzeitige Abgleiche gilt immer.
// Gibt eine kurze Zusammenfassung zurück oder null, wenn nichts eingerichtet ist.
async function abgleichen({ erzwingen = false, jetzt = Date.now(), holen = fetch, aendern = D.jsonAendern, katalog = () => D.katalog(true) } = {}) {
  const z = zugang();
  if (!z) return null;
  let darf = false;
  const stand = await aendern(ZUORDNUNG, (alt) => {
    darf = false;
    if ((alt.sperre || 0) > jetzt || (!erzwingen && (alt.zuletzt || 0) > jetzt - PAUSE_MS)) return undefined;
    darf = true;
    return { ...alt, sperre: jetzt + SPERRE_MS };
  }, () => ({ events: {} }));
  if (!darf) return { uebersprungen: true };

  const events = { ...(stand.events || {}) };
  const zaehler = { angelegt: 0, geaendert: 0, entfernt: 0, fehler: 0 };
  try {
    const [team, kat] = await Promise.all([teamRennenLaden(holen), katalog().catch((e) => { console.warn("Discord-Events: Liga nicht lesbar:", e.message); return null; })]);
    const rufe = discord(z, holen);
    const liste = await rufe("GET", `/guilds/${z.server}/scheduled-events`);
    if (!liste.ok) throw new Error(`Discord liefert die Events nicht (Code ${liste.status}).`);
    const bestehend = new Map((await liste.json()).map((ev) => [ev.id, ev]));
    const termine = [...(team ? teamTermine(team) : []), ...(kat ? ligaTermine(kat) : [])];
    const unbekannt = [...(team ? [] : ["team:"]), ...(kat ? [] : ["liga:"])];
    const eventRufe = (m, pfad, d) => rufe(m, `/guilds/${z.server}/scheduled-events${pfad}`, d);
    for (const s of planen(termine, events, bestehend, jetzt, unbekannt)) {
      const ergebnis = await ausfuehren(s, eventRufe, holen).catch((e) => { console.warn("Discord-Events:", e.message); return null; });
      if (!ergebnis) { zaehler.fehler++; continue; }
      if (ergebnis.weg) { delete events[s.schluessel]; if (s.art !== "vergessen") zaehler.entfernt++; continue; }
      events[s.schluessel] = ergebnis.eintrag;
      zaehler[s.art === "anlegen" ? "angelegt" : "geaendert"]++;
    }
  } finally {
    // Auch nach einem Fehler: Was schon in Discord angekommen ist, bleibt vermerkt, und die Sperre wird frei.
    await aendern(ZUORDNUNG, () => ({ events, zuletzt: jetzt, sperre: 0 }), () => ({ events: {} }));
  }
  return zaehler;
}

module.exports = { teamTermine, ligaTermine, planen, abgleichen, pruefsumme };
