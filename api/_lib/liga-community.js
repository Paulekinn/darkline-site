// Community-Rennen: Fahrer beantragen ein eigenes Rennen, die Rennleitung gibt frei oder lehnt ab.
// Eigene Kategorie, zählt nie für eine Season. Der Antragsteller (Veranstalter) hostet in iRacing.
// Bei der Freigabe legt die Rennleitung fest, wer das Stewarding übernimmt (Darkline oder auf eigene Verantwortung)
// und ob das Rennen „Darkline Sponsored“ ist. Der Veranstalter bekommt dadurch keine Steward-Rechte.
//
// Ablage: liga/community/<8hex>.json
//   { id, discordId, name, nummer, status: offen|freigegeben|abgelehnt|abgesagt, titel, datum, uhrzeit, start, strecke,
//     fahrzeugklasse, dauer, quali, art: einzel|team, zugang: offen|freigabe, plaetze, iratingMin, iratingMax, beschreibung,
//     banner, session: { name, passwort }, anfragen: [...], aenderung, erstellt, entscheid }
//
// Freigegebene Rennen erscheinen als Rennen mit der Kennung c-<id> im Fahrerbereich. Die Anmeldungen liegen wie bei
// Liga-Rennen unter liga/anmeldungen/c-<id>/…, dadurch gelten Startplätze, Warteliste und Überschneidungen genauso.
// Bei „freigabe“ fragen Fahrer an und der Veranstalter nimmt sie an. Teamrennen brauchen ein Liga-Team.
// Termin, Strecke, Fahrzeug und Dauer ändert der Veranstalter nur per Antrag, den die Rennleitung freigibt.
//
// Banner (freiwillig): Bildschlüssel community-<id>, die Version steht in `banner`. Der Fahrer darf ihn bis zum Start ändern,
// nach der Freigabe gilt die Änderung sofort und die Rennleitung bekommt eine Meldung. Die Rennleitung kann ihn jederzeit entfernen.
// Ergebnisse (Phase 3): Der Veranstalter lädt die iRacing-Ergebnisdatei hoch, auch im Teamformat (geteiltes Auto).
// Gewertet werden nur gemeldete Fahrer. Bei Stewarding durch Darkline gibt es Reports, Urteile (Verwarnung, Zeitstrafe, DSQ)
// ändern das Ergebnis. Ohne Darkline-Stewarding ist das Ergebnis sofort endgültig.
const crypto = require("crypto");
const { blobInhalte, blobDelete, blobPut, blobGet } = require("./blob");
const D = require("./liga-daten");
const { Hinweis } = D;
const { berlinNachUtc, dauerMinuten, anmeldungPfad, profilPfad } = require("./liga-anmeldung");
const { fahrerKennung } = require("./session");

const PREFIX = "liga/community/";
const ID = /^[0-9a-f]{8}$/;
const VORLAUF_TAGE = 5;
const AENDERUNG_VORLAUF_TAGE = 2;
const MAX_TAGE_VORAUS = 180;
const MAX_ABGELEHNTE = 5; // so viele erledigte Anträge sieht der Fahrer noch
const STANDARD_PLAETZE = 30;
const STEWARDING = { darkline: "Stewarding durch Darkline", eigene: "Auf eigene Verantwortung" };
const LINK = "https://darklineperformance.de/fahrerbereich";
const pfad = (id) => {
  if (!ID.test(String(id || ""))) throw new Hinweis("Diesen Antrag gibt es nicht.");
  return `${PREFIX}${id}.json`;
};
const rennenId = (a) => `c-${a.id}`;
const idAusRennen = (rid) => { const m = /^c-([0-9a-f]{8})$/.exec(String(rid || "")); return m ? m[1] : null; };
// Ältere Anträge kennen „einladung“, das heißt jetzt Freigabe durch den Veranstalter.
const zugangVon = (a) => (a.zugang === "freigabe" || a.zugang === "einladung" ? "freigabe" : "offen");
const plaetzeVon = (a) => (Number.isInteger(a.plaetze) ? a.plaetze : STANDARD_PLAETZE);

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
const vorStart = (a, jetzt = Date.now()) => Date.parse(a.start) > jetzt;
const nochAktuell = (a, jetzt = Date.now()) => Date.parse(a.start) + (a.dauer || 0) * 60e3 > jetzt;

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
// Bis zum Start darf der Fahrer den Banner ändern, abgelehnte und abgesagte Rennen sind erledigt.
const bannerAenderbar = (a, jetzt = Date.now()) => (a.status === "offen" || a.status === "freigegeben") && vorStart(a, jetzt);

/* ---------- Prüfen, ohne Speicher ---------- */
const zeile = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

// Termin, Strecke, Fahrzeug und Dauer. Für eine Änderung gilt ein kürzerer Vorlauf.
function pruefeTermin(e, jetzt = Date.now(), vorlaufTage = VORLAUF_TAGE) {
  const datum = String((e && e.datum) || "");
  const uhrzeit = String((e && e.uhrzeit) || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || !/^\d{1,2}:\d{2}$/.test(uhrzeit)) throw new Hinweis("Bitte gib Datum und Uhrzeit des Rennens an.");
  const start = berlinNachUtc(datum, uhrzeit);
  if (start === null || Number.isNaN(start)) throw new Hinweis("Bitte gib Datum und Uhrzeit des Rennens an.");
  if (start < jetzt + vorlaufTage * 864e5) throw new Hinweis(vorlaufTage === VORLAUF_TAGE ? `Bitte beantrage dein Rennen mindestens ${VORLAUF_TAGE} Tage vorher, damit die Rennleitung Zeit zum Prüfen hat.` : `Der neue Termin muss mindestens ${vorlaufTage} Tage in der Zukunft liegen.`);
  if (start > jetzt + MAX_TAGE_VORAUS * 864e5) throw new Hinweis(`Bitte beantrage nur Rennen in den nächsten ${MAX_TAGE_VORAUS} Tagen.`);
  const strecke = zeile(e.strecke, 80);
  if (strecke.length < 2) throw new Hinweis("Bitte gib die Strecke an.");
  const fahrzeugklasse = zeile(e.fahrzeugklasse, 80);
  if (fahrzeugklasse.length < 2) throw new Hinweis("Bitte gib die Fahrzeugklasse oder das Fahrzeug an.");
  const dauer = Number(e.dauer);
  if (!Number.isInteger(dauer) || dauer < 10 || dauer > 1440) throw new Hinweis("Bitte gib die Renndauer in Minuten an (10 bis 1440).");
  return { datum, uhrzeit, start: new Date(start).toISOString(), strecke, fahrzeugklasse, dauer };
}

