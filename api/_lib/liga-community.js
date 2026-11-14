// Community-Rennen: Fahrer beantragen ein eigenes Rennen, die Rennleitung gibt frei oder lehnt ab.
// Eigene Kategorie, zählt nie für eine Season. Der Antragsteller hostet in iRacing.
// Bei der Freigabe legt die Rennleitung fest, wer das Stewarding übernimmt (Darkline oder auf eigene Verantwortung)
// und ob das Rennen „Darkline Sponsored“ ist. Der Antragsteller bekommt dadurch keine Steward-Rechte.
// Ablage: liga/community/<8hex>.json
//   { id, discordId, name, nummer, status: offen|freigegeben|abgelehnt, titel, datum, uhrzeit, start, strecke, fahrzeugklasse,
//     dauer, quali, art: einzel|team, zugang: offen|einladung, beschreibung, banner, erstellt, entscheid }
// Banner (freiwillig): Bildschlüssel community-<id>, die Version steht in `banner`. Der Fahrer darf ihn bis zum Start ändern,
// nach der Freigabe gilt die Änderung sofort und die Rennleitung bekommt eine Meldung. Die Rennleitung kann ihn jederzeit entfernen.
const crypto = require("crypto");
const { blobInhalte, blobDelete } = require("./blob");
const D = require("./liga-daten");
const { Hinweis } = D;
const { berlinNachUtc, dauerMinuten } = require("./liga-anmeldung");

const PREFIX = "liga/community/";
const ID = /^[0-9a-f]{8}$/;
const VORLAUF_TAGE = 5;
const MAX_TAGE_VORAUS = 180;
const MAX_ABGELEHNTE = 5; // so viele erledigte Anträge sieht der Fahrer noch
const STEWARDING = { darkline: "Stewarding durch Darkline", eigene: "Auf eigene Verantwortung" };
const pfad = (id) => {
  if (!ID.test(String(id || ""))) throw new Hinweis("Diesen Antrag gibt es nicht.");
  return `${PREFIX}${id}.json`;
};

/* ---------- Lesen ---------- */
let cache = { bis: 0, wert: null };
async function alle(frisch) {
  if (!frisch && cache.wert && cache.bis > Date.now()) return cache.wert;
  const wert = (await blobInhalte(PREFIX)).map(([, t]) => { try { return JSON.parse(t); } catch (e) { return null; } }).filter((a) => a && ID.test(a.id));
  cache = { bis: Date.now() + 15000, wert };
  return wert;
}
const vergessen = () => { cache = { bis: 0, wert: null }; };
const nachStart = (a, b) => String(a.start).localeCompare(String(b.start));

/* ---------- Banner ---------- */
const MAX_BANNER_BYTES = 1024 * 1024;
const bannerSchluessel = (id) => `community-${id}`;
const bannerUrl = (a) => (a.banner ? `https://darklineperformance.de/api/liga?r=bild&k=${bannerSchluessel(a.id)}&v=${a.banner}` : "");
const bannerWeg = (id) => D.bildLoeschen(bannerSchluessel(id)).catch(() => {});
async function bannerSpeichern(id, daten) {
  const buf = D.pruefeBild(daten);
  if (buf.length > MAX_BANNER_BYTES) throw new Hinweis("Der Banner ist zu groß. Bitte wähle ein kleineres Bild.");
  await D.bildSpeichern(bannerSchluessel(id), buf);
  return crypto.randomBytes(3).toString("hex");
}
// Bis zum Start darf der Fahrer den Banner ändern, abgelehnte Anträge sind erledigt.
const bannerAenderbar = (a, jetzt = Date.now()) => a.status !== "abgelehnt" && Date.parse(a.start) > jetzt;

/* ---------- Prüfen, ohne Speicher ---------- */
const zeile = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

