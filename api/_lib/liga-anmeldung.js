// Fahrerbereich der Liga: Rechenlogik für Serien, Termine, Fristen, Starterliste und Warteliste (ohne Speicherzugriff).
//
// Alle Angaben stehen im Dateinamen leerer Dateien im privaten Blob-Speicher. Dadurch reicht eine einzige Abfrage,
// und gleichzeitige Anmeldungen können sich nicht überschreiben:
//   liga/serien/<serie>/<discordId>~<fahrzeugklasse>~<name>       für die ganze Serie gemeldet
//   liga/anmeldungen/<rennen>/<discordId>~<fahrzeugklasse>~<name> nur für dieses Rennen gemeldet
//   liga/abmeldungen/<rennen>/<discordId>                         als Serienfahrer von diesem Rennen abgemeldet
// Fahrzeugklasse und Name sind base64url-kodiert. Serienfahrer gehen vor Einzelmeldungen, sonst zählt die Upload-Zeit.
// Wer über die Platzzahl hinaus liegt, steht auf der Warteliste und rückt von selbst nach,
// weil die Listen bei jedem Abruf neu gebildet werden.
const { gueltig } = require("../../assets/liga-flaggen.js");

const PREFIX = "liga/";

const kodiere = (s) => Buffer.from(String(s || ""), "utf8").toString("base64url");
const dekodiere = (s) => Buffer.from(String(s || ""), "base64url").toString("utf8");

const anmeldungPfad = (rennenId, discordId, fahrzeugklasse, name) => `liga/anmeldungen/${rennenId}/${discordId}~${kodiere(fahrzeugklasse)}~${kodiere(name)}`;
const mitgliedPfad = (serieId, discordId, fahrzeugklasse, name) => `liga/serien/${serieId}/${discordId}~${kodiere(fahrzeugklasse)}~${kodiere(name)}`;
const abmeldungPfad = (rennenId, discordId) => `liga/abmeldungen/${rennenId}/${discordId}`;
const profilPfad = (discordId) => `liga/fahrer/${discordId}.json`;

// Macht aus einem Eintrag der Blob-Liste eine Meldung, andere Dateien ergeben null.
function leseEintrag(blob) {
  const pfad = blob.pathname || "";
  const zeit = new Date(blob.uploadedAt).getTime() || 0;
  let m = /^liga\/anmeldungen\/([^/]+)\/([^~/]+)~([^~/]*)~([^~/]*)$/.exec(pfad);
  if (m) return { typ: "rennen", pfad, rennenId: m[1], discordId: m[2], fahrzeugklasse: dekodiere(m[3]), name: dekodiere(m[4]), zeit };
  m = /^liga\/serien\/([^/]+)\/([^~/]+)~([^~/]*)~([^~/]*)$/.exec(pfad);
  if (m) return { typ: "serie", pfad, serieId: m[1], discordId: m[2], fahrzeugklasse: dekodiere(m[3]), name: dekodiere(m[4]), zeit };
  m = /^liga\/abmeldungen\/([^/]+)\/([^~/]+)$/.exec(pfad);
  if (m) return { typ: "abmeldung", pfad, rennenId: m[1], discordId: m[2], zeit };
  return null;
}

// Wandelt Datum (JJJJ-MM-TT) und Uhrzeit in deutscher Zeit in einen Zeitpunkt um, auch über die Zeitumstellung hinweg.
function berlinNachUtc(datum, zeit) {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(datum || ""));
  const z = /^(\d{1,2})[:.](\d{2})/.exec(String(zeit || "").trim());
  if (!d || !z) return null;
  const wunsch = Date.UTC(+d[1], +d[2] - 1, +d[3], +z[1], +z[2]);
  const format = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
  const versatz = (t) => {
    const p = Object.fromEntries(format.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t;
  };
  const erste = wunsch - versatz(wunsch);
  return wunsch - versatz(erste);
}