// Startplätze und iRating-Grenzen: legt der Veranstalter fest und darf sie auch nach der Freigabe ändern.
function pruefeRahmen(e) {
  const plaetze = Number(e.plaetze ?? STANDARD_PLAETZE);
  if (!Number.isInteger(plaetze) || plaetze < 2 || plaetze > 100) throw new Hinweis("Bitte gib 2 bis 100 Startplätze an.");
  const grenze = (v, name) => {
    const t = String(v ?? "").trim();
    if (!t) return null;
    const n = Number(t);
    if (!Number.isInteger(n) || n < 0 || n > 20000) throw new Hinweis(`${name}: bitte eine ganze Zahl von 0 bis 20000 eingeben oder leer lassen.`);
    return n;
  };
  const iratingMin = grenze(e.iratingMin, "iRating ab");
  const iratingMax = grenze(e.iratingMax, "iRating bis");
  if (iratingMin !== null && iratingMax !== null && iratingMax < iratingMin) throw new Hinweis("Bei den iRating-Grenzen muss „bis“ größer sein als „ab“.");
  return { plaetze, iratingMin, iratingMax };
}

const pruefeBeschreibung = (v) => {
  const beschreibung = String(v ?? "").trim().replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").slice(0, 1000);
  if (beschreibung.length < 20) throw new Hinweis("Bitte beschreibe dein Rennen in ein, zwei Sätzen (mindestens 20 Zeichen).");
  return beschreibung;
};

