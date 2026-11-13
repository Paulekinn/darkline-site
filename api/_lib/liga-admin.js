// Liga-Admin (/liga-admin): nur für die Rolle aus LIGA_ADMIN_ROLE_IDS, mit eigenem Cookie.
const crypto = require("crypto");
const { getLigaAdminSession, clearLigaAdminSession, fahrerKennung } = require("./session");
const P = require("./liga-profil");
const { blobPut, blobGet, blobDelete, blobList } = require("./blob");
const A = require("./liga-anmeldung");
const D = require("./liga-daten");
const R = require("./liga-reports");
const { Hinweis } = D;
const G = require("./liga-strecken");
const Renntag = require("./liga-renntag");
const Regeln = require("./liga-regeln");
const Dc = require("./liga-discord");
const F = require("./liga-fahrzeuge");
const G61 = require("./g61");
const Sichtung = require("./liga-sichtung");
const Anfragen = require("./liga-anfragen");
const DiscordEvents = require("./discord-events");
// Aktionen, nach denen sich Liga-Termine in Discord ändern können
const TERMIN_AKTIONEN = new Set(["serie-speichern", "serie-loeschen", "rennen-speichern", "rennen-loeschen", "rennen-verschieben", "rennen-duplizieren", "saison-planen"]);
const { leseErgebnis, berechneTabelle, klasseFuer } = require("../../assets/liga-wertung.js");

const eintraege = async () => (await blobList(A.PREFIX)).map(A.leseEintrag).filter(Boolean);
const serieFinden = (kat, id) => {
  const s = kat.serien.find((x) => x.id === id);
  if (!s) throw new Hinweis("Diese Serie gibt es nicht.");
  return s;
};

// Alle für eine Serie oder eines ihrer Rennen gemeldeten Fahrer: Map iRacing-ID → iRacing-Name
async function gemeldeteFahrer(kat, serieId) {
  const alle = await eintraege();
  const rennen = new Set(kat.rennen.filter((r) => r.serie === serieId).map((r) => r.id));
  const ids = [...new Set(alle.filter((e) => (e.typ === "serie" && e.serieId === serieId) || (e.typ === "rennen" && rennen.has(e.rennenId))).map((e) => e.discordId))];
  const profile = await Promise.all(ids.map(async (d) => { const t = await blobGet(A.profilPfad(d)); return t ? { discordId: d, ...JSON.parse(t) } : null; }));
  const vorhanden = profile.filter((p) => p && p.custId);
  const mitglieder = new Set(alle.filter((e) => e.typ === "serie" && e.serieId === serieId).map((e) => e.discordId));
  // Nur Seasons kennen Gäste. Bei einem Event wird jeder Gemeldete normal gewertet.
  const stamm = serieFinden(kat, serieId).typ === "event" ? null : new Set(vorhanden.filter((p) => mitglieder.has(p.discordId)).map((p) => String(p.custId)));
  return { gemeldet: new Map(vorhanden.map((p) => [String(p.custId), p.iracingName])), stamm, discord: new Map(vorhanden.map((p) => [String(p.custId), p.discordId])) };
}

// Details einer Serie: Fahrer mit Profil, Rennen mit Listen, Ergebnisse und Strafen
async function serienDetails(kat, id) {
  const serie = serieFinden(kat, id);
  const [alle, ergebnisse, privat, oeffentlich, alleReports, fahrzeuge] = await Promise.all([eintraege(), D.ergebnisseLesen(id), D.privatLesen(id), P.oeffentlicheProfile(), R.alleReports(false), F.derSerie(id).catch(() => new Map())]);
  const standCtx = { serie, rennen: kat.rennen, reports: alleReports, privat, jetzt: Date.now() };
  const mitglieder = alle.filter((e) => e.typ === "serie" && e.serieId === id);
  const direkt = alle.filter((e) => e.typ === "rennen" && kat.rennen.some((r) => r.id === e.rennenId && r.serie === id));
  const ids = [...new Set([...mitglieder, ...direkt].map((e) => e.discordId))];
  const profile = new Map(await Promise.all(ids.map(async (d) => { const t = await blobGet(A.profilPfad(d)); return [d, t ? JSON.parse(t) : null]; })));
  // Letztes iRating je iRacing-ID aus den eingelesenen Ergebnissen
  const ausErgebnis = new Map();
  [...ergebnisse].sort((a, b) => String(a.start).localeCompare(String(b.start))).forEach((e) => e.fahrer.forEach((f) => { if (f.irating > 0) ausErgebnis.set(f.cust, f.irating); }));
  const sportsCar = serie.kategorie === "Sports_Car";
  const fahrer = ids.map((d) => {
    const p = profile.get(d);
    const eintrag = mitglieder.find((e) => e.discordId === d) || direkt.find((e) => e.discordId === d);
    const irating = p ? ausErgebnis.get(p.custId) ?? p.irating : null;
    const auto = sportsCar && irating !== null ? (klasseFuer(irating, serie.klassen) || {}).id || "" : "";
    const pid = p && p.custId ? fahrerKennung(p.custId) : "";
    return { pid, nummer: p ? p.nummer ?? "" : "", land: p ? p.land || "" : "", team: p ? p.team || "" : "", bild: (pid && oeffentlich[pid] && oeffentlich[pid].bild) || "", discordId: d, name: eintrag.name, mitglied: mitglieder.some((e) => e.discordId === d), fahrzeugklasse: eintrag.fahrzeugklasse, custId: p ? p.custId : "", iratingAngabe: p ? p.irating : null, iratingErgebnis: p && ausErgebnis.has(p.custId) ? ausErgebnis.get(p.custId) : null, klasseAuto: auto, klasseFest: p ? privat.einstufung[p.custId] || "" : "", modell: (fahrzeuge.get(d) || {}).modell || "", wechsel: ((fahrzeuge.get(d) || {}).wechsel || []).length };
  }).sort((a, b) => a.name.localeCompare(b.name, "de"));
  const opt = { jetzt: Date.now(), schlussMinuten: 60, discordId: "", serien: { [id]: serie }, mitIds: true };
  return {
    serie: id, fahrer,
    rennen: A.baueRennen(kat.rennen.filter((r) => r.serie === id), alle, opt).map(({ id: rid, titel, start, status, plaetze, starter, warteliste }) => ({ id: rid, titel, start, status, plaetze, starter, warteliste })),
    ergebnisse: ergebnisse.map((e) => ({ id: e.id, start: e.start, strecke: e.strecke, variante: e.variante, verkuerzt: !!e.verkuerzt, sichtung: D.istSichtung(e, kat.rennen, id), stand: R.ergebnisStand(e.start, standCtx), fahrer: e.fahrer.map((f) => ({ cust: f.cust, name: f.name })) })).sort((a, b) => String(a.start).localeCompare(String(b.start))),
    strafen: [
      ...privat.strafen.map((s) => ({ ...s, typ: "punkte" })),
      ...(privat.zeitstrafen || []).map((s) => ({ ...s, typ: "zeit" })),
      ...(privat.disqualifikationen || []).map((s) => ({ ...s, typ: "dsq" })),
    ],
  };
}

// Prüft, ob dieser Nutzer über den Report entscheiden darf.
function darfEntscheiden(report, s) {
  if (R.beteiligt(report, s.id)) throw new Hinweis("Du bist an diesem Vorfall beteiligt und kannst nicht darüber entscheiden.");
}

async function neuBerechnen(kat, id) {
  return D.tabelleNeu(id, serieFinden(kat, id), await D.ergebnisseLesen(id), kat.rennen);
}

const rennenFinden = (kat, id) => {
  const r = kat.rennen.find((x) => x.id === id);
  if (!r) throw new Hinweis("Dieses Rennen gibt es nicht.");
  return r;
};
// Die Streckenkarte wird beim Lesen ergänzt und gehört nicht in die Datei.
const rennenDaten = ({ streckenBild, ...r }) => r;

/* ---------- Änderungsprotokoll: jede Aktion steht im Dateinamen, eine Abfrage liefert alle Einträge ---------- */
const PROTOKOLL = "liga-protokoll/";
const MAX_PROTOKOLL = 300;
const protokollPfad = (zeit, zufall, eintrag) => `${PROTOKOLL}${String(zeit).padStart(15, "0")}-${zufall}~${Buffer.from(JSON.stringify(eintrag), "utf8").toString("base64url")}`;
function leseProtokoll(blob) {
  const m = new RegExp(`^${PROTOKOLL}(\\d{15})-[0-9a-f]+~([A-Za-z0-9_-]+)$`).exec(blob.pathname || "");
  if (!m) return null;
  try {
    return { pfad: blob.pathname, zeit: new Date(Number(m[1])).toISOString(), ...JSON.parse(Buffer.from(m[2], "base64url").toString("utf8")) };
  } catch (e) {
    return null;
  }
}