// Renndauer aus Texten wie "60 min", "6h", "2:40h" oder "1h30". Ohne Angabe gelten zwei Stunden.
function dauerMinuten(text) {
  const t = String(text || "").toLowerCase().replace(",", ".").trim();
  let m;
  if ((m = /^(\d+)\s*[:.]\s*(\d{1,2})\s*h?/.exec(t))) return +m[1] * 60 + +m[2];
  if ((m = /^(\d+(?:\.\d+)?)\s*h[a-z]*\s*(\d+)?/.exec(t))) return Math.round(+m[1] * 60) + (+m[2] || 0);
  if ((m = /^(\d+)\s*m/.exec(t))) return +m[1];
  return 120;
}

// Serienfahrer zuerst, innerhalb davon die früheste Meldung. Bei gleicher Zeit entscheidet die ID.
function ordne(eintraege, plaetze) {
  const je = new Map();
  [...eintraege].sort((a, b) => (a.prio || 0) - (b.prio || 0) || a.zeit - b.zeit || a.discordId.localeCompare(b.discordId)).forEach((e) => { if (!je.has(e.discordId)) je.set(e.discordId, e); });
  const alle = [...je.values()];
  const grenze = plaetze > 0 ? plaetze : alle.length;
  return { starter: alle.slice(0, grenze), warteliste: alle.slice(grenze) };
}

const ueberlappt = (a, b) => a.startMs < b.endeMs && b.startMs < a.endeMs;

// Bereitet die Rennen für den Fahrerbereich auf. Das Passwort sehen nur Fahrer mit Startplatz.
function baueRennen(kalender, eintraege, { jetzt, schlussMinuten, discordId, serien = {}, mitIds = false, auchVergangene = false }) {
  const liste = kalender
    .map((r) => ({ ...r, startMs: berlinNachUtc(r.datum, r.startzeit) }))
    .filter((r) => r.startMs !== null && (auchVergangene || r.startMs + 3 * 3600e3 > jetzt))
    .sort((a, b) => a.startMs - b.startMs)
    .map((r) => {
      const serie = serien[r.serie] || {};
      const minuten = Number.isFinite(serie.anmeldeschlussMinuten) ? serie.anmeldeschlussMinuten : schlussMinuten;
      const schlussMs = r.startMs - minuten * 60e3;
      const abgemeldet = new Set(eintraege.filter((e) => e.typ === "abmeldung" && e.rennenId === r.id).map((e) => e.discordId));
      // Wer erst nach dem Anmeldeschluss der Serie beitritt, zählt für dieses Rennen nicht mehr.
      const mitglieder = eintraege.filter((e) => e.typ === "serie" && r.serie && e.serieId === r.serie && e.zeit < schlussMs && !abgemeldet.has(e.discordId)).map((e) => ({ ...e, prio: 0 }));
      const direkt = eintraege.filter((e) => e.typ === "rennen" && e.rennenId === r.id).map((e) => ({ ...e, prio: 1 }));
      const { starter, warteliste } = ordne([...mitglieder, ...direkt], r.plaetze);
      const abgesagt = r.status === "abgesagt";
      const iS = starter.findIndex((e) => e.discordId === discordId);
      const iW = warteliste.findIndex((e) => e.discordId === discordId);
      const eigen = iS >= 0 ? starter[iS] : iW >= 0 ? warteliste[iW] : null;
      // Die Discord-ID sieht nur die Rennleitung.
      // Gast ist, wer nur für dieses Rennen gemeldet und nicht in der Season ist. Bei Events gibt es keine Gäste.
      const inSerie = new Set(eintraege.filter((e) => e.typ === "serie" && r.serie && e.serieId === r.serie).map((e) => e.discordId));
      const istGast = (e) => serie.typ !== "event" && !!r.serie && e.typ === "rennen" && !inSerie.has(e.discordId);
      const oeffentlich = (e) => (mitIds ? { name: e.name, fahrzeugklasse: e.fahrzeugklasse, gast: istGast(e), discordId: e.discordId, quelle: e.typ } : { name: e.name, fahrzeugklasse: e.fahrzeugklasse, gast: istGast(e) });
      return {
        id: r.id, titel: r.titel || r.strecke || "Rennen", status: abgesagt ? "abgesagt" : "geplant",
        serie: r.serie || "", serieName: serie.name || "", serieFarbe: serie.farbe || "rot", serieTyp: serie.typ || "liga",
        start: new Date(r.startMs).toISOString(), ende: new Date(r.startMs + dauerMinuten(r.renndauer) * 60e3).toISOString(), schluss: new Date(schlussMs).toISOString(),
        startMs: r.startMs, endeMs: r.startMs + dauerMinuten(r.renndauer) * 60e3,
        // In einer beendeten Serie ändert sich nichts mehr. Ist nur die Anmeldung der Serie zu, kann man sich noch abmelden.
        offen: !abgesagt && serie.status !== "beendet" && jetzt < schlussMs,
        anmeldungZu: serie.anmeldungOffen === false || serie.status === "geplant",
        anmeldungFolgt: serie.status === "geplant",
        // Ligen laufen über die iRacing-Liga. Eigene Zugangsdaten braucht es nur bei Events und Serien mit ein oder zwei Rennen.
        zugangNoetig: serie.typ === "event" || !(serie.rennenGesamt > 2),
        strecke: r.strecke || "", streckenBild: r.streckenBild || null, fahrzeuge: r.fahrzeuge || "", fahrzeugklassen: serie.fahrzeugklassen || [], plaetze: r.plaetze || 0,
        training: r.training || "", qualifying: r.qualifying || "", renndauer: r.renndauer || "", wetter: r.wetter || "", server: r.server || "", briefing: r.briefing || "",
        starter: starter.map(oeffentlich), warteliste: warteliste.map(oeffentlich),
        ich: eigen ? { status: iS >= 0 ? "starter" : "warteliste", platz: (iS >= 0 ? iS : iW) + 1, fahrzeugklasse: eigen.fahrzeugklasse, quelle: eigen.typ, ...(mitIds ? { discordId } : {}) } : null,
        passwort: iS >= 0 && r.passwort ? r.passwort : "",
      };
    });
  return liste.map((a) => {
    const konflikt = a.ich && a.status !== "abgesagt" ? liste.filter((b) => b !== a && b.ich && b.status !== "abgesagt" && ueberlappt(a, b)).map((b) => b.titel) : [];
    const { startMs, endeMs, ...rest } = a;
    return { ...rest, konflikt };
  });
}