function pruefe(e, jetzt = Date.now()) {
  const titel = zeile(e && e.titel, 60);
  if (titel.length < 3) throw new Hinweis("Bitte gib dem Rennen einen Titel mit mindestens 3 Zeichen.");
  const datum = String((e && e.datum) || "");
  const uhrzeit = String((e && e.uhrzeit) || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || !/^\d{1,2}:\d{2}$/.test(uhrzeit)) throw new Hinweis("Bitte gib Datum und Uhrzeit des Rennens an.");
  const start = berlinNachUtc(datum, uhrzeit);
  if (start === null || Number.isNaN(start)) throw new Hinweis("Bitte gib Datum und Uhrzeit des Rennens an.");
  if (start < jetzt + VORLAUF_TAGE * 864e5) throw new Hinweis(`Bitte beantrage dein Rennen mindestens ${VORLAUF_TAGE} Tage vorher, damit die Rennleitung Zeit zum Prüfen hat.`);
  if (start > jetzt + MAX_TAGE_VORAUS * 864e5) throw new Hinweis(`Bitte beantrage nur Rennen in den nächsten ${MAX_TAGE_VORAUS} Tagen.`);
  const strecke = zeile(e.strecke, 80);
  if (strecke.length < 2) throw new Hinweis("Bitte gib die Strecke an.");
  const fahrzeugklasse = zeile(e.fahrzeugklasse, 80);
  if (fahrzeugklasse.length < 2) throw new Hinweis("Bitte gib die Fahrzeugklasse oder das Fahrzeug an.");
  const dauer = Number(e.dauer);
  if (!Number.isInteger(dauer) || dauer < 10 || dauer > 1440) throw new Hinweis("Bitte gib die Renndauer in Minuten an (10 bis 1440).");
  const art = e.art === "team" ? "team" : "einzel";
  const zugang = e.zugang === "einladung" ? "einladung" : "offen";
  const beschreibung = String(e.beschreibung ?? "").trim().replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").slice(0, 1000);
  if (beschreibung.length < 20) throw new Hinweis("Bitte beschreibe dein Rennen in ein, zwei Sätzen (mindestens 20 Zeichen).");
  return { titel, datum, uhrzeit, start: new Date(start).toISOString(), strecke, fahrzeugklasse, dauer, quali: e.quali === true, art, zugang, beschreibung };
}

// Liga-Rennen, die sich mit dem Termin überschneiden. Nur ein Hinweis für die Rennleitung, kein Hindernis.
function kollisionen(antrag, rennen, serien) {
  const von = Date.parse(antrag.start);
  const bis = von + antrag.dauer * 60e3;
  const name = new Map((serien || []).map((s) => [s.id, s.name]));
  return (rennen || []).filter((r) => {
    if (r.status === "abgesagt") return false;
    const s = berlinNachUtc(r.datum, r.startzeit);
    return s !== null && s < bis && s + dauerMinuten(r.renndauer) * 60e3 > von;
  }).map((r) => [name.get(r.serie), r.titel].filter(Boolean).join(": "));
}

/* ---------- Sichten ---------- */
// Für den Fahrerbereich: eigene Anträge, offene und freigegebene zuerst, dazu die letzten erledigten.
function eigene(liste, discordId) {
  const meine = liste.filter((a) => a.discordId === discordId);
  const aktiv = meine.filter((a) => a.status !== "abgelehnt").sort(nachStart);
  const erledigt = meine.filter((a) => a.status === "abgelehnt").sort((a, b) => String(b.entscheid && b.entscheid.zeit).localeCompare(String(a.entscheid && a.entscheid.zeit))).slice(0, MAX_ABGELEHNTE);
  return [...aktiv, ...erledigt].map(({ discordId: _, entscheid, ...a }) => ({ ...a, banner: a.banner || "", bannerAenderbar: bannerAenderbar(a), entscheid: entscheid ? { stewarding: entscheid.stewarding || "", sponsored: !!entscheid.sponsored, grund: entscheid.grund || "", zeit: entscheid.zeit } : null }));
}