async function protokollText(b, kat) {
  const serie = (id) => (kat.serien.find((s) => s.id === id) || {}).name || id;
  const rennen = (id) => (kat.rennen.find((r) => r.id === id) || {}).titel || id;
  const strecke = (id) => (kat.strecken.find((s) => s.id === id) || {}).name || id;
  const report = async () => { const r = await R.lesen(b.id); return `${r.rennenTitel}, ${r.von.name} gegen ${r.gegen.name}`; };
  const texte = {
    "serie-speichern": () => `${b.id ? "Serie geändert" : "Serie angelegt"}: ${(b.serie || {}).name}`,
    "serie-loeschen": () => `Serie gelöscht: ${serie(b.id)}`,
    "strecke-speichern": () => `${b.id ? "Strecke geändert" : "Strecke angelegt"}: ${(b.strecke || {}).name}`,
    "strecke-loeschen": () => `Strecke gelöscht: ${strecke(b.id)}`,
    "strecken-import": () => "Streckenliste aus Garage 61 importiert",
    "report-stimme": async () => `Stimme abgegeben: ${await report()}`,
    "pruefung-erledigt": () => `Prüfung nach dem Rennen erledigt in ${serie(b.serie)}`,
    "bericht-posten": () => `Rennbericht im Discord gepostet: ${serie(b.serie)}`,
    "ergebnis-endgueltig": () => `Ergebnis endgültig freigegeben in ${serie(b.serie)}`,
    "katalog-speichern": () => "Strafenkatalog geändert",
    "reglement-speichern": () => `Reglement geändert, Version ${(b.reglement || {}).version}`,
    "ergebnis-distanz": () => `Renndistanz ${b.verkuerzt ? "als verkürzt markiert" : "wieder als voll gewertet"} in ${serie(b.serie)}`,
    "saison-planen": () => `${(b.rennen || []).length} Rennen geplant in ${serie(b.serie)}`,
    "rennen-speichern": () => `${b.id ? "Rennen geändert" : "Rennen angelegt"}: ${(b.rennen || {}).titel}`,
    "rennen-loeschen": () => `Rennen gelöscht: ${rennen(b.id)}`,
    "rennen-verschieben": () => `Rennen um ${b.tage} Tage verschoben${b.folgende ? ", inklusive aller folgenden" : ""}: ${rennen(b.id)}`,
    "rennen-duplizieren": () => `Rennen dupliziert: ${rennen(b.id)}`,
    "passwort-setzen": () => `Passwort für alle kommenden Rennen gesetzt: ${serie(b.serie)}`,
    "ergebnis-veroeffentlichen": () => `Ergebnis veröffentlicht in ${serie(b.serie)}`,
    "ergebnis-loeschen": () => `Ergebnis gelöscht in ${serie(b.serie)}`,
    "strafe-hinzufuegen": () => `Strafe eingetragen in ${serie(b.serie)}: ${b.punkte} Punkte`,
    "strafe-loeschen": () => `Strafe gelöscht in ${serie(b.serie)}`,
    "einstufung-setzen": () => `Einstufung geändert in ${serie(b.serie)}`,
    "fahrer-aus-serie": () => `Fahrer aus Serie entfernt: ${serie(b.serie)}`,
    "fahrer-aus-rennen": () => `Fahrer aus Rennen genommen: ${rennen(b.rennen)}`,
    "profil-bearbeiten": () => `Fahrerprofil geändert: ${(b.profil || {}).iracingName}${b.bildEntfernen ? ", Profilbild entfernt" : ""}`,
    "nummer-bestaetigen": () => `Startnummer bestätigt: ${b.name}, neu #${b.nummer}`,
    "nummer-ablehnen": () => `Startnummer abgelehnt: ${b.name}, gewünscht #${b.nummer}`,
    "g61-sichtung-test": () => "",
    "anfrage-entscheiden": () => `Beitrittsanfrage ${b.ja === true ? "freigegeben" : "abgelehnt"} in ${serie(b.serie)}: ${b.name || b.discordId}`,
    "fahrzeug-entscheiden": () => `Fahrzeugwechsel ${b.ja === true ? "bestätigt" : "abgelehnt"} in ${serie(b.serie)}`,
    "fahrzeug-setzen": () => `Fahrzeug gesetzt in ${serie(b.serie)}: ${b.modell}`,
    "fahrzeug-streichen": () => `Ergebnis wegen Fahrzeug gestrichen in ${serie(b.serie)}`,
    "sichtung-uebernehmen": () => `Klassen aus der Sichtung übernommen: ${serie(b.serie)}`,
    "sichtung-einrichten": () => `Sichtung eingerichtet: ${serie(b.serie)}`,
    "sichtung-zuruecksetzen": () => `Sichtungs-Abgabe zurückgesetzt in ${serie(b.serie)}: ${b.name || b.discordId}, ${b.streckeName || b.strecke}`,
    "sichtung-zuordnen": () => `Garage-61-Fahrer ${b.discordId ? "zugeordnet" : "Zuordnung gelöst"} in ${serie(b.serie)}: ${b.slug}`,
    "report-status": async () => `Report-Status geändert: ${await report()}`,
    "report-urteil": async () => `Urteil gesprochen (${(b.urteil || {}).art}): ${await report()}`,
  };
  return texte[b.aktion] ? String(await texte[b.aktion]()).slice(0, 300) : "";
}

// Ein Fehler beim Protokollieren darf die eigentliche Aktion nicht zurückdrehen.
async function protokollieren(s, b, kat) {
  try {
    const text = await protokollText(b, kat);
    if (text) await blobPut(protokollPfad(Date.now(), crypto.randomBytes(3).toString("hex"), { wer: s.name, text }), "1", "text/plain");
  } catch (e) {
    console.error("Liga-Protokoll:", e.message);
  }
}

async function protokollLesen() {
  const alle = (await blobList(PROTOKOLL)).map(leseProtokoll).filter(Boolean).sort((a, b) => b.pfad.localeCompare(a.pfad));
  const alt = alle.slice(MAX_PROTOKOLL).map((e) => e.pfad);
  if (alt.length) await blobDelete(alt).catch((e) => console.error("Liga-Protokoll:", e.message));
  return alle.slice(0, MAX_PROTOKOLL).map(({ pfad, ...e }) => e);
}

// Hinweise für das Cockpit, kurz zwischengespeichert. Nach jeder Änderung der Rennleitung wird neu gerechnet.
let fehlendCache = { bis: 0, wert: null };
const COCKPIT_LEER = { fehlendeErgebnisse: [], pruefungen: [], strafkonten: [], sichtungen: [] };
async function cockpitHinweise(kat) {
  if (fehlendCache.wert && fehlendCache.bis > Date.now()) return fehlendCache.wert;
  const serien = kat.serien.filter((s) => s.status !== "beendet");
  const rennen = kat.rennen.filter((r) => serien.some((s) => s.id === r.serie));
  const ergebnisse = new Map(await Promise.all(serien.map(async (s) => [s.id, await D.ergebnisseLesen(s.id)])));
  const pruefungen = serien.flatMap((s) => ergebnisse.get(s.id).filter((e) => e.pruefung && !e.pruefung.erledigt).map((e) => ({ serie: s.id, serieName: s.name, id: e.id, strecke: e.strecke, start: e.start, noShows: e.pruefung.noShows, incidents: e.pruefung.incidents, fahrzeuge: e.pruefung.fahrzeuge || [] })));
  const strafkonten = (await Promise.all(serien.map(async (s) => D.strafkonten(s, await D.privatLesen(s.id))))).flat();
  const mitSichtung = serien.filter((s) => s.einstufungArt === "sichtung");
  const sichtungen = mitSichtung.length ? await eintraege().then((alle) => Promise.all(mitSichtung.map((s) => Sichtung.fortschritt(s, alle)))).catch(() => []) : [];
  const wert = { fehlendeErgebnisse: D.rennenOhneErgebnis(rennen, ergebnisse, Date.now()), pruefungen, strafkonten, sichtungen };
  fehlendCache = { bis: Date.now() + 60000, wert };
  return wert;
}