// Mit welchen Rennen des Fahrers würde ein weiteres Rennen kollidieren?
function kollisionen(kalender, rennenId, eintraege, optionen) {
  const roh = kalender.map((r) => ({ id: r.id, startMs: berlinNachUtc(r.datum, r.startzeit), dauer: dauerMinuten(r.renndauer) })).filter((r) => r.startMs !== null);
  const fenster = new Map(roh.map((r) => [r.id, { startMs: r.startMs, endeMs: r.startMs + r.dauer * 60e3 }]));
  const ziel = fenster.get(rennenId);
  if (!ziel) return [];
  return baueRennen(kalender, eintraege, optionen).filter((r) => r.id !== rennenId && r.ich && r.status !== "abgesagt" && ueberlappt(ziel, fenster.get(r.id))).map((r) => r.titel);
}

// Serien für Übersicht und Fahrerbereich, mit Status des angemeldeten Fahrers
function baueSerien(serienListe, eintraege, { discordId, profil, klasseFuer }) {
  return serienListe.map((s) => {
    const mitglieder = eintraege.filter((e) => e.typ === "serie" && e.serieId === s.id);
    const eigen = mitglieder.find((e) => e.discordId === discordId);
    const sportsCar = !s.kategorie || s.kategorie === "Sports_Car";
    const klasse = profil && sportsCar && !s.ohneKlassen ? (klasseFuer(profil.irating, s.klassen || []) || {}).name || "" : "";
    return { id: s.id, name: s.name, typ: s.typ || "liga", saison: s.saison || "", status: s.status || "anmeldung", anmeldungOffen: s.anmeldungOffen !== false && s.status !== "beendet" && s.status !== "geplant", farbe: s.farbe || "rot", bildVersion: s.bildVersion || 0, fahrzeugklassen: s.fahrzeugklassen || [], fahrer: mitglieder.length, ich: !!eigen, fahrzeugklasse: eigen ? eigen.fahrzeugklasse : "", klasse, einstufungDurchRennleitung: !sportsCar && !s.ohneKlassen };
  });
}