// Für das Cockpit: offene Anträge, älteste zuerst, mit Überschneidungen
const offeneFuerCockpit = (liste, kat) => liste.filter((a) => a.status === "offen").sort((a, b) => String(a.erstellt).localeCompare(String(b.erstellt))).map((a) => ({ ...a, kollisionen: kollisionen(a, kat.rennen, kat.serien) }));
// Freigegebene, noch nicht gefahrene Rennen mit Banner: Dort kann die Rennleitung den Banner entfernen.
const kommendeMitBanner = (liste, jetzt = Date.now()) => liste.filter((a) => a.status === "freigegeben" && a.banner && Date.parse(a.start) + a.dauer * 60e3 > jetzt).sort(nachStart);

/* ---------- Texte ---------- */
const termin = (a) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(a.start));
const freigabeText = (a) => `✅ Dein Community-Rennen **${a.titel}** am ${termin(a)} Uhr ist freigegeben.\n${STEWARDING[a.entscheid.stewarding]}.${a.entscheid.sponsored ? "\n⭐ Darkline unterstützt dein Rennen als **Darkline Sponsored**." : ""}\nDu hostest die Session in iRacing. Alles Weitere findest du im Fahrerbereich: https://darklineperformance.de/fahrerbereich`;
const ablehnungText = (a, grund) => `❌ Dein Antrag für das Community-Rennen **${a.titel}** wurde abgelehnt.${grund ? `\nGrund: ${grund}` : ""}\nBei Fragen melde dich im Discord bei der Rennleitung.`;