// Die laut Anmeldung erwarteten Starter des Rennens, mit iRacing-ID für den Abgleich mit dem Ergebnis.
async function erwarteteStarter(kat, serie, ergebnis) {
  const rennen = Renntag.rennenZumErgebnis(kat.rennen, serie.id, ergebnis);
  if (!rennen) return [];
  const [stand] = A.baueRennen([rennen], await eintraege(), { jetzt: Date.now(), schlussMinuten: 60, discordId: "", serien: { [serie.id]: serie }, mitIds: true, auchVergangene: true });
  return Promise.all(stand.starter.map(async (f) => { const t = await blobGet(A.profilPfad(f.discordId)); return { name: f.name, discordId: f.discordId, cust: t ? JSON.parse(t).custId : "" }; }));
}

// Daten für Grafik und Nachricht zu einem eingelesenen Ergebnis
async function berichtZumErgebnis(kat, serieId, id) {
  const serie = serieFinden(kat, serieId);
  const ergebnis = (await D.ergebnisseLesen(serieId)).find((e) => e.id === String(id));
  if (!ergebnis) throw new Hinweis("Dieses Ergebnis gibt es nicht.");
  const bericht = Renntag.berichtDaten(serie, ergebnis, await D.tabelleLesen(serieId), kat.rennen);
  if (!bericht) throw new Hinweis("Für dieses Rennen gibt es noch keinen Rennbericht.");
  const stand = R.ergebnisStand(ergebnis.start, { serie, rennen: kat.rennen, reports: await R.alleReports(true), privat: await D.privatLesen(serieId), jetzt: Date.now() });
  // Namen aus dem Ergebnis über die iRacing-ID dem Discord-Konto zuordnen. Ohne Treffer bleibt es beim Namen.
  const { discord } = await gemeldeteFahrer(kat, serieId).catch(() => ({ discord: new Map() }));
  const erwaehnungen = Object.fromEntries((ergebnis.fahrer || []).filter((f) => discord.get(String(f.cust))).map((f) => [f.name, discord.get(String(f.cust))]));
  return { ...bericht, erwaehnungen, vorlaeufig: stand === "vorlaeufig" };
}

// Bildziel „strecke:<id>“ führt zu einer Strecke der Bibliothek.
function streckeZiel(kat, ziel) {
  const m = /^strecke:(.+)$/.exec(String(ziel || ""));
  if (!m) return null;
  const strecke = kat.strecken.find((s) => s.id === m[1]);
  if (!strecke) throw new Hinweis("Diese Strecke gibt es nicht.");
  return strecke;
}

// Bei Events zählt nur die Platzierung, Strafpunkte hätten dort keine Wirkung.
function keinePunkteBeiEvents(kat, serieId, art) {
  const serie = kat.serien.find((s) => s.id === serieId);
  if (art === "strafpunkte" && serie && serie.typ === "event") throw new Hinweis("Bei Events gibt es keine Strafpunkte. Bitte wähle eine Zeitstrafe oder Disqualifikation.");
}