function pruefe(e, jetzt = Date.now()) {
  const titel = zeile(e && e.titel, 60);
  if (titel.length < 3) throw new Hinweis("Bitte gib dem Rennen einen Titel mit mindestens 3 Zeichen.");
  return {
    titel, ...pruefeTermin(e, jetzt), ...pruefeRahmen(e),
    quali: e.quali === true, art: e.art === "team" ? "team" : "einzel", zugang: e.zugang === "freigabe" || e.zugang === "einladung" ? "freigabe" : "offen",
    beschreibung: pruefeBeschreibung(e.beschreibung),
  };
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

// Darf dieser Fahrer teilnehmen? iRating aus dem Profil, bei Teamrennen ein Liga-Team.
function teilnahmePruefen(a, profil, team, jetzt = Date.now()) {
  if (!a || a.status !== "freigegeben") throw new Hinweis(a && a.status === "abgesagt" ? "Dieses Rennen wurde abgesagt." : "Dieses Rennen gibt es nicht.");
  if (!vorStart(a, jetzt)) throw new Hinweis("Dieses Rennen hat schon begonnen.");
  if (!profil || !profil.iracingName || !profil.nummer) throw new Hinweis("Bitte registriere dich zuerst als Fahrer mit Startnummer.");
  if (a.iratingMin !== null && a.iratingMin !== undefined || a.iratingMax !== null && a.iratingMax !== undefined) {
    const ir = Number(profil.irating);
    if (!Number.isFinite(ir) || profil.irating === null || profil.irating === "") throw new Hinweis("Für dieses Rennen gilt eine iRating-Grenze. Bitte trage dein iRating in deinem Profil ein.");
    if (a.iratingMin !== null && a.iratingMin !== undefined && ir < a.iratingMin) throw new Hinweis(`Für dieses Rennen brauchst du mindestens ${a.iratingMin} iRating.`);
    if (a.iratingMax !== null && a.iratingMax !== undefined && ir > a.iratingMax) throw new Hinweis(`Dieses Rennen ist für Fahrer bis ${a.iratingMax} iRating.`);
  }
  if (a.art === "team" && !team) throw new Hinweis("Das ist ein Teamrennen. Tritt zuerst einem Liga-Team bei oder gründe eins.");
}

/* ---------- Als Rennen für den Fahrerbereich ---------- */
// Freigegebene und abgesagte Rennen als Serie und Rennen im Format des Liga-Katalogs, nur im Speicher.
function alsKatalog(liste) {
  const relevant = liste.filter((a) => a.status === "freigegeben" || a.status === "abgesagt");
  return {
    serien: relevant.map((a) => ({ id: rennenId(a), name: "Community-Rennen", typ: "community", farbe: "gelb", status: "anmeldung", anmeldungOffen: true, fahrzeugklassen: [] })),
    rennen: relevant.map((a) => ({
      id: rennenId(a), serie: rennenId(a), titel: a.titel, datum: a.datum, startzeit: a.uhrzeit, strecke: a.strecke, plaetze: plaetzeVon(a),
      status: a.status === "abgesagt" ? "abgesagt" : "geplant", fahrzeuge: a.fahrzeugklasse, renndauer: `${a.dauer} min`, qualifying: a.quali ? "Ja" : "",
      server: (a.session && a.session.name) || "", passwort: (a.session && a.session.passwort) || "", briefing: a.beschreibung,
    })),
  };
}
// Zusatzangaben eines Community-Rennens für die Karte im Fahrerbereich
const info = (a, discordId) => ({
  id: a.id, veranstalter: a.name, nummer: a.nummer || null, sponsored: !!(a.entscheid && a.entscheid.sponsored), stewarding: (a.entscheid && a.entscheid.stewarding) || "",
  art: a.art, zugang: zugangVon(a), banner: a.banner || "", iratingMin: a.iratingMin ?? null, iratingMax: a.iratingMax ?? null,
  eigenes: a.discordId === discordId, anfrage: (a.anfragen || []).some((x) => x.discordId === discordId),
});

/* ---------- Sichten ---------- */
const gemeldeteIds = (a, eintraege) => [...new Set((eintraege || []).filter((e) => e.typ === "rennen" && e.rennenId === rennenId(a)).map((e) => e.discordId))];

// Für den Fahrerbereich: eigene Anträge, offene und freigegebene zuerst, dazu die letzten erledigten.
function eigene(liste, discordId, eintraege = []) {
  const meine = liste.filter((a) => a.discordId === discordId);
  const aktiv = meine.filter((a) => a.status === "offen" || (a.status === "freigegeben" && nochAktuell(a))).sort(nachStart);
  const erledigt = meine.filter((a) => !aktiv.includes(a)).sort((a, b) => String(b.start).localeCompare(String(a.start))).slice(0, MAX_ABGELEHNTE);
  return [...aktiv, ...erledigt].map(({ discordId: _, entscheid, anfragen, session, ergebnis, strafen, ...a }) => ({
    // Ergebnis: Hochladen nach dem Start, Kurzfassung ohne interne Kennungen
    ergebnisMoeglich: a.status === "freigegeben" && !vorStart(a) && Date.now() <= Date.parse(a.start) + ERGEBNIS_TAGE * 864e5,
    ergebnis: ergebnis ? { hochgeladen: ergebnis.hochgeladen, team: !!ergebnis.team, zeilen: wertung({ ergebnis, strafen }).slice(0, 3).map((z) => ({ platz: z.platz, name: z.name })), anzahl: ergebnis.zeilen.length } : null,
    ...a, zugang: zugangVon(a), plaetze: plaetzeVon(a), iratingMin: a.iratingMin ?? null, iratingMax: a.iratingMax ?? null,
    banner: a.banner || "", bannerAenderbar: bannerAenderbar(a), rennen: rennenId(a),
    bearbeitbar: a.status === "freigegeben" && vorStart(a), gemeldet: gemeldeteIds(a, eintraege).length,
    // Anfragen und Zugangsdaten sieht nur der Veranstalter selbst.
    anfragen: (anfragen || []).map((x) => ({ discordId: x.discordId, name: x.name, nummer: x.nummer || null, irating: x.irating ?? null, team: x.team || "", seit: x.seit })),
    session: { name: (session && session.name) || "", passwort: (session && session.passwort) || "" },
    entscheid: entscheid ? { stewarding: entscheid.stewarding || "", sponsored: !!entscheid.sponsored, grund: entscheid.grund || "", zeit: entscheid.zeit } : null,
  }));
}

// Für das Cockpit: offene Anträge, älteste zuerst, mit Überschneidungen
const offeneFuerCockpit = (liste, kat) => liste.filter((a) => a.status === "offen").sort((a, b) => String(a.erstellt).localeCompare(String(b.erstellt))).map((a) => ({ ...a, zugang: zugangVon(a), plaetze: plaetzeVon(a), kollisionen: kollisionen(a, kat.rennen, kat.serien) }));
// Beantragte Änderungen an freigegebenen Rennen
const aenderungenFuerCockpit = (liste, kat) => liste.filter((a) => a.status === "freigegeben" && a.aenderung).map((a) => ({ id: a.id, titel: a.titel, name: a.name, alt: { start: a.start, strecke: a.strecke, fahrzeugklasse: a.fahrzeugklasse, dauer: a.dauer }, neu: a.aenderung, kollisionen: kollisionen(a.aenderung, kat.rennen, kat.serien) }));
// Kommende freigegebene Rennen mit Anzahl der Meldungen: Banner entfernen oder absagen
const kommendeFuerCockpit = (liste, eintraege, jetzt = Date.now()) => liste.filter((a) => a.status === "freigegeben" && nochAktuell(a, jetzt)).sort(nachStart).map((a) => ({
  id: a.id, titel: a.titel, name: a.name, start: a.start, strecke: a.strecke, banner: a.banner || "", plaetze: plaetzeVon(a), gemeldet: gemeldeteIds(a, eintraege).length,
  stewarding: (a.entscheid && a.entscheid.stewarding) || "", sponsored: !!(a.entscheid && a.entscheid.sponsored),
}));
// Freigegebene, noch nicht gefahrene Rennen mit Banner (ältere Ansicht, bleibt für die Tests)
const kommendeMitBanner = (liste, jetzt = Date.now()) => liste.filter((a) => a.status === "freigegeben" && a.banner && nochAktuell(a, jetzt)).sort(nachStart);

// Öffentlich für /liga: kommende freigegebene Rennen ohne Discord-IDs, Anfragen und Zugangsdaten
const oeffentlich = (liste, jetzt = Date.now()) => liste.filter((a) => (a.status === "freigegeben" || a.status === "abgesagt") && nochAktuell(a, jetzt)).sort(nachStart).map((a) => ({
  id: a.id, rennen: rennenId(a), titel: a.titel, start: a.start, datum: a.datum, uhrzeit: a.uhrzeit, strecke: a.strecke, fahrzeugklasse: a.fahrzeugklasse, dauer: a.dauer, quali: !!a.quali,
  art: a.art, zugang: zugangVon(a), plaetze: plaetzeVon(a), iratingMin: a.iratingMin ?? null, iratingMax: a.iratingMax ?? null, beschreibung: a.beschreibung, banner: a.banner || "",
  veranstalter: a.name, nummer: a.nummer || null, sponsored: !!(a.entscheid && a.entscheid.sponsored), stewarding: (a.entscheid && a.entscheid.stewarding) || "", abgesagt: a.status === "abgesagt",
}));

/* ---------- Texte ---------- */
const termin = (a) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(a.start));
const freigabeText = (a) => `✅ Dein Community-Rennen **${a.titel}** am ${termin(a)} Uhr ist freigegeben.\n${STEWARDING[a.entscheid.stewarding]}.${a.entscheid.sponsored ? "\n⭐ Darkline unterstützt dein Rennen als **Darkline Sponsored**." : ""}\nDu hostest die Session in iRacing. Session-Name und Passwort trägst du im Fahrerbereich unter „Veranstalten“ ein: ${LINK}`;
const ablehnungText = (a, grund) => `❌ Dein Antrag für das Community-Rennen **${a.titel}** wurde abgelehnt.${grund ? `\nGrund: ${grund}` : ""}\nBei Fragen melde dich im Discord bei der Rennleitung.`;
const absageText = (a, grund, vonLeitung) => `🚫 Das Community-Rennen **${a.titel}** am ${termin(a)} Uhr wurde ${vonLeitung ? "von der Rennleitung" : "vom Veranstalter"} abgesagt.${grund ? `\nGrund: ${grund}` : ""}`;
const neuerTerminText = (a) => `📅 Das Community-Rennen **${a.titel}** hat sich geändert: jetzt am ${termin(a)} Uhr, ${a.strecke}, ${a.fahrzeugklasse}, ${a.dauer} min. Du bleibst angemeldet. Passt es dir nicht mehr, melde dich im Fahrerbereich ab: ${LINK}`;
const aenderungFreigabeText = (a) => `✅ Deine Änderung am Community-Rennen **${a.titel}** ist freigegeben: jetzt am ${termin(a)} Uhr, ${a.strecke}, ${a.fahrzeugklasse}, ${a.dauer} min. Alle Gemeldeten wurden informiert.`;
const aenderungAbgelehntText =(a, grund) => `❌ Deine Änderung am Community-Rennen **${a.titel}** wurde abgelehnt. Es bleibt beim bisherigen Termin.${grund ? `\nGrund: ${grund}` : ""}`;
const bannerEntferntText = (a) => `🖼️ Die Rennleitung hat den Banner deines Community-Rennens **${a.titel}** entfernt. Du kannst im Fahrerbereich einen anderen hochladen. Bitte nur eigene Bilder oder Bilder, die du verwenden darfst, und keine fremden Logos.`;