// Karte für den Rennleitungs-Kanal
const meldungKarte = (a, parallel = []) => ({
  title: "Community-Rennen beantragt", url: "https://darklineperformance.de/liga-admin", color: 0xd3121b,
  fields: [
    { name: "Titel", value: a.titel, inline: true },
    { name: "Fahrer", value: `${a.name}${a.nummer ? ` (#${a.nummer})` : ""}`, inline: true },
    { name: "Termin", value: `${termin(a)} Uhr`, inline: true },
    { name: "Strecke", value: a.strecke, inline: true },
    { name: "Fahrzeug", value: a.fahrzeugklasse, inline: true },
    { name: "Format", value: `${a.dauer} min${a.quali ? ", mit Quali" : ""} · ${a.art === "team" ? "Teamrennen" : "Einzelrennen"} · ${a.zugang === "einladung" ? "auf Einladung" : "offen"}`, inline: true },
    ...(parallel.length ? [{ name: "⚠️ Überschneidung mit", value: parallel.join("\n").slice(0, 1000) }] : []),
    { name: "Beschreibung", value: a.beschreibung.slice(0, 1000) },
  ],
  ...(a.banner ? { image: { url: bannerUrl(a) } } : {}),
});
// Nach der Freigabe geht ein neuer Banner sofort online, die Rennleitung schaut ihn sich an.
const bannerKarte = (a) => ({
  title: "Community-Rennen: neuer Banner", url: "https://darklineperformance.de/liga-admin", color: 0xd3121b,
  description: `${a.name} hat den Banner für **${a.titel}** (${termin(a)} Uhr) geändert. Er ist schon sichtbar. Entfernen könnt ihr ihn im Cockpit.`,
  image: { url: bannerUrl(a) },
});

async function aendern(id, fn) {
  const neu = await D.jsonAendern(pfad(id), (alt) => {
    if (!alt) throw new Hinweis("Diesen Antrag gibt es nicht mehr.");
    return fn(alt);
  });
  vergessen();
  return neu;
}

/* ---------- Aktionen aus dem Fahrerbereich ---------- */
// Gibt optional eine Karte für die Rennleitung zurück.
async function aktion(art, discordId, profil, body = {}, kat = { rennen: [], serien: [] }) {
  if (art === "community-beantragen") {
    if (!profil || !profil.iracingName || !profil.nummer) throw new Hinweis("Bitte registriere dich zuerst als Fahrer mit Startnummer.");
    const daten = pruefe(body);
    const liste = await alle(true);
    if (liste.some((a) => a.discordId === discordId && a.status === "offen")) throw new Hinweis("Du hast schon einen offenen Antrag. Warte die Entscheidung ab oder zieh ihn zurück.");
    const id = crypto.randomBytes(4).toString("hex");
    // Der Banner wird zuerst geprüft und gespeichert, damit ein ungültiges Bild keinen halben Antrag hinterlässt.
    const banner = body.banner ? await bannerSpeichern(id, body.banner) : "";
    const antrag = { id, discordId, name: profil.iracingName, nummer: profil.nummer, status: "offen", ...daten, banner, erstellt: new Date().toISOString(), entscheid: null };
    await D.jsonAendern(pfad(antrag.id), (alt) => { if (alt) throw new Hinweis("Bitte versuche es noch einmal."); return antrag; }).catch(async (e) => { if (banner) await bannerWeg(id); throw e; });
    vergessen();
    return { karte: meldungKarte(antrag, kollisionen(antrag, kat.rennen, kat.serien)) };
  }
  const id = String(body.id || "");
  const a = (await alle(true)).find((x) => x.id === id && x.discordId === discordId);
  if (art === "community-zurueck") {
    if (!a) return null;
    if (a.status !== "offen") throw new Hinweis("Über diesen Antrag ist schon entschieden. Für Änderungen melde dich bei der Rennleitung.");
    await blobDelete([pfad(a.id)]);
    if (a.banner) await bannerWeg(a.id);
    vergessen();
    return null;
  }
  if (art === "community-banner" || art === "community-banner-weg") {
    if (!a) throw new Hinweis("Diesen Antrag gibt es nicht.");
    if (!bannerAenderbar(a)) throw new Hinweis("Den Banner kannst du nur bis zum Start ändern, und nicht bei abgelehnten Anträgen.");
    if (art === "community-banner-weg") {
      await bannerWeg(a.id);
      await aendern(a.id, (alt) => (alt.banner ? { ...alt, banner: "" } : undefined));
      return null;
    }
    const version = await bannerSpeichern(a.id, body.daten);
    const neu = await aendern(a.id, (alt) => ({ ...alt, banner: version }));
    return neu.status === "freigegeben" ? { karte: bannerKarte(neu) } : null;
  }
  throw new Hinweis("Unbekannte Aktion.");
}

/* ---------- Entscheidung der Rennleitung ---------- */
// Gibt den Antrag nach der Entscheidung zurück, damit die Direktnachricht ihn verwenden kann.
async function entscheiden(id, { ja, stewarding, sponsored, grund }, von) {
  if (ja && !STEWARDING[stewarding]) throw new Hinweis("Bitte wähle aus, wer das Stewarding übernimmt.");
  const neu = await D.jsonAendern(pfad(id), (alt) => {
    if (!alt || alt.status !== "offen") throw new Hinweis("Dieser Antrag liegt nicht mehr vor.");
    const entscheid = ja
      ? { stewarding, sponsored: sponsored === true, zeit: new Date().toISOString(), von: String(von || "") }
      : { grund: String(grund || "").trim().slice(0, 300), zeit: new Date().toISOString(), von: String(von || "") };
    return { ...alt, status: ja ? "freigegeben" : "abgelehnt", entscheid };
  });
  vergessen();
  return neu;
}

// Die Rennleitung entfernt einen unpassenden Banner. Gibt den Antrag zurück, damit der Fahrer informiert werden kann.
async function adminBannerWeg(id) {
  const vorher = (await alle(true)).find((a) => a.id === id);
  if (!vorher || !vorher.banner) throw new Hinweis("Dieser Banner ist schon entfernt.");
  await bannerWeg(id);
  return aendern(id, (alt) => (alt.banner ? { ...alt, banner: "" } : undefined)).then((neu) => neu || vorher);
}
const bannerEntferntText = (a) => `🖼️ Die Rennleitung hat den Banner deines Community-Rennens **${a.titel}** entfernt. Du kannst im Fahrerbereich einen anderen hochladen. Bitte nur eigene Bilder oder Bilder, die du verwenden darfst, und keine fremden Logos.`;

module.exports = { VORLAUF_TAGE, MAX_TAGE_VORAUS, STEWARDING, alle, pruefe, kollisionen, eigene, offeneFuerCockpit, kommendeMitBanner, bannerAenderbar, aktion, entscheiden, adminBannerWeg, freigabeText, ablehnungText, bannerEntferntText, meldungKarte, bannerKarte };