const aktionen = {
  async "serie-speichern"(b, kat) {
    // Die Einrichtung der Sichtung steht im eigenen Menüpunkt. Das Season-Formular schickt sie nicht mit, sie bleibt erhalten.
    const gespeichert = b.id && D.istId(b.id) ? JSON.parse((await blobGet(`liga/daten/serien/${b.id}.json`)) || "{}") : {};
    const sichtung = Object.fromEntries(D.SICHTUNG_FELDER.filter((k) => gespeichert[k] !== undefined && (b.serie || {})[k] === undefined).map((k) => [k, gespeichert[k]]));
    const daten = D.pruefeSerie({ ...sichtung, ...(b.serie || {}) });
    let id = b.id;
    if (id) {
      const bisher = serieFinden(kat, D.brauchtId(id));
      D.nichtUeberschreiben(b.vorher, bisher, ["bildVersion"], "Diese Serie");
      if (bisher.bildVersion) daten.bildVersion = bisher.bildVersion;
    } else {
      id = D.slug(daten.name);
      if (!D.istId(id)) throw new Hinweis("Dieser Name ergibt keine gültige Kennung.");
      if (kat.serien.some((s) => s.id === id)) throw new Hinweis("Eine Serie mit diesem Namen gibt es schon.");
    }
    await D.serieSpeichern(id, daten);
    // Geänderte Punkte oder Klassen wirken sofort auf die Tabelle.
    if (b.id) await D.tabelleNeu(id, { ...daten, id }, await D.ergebnisseLesen(id), kat.rennen);
    return { id };
  },
  async "serie-loeschen"(b, kat) {
    const serie = serieFinden(kat, b.id);
    const rennen = kat.rennen.filter((r) => r.serie === b.id);
    const ids = new Set(rennen.map((r) => r.id));
    const meldungen = (await eintraege()).filter((e) => (e.typ === "serie" && e.serieId === b.id) || (e.typ !== "serie" && ids.has(e.rennenId)));
    const hatDaten = rennen.length || meldungen.length || (await D.ergebnisseLesen(b.id)).length;
    if (hatDaten && serie.status !== "beendet") throw new Hinweis("Diese Serie hat noch Rennen, Meldungen oder Ergebnisse. Setze sie zuerst auf „Beendet“, dann lässt sie sich komplett löschen.");
    if (hatDaten && b.bestaetigung !== serie.name) throw new Hinweis("Bitte bestätige das Löschen mit dem genauen Namen der Serie.");
    if (meldungen.length) await blobDelete(meldungen.map((e) => e.pfad));
    await Promise.all(rennen.map((r) => D.rennenLoeschen(r.id)));
    await R.derSerieLoeschen(b.id);
    await D.serieDatenLoeschen(b.id);
    await Sichtung.derSerieLoeschen(b.id).catch(() => {});
    await Anfragen.derSerieLoeschen(b.id).catch(() => {});
    await D.serieLoeschen(b.id);
    if (serie.bildVersion) await D.bildLoeschen(`serie-${b.id}`);
    return {};
  },
  async "strecke-speichern"(b, kat) {
    const daten = D.pruefeStrecke(b.strecke || {});
    let id = b.id;
    if (id) {
      const bisher = kat.strecken.find((s) => s.id === id);
      if (!bisher) throw new Hinweis("Diese Strecke gibt es nicht.");
      D.nichtUeberschreiben(b.vorher, bisher, ["kartenVersion"], "Diese Strecke");
      if (bisher.kartenVersion) daten.kartenVersion = bisher.kartenVersion;
      if (bisher.g61) daten.g61 = bisher.g61;
    } else {
      id = D.slug([daten.name, daten.variante].filter(Boolean).join(" "));
      if (!D.istId(id)) throw new Hinweis("Dieser Name ergibt keine gültige Kennung.");
      if (kat.strecken.some((s) => s.id === id)) throw new Hinweis("Diese Strecke gibt es schon.");
    }
    await D.streckeSpeichern(id, daten);
    return { id };
  },
  // Geplante Rennen behalten den Streckennamen, nur die Karte entfällt.
  async "strecke-loeschen"(b, kat) {
    const strecke = kat.strecken.find((s) => s.id === b.id);
    if (!strecke) throw new Hinweis("Diese Strecke gibt es nicht.");
    if (!strecke.importiert) await D.streckeLoeschen(b.id);
    await D.streckeAusImportEntfernen(b.id);
    if (strecke.kartenVersion) await D.bildLoeschen(`strecke-${b.id}`);
    return {};
  },
  // Holt alle Strecken aus Garage 61. Eigene Strecken und ihre Karten bleiben unverändert.
  async "strecken-import"(b, kat) {
    const liste = await G.streckenLaden();
    if (!liste.length) throw new Hinweis("Garage 61 hat keine Strecken geliefert.");
    await D.streckenImportSpeichern(liste);
    const gesamt = D.streckenZusammen(kat.strecken.filter((s) => !s.importiert), liste).length;
    return { gelesen: liste.length, neu: Math.max(0, gesamt - kat.strecken.length) };
  },
  // Liefert nur die Linie. Gezeichnet und über „bild-speichern“ abgelegt wird sie im Browser, wie jedes hochgeladene Bild.
  async "strecke-karte"(b, kat) {
    const strecke = kat.strecken.find((s) => s.id === b.id);
    if (!strecke) throw new Hinweis("Diese Strecke gibt es nicht.");
    return G.kartendaten(strecke);
  },
  // Korrigiert das Profil eines Fahrers. Es gelten dieselben Prüfungen wie im Fahrerbereich.
  async "profil-bearbeiten"(b, kat) {
    const discordId = D.brauchtId(b.discordId);
    const gespeichert = await blobGet(A.profilPfad(discordId));
    if (!gespeichert) throw new Hinweis("Dieser Fahrer hat noch kein Profil.");
    const bisher = JSON.parse(gespeichert);
    // Die Zustimmung zur Fahrerübersicht gibt nur der Fahrer selbst, die Rennleitung übernimmt sie unverändert.
    const extras = { ...A.pruefeExtras(b.profil), zeigeBild: !b.bildEntfernen && bisher.zeigeBild !== false, uebersicht: bisher.uebersicht === true };
    A.nummerPflicht(extras);
    const geaendert = extras.nummer !== bisher.nummer;
    const entscheid = geaendert ? P.nummerEntscheid("bestaetigt", extras.nummer) : null;
    const felder = { ...A.pruefeProfil(b.profil), ...extras, ...(entscheid ? { nummerEntscheid: entscheid } : {}), gespeichert: new Date().toISOString() };
    await P.speichern({ id: discordId, avatar: "" }, { ...bisher, ...felder }, extras);
    // Nur die bearbeiteten Felder, damit z. B. der Discord-Stand aus einem gleichzeitigen Abgleich erhalten bleibt.
    const profil = await D.jsonAendern(A.profilPfad(discordId), (aktuell) => ({ ...(aktuell || bisher), ...felder }));
    // Hat die Rennleitung die Nummer selbst geändert, ist ein offener Antrag erledigt.
    if (geaendert) await P.wunschLoeschen(discordId);
    await Dc.abgleichen(discordId, profil, await eintraege(), kat.serien);
    if (entscheid) await Dc.nachricht(discordId, entscheid.text);
    return { custId: profil.custId };
  },
  async "nummer-bestaetigen"(b, kat) {
    const discordId = D.brauchtId(b.discordId);
    const wunsch = await P.wunschLesen(discordId);
    if (!wunsch) throw new Hinweis("Dieser Antrag liegt nicht mehr vor.");
    const gespeichert = await blobGet(A.profilPfad(discordId));
    if (!gespeichert) throw new Hinweis("Dieser Fahrer hat noch kein Profil.");
    const bisher = JSON.parse(gespeichert);
    const extras = { nummer: wunsch.nach, land: bisher.land || "", team: bisher.team || "", kanal: bisher.kanal || "", zeigeBild: bisher.zeigeBild !== false, uebersicht: bisher.uebersicht === true };
    const entscheid = P.nummerEntscheid("bestaetigt", wunsch.nach);
    const felder = { nummer: wunsch.nach, nummerEntscheid: entscheid, gespeichert: new Date().toISOString() };
    await P.speichern({ id: discordId, avatar: "" }, { ...bisher, ...felder }, extras);
    const profil = await D.jsonAendern(A.profilPfad(discordId), (aktuell) => ({ ...(aktuell || bisher), ...felder }));
    await P.wunschLoeschen(discordId);
    await Dc.abgleichen(discordId, profil, await eintraege(), kat.serien);
    await Dc.nachricht(discordId, entscheid.text);
    return {};
  },
  // Zugriffstest für die Sichtung: Was liefert Garage 61 aus dem Liga-Team? Nur lesen, nichts wird gespeichert.
  // Zeigt Team, Mitglieder, Sessions der letzten 14 Tage und die Felder einer Beispielrunde, damit die Sichtung auf echte Daten passt.
  async "g61-sichtung-test"() {
    const team = process.env.G61_SICHTUNG_TEAM || "darkline-simracing-series";
    const T = "G61_SICHTUNG_TOKEN";
    const schritt = async (name, fn) => { try { return { name, ok: true, daten: await fn() }; } catch (e) { return { name, ok: false, fehler: `${e.status ? `Code ${e.status}: ` : ""}${e.message}` }; } };
    const kurz = (o, tiefe = 0) => (Array.isArray(o) ? (o.length ? [kurz(o[0], tiefe + 1), `… ${o.length} Einträge`] : []) : o && typeof o === "object" ? (tiefe > 2 ? "{…}" : Object.fromEntries(Object.entries(o).slice(0, 40).map(([k, v]) => [k, kurz(v, tiefe + 1)]))) : o);
    const nach = new Date(Date.now() - 14 * 864e5).toISOString();
    const teamInfo = await schritt("Team", async () => { const t = await G61.g61Get(`/teams/${team}`, {}, T); return { name: t.name, slug: t.slug, mitglieder: (t.members || t.drivers || []).map((m) => [m.firstName, m.lastName].filter(Boolean).join(" ") || m.slug || m.name), felder: Object.keys(t) }; });
    const events = await schritt("Sessions (14 Tage)", async () => G61.items(await G61.g61Get("/events", { team, after: nach, before: new Date().toISOString(), limit: 20 }, T)).map((e) => ({ id: e.id, start: e.startedAt, strecke: e.track && e.track.name, variante: e.track && e.track.variant, auto: e.car && e.car.name, runden: e.lapCount, fahrer: (e.drivers || []).length, iracing: !!e.platformEvent, felder: Object.keys(e) })));
    const ersteId = events.ok && events.daten.find((e) => e.runden > 0);
    const beispiel = ersteId ? await schritt("Beispiel-Session", async () => { const ev = await G61.g61Get(`/events/${ersteId.id}`, {}, T); const { laps, ...rest } = ev; return { session: kurz(rest), runden: (laps || []).length, ersteRunde: kurz((laps || [])[0] || null), sessionArten: [...new Set((laps || []).map((l) => l.sessionType))], sauber: (laps || []).filter((l) => l.clean).length }; }) : { name: "Beispiel-Session", ok: false, fehler: "Keine Session mit Runden in den letzten 14 Tagen gefunden. Bitte ein paar Runden fahren und erneut testen." };
    return { g61Test: { team, schritte: [teamInfo, events, beispiel] } };
  },
  // Alle Fahrzeugnamen aus Garage 61 als Vorschlag für die Fahrzeugliste einer Season
  async fahrzeugliste() {
    // Garage-61-Fehler (kein Zugriff, ausgelastet) sollen im Formular lesbar ankommen, nicht als „Technischer Fehler“.
    const liste = await G61.cars().catch((e) => { throw new Hinweis(`Garage 61: ${e.message} Du kannst die Fahrzeuge auch von Hand eintragen.`); });
    const namen = [...new Set([...liste.values()].map((n) => String(n || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
    return { fahrzeuge: namen };
  },
  // Fahrzeugwechsel: Antrag des Fahrers bestätigen oder ablehnen, der Fahrer bekommt eine Direktnachricht.
  async "fahrzeug-entscheiden"(b, kat) {
    const serie = serieFinden(kat, b.serie);
    const discordId = D.brauchtId(b.discordId);
    const vorher = await F.lesen(serie.id, discordId);
    const ja = b.ja === true;
    const grund = String(b.grund || "").trim().slice(0, 300);
    await F.entscheiden(serie, discordId, ja);
    const nach = vorher && vorher.antrag ? vorher.antrag.nach : "";
    await Dc.nachricht(discordId, ja ? `✅ Dein Fahrzeugwechsel in **${serie.name}** ist bestätigt: Ab dem nächsten Rennen fährst du den **${nach}**.` : `❌ Dein Fahrzeugwechsel in **${serie.name}** auf den ${nach} wurde abgelehnt. Du fährst weiter den **${vorher ? vorher.modell : ""}**.${grund ? `\nGrund: ${grund}` : ""}`);
    return {};
  },
  // Beitrittsanfrage einer privaten Season: Freigabe macht daraus eine normale Season-Anmeldung, der Fahrer bekommt in beiden Fällen eine Direktnachricht.
  async "anfrage-entscheiden"(b, kat) {
    const serie = serieFinden(kat, b.serie);
    const discordId = D.brauchtId(b.discordId);
    const anfrage = await Anfragen.lesen(serie.id, discordId);
    if (!anfrage) throw new Hinweis("Diese Anfrage liegt nicht mehr vor.");
    if (b.ja !== true) {
      await Anfragen.loeschen(serie.id, discordId);
      await Dc.nachricht(discordId, Anfragen.ablehnungText(serie, String(b.grund || "").trim().slice(0, 300)));
      return {};
    }
    if (serie.status === "beendet") throw new Hinweis("Diese Season ist beendet.");
    const alle = await eintraege();
    if (!alle.some((e) => e.typ === "serie" && e.serieId === serie.id && e.discordId === discordId)) {
      // Das Fahrzeug aus der Anfrage. Hat die Rennleitung die Liste inzwischen geändert, wird es ohne Fahrzeug übernommen und lässt sich im Fahrerbereich wählen.
      let modell = "";
      try { modell = F.modellPruefen(serie, anfrage.modell || ""); } catch (e) { modell = ""; }
      if (modell) await F.waehlen(serie, discordId, modell, anfrage.name);
      await blobPut(A.mitgliedPfad(serie.id, discordId, anfrage.fahrzeugklasse || "", anfrage.name || "Fahrer"), "1", "text/plain");
      if (serie.einstufungArt === "sichtung" && !serie.ohneKlassen) await Dc.nachricht(discordId, Sichtung.einladungText(serie, modell)).catch(() => {});
    }
    await Anfragen.loeschen(serie.id, discordId);
    const profilText = await blobGet(A.profilPfad(discordId));
    if (profilText) await Dc.abgleichen(discordId, JSON.parse(profilText), await eintraege(), kat.serien).catch(() => {});
    await Dc.nachricht(discordId, Anfragen.freigabeText(serie));
    return {};
  },
  // Die Rennleitung setzt das Fahrzeug direkt, etwa nach einem im Rennen festgestellten Wechsel.
  async "fahrzeug-setzen"(b, kat) {
    await F.setzen(serieFinden(kat, b.serie), D.brauchtId(b.discordId), String(b.modell || ""));
    return {};
  },
  // Anderes Auto als gemeldet und nicht genehmigt: Das Ergebnis dieses Fahrers wird gestrichen (gewertet wie eine Disqualifikation).
  async "fahrzeug-streichen"(b, kat) {
    serieFinden(kat, b.serie);
    const ergebnis = (await D.ergebnisseLesen(b.serie)).find((e) => e.id === String(b.rennen));
    const fahrer = ergebnis && ergebnis.fahrer.find((f) => f.cust === String(b.cust));
    if (!fahrer) throw new Hinweis("Dieses Ergebnis gibt es nicht mehr.");
    const id = `fz-${ergebnis.id}-${fahrer.cust}`;
    await D.privatAendern(b.serie, (privat) => ((privat.disqualifikationen || []).some((x) => x.id === id) ? undefined : { ...privat, disqualifikationen: [...(privat.disqualifikationen || []), { id, rennen: ergebnis.id, cust: fahrer.cust, name: fahrer.name, grund: `Nicht gemeldetes Fahrzeug (${fahrer.fahrzeug})` }] }));
    await neuBerechnen(kat, b.serie);
    return {};
  },
  async "nummer-ablehnen"(b) {
    const discordId = D.brauchtId(b.discordId);
    const wunsch = await P.wunschLesen(discordId);
    if (!wunsch) throw new Hinweis("Dieser Antrag liegt nicht mehr vor.");
    const entscheid = P.nummerEntscheid("abgelehnt", wunsch.nach, wunsch.von, String(b.grund || "").trim().slice(0, 300));
    await D.jsonAendern(A.profilPfad(discordId), (aktuell) => (aktuell ? { ...aktuell, nummerEntscheid: entscheid } : undefined));
    await P.wunschLoeschen(discordId);
    await Dc.nachricht(discordId, entscheid.text);
    return {};
  },
  // Testet alle drei Webhooks: Reports, Renntag und Urteile.
  async "discord-test"(b, kat, s) {
    const beispiel = R.reportKarte({ serie: "GT3 Sprint", rennen: "Runde 3 · Spa", session: "rennen", zeitstempel: "24:17", stelle: "Runde 5, Kurve 3", von: "Max Beispiel", gegen: "Tom Muster", beschreibung: `Beim Anbremsen auf Kurve 3 wurde ich von hinten getroffen und habe mich gedreht. Ausgelöst von ${s.name} über den Knopf „Discord testen“.`, clip: "https://www.twitch.tv/videos/beispiel" }, true);
    // Beispiel wie ein normaler Renntag: Serverstart heute 18:00 Uhr nach Berliner Zeit.
    const start = A.berlinNachUtc(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date()), "18:00");
    const renntag = Renntag.erinnerungKarte({
      titel: "Runde 3 · Spa", serieName: "GT3 Sprint", strecke: "Circuit de Spa-Francorchamps", start: new Date(start).toISOString(), schluss: new Date(start - 3600e3).toISOString(),
      plaetze: 24, starter: Array.from({ length: 18 }, () => ({})), warteliste: [{}, {}], training: "70 Min", qualifying: "40 Min", renndauer: "65 Min", fahrzeuge: "GT3 und GT4", zugangNoetig: false,
    });
    // Der echte Rennbericht hängt zusätzlich die im Admin-Bereich gezeichnete Grafik an, der Test kommt ohne aus.
    // Platz 1 in GT3 erwähnt den Auslöser selbst, damit man die Verlinkung im Test sieht.
    const bericht = Renntag.berichtKarte({
      serie: "", serieName: "GT3 Sprint", titel: "Runde 3 · Spa", strecke: "Circuit de Spa-Francorchamps · Grand Prix", vorlaeufig: true, erwaehnungen: { "Max Beispiel": s.id },
      klassen: [
        { fahrzeugklasse: "GT3", podium: ["Max Beispiel", "Tom Muster", "Lena Probe"], schnellste: { name: "Tom Muster", zeit: "2:18.452" }, aufholer: { name: "Lena Probe", plaetze: 6 } },
        { fahrzeugklasse: "GT4", podium: ["Jonas Test", "Mia Muster", "Paul Probe"], schnellste: { name: "Mia Muster", zeit: "2:31.907" }, aufholer: { name: "Paul Probe", plaetze: 4 } },
      ],
    }, false);
    const urteil = R.urteilKarte({ serieName: "GT3 Sprint", rennenTitel: "Runde 3 · Spa", gegen: { name: "Max Beispiel", discordId: s.id } }, { art: "strafpunkte", punkte: 3 });
    const ergebnis = await R.webhooksTesten(s.name, { Reports: beispiel, Renntag: [renntag, bericht], Urteile: urteil });
    if (ergebnis.every((x) => x.stand === "fehlt")) throw new Hinweis("Es ist noch kein Discord-Webhook eingerichtet.");
    return { discord: ergebnis };
  },
  // Verschiebt ein Rennen, auf Wunsch auch alle folgenden derselben Serie.
  async "rennen-verschieben"(b, kat) {
    const ziel = rennenFinden(kat, b.id);
    const tage = Number(b.tage);
    if (!Number.isInteger(tage) || tage === 0 || Math.abs(tage) > 365) throw new Hinweis("Bitte gib die Anzahl der Tage als ganze Zahl an, negativ für früher.");
    const zeit = (r) => `${r.datum} ${r.startzeit}`;
    const liste = b.folgende ? kat.rennen.filter((r) => r.serie === ziel.serie && zeit(r) >= zeit(ziel)) : [ziel];
    await Promise.all(liste.map((r) => { const { id, ...daten } = rennenDaten(r); return D.rennenSpeichern(id, { ...daten, datum: D.datumPlus(r.datum, tage) }); }));
    return { anzahl: liste.length };
  },
  async "rennen-duplizieren"(b, kat) {
    const { id, ...daten } = rennenDaten(rennenFinden(kat, b.id));
    const kopie = { ...daten, titel: `${daten.titel} (Kopie)`.slice(0, 80), datum: D.datumPlus(daten.datum, 7), status: "geplant" };
    const neu = D.neueRennenId(kopie);
    await D.rennenSpeichern(neu, kopie);
    return { id: neu };
  },
  // Setzt das Session-Passwort für alle kommenden Rennen einer Serie.
  async "passwort-setzen"(b, kat) {
    serieFinden(kat, b.serie);
    const passwort = String(b.passwort || "").trim().slice(0, 60);
    const heute = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
    const liste = kat.rennen.filter((r) => r.serie === b.serie && r.status !== "abgesagt" && String(r.datum) >= heute);
    if (!liste.length) throw new Hinweis("Diese Serie hat keine kommenden Rennen.");
    await Promise.all(liste.map((r) => { const { id, ...daten } = rennenDaten(r); return D.rennenSpeichern(id, { ...daten, passwort }); }));
    return { anzahl: liste.length };
  },
  // Legt alle Rennen einer Saison auf einmal an. Erst wenn jede Zeile gültig ist, wird gespeichert.
  async "saison-planen"(b, kat) {
    serieFinden(kat, b.serie);
    const liste = Array.isArray(b.rennen) ? b.rennen : [];
    if (!liste.length || liste.length > 60) throw new Hinweis("Bitte plane zwischen 1 und 60 Rennen auf einmal.");
    const daten = liste.map((r) => D.pruefeRennen({ ...r, serie: b.serie }, kat.serien.map((s) => s.id)));
    await Promise.all(daten.map((r) => D.rennenSpeichern(D.neueRennenId(r), r)));
    return { anzahl: daten.length };
  },
  // ziel ist „uebersicht“ für das Titelbild der Liga oder die Kennung einer Serie
  async "bild-speichern"(b, kat) {
    const buf = D.pruefeBild(b.daten);
    const version = Date.now();
    const strecke = streckeZiel(kat, b.ziel);
    if (strecke) {
      const { id, ...daten } = strecke;
      await D.bildSpeichern(`strecke-${id}`, buf);
      await D.streckeSpeichern(id, { ...daten, kartenVersion: version });
    } else if (b.ziel === "uebersicht") {
      await D.bildSpeichern("uebersicht", buf);
      await D.einstellungenSpeichern({ ...kat.einstellungen, kopfbildVersion: version });
    } else {
      const { id, ...serie } = serieFinden(kat, b.ziel);
      await D.bildSpeichern(`serie-${id}`, buf);
      await D.serieSpeichern(id, { ...serie, bildVersion: version });
    }
    return { version };
  },
  async "bild-loeschen"(b, kat) {
    const strecke = streckeZiel(kat, b.ziel);
    if (strecke) {
      const { id, kartenVersion, ...daten } = strecke;
      await D.bildLoeschen(`strecke-${id}`);
      await D.streckeSpeichern(id, daten);
    } else if (b.ziel === "uebersicht") {
      await D.bildLoeschen("uebersicht");
      const { kopfbildVersion, ...rest } = kat.einstellungen;
      await D.einstellungenSpeichern(rest);
    } else {
      const { id, bildVersion, ...serie } = serieFinden(kat, b.ziel);
      await D.bildLoeschen(`serie-${id}`);
      await D.serieSpeichern(id, serie);
    }
    return {};
  },
  async "rennen-speichern"(b, kat) {
    const daten = D.pruefeRennen(b.rennen || {}, kat.serien.map((s) => s.id));
    let id = b.id;
    if (id) {
      const bisher = kat.rennen.find((r) => r.id === id);
      if (!bisher) throw new Hinweis("Dieses Rennen gibt es nicht.");
      D.nichtUeberschreiben(b.vorher, bisher, ["streckenBild"], "Dieses Rennen");
    } else id = D.neueRennenId(daten);
    await D.rennenSpeichern(id, daten);
    // Wird ein Rennen zur Sichtung, wieder zum Wertungsrennen oder einer anderen Serie zugeordnet, ändert sich die Tabelle.
    const vorher = kat.rennen.find((r) => r.id === id);
    if (vorher && (!!vorher.sichtung !== daten.sichtung || vorher.serie !== daten.serie)) {
      const rennen = [...kat.rennen.filter((r) => r.id !== id), { ...daten, id }];
      for (const s of new Set([daten.serie, vorher.serie])) await D.tabelleNeu(s, serieFinden(kat, s), await D.ergebnisseLesen(s), rennen);
    }
    return { id };
  },
  async "rennen-loeschen"(b, kat) {
    if (!kat.rennen.some((r) => r.id === b.id)) throw new Hinweis("Dieses Rennen gibt es nicht.");
    // Einzelmeldungen und Abmeldungen gehören zum Rennen und gehen mit. Eingelesene Ergebnisse sind getrennt gespeichert und bleiben.
    const meldungen = (await eintraege()).filter((e) => e.typ !== "serie" && e.rennenId === b.id);
    // Ohne das Sichtungsrennen würde sein Ergebnis plötzlich in der Tabelle zählen.
    const weg = kat.rennen.find((r) => r.id === b.id);
    if (weg.sichtung && (await D.ergebnisseLesen(weg.serie)).some((e) => D.istSichtung(e, [weg], weg.serie))) throw new Hinweis("Zu diesem Sichtungsrennen gibt es ein eingelesenes Ergebnis. Lösche zuerst das Ergebnis, sonst würde es in der Tabelle zählen. Bereits übernommene Klassen bleiben erhalten.");
    if (meldungen.length) await blobDelete(meldungen.map((e) => e.pfad));
    await D.rennenLoeschen(b.id);
    return {};
  },
  // Rechnet die Tabelle mit der Datei, ohne etwas zu speichern.
  async "ergebnis-vorschau"(b, kat) {
    const serie = serieFinden(kat, b.serie);
    const eingelesen = leseErgebnis(b.datei);
    const { gemeldet, stamm } = await gemeldeteFahrer(kat, b.serie);
    const { ergebnis: neu, fremde, fehlend } = D.abgleichen(eingelesen, gemeldet, b.zugelassen, stamm);
    const vorhanden = await D.ergebnisseLesen(b.serie);
    const bisher = vorhanden.filter((e) => e.id !== neu.id);
    const sichtung = D.istSichtung(neu, kat.rennen, b.serie);
    const wertung = D.wertungsErgebnisse([...bisher, neu], kat.rennen, b.serie);
    const { warnungen, ...tabelle } = wertung.length ? berechneTabelle(wertung, serie, await D.privatLesen(b.serie)) : { warnungen: [], klassen: [], gesamt: [], rennen: [] };
    return { sichtung, warnungen, tabelle, ersetzt: bisher.length !== vorhanden.length, fremde, fehlend, gaeste: neu.fahrer.filter((f) => f.gast).map((f) => f.name), rennen: { id: neu.id, strecke: neu.strecke, start: neu.start, gesamt: eingelesen.fahrer.length, gewertet: neu.fahrer.length } };
  },
  async "ergebnis-veroeffentlichen"(b, kat) {
    const serie = serieFinden(kat, b.serie);
    // Nicht gemeldete Fahrer werden nicht gewertet und auch nicht gespeichert.
    const { gemeldet, stamm, discord } = await gemeldeteFahrer(kat, b.serie);
    const { ergebnis } = D.abgleichen(leseErgebnis(b.datei), gemeldet, b.zugelassen, stamm);
    if (!ergebnis.fahrer.length) throw new Hinweis("Keiner der Fahrer in dieser Datei ist für diese Serie gemeldet. Prüfe die Serie und die Datei oder lasse einzelne Fahrer als Gast zu.");
    // Ein Fehler bei der Zusatzprüfung darf das Veröffentlichen nicht verhindern.
    const fahrzeuge =(serie.modelle || []).length ? F.abweichungen(ergebnis, discord, await F.derSerie(b.serie).catch(() => new Map())) : [];
    const pruefung = D.pruefungNachRennen(ergebnis, await erwarteteStarter(kat, serie, ergebnis).catch(() => []), fahrzeuge);
    // Wird eine korrigierte Datei erneut eingelesen, bleibt die Markierung für die verkürzte Distanz erhalten.
    const bisher = (await D.ergebnisseLesen(b.serie)).find((e) => e.id === ergebnis.id);
    await D.ergebnisSpeichern(b.serie, { ...ergebnis, ...(pruefung ? { pruefung } : {}), ...(bisher && bisher.verkuerzt ? { verkuerzt: true } : {}) });
    const warnungen = (await neuBerechnen(kat, b.serie)) || [];
    const berichtOffen = !!process.env.LIGA_DISCORD_WEBHOOK && !(await Renntag.berichtSchonGepostet(ergebnis.id));
    return { warnungen, ergebnisId: ergebnis.id, berichtOffen };
  },
  async "reglement-speichern"(b) {
    await Regeln.reglementSpeichern(Regeln.pruefeReglement(b.reglement));
    return {};
  },
  // Reglement 4.3: Unter 75 % der ausgeschriebenen Distanz gibt es nur anteilige Platzpunkte. Das entscheidet die Rennleitung.
  async "ergebnis-distanz"(b, kat) {
    serieFinden(kat, b.serie);
    const ergebnis = (await D.ergebnisseLesen(b.serie)).find((e) => e.id === String(b.id));
    if (!ergebnis) throw new Hinweis("Dieses Ergebnis gibt es nicht.");
    await D.ergebnisSpeichern(b.serie, { ...ergebnis, verkuerzt: !!b.verkuerzt });
    await neuBerechnen(kat, b.serie);
    return {};
  },
  // Bereits gesprochene Urteile bleiben unverändert, sie speichern ihr Strafmaß selbst.
  async "katalog-speichern"(b) {
    await Regeln.katalogSpeichern(Regeln.pruefeKatalog(b.katalog));
    return {};
  },
  // Vor Ablauf der Fristen von Hand freigeben. Offene Reports und Einsprüche gehen vor.
  async "ergebnis-endgueltig"(b, kat) {
    const serie = serieFinden(kat, b.serie);
    const ergebnis = (await D.ergebnisseLesen(b.serie)).find((e) => e.id === String(b.id));
    if (!ergebnis) throw new Hinweis("Dieses Ergebnis gibt es nicht.");
    const offen = (await R.alleReports(true)).some((r) => r.serie === serie.id && Math.abs(new Date(r.start) - new Date(ergebnis.start)) <= 12 * 3600e3 && (!r.urteil || ((r.einsprueche || []).length > 0 && !r.endgueltig)));
    if (offen) throw new Hinweis("Zu diesem Rennen sind noch Reports oder Einsprüche offen. Entscheide sie zuerst.");
    await D.privatAendern(b.serie, (privat) => ({ ...privat, endgueltig: [...new Set([...(privat.endgueltig || []), ergebnis.start])] }));
    return {};
  },
  async "bericht-daten"(b, kat) {
    return { bericht: await berichtZumErgebnis(kat, b.serie, b.id) };
  },
  // bild ist die im Browser gezeichnete Grafik. Ohne sie geht die Nachricht als reiner Text raus.
  async "bericht-posten"(b, kat) {
    if (!process.env.LIGA_DISCORD_WEBHOOK) throw new Hinweis("Der Discord-Webhook der Liga ist noch nicht eingerichtet.");
    const bericht = await berichtZumErgebnis(kat, b.serie, b.id);
    const bild = b.bild ? D.pruefeBild(b.bild) : null;
    if (!(await Renntag.berichtPosten(bericht, String(b.id), bild))) throw new Hinweis("Discord hat die Nachricht nicht angenommen. Bitte prüfe den Webhook.");
    return {};
  },
  async "pruefung-erledigt"(b, kat) {
    serieFinden(kat, b.serie);
    const ergebnis = (await D.ergebnisseLesen(b.serie)).find((e) => e.id === String(b.id));
    if (!ergebnis || !ergebnis.pruefung) throw new Hinweis("Diese Prüfung gibt es nicht.");
    await D.ergebnisSpeichern(b.serie, { ...ergebnis, pruefung: { ...ergebnis.pruefung, erledigt: true } });
    return {};
  },
  async "report-stimme"(b, kat, s) {
    const stimme = R.pruefeStimme(b.stimme || {});
    await R.aendern(b.id, (report) => {
      darfEntscheiden(report, s);
      if (report.urteil) throw new Hinweis("Dieser Report ist bereits entschieden.");
      keinePunkteBeiEvents(kat, report.serie, stimme.art);
      R.stimmeSetzen(report, s, stimme);
    });
    return {};
  },
  async "ergebnis-loeschen"(b, kat) {
    serieFinden(kat, b.serie);
    await D.ergebnisLoeschen(b.serie, b.id);
    await neuBerechnen(kat, b.serie);
    return {};
  },
  async "strafe-hinzufuegen"(b, kat) {
    serieFinden(kat, b.serie);
    keinePunkteBeiEvents(kat, b.serie, "strafpunkte");
    const punkte = Number(b.punkte);
    if (!Number.isInteger(punkte) || punkte < 1 || punkte > 1000) throw new Hinweis("Bitte gib die Strafpunkte als ganze Zahl an.");
    const ergebnis = (await D.ergebnisseLesen(b.serie)).find((e) => e.id === String(b.rennen));
    const fahrer = ergebnis && ergebnis.fahrer.find((f) => f.cust === String(b.cust));
    if (!fahrer) throw new Hinweis("Bitte wähle Rennen und Fahrer aus.");
    const strafe = { id: `${Date.now()}`, rennen: ergebnis.id, cust: fahrer.cust, name: fahrer.name, punkte, grund: String(b.grund || "").trim().slice(0, 200) };
    await D.privatAendern(b.serie, (privat) => ({ ...privat, strafen: [...privat.strafen, strafe] }));
    await neuBerechnen(kat, b.serie);
    return {};
  },
  async "strafe-loeschen"(b, kat) {
    serieFinden(kat, b.serie);
    await D.privatAendern(b.serie, (privat) => {
      const alle = [...privat.strafen, ...(privat.disqualifikationen || [])];
      if (alle.some((s) => s.id === String(b.id) && s.reportId)) throw new Hinweis("Diese Strafe gehört zu einem Report. Bitte ändere dort das Urteil.");
      // Auch eine gestrichene Wertung (etwa wegen eines nicht gemeldeten Fahrzeugs) lässt sich so zurücknehmen.
      return { ...privat, strafen: privat.strafen.filter((s) => s.id !== String(b.id)), disqualifikationen: (privat.disqualifikationen || []).filter((s) => s.id !== String(b.id)) };
    });
    await neuBerechnen(kat, b.serie);
    return {};
  },
  async "einstufung-setzen"(b, kat) {
    const serie = serieFinden(kat, b.serie);
    if (!/^\d+$/.test(String(b.cust || ""))) throw new Hinweis("Für diesen Fahrer fehlt die iRacing-ID.");
    if (b.klasse && !serie.klassen.some((k) => k.id === b.klasse)) throw new Hinweis("Diese Klasse gibt es nicht.");
    await D.privatAendern(b.serie, (privat) => {
      const einstufung = { ...privat.einstufung };
      if (b.klasse) einstufung[b.cust] = b.klasse; else delete einstufung[b.cust];
      return { ...privat, einstufung };
    });
    await neuBerechnen(kat, b.serie);
    return {};
  },
  // Einrichtung der Sichtung einer Season: Zeitraum, Strecken, Runden, Wertung, Grenzen und Steckbrief.
  async "sichtung-einrichten"(b, kat) {
    const bisher = serieFinden(kat, D.brauchtId(b.serie));
    D.nichtUeberschreiben(b.vorher, bisher, ["bildVersion"], "Diese Season");
    const gespeichert = JSON.parse((await blobGet(`liga/daten/serien/${b.serie}.json`)) || "null");
    if (!gespeichert) throw new Hinweis("Diese Season gibt es nicht.");
    const e = b.einrichtung || {};
    const daten = D.pruefeSerie({ ...gespeichert, ...Object.fromEntries(D.SICHTUNG_FELDER.map((k) => [k, e[k]])), einstufungArt: "sichtung" });
    if (daten.einstufungArt !== "sichtung") throw new Hinweis("Eine Season ohne Klassen braucht keine Sichtung.");
    if (gespeichert.bildVersion) daten.bildVersion = gespeichert.bildVersion;
    await D.serieSpeichern(b.serie, daten);
    return {};
  },
  // Stand für den Menüpunkt „Sichtung“. Liest Garage 61, speichert nichts.
  async "sichtung-stand"(b, kat) {
    const serie = serieFinden(kat, b.serie);
    if (serie.einstufungArt !== "sichtung") throw new Hinweis("Diese Season wird nach iRating eingestuft.");
    return { sichtung: await Sichtung.adminStand(serie, await eintraege(), await D.privatLesen(serie.id)) };
  },
  async "sichtung-zuruecksetzen"(b, kat) {
    const serie = serieFinden(kat, b.serie);
    await Sichtung.zuruecksetzen(serie.id, D.brauchtId(String(b.discordId || "")), String(b.strecke || ""));
    return {};
  },
  // Garage-61-Fahrer, deren Name nicht eindeutig passt, ordnet die Rennleitung von Hand zu. Leere Discord-ID löst die Zuordnung.
  async "sichtung-zuordnen"(b, kat) {
    serieFinden(kat, b.serie);
    const slug = String(b.slug || "").trim().slice(0, 100);
    if (!slug) throw new Hinweis("Unbekannter Garage-61-Fahrer.");
    const discordId = b.discordId ? D.brauchtId(String(b.discordId)) : "";
    await D.privatAendern(b.serie, (privat) => {
      const zuordnung = { ...(privat.sichtungZuordnung || {}) };
      if (discordId) zuordnung[slug] = discordId; else delete zuordnung[slug];
      return { ...privat, sichtungZuordnung: zuordnung };
    });
    return {};
  },
  // Übernimmt den Klassenvorschlag aus der Sichtung für alle Fahrer, die jede Strecke abgegeben haben. Einzelne lassen sich danach von Hand ändern.
  async "sichtung-uebernehmen"(b, kat) {
    const serie = serieFinden(kat, b.serie);
    if (serie.einstufungArt !== "sichtung") throw new Hinweis("Diese Season wird nach iRating eingestuft. Stelle sie zuerst auf Sichtung um.");
    const fahrer = await Sichtung.seasonFahrer(serie, await eintraege());
    const { fahrer: liste } = Sichtung.vorschlag(serie, fahrer, await Sichtung.lesenAlle(serie.id));
    const mitVorschlag = liste.filter((f) => f.vorschlag && f.cust);
    if (!mitVorschlag.length) throw new Hinweis("Noch hat kein Fahrer für jede Strecke ein Ergebnis abgegeben.");
    await D.privatAendern(b.serie, (privat) => ({ ...privat, einstufung: { ...privat.einstufung, ...Object.fromEntries(mitVorschlag.map((f) => [f.cust, f.vorschlag])) } }));
    await neuBerechnen(kat, b.serie);
    return { anzahl: mitVorschlag.length };
  },
  async "report-status"(b, kat, s) {
    await R.aendern(b.id, (report) => {
      darfEntscheiden(report, s);
      if (report.urteil) throw new Hinweis("Dieser Report ist bereits entschieden.");
      report.status = b.status === "pruefung" ? "pruefung" : "offen";
    });
    return {};
  },
  async "report-notiz"(b, kat, s) {
    await R.aendern(b.id, (report) => {
      darfEntscheiden(report, s);
      if (typeof b.notizenVorher === "string" && b.notizenVorher !== (report.notizen || "")) throw D.konflikt("Die Notizen hat inzwischen jemand anderes geändert. Dein Text steht noch im Feld, der neue Stand darunter. Speicherst du noch einmal, ersetzt dein Text ihn.");
      report.notizen = String(b.notizen || "").slice(0, 5000);
    });
    return {};
  },
  async "report-urteil"(b, kat, s) {
    const report = await R.lesen(b.id);
    darfEntscheiden(report, s);
    const urteil = R.pruefeUrteil(b.urteil || {});
    keinePunkteBeiEvents(kat, report.serie, urteil.art);
    let ziel = null;
    if (R.istStrafend(urteil)) {
      const ergebnis = (await D.ergebnisseLesen(report.serie)).find((e) => e.id === String(b.ergebnis));
      const fahrer = ergebnis && ergebnis.fahrer.find((f) => f.cust === String(b.cust));
      if (!fahrer) throw new Hinweis("Bitte wähle das eingelesene Ergebnis und den Fahrer aus, für den die Strafe gilt.");
      ziel = { rennen: ergebnis.id, cust: fahrer.cust, name: fahrer.name };
    }
    await D.privatAendern(report.serie, (privat) => R.urteilAnwenden(privat, report.id, urteil, ziel));
    const einsprueche = ((await R.alleReports(true)).find((r) => r.id === report.id) || {}).einsprueche || [];
    let vorher;
    const entschieden = await R.aendern(report.id, (r) => {
      vorher = r.urteil;
      r.urteil = { ...urteil, ...(ziel || {}), von: s.name, zeit: new Date().toISOString() };
      r.status = "entschieden";
      // Nach geprüftem Einspruch ist das Urteil endgültig.
      r.endgueltig = einsprueche.length > 0;
    });
    const warnungen = (await neuBerechnen(kat, report.serie)) || [];
    await R.discordMelden(entschieden, urteil, vorher);
    return { warnungen: warnungen.filter((w) => w.startsWith("Zeitstrafe")) };
  },
  async "fahrer-aus-serie"(b, kat) {
    serieFinden(kat, b.serie);
    const alle = await eintraege();
    const ids = new Set(kat.rennen.filter((r) => r.serie === b.serie).map((r) => r.id));
    const weg = alle.filter((e) => e.discordId === String(b.discordId) && ((e.typ === "serie" && e.serieId === b.serie) || (e.typ !== "serie" && ids.has(e.rennenId))));
    if (weg.length) await blobDelete(weg.map((e) => e.pfad));
    await F.loeschen(b.serie, String(b.discordId)).catch(() => {});
    return {};
  },
  async "fahrer-aus-rennen"(b, kat) {
    if (!kat.rennen.some((r) => r.id === b.rennen)) throw new Hinweis("Dieses Rennen gibt es nicht.");
    const alle = await eintraege();
    const direkt = alle.filter((e) => e.typ === "rennen" && e.rennenId === b.rennen && e.discordId === String(b.discordId));
    if (direkt.length) await blobDelete(direkt.map((e) => e.pfad));
    if (alle.some((e) => e.typ === "serie" && e.discordId === String(b.discordId) && kat.rennen.some((r) => r.id === b.rennen && r.serie === e.serieId))) await blobPut(A.abmeldungPfad(b.rennen, String(b.discordId)), "1", "text/plain");
    return {};
  },
};

function gleicheHerkunft(req) {
  try {
    return new URL(req.headers.origin).host === (req.headers["x-forwarded-host"] || req.headers.host);
  } catch (e) {
    return false;
  }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const s = getLigaAdminSession(req);
  if (req.method === "GET") {
    if (!s) return res.status(200).json({ angemeldet: false });
    if ((req.query || {}).nur === "status") return res.status(200).json({ angemeldet: true });
    if ((req.query || {}).nur === "stand") return res.status(200).json({ angemeldet: true, stand: await R.stand() });
    // Das Protokoll wird nur beim Öffnen des Bereichs geholt.
    if ((req.query || {}).nur === "protokoll") return res.status(200).json({ angemeldet: true, protokoll: await protokollLesen().catch(() => []) });
    const kat = await D.katalog(true);
    if ((req.query || {}).akte) {
      const privatJeSerie = await Promise.all(kat.serien.map(async (x) => ({ serieName: x.name, privat: await D.privatLesen(x.id) })));
      const discordId = String(req.query.discord || "");
      const text = D.istId(discordId) ? await blobGet(A.profilPfad(discordId)) : null;
      const p = text ? JSON.parse(text) : null;
      const profil = p ? { iracingName: p.iracingName, custId: p.custId, irating: p.irating, nummer: p.nummer ?? "", land: p.land || "", team: p.team || "", kanal: p.kanal || "", hatBild: !!((await P.angabenVon(fahrerKennung(p.custId)).catch(() => null)) || {}).bild } : null;
      return res.status(200).json({ ...R.fahrerAkte(await R.alleReports(true), privatJeSerie, { cust: String(req.query.cust || (p && p.custId) || ""), discordId }), profil });
    }
    const details = D.istId((req.query || {}).serie) && kat.serien.some((x) => x.id === req.query.serie) ? await serienDetails(kat, req.query.serie) : null;
    const alleReports = await R.alleReports(true);
    const ergebnisseJe = new Map(await Promise.all([...new Set(alleReports.map((r) => r.serie))].filter((x) => D.istId(x)).map(async (id) => [id, await D.ergebnisseLesen(id).catch(() => [])])));
    const reports = alleReports.map((r) => ({ ...r, ichBeteiligt: R.beteiligt(r, s.id), stimmen: R.stimmenSicht(r, s.id), kontext: R.rennKontext(r, ergebnisseJe.get(r.serie) || []) }));
    return res.status(200).json({ angemeldet: true, name: s.name, serien: kat.serien, rennen: kat.rennen, strecken: kat.strecken, katalog: await Regeln.katalogLesen(), reglement: await Regeln.reglementLesen(), ...(await cockpitHinweise(kat).catch(() => COCKPIT_LEER)), nummernWuensche: await P.wuenscheLesen().catch(() => []), fahrzeugAntraege: (await F.offeneAntraege().catch(() => [])).map((a) => ({ ...a, serieName: (kat.serien.find((x) => x.id === a.serie) || {}).name || a.serie })), beitrittsAnfragen: (await Anfragen.alle().catch(() => [])).filter((a) => kat.serien.some((x) => x.id === a.serie)).map((a) => ({ ...a, serieName: kat.serien.find((x) => x.id === a.serie).name })), details, reports, kopfbildVersion: kat.einstellungen.kopfbildVersion || 0 });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Nicht erlaubt" });
  if (!gleicheHerkunft(req)) return res.status(403).json({ error: "Anfrage abgelehnt." });
  const body = req.body && typeof req.body === "object" ? req.body : {};
  if (body.aktion === "logout") {
    clearLigaAdminSession(res);
    return res.status(200).json({ angemeldet: false });
  }
  if (!s) return res.status(401).json({ error: "Bitte melde dich erneut an." });
  if (!Object.prototype.hasOwnProperty.call(aktionen, body.aktion)) return res.status(400).json({ error: "Unbekannte Aktion." });
  const kat = await D.katalog(true);
  // Das Protokoll nutzt den Stand von vor der Aktion, damit Namen auch nach einem Löschen auffindbar sind. Eingetragen wird nur bei Erfolg.
  const antwort = await aktionen[body.aktion](body, kat, s);
  fehlendCache = { bis: 0, wert: null };
  await protokollieren(s, body, kat);
  // Gespeichert ist schon. Klappt der Abgleich nicht, holt ihn der tägliche Lauf nach.
  if (TERMIN_AKTIONEN.has(body.aktion)) await DiscordEvents.abgleichen({ erzwingen: true }).catch((e) => console.warn("Discord-Events:", e.message));
  return res.status(200).json({ ok: true, ...antwort });
};
Object.assign(module.exports, { protokollPfad, leseProtokoll, protokollText });