const formatText = (a) => `${a.dauer} min${a.quali ? ", mit Quali" : ""} · ${a.art === "team" ? "Teamrennen" : "Einzelrennen"} · ${zugangVon(a) === "freigabe" ? "mit Freigabe durch den Veranstalter" : "offen"} · ${plaetzeVon(a)} Plätze`;
const iratingText = (a) => (a.iratingMin != null && a.iratingMax != null ? `${a.iratingMin} bis ${a.iratingMax}` : a.iratingMin != null ? `ab ${a.iratingMin}` : a.iratingMax != null ? `bis ${a.iratingMax}` : "");

// Karte für den Rennleitungs-Kanal
const meldungKarte = (a, parallel = []) => ({
  title: "Community-Rennen beantragt", url: "https://darklineperformance.de/liga-admin", color: 0xd3121b,
  fields: [
    { name: "Titel", value: a.titel, inline: true },
    { name: "Fahrer", value: `${a.name}${a.nummer ? ` (#${a.nummer})` : ""}`, inline: true },
    { name: "Termin", value: `${termin(a)} Uhr`, inline: true },
    { name: "Strecke", value: a.strecke, inline: true },
    { name: "Fahrzeug", value: a.fahrzeugklasse, inline: true },
    { name: "Format", value: formatText(a), inline: true },
    ...(iratingText(a) ? [{ name: "iRating", value: iratingText(a), inline: true }] : []),
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
const aenderungKarte = (a) => ({
  title: "Community-Rennen: Änderung beantragt", url: "https://darklineperformance.de/liga-admin", color: 0xd3121b,
  description: `${a.name} möchte **${a.titel}** ändern.`,
  fields: [
    { name: "Bisher", value: `${termin(a)} Uhr · ${a.strecke} · ${a.fahrzeugklasse} · ${a.dauer} min` },
    { name: "Neu", value: `${termin(a.aenderung)} Uhr · ${a.aenderung.strecke} · ${a.aenderung.fahrzeugklasse} · ${a.aenderung.dauer} min` },
  ],
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
// ctx: { kat, eintraege, team } (team: Liga-Team des Fahrers oder null)
// Gibt zurück: { karte } für die Rennleitung, { nachrichten: [{ an, text }] } als Direktnachrichten, { eintrag } neue Anmeldung.
async function aktion(art, discordId, profil, body = {}, ctx = {}) {
  const kat = ctx.kat || { rennen: [], serien: [] };
  if (art === "community-beantragen") {
    if (!profil || !profil.iracingName || !profil.nummer) throw new Hinweis("Bitte registriere dich zuerst als Fahrer mit Startnummer.");
    const daten = pruefe(body);
    const liste = await alle(true);
    if (liste.some((a) => a.discordId === discordId && a.status === "offen")) throw new Hinweis("Du hast schon einen offenen Antrag. Warte die Entscheidung ab oder zieh ihn zurück.");
    const id = crypto.randomBytes(4).toString("hex");
    // Der Banner wird zuerst geprüft und gespeichert, damit ein ungültiges Bild keinen halben Antrag hinterlässt.
    const banner = body.banner ? await bannerSpeichern(id, body.banner) : "";
    const antrag = { id, discordId, name: profil.iracingName, nummer: profil.nummer, status: "offen", ...daten, banner, session: { name: "", passwort: "" }, anfragen: [], aenderung: null, erstellt: new Date().toISOString(), entscheid: null };
    await D.jsonAendern(pfad(antrag.id), (alt) => { if (alt) throw new Hinweis("Bitte versuche es noch einmal."); return antrag; }).catch(async (e) => { if (banner) await bannerWeg(id); throw e; });
    vergessen();
    return { karte: meldungKarte(antrag, kollisionen(antrag, kat.rennen, kat.serien)) };
  }

  const liste = await alle(true);
  const id = String(body.id || "");

  // Teilnahme bei Rennen mit Freigabe: Der Fahrer fragt an, der Veranstalter entscheidet.
  if (art === "community-teilnahme-anfragen" || art === "community-teilnahme-zurueck") {
    const a = liste.find((x) => x.id === id);
    if (!a) throw new Hinweis("Dieses Rennen gibt es nicht.");
    if (art === "community-teilnahme-zurueck") {
      await aendern(a.id, (alt) => ((alt.anfragen || []).some((x) => x.discordId === discordId) ? { ...alt, anfragen: alt.anfragen.filter((x) => x.discordId !== discordId) } : undefined));
      return null;
    }
    if (zugangVon(a) !== "freigabe") throw new Hinweis("Für dieses Rennen kannst du dich direkt anmelden.");
    if (a.discordId === discordId) throw new Hinweis("Bei deinem eigenen Rennen meldest du dich direkt an.");
    teilnahmePruefen(a, profil, ctx.team);
    if (gemeldeteIds(a, ctx.eintraege).includes(discordId)) return null;
    let neu = false;
    await aendern(a.id, (alt) => {
      if ((alt.anfragen || []).some((x) => x.discordId === discordId)) return undefined;
      neu = true;
      return { ...alt, anfragen: [...(alt.anfragen || []), { discordId, name: profil.iracingName, nummer: profil.nummer, irating: profil.irating ?? null, team: ctx.team ? ctx.team.kuerzel : "", seit: new Date().toISOString() }].slice(-100) };
    });
    return neu ? { nachrichten: [{ an: a.discordId, text: `📨 **${profil.iracingName}** (#${profil.nummer}) möchte bei deinem Community-Rennen **${a.titel}** mitfahren. Annehmen oder ablehnen kannst du im Fahrerbereich unter „Veranstalten“: ${LINK}` }] } : null;
  }

  // Ab hier nur eigene Anträge und Rennen
  const a = liste.find((x) => x.id === id && x.discordId === discordId);
  if (art === "community-zurueck") {
    if (!a) return null;
    if (a.status !== "offen") throw new Hinweis("Über diesen Antrag ist schon entschieden. Für Änderungen melde dich bei der Rennleitung.");
    await blobDelete([pfad(a.id)]);
    if (a.banner) await bannerWeg(a.id);
    vergessen();
    return null;
  }
  if (!a) throw new Hinweis("Diesen Antrag gibt es nicht.");

  if (art === "community-banner" || art === "community-banner-weg") {
    if (!bannerAenderbar(a)) throw new Hinweis("Den Banner kannst du nur bis zum Start ändern, und nicht bei abgelehnten oder abgesagten Rennen.");
    if (art === "community-banner-weg") {
      await bannerWeg(a.id);
      await aendern(a.id, (alt) => (alt.banner ? { ...alt, banner: "" } : undefined));
      return null;
    }
    const version = await bannerSpeichern(a.id, body.daten);
    const neu = await aendern(a.id, (alt) => ({ ...alt, banner: version }));
    return neu.status === "freigegeben" ? { karte: bannerKarte(neu) } : null;
  }

  // Ergebnis: nach dem Start, bis ERGEBNIS_TAGE danach. ctx.teamVon ordnet Fahrer ihrem Liga-Team zu.
  if (art === "community-ergebnis") {
    const neu = await ergebnisSpeichern(a, body.datei, ctx.eintraege, ctx.teamVon || (() => null), profil && profil.iracingName);
    return { karte: ergebnisKarte(neu) };
  }
  if (art === "community-ergebnis-loeschen") {
    if (a.status !== "freigegeben" || Date.now() > Date.parse(a.start) + ERGEBNIS_TAGE * 864e5) throw new Hinweis("Das Ergebnis kann jetzt nur noch die Rennleitung entfernen.");
    await ergebnisLoeschen(a.id);
    return null;
  }

  // Alles Weitere geht nur bei freigegebenen Rennen vor dem Start.
  if (a.status !== "freigegeben") throw new Hinweis(a.status === "offen" ? "Dein Antrag wartet noch auf die Rennleitung." : "Dieses Rennen ist erledigt.");
  if (!vorStart(a)) throw new Hinweis("Dein Rennen hat schon begonnen.");

  if (art === "community-teilnahme-entscheiden") {
    const wer = String(body.fahrer || "");
    const anfrage = (a.anfragen || []).find((x) => x.discordId === wer);
    if (!anfrage) throw new Hinweis("Diese Anfrage liegt nicht mehr vor.");
    await aendern(a.id, (alt) => ({ ...alt, anfragen: (alt.anfragen || []).filter((x) => x.discordId !== wer) }));
    if (body.ja !== true) return { nachrichten: [{ an: wer, text: `❌ Deine Anfrage für das Community-Rennen **${a.titel}** wurde vom Veranstalter abgelehnt.` }] };
    // Die Anmeldung zählt ab der Annahme, wer früher angenommen wurde, steht in der Liste weiter vorn.
    const eintrag = anmeldungPfad(rennenId(a), wer, "", anfrage.name || "Fahrer");
    await blobPut(eintrag, "1", "text/plain");
    return { eintrag, nachrichten: [{ an: wer, text: `✅ Du bist beim Community-Rennen **${a.titel}** am ${termin(a)} Uhr dabei. Alles Weitere findest du im Fahrerbereich: ${LINK}` }] };
  }

  if (art === "community-bearbeiten") {
    const rahmen = pruefeRahmen(body);
    const beschreibung = pruefeBeschreibung(body.beschreibung);
    const session = { name: zeile(body.sessionName, 60), passwort: zeile(body.passwort, 60) };
    await aendern(a.id, (alt) => ({ ...alt, ...rahmen, beschreibung, session }));
    return null;
  }

  if (art === "community-aenderung") {
    if (a.aenderung) throw new Hinweis("Du hast schon eine Änderung beantragt. Warte die Entscheidung ab oder zieh sie zurück.");
    const neu = pruefeTermin(body, Date.now(), AENDERUNG_VORLAUF_TAGE);
    if (neu.start === a.start && neu.strecke === a.strecke && neu.fahrzeugklasse === a.fahrzeugklasse && neu.dauer === a.dauer) throw new Hinweis("Das ist derselbe Stand wie bisher.");
    const gespeichert = await aendern(a.id, (alt) => ({ ...alt, aenderung: { ...neu, seit: new Date().toISOString() } }));
    return { karte: aenderungKarte(gespeichert) };
  }
  if (art === "community-aenderung-zurueck") {
    await aendern(a.id, (alt) => (alt.aenderung ? { ...alt, aenderung: null } : undefined));
    return null;
  }

  if (art === "community-absagen") {
    const grund = zeile(body.grund, 300);
    const neu = await aendern(a.id, (alt) => ({ ...alt, status: "abgesagt", aenderung: null, abgesagt: { zeit: new Date().toISOString(), grund, von: "veranstalter" } }));
    const an = [...new Set([...gemeldeteIds(a, ctx.eintraege), ...(a.anfragen || []).map((x) => x.discordId)])].filter((x) => x !== discordId);
    return { karte: { title: "Community-Rennen abgesagt", url: "https://darklineperformance.de/liga-admin", color: 0xd3121b, description: `${a.name} hat **${a.titel}** (${termin(a)} Uhr) abgesagt.${grund ? `\nGrund: ${grund}` : ""}` }, nachrichten: an.map((x) => ({ an: x, text: absageText(neu, grund, false) })) };
  }

  throw new Hinweis("Unbekannte Aktion.");
}

// Direkte Anmeldung zu einem Community-Rennen: bei „freigabe“ nur für den Veranstalter selbst.
function direktAnmeldenPruefen(a, discordId, profil, team) {
  teilnahmePruefen(a, profil, team);
  if (zugangVon(a) === "freigabe" && a.discordId !== discordId) throw new Hinweis("Bei diesem Rennen entscheidet der Veranstalter. Bitte stelle eine Teilnahme-Anfrage.");
}

/* ---------- Ergebnisse ---------- */
const ERGEBNIS_TAGE = 7;      // so lange nach dem Start kann der Veranstalter ein Ergebnis hochladen oder ersetzen
const PROTEST_STUNDEN = 72;   // Reglement 8.3: danach ist das Ergebnis endgültig, wenn kein Fall mehr offen ist
const darklineStewarding = (a) => !!(a.entscheid && a.entscheid.stewarding === "darkline");

// Liest die iRacing-Ergebnisdatei. Einzel- und Teamformat (Teamzeilen ohne iRacing-ID, die Fahrer stehen in driver_results).
function leseErgebnisDatei(json) {
  const d = (json && json.data) || json;
  if (!d || !Array.isArray(d.session_results)) throw new Hinweis("Das ist keine iRacing-Ergebnisdatei. Lade die JSON-Datei des Rennens aus iRacing hoch.");
  const rennen = d.session_results.filter((s) => s.simsession_type === 6);
  if (!rennen.length) throw new Hinweis("In der Datei ist keine Rennsession enthalten.");
  const haupt = rennen.find((s) => s.simsession_number === 0) || rennen[rennen.length - 1];
  const roh = (haupt.results || []).filter((r) => !r.ai);
  if (!roh.length) throw new Hinweis("Die Rennsession enthält keine Fahrer.");
  const team = roh.some((r) => !(r.cust_id > 0) || (Array.isArray(r.driver_results) && r.driver_results.length));
  const zahl = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const fahrerAus = (x) => ({ cust: String(x.cust_id), name: String(x.display_name || "").trim() || `Fahrer ${x.cust_id}`, runden: zahl(x.laps_complete), incidents: zahl(x.incidents), besteRunde: x.best_lap_time > 0 ? x.best_lap_time : null });
  const zeilen = roh.map((r) => ({
    key: team ? `t${r.team_id || r.cust_id}` : String(r.cust_id),
    name: String(r.display_name || "").trim() || (team ? "Team" : `Fahrer ${r.cust_id}`),
    fahrer: team ? (r.driver_results || []).filter((x) => x.cust_id > 0).map(fahrerAus) : [fahrerAus(r)],
    gesamt: zahl(r.finish_position) + 1,
    start: r.starting_position >= 0 ? r.starting_position + 1 : null,
    runden: zahl(r.laps_complete),
    // Abstand zum Sieger in 1/10000 Sekunden, iRacing liefert -1 für Überrundete
    abstand: Number.isFinite(r.interval) && r.interval >= 0 ? r.interval : null,
    besteRunde: r.best_lap_time > 0 ? r.best_lap_time : null,
    incidents: zahl(r.incidents),
    klasse: String(r.car_class_short_name || "").trim(),
    fahrzeug: String(r.car_name || "").trim(),
    dsq: /disq/i.test(String(r.reason_out || "")),
    ausfall: !!r.reason_out && !/running/i.test(String(r.reason_out)) && !/disq/i.test(String(r.reason_out)),
  })).sort((a, b) => a.gesamt - b.gesamt);
  return { id: String(d.subsession_id || ""), start: d.start_time || "", strecke: (d.track && d.track.track_name) || "", variante: (d.track && d.track.config_name) || "", team, zeilen };
}

// Nur gemeldete Fahrer bleiben drin. In Teamzeilen stehen nur die gemeldeten Fahrer, die übrigen als Anzahl.
// gemeldet: Map iRacing-ID → { discordId, name }. teamVon(discordId) liefert das Liga-Team oder null.
function ergebnisAbgleichen(datei, gemeldet, teamVon = () => null) {
  const zeilen = datei.zeilen.map((z) => {
    const drin = z.fahrer.filter((f) => gemeldet.has(f.cust));
    if (!drin.length) return null;
    const fahrer = drin.map((f) => ({ ...f, pid: fahrerKennung(f.cust), discordId: gemeldet.get(f.cust).discordId }));
    // Liga-Team der Teamzeile: das Team, in dem die meisten ihrer gemeldeten Fahrer sind
    let ligaTeam = null;
    if (datei.team) {
      const je = new Map();
      fahrer.forEach((f) => { const t = teamVon(f.discordId); if (t) je.set(t.id, { t, n: ((je.get(t.id) || {}).n || 0) + 1 }); });
      const best = [...je.values()].sort((a, b) => b.n - a.n)[0];
      if (best) ligaTeam = { id: best.t.id, name: best.t.name, kuerzel: best.t.kuerzel, farbe: best.t.farbe || "rot" };
    }
    return { ...z, fahrer, weitere: z.fahrer.length - drin.length, ...(ligaTeam ? { ligaTeam } : {}) };
  }).filter(Boolean);
  if (!zeilen.length) throw new Hinweis("Keiner der Fahrer in dieser Datei ist für dieses Rennen gemeldet. Prüfe, ob du die richtige Datei hochgeladen hast.");
  return { ...datei, zeilen };
}

// Wertung mit Urteilen: Zeitstrafen wirken auf den Abstand (nur in der Führungsrunde), Disqualifizierte ans Ende.
function wertung(a) {
  if (!a.ergebnis) return [];
  const st = a.strafen || {};
  const sek = (key) => (st.zeitstrafen || []).filter((x) => x.key === key).reduce((t, x) => t + x.sekunden, 0);
  const raus = new Set((st.disqualifikationen || []).map((x) => x.key));
  const zeilen = a.ergebnis.zeilen.map((z) => {
    const strafe = sek(z.key);
    return { ...z, strafe, dsq: z.dsq || raus.has(z.key), wert: z.abstand === null ? null : z.abstand + strafe * 10000 };
  });
  zeilen.sort((x, y) => Number(x.dsq) - Number(y.dsq) || y.runden - x.runden || (x.wert !== null && y.wert !== null ? x.wert - y.wert : 0) || x.gesamt - y.gesamt);
  // Platz je Klasse, falls mehrere Fahrzeugklassen gefahren sind
  const jeKlasse = new Map();
  return zeilen.map((z, i) => {
    const k = (jeKlasse.get(z.klasse) || 0) + (z.dsq ? 0 : 1);
    if (!z.dsq) jeKlasse.set(z.klasse, k);
    return { ...z, platz: z.dsq ? null : i + 1, klassenPlatz: z.dsq ? null : k };
  });
}

// Vorläufig, solange bei Darkline-Stewarding ein Fall offen ist oder die Protestfrist läuft.
function ergebnisStand(a, reports = [], jetzt = Date.now()) {
  if (!a.ergebnis) return null;
  if (!darklineStewarding(a)) return "endgueltig";
  const faelle = reports.filter((r) => r.serie === rennenId(a));
  if (faelle.some((r) => !r.urteil)) return "vorlaeufig";
  return jetzt > Date.parse(a.start) + (a.dauer + PROTEST_STUNDEN * 60) * 60e3 ? "endgueltig" : "vorlaeufig";
}

// Für das Report-Modul: das Ergebnis im Format der Liga-Ergebnisse (eine Zeile je Fahrer, Teamfahrer mit dem Platz ihres Autos)
function alsLigaErgebnis(a) {
  if (!a.ergebnis) return null;
  return {
    id: a.ergebnis.id || rennenId(a), start: a.ergebnis.start || a.start, strecke: a.ergebnis.strecke || a.strecke,
    fahrer: a.ergebnis.zeilen.flatMap((z) => z.fahrer.map((f) => ({ cust: f.cust, name: a.ergebnis.team ? `${f.name} (${z.name})` : f.name, start: z.start, gesamt: z.gesamt, runden: f.runden || z.runden, incidents: f.incidents, besteRunde: f.besteRunde }))),
  };
}

// Urteil auf das Ergebnis anwenden: die Wirkung eines früheren Urteils zum selben Report wird ersetzt. ziel: { cust }.
async function urteilAnwenden(id, reportId, urteil, ziel) {
  return aendern(id, (alt) => {
    if (!alt.ergebnis) throw new Hinweis("Für eine Strafe muss der Veranstalter zuerst das Ergebnis hochladen.");
    const ohne = (l) => (l || []).filter((x) => x.reportId !== reportId);
    const strafen = { zeitstrafen: ohne((alt.strafen || {}).zeitstrafen), disqualifikationen: ohne((alt.strafen || {}).disqualifikationen) };
    if (urteil.art === "zeitstrafe" || urteil.art === "dsq") {
      const zeile = alt.ergebnis.zeilen.find((z) => z.fahrer.some((f) => f.cust === String(ziel && ziel.cust)));
      if (!zeile) throw new Hinweis("Diesen Fahrer gibt es im Ergebnis nicht.");
      const eintrag = { reportId, key: zeile.key, cust: String(ziel.cust) };
      if (urteil.art === "zeitstrafe") strafen.zeitstrafen.push({ ...eintrag, sekunden: urteil.sekunden });
      else strafen.disqualifikationen.push(eintrag);
    }
    return { ...alt, strafen };
  });
}

// Gemeldete Fahrer mit iRacing-ID aus ihren Profilen
async function gemeldeteMitCust(a, eintraege) {
  const ids = gemeldeteIds(a, eintraege);
  const profile = await Promise.all(ids.map(async (d) => { const t = await blobGet(profilPfad(d)).catch(() => null); return t ? { discordId: d, ...JSON.parse(t) } : null; }));
  return new Map(profile.filter((p) => p && p.custId).map((p) => [String(p.custId), { discordId: p.discordId, name: p.iracingName }]));
}

async function ergebnisSpeichern(a, datei, eintraege, teamVon, von, jetzt = Date.now()) {
  if (a.status !== "freigegeben") throw new Hinweis("Für dieses Rennen kannst du kein Ergebnis hochladen.");
  if (Date.parse(a.start) > jetzt) throw new Hinweis("Das Ergebnis kannst du erst nach dem Start hochladen.");
  if (jetzt > Date.parse(a.start) + ERGEBNIS_TAGE * 864e5) throw new Hinweis(`Ein Ergebnis kannst du bis ${ERGEBNIS_TAGE} Tage nach dem Rennen hochladen. Wende dich an die Rennleitung.`);
  const gelesen = leseErgebnisDatei(datei);
  if (gelesen.start && Math.abs(Date.parse(gelesen.start) - Date.parse(a.start)) > 12 * 3600e3) throw new Hinweis("Die Datei passt nicht zum Termin deines Rennens. Bitte lade das Ergebnis genau dieses Rennens hoch.");
  if (a.art === "team" && !gelesen.team) throw new Hinweis("Dein Rennen ist ein Teamrennen, die Datei ist aber eine Einzelsession.");
  const ergebnis = { ...ergebnisAbgleichen(gelesen, await gemeldeteMitCust(a, eintraege), teamVon), hochgeladen: new Date(jetzt).toISOString(), von: String(von || "") };
  // Ein neues Ergebnis ersetzt das alte. Urteile zu Fahrern, die es nicht mehr gibt, laufen dann ins Leere.
  return aendern(a.id, (alt) => ({ ...alt, ergebnis }));
}

const ergebnisLoeschen = (id) => aendern(id, (alt) => (alt.ergebnis ? { ...alt, ergebnis: null, strafen: { zeitstrafen: [], disqualifikationen: [] } } : undefined));

// Ergebniskarte für den Rennleitungs-Kanal
const ergebnisKarte = (a) => {
  const w = wertung(a).slice(0, 3);
  return {
    title: "Community-Rennen: Ergebnis hochgeladen", url: "https://darklineperformance.de/liga-admin", color: 0xd3121b,
    description: `${a.name} hat das Ergebnis von **${a.titel}** hochgeladen.${darklineStewarding(a) ? " Darkline übernimmt das Stewarding, Reports sind jetzt möglich." : ""}`,
    fields: w.map((z) => ({ name: `P${z.platz}`, value: z.name, inline: true })),
  };
};

// Öffentliche Zeile: Namen und anonyme Kennungen, keine Discord- und iRacing-IDs
const oeffentlicheZeile = (z) => ({
  platz: z.platz, klassenPlatz: z.klassenPlatz, name: z.name, klasse: z.klasse, runden: z.runden, abstand: z.abstand, strafe: z.strafe || 0, besteRunde: z.besteRunde, incidents: z.incidents,
  dsq: !!z.dsq, ausfall: !!z.ausfall, weitere: z.weitere || 0, ligaTeam: z.ligaTeam || null, fahrer: z.fahrer.map((f) => ({ name: f.name, pid: f.pid })),
});

// Letzte Community-Rennen mit Ergebnis für /liga
function oeffentlicheErgebnisse(liste, reports = [], jetzt = Date.now(), anzahl = 8) {
  return liste.filter((a) => a.status === "freigegeben" && a.ergebnis).sort((x, y) => String(y.start).localeCompare(String(x.start))).slice(0, anzahl).map((a) => ({
    id: a.id, titel: a.titel, start: a.start, strecke: a.strecke, fahrzeugklasse: a.fahrzeugklasse, veranstalter: a.name, art: a.art, banner: a.banner || "",
    sponsored: !!(a.entscheid && a.entscheid.sponsored), stand: ergebnisStand(a, reports, jetzt), zeilen: wertung(a).map(oeffentlicheZeile),
  }));
}

// Eigener Block im Fahrerprofil: Starts, Siege, Podien und die einzelnen Rennen
function fahrerBilanz(liste, pid, reports = [], jetzt = Date.now()) {
  const rennen = liste.filter((a) => a.status === "freigegeben" && a.ergebnis).flatMap((a) => {
    const z = wertung(a).find((x) => x.fahrer.some((f) => f.pid === pid));
    return z ? [{ id: a.id, titel: a.titel, start: a.start, strecke: a.strecke, team: a.ergebnis.team ? (z.ligaTeam ? z.ligaTeam.name : z.name) : "", platz: z.platz, dsq: !!z.dsq, vorlaeufig: ergebnisStand(a, reports, jetzt) === "vorlaeufig" }] : [];
  }).sort((x, y) => String(y.start).localeCompare(String(x.start)));
  return { starts: rennen.length, siege: rennen.filter((r) => r.platz === 1).length, podien: rennen.filter((r) => r.platz && r.platz <= 3).length, rennen };
}

// Teamrennen je Liga-Team: nur Rennen, die als Team gefahren wurden (Regel des Users)
function teamErgebnisse(liste, reports = [], jetzt = Date.now()) {
  const je = new Map();
  liste.filter((a) => a.status === "freigegeben" && a.ergebnis && a.ergebnis.team).forEach((a) => {
    wertung(a).filter((z) => z.ligaTeam).forEach((z) => {
      const l = je.get(z.ligaTeam.id) || [];
      l.push({ id: a.id, titel: a.titel, start: a.start, strecke: a.strecke, platz: z.platz, dsq: !!z.dsq, fahrer: z.fahrer.map((f) => f.name), vorlaeufig: ergebnisStand(a, reports, jetzt) === "vorlaeufig" });
      je.set(z.ligaTeam.id, l);
    });
  });
  for (const l of je.values()) l.sort((x, y) => String(y.start).localeCompare(String(x.start)));
  return je;
}

// Cockpit: Rennen der letzten 14 Tage nach dem Start, mit Stand des Ergebnisses
const ergebnisseFuerCockpit = (liste, reports = [], jetzt = Date.now()) => liste.filter((a) => a.status === "freigegeben" && Date.parse(a.start) <= jetzt && Date.parse(a.start) > jetzt - 14 * 864e5).sort((x, y) => String(y.start).localeCompare(String(x.start))).map((a) => {
  const w = wertung(a);
  return { id: a.id, titel: a.titel, name: a.name, start: a.start, team: !!(a.ergebnis && a.ergebnis.team), hochgeladen: a.ergebnis ? a.ergebnis.hochgeladen : "", stand: ergebnisStand(a, reports, jetzt), podium: w.filter((z) => z.platz && z.platz <= 3).map((z) => z.name), stewarding: (a.entscheid && a.entscheid.stewarding) || "" };
});

/* ---------- Entscheidungen der Rennleitung ---------- */
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

// Beantragte Änderung übernehmen oder ablehnen. Gibt { vorher, nachher } zurück.
async function aenderungEntscheiden(id, ja) {
  let vorher = null;
  const nachher = await aendern(id, (alt) => {
    if (alt.status !== "freigegeben" || !alt.aenderung) throw new Hinweis("Diese Änderung liegt nicht mehr vor.");
    vorher = alt;
    if (!ja) return { ...alt, aenderung: null };
    const { seit, ...neu } = alt.aenderung;
    return { ...alt, ...neu, aenderung: null };
  });
  return { vorher, nachher };
}

async function adminAbsagen(id, grund, von) {
  return aendern(id, (alt) => {
    if (alt.status !== "freigegeben") throw new Hinweis("Dieses Rennen ist nicht (mehr) freigegeben.");
    return { ...alt, status: "abgesagt", aenderung: null, abgesagt: { zeit: new Date().toISOString(), grund: zeile(grund, 300), von: String(von || "rennleitung") } };
  });
}

// Die Rennleitung entfernt einen unpassenden Banner. Gibt den Antrag zurück, damit der Fahrer informiert werden kann.
async function adminBannerWeg(id) {
  const vorher = (await alle(true)).find((a) => a.id === id);
  if (!vorher || !vorher.banner) throw new Hinweis("Dieser Banner ist schon entfernt.");
  await bannerWeg(id);
  return aendern(id, (alt) => (alt.banner ? { ...alt, banner: "" } : undefined)).then((neu) => neu || vorher);
}

module.exports = {
  VORLAUF_TAGE, AENDERUNG_VORLAUF_TAGE, MAX_TAGE_VORAUS, STEWARDING, STANDARD_PLAETZE,
  alle, pruefe, pruefeTermin, pruefeRahmen, kollisionen, teilnahmePruefen, direktAnmeldenPruefen,
  rennenId, idAusRennen, zugangVon, alsKatalog, info, gemeldeteIds,
  eigene, offeneFuerCockpit, aenderungenFuerCockpit, kommendeFuerCockpit, kommendeMitBanner, oeffentlich, bannerAenderbar,
  aktion, entscheiden, aenderungEntscheiden, adminAbsagen, adminBannerWeg,
  ERGEBNIS_TAGE, darklineStewarding, leseErgebnisDatei, ergebnisAbgleichen, wertung, ergebnisStand, alsLigaErgebnis, urteilAnwenden, ergebnisLoeschen,
  oeffentlicheErgebnisse, fahrerBilanz, teamErgebnisse, ergebnisseFuerCockpit, ergebnisKarte,
  freigabeText, ablehnungText, absageText, neuerTerminText, aenderungFreigabeText, aenderungAbgelehntText, bannerEntferntText, meldungKarte, bannerKarte, aenderungKarte,
};