// Die eigenen Fahrerkarten über die anonyme Kennung. Ältere Tabellen ohne Kennung werden über den iRacing-Namen zugeordnet.
function eigeneKarten(serienListe, tabellen, iracingName, pid) {
  const name = String(iracingName || "").trim().toLowerCase();
  if (!name && !pid) return [];
  return serienListe.flatMap((s) => {
    const t = tabellen.get(s.id);
    if (!t || !Array.isArray(t.klassen)) return [];
    return t.klassen.flatMap((k) => {
      const f = k.fahrer.find((x) => x.karte && (x.pid ? x.pid === pid : x.name.trim().toLowerCase() === name));
      if (!f) return [];
      return [{ pid: f.pid, serie: s.id, serieName: s.name, bildVersion: s.bildVersion || 0, rennenGesamt: t.rennenGesamt, klasseId: k.id, klasse: k.name, offen: k.offen, min: k.min, max: k.max, name: f.name, pos: f.pos, punkte: f.punkte, rennen: f.rennen, karte: f.karte }];
    });
  });
}

// Prüft die freiwilligen, öffentlichen Angaben. Leere Felder sind erlaubt.
function pruefeExtras(p) {
  const nummerText = String((p && p.nummer) ?? "").trim();
  if (nummerText && !/^[1-9]\d{0,2}$/.test(nummerText)) throw new Error("Bitte gib als Startnummer eine Zahl von 1 bis 999 an.");
  const land = String((p && p.land) || "");
  if (land && !gueltig(land)) throw new Error("Bitte wähle ein Land aus der Liste.");
  const team = String((p && p.team) || "").trim().slice(0, 40);
  const kanal = String((p && p.kanal) || "").trim();
  if (kanal) {
    let url = null;
    try { url = new URL(kanal); } catch (e) { /* unten als Fehler gemeldet */ }
    if (!url || url.protocol !== "https:" || !/^(www\.|m\.)?(twitch\.tv|youtube\.com|youtu\.be)$/.test(url.hostname) || kanal.length > 150) throw new Error("Bitte gib einen Twitch- oder YouTube-Link an, der mit https:// beginnt.");
  }
  return { nummer: nummerText ? +nummerText : null, land, team, kanal, zeigeBild: !!(p && p.zeigeBild) };
}

// Prüft die Eingaben aus dem Profilformular. Wirft einen Fehlertext für den Fahrer.
function pruefeProfil(p) {
  const name = String((p && p.iracingName) || "").trim();
  const custId = String((p && p.custId) || "").trim();
  const irating = String((p && p.irating) || "").trim();
  if (name.length < 2 || name.length > 40) throw new Error("Bitte gib deinen iRacing-Namen an (2 bis 40 Zeichen).");
  if (!/^[1-9]\d{0,8}$/.test(custId)) throw new Error("Die iRacing-ID besteht nur aus Ziffern.");
  if (!/^\d{1,5}$/.test(irating) || +irating > 20000) throw new Error("Bitte gib dein Sports-Car-iRating als Zahl an.");
  return { iracingName: name, custId, irating: +irating };
}

module.exports = { PREFIX, anmeldungPfad, mitgliedPfad, abmeldungPfad, profilPfad, leseEintrag, berlinNachUtc, dauerMinuten, ordne, baueRennen, baueSerien, kollisionen, eigeneKarten, pruefeProfil, pruefeExtras };
