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
  return { gemeldet: new Map(vorhanden.map((p) => [String(p.custId), p.iracingName])), stamm };
}

// Details einer Serie: Fahrer mit Profil, Rennen mit Listen, Ergebnisse und Strafen
async function serienDetails(kat, id) {
  const serie = serieFinden(kat, id);
  const [alle, ergebnisse, privat, oeffentlich, alleReports] = await Promise.all([eintraege(), D.ergebnisseLesen(id), D.privatLesen(id), P.oeffentlicheProfile(), R.alleReports(false)]);
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
    return { pid, nummer: p ? p.nummer ?? "" : "", land: p ? p.land || "" : "", team: p ? p.team || "" : "", bild: (pid && oeffentlich[pid] && oeffentlich[pid].bild) || "", discordId: d, name: eintrag.name, mitglied: mitglieder.some((e) => e.discordId === d), fahrzeugklasse: eintrag.fahrzeugklasse, custId: p ? p.custId : "", iratingAngabe: p ? p.irating : null, iratingErgebnis: p && ausErgebnis.has(p.custId) ? ausErgebnis.get(p.custId) : null, klasseAuto: auto, klasseFest: p ? privat.einstufung[p.custId] || "" : "" };
  }).sort((a, b) => a.name.localeCompare(b.name, "de"));
  const opt = { jetzt: Date.now(), schlussMinuten: 60, discordId: "", serien: { [id]: serie }, mitIds: true };
  return {
    serie: id, fahrer,
    rennen: A.baueRennen(kat.rennen.filter((r) => r.serie === id), alle, opt).map(({ id: rid, titel, start, status, plaetze, starter, warteliste }) => ({ id: rid, titel, start, status, plaetze, starter, warteliste })),
    ergebnisse: ergebnisse.map((e) => ({ id: e.id, start: e.start, strecke: e.strecke, variante: e.variante, verkuerzt: !!e.verkuerzt, stand: R.ergebnisStand(e.start, standCtx), fahrer: e.fahrer.map((f) => ({ cust: f.cust, name: f.name })) })).sort((a, b) => String(a.start).localeCompare(String(b.start))),
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
  return D.tabelleNeu(id, serieFinden(kat, id), await D.ergebnisseLesen(id));
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
const COCKPIT_LEER = { fehlendeErgebnisse: [], pruefungen: [], strafkonten: [] };
async function cockpitHinweise(kat) {
  if (fehlendCache.wert && fehlendCache.bis > Date.now()) return fehlendCache.wert;
  const serien = kat.serien.filter((s) => s.status !== "beendet");
  const rennen = kat.rennen.filter((r) => serien.some((s) => s.id === r.serie));
  const ergebnisse = new Map(await Promise.all(serien.map(async (s) => [s.id, await D.ergebnisseLesen(s.id)])));
  const pruefungen = serien.flatMap((s) => ergebnisse.get(s.id).filter((e) => e.pruefung && !e.pruefung.erledigt).map((e) => ({ serie: s.id, serieName: s.name, id: e.id, strecke: e.strecke, start: e.start, noShows: e.pruefung.noShows, incidents: e.pruefung.incidents })));
  const strafkonten = (await Promise.all(serien.map(async (s) => D.strafkonten(s, await D.privatLesen(s.id))))).flat();
  const wert = { fehlendeErgebnisse: D.rennenOhneErgebnis(rennen, ergebnisse, Date.now()), pruefungen, strafkonten };
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
  return { ...bericht, vorlaeufig: stand === "vorlaeufig" };
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
    const daten = D.pruefeSerie(b.serie || {});
    let id = b.id;
    if (id) {
      const bisher = serieFinden(kat, D.brauchtId(id));
      if (bisher.bildVersion) daten.bildVersion = bisher.bildVersion;
    } else {
      id = D.slug(daten.name);
      if (!D.istId(id)) throw new Hinweis("Dieser Name ergibt keine gültige Kennung.");
      if (kat.serien.some((s) => s.id === id)) throw new Hinweis("Eine Serie mit diesem Namen gibt es schon.");
    }
    await D.serieSpeichern(id, daten);
    // Geänderte Punkte oder Klassen wirken sofort auf die Tabelle.
    if (b.id) await D.tabelleNeu(id, daten, await D.ergebnisseLesen(id));
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
    const extras = { ...A.pruefeExtras(b.profil), zeigeBild: !b.bildEntfernen && bisher.zeigeBild !== false };
    A.nummerPflicht(extras);
    const geaendert = extras.nummer !== bisher.nummer;
    const entscheid = geaendert ? P.nummerEntscheid("bestaetigt", extras.nummer) : null;
    const profil = { ...bisher, ...A.pruefeProfil(b.profil), ...extras, ...(entscheid ? { nummerEntscheid: entscheid } : {}), gespeichert: new Date().toISOString() };
    await P.speichern({ id: discordId, avatar: "" }, profil, extras);
    await blobPut(A.profilPfad(discordId), JSON.stringify(profil), "application/json");
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
    const extras = { nummer: wunsch.nach, land: bisher.land || "", team: bisher.team || "", kanal: bisher.kanal || "", zeigeBild: bisher.zeigeBild !== false };
    const entscheid = P.nummerEntscheid("bestaetigt", wunsch.nach);
    const profil = { ...bisher, nummer: wunsch.nach, nummerEntscheid: entscheid, gespeichert: new Date().toISOString() };
    await P.speichern({ id: discordId, avatar: "" }, profil, extras);
    await blobPut(A.profilPfad(discordId), JSON.stringify(profil), "application/json");
    await P.wunschLoeschen(discordId);
    await Dc.abgleichen(discordId, profil, await eintraege(), kat.serien);
    await Dc.nachricht(discordId, entscheid.text);
    return {};
  },
  async "nummer-ablehnen"(b) {
    const discordId = D.brauchtId(b.discordId);
    const wunsch = await P.wunschLesen(discordId);
    if (!wunsch) throw new Hinweis("Dieser Antrag liegt nicht mehr vor.");
    const gespeichert = await blobGet(A.profilPfad(discordId));
    const entscheid = P.nummerEntscheid("abgelehnt", wunsch.nach, wunsch.von, String(b.grund || "").trim().slice(0, 300));
    if (gespeichert) await blobPut(A.profilPfad(discordId), JSON.stringify({ ...JSON.parse(gespeichert), nummerEntscheid: entscheid }), "application/json");
    await P.wunschLoeschen(discordId);
    await Dc.nachricht(discordId, entscheid.text);
    return {};
  },
  // Testet alle drei Webhooks: Reports, Renntag und Urteile.
  async "discord-test"(b, kat, s) {
    const beispiel = R.reportKarte({ serie: "GT3 Sprint", rennen: "Runde 3 · Spa", stelle: "Runde 5, Kurve 3", von: "Max Beispiel", gegen: "Tom Muster", beschreibung: `Beim Anbremsen auf Kurve 3 wurde ich von hinten getroffen und habe mich gedreht. Ausgelöst von ${s.name} über den Knopf „Discord testen“.`, clip: "https://www.twitch.tv/videos/beispiel" }, true);
    // Beispiel wie ein normaler Renntag: Serverstart heute 18:00 Uhr nach Berliner Zeit.
    const start = A.berlinNachUtc(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date()), "18:00");
    const renntag = Renntag.erinnerungKarte({
      titel: "Runde 3 · Spa", serieName: "GT3 Sprint", strecke: "Circuit de Spa-Francorchamps", start: new Date(start).toISOString(), schluss: new Date(start - 3600e3).toISOString(),
      plaetze: 24, starter: Array.from({ length: 18 }, () => ({})), warteliste: [{}, {}], training: "70 Min", qualifying: "40 Min", renndauer: "65 Min", fahrzeuge: "GT3 und GT4", zugangNoetig: false,
    });
    const urteil = R.urteilKarte({ serieName: "GT3 Sprint", rennenTitel: "Runde 3 · Spa", gegen: { name: "Max Beispiel" } }, { art: "strafpunkte", punkte: 3 });
    const ergebnis = await R.webhooksTesten(s.name, { Reports: beispiel, Renntag: renntag, Urteile: urteil });
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
    if (id) { if (!kat.rennen.some((r) => r.id === id)) throw new Hinweis("Dieses Rennen gibt es nicht."); } else id = D.neueRennenId(daten);
    await D.rennenSpeichern(id, daten);
    return { id };
  },
  async "rennen-loeschen"(b, kat) {
    if (!kat.rennen.some((r) => r.id === b.id)) throw new Hinweis("Dieses Rennen gibt es nicht.");
    // Einzelmeldungen und Abmeldungen gehören zum Rennen und gehen mit. Eingelesene Ergebnisse sind getrennt gespeichert und bleiben.
    const meldungen = (await eintraege()).filter((e) => e.typ !== "serie" && e.rennenId === b.id);
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
    const { warnungen, ...tabelle } = berechneTabelle([...bisher, neu], serie, await D.privatLesen(b.serie));
    return { warnungen, tabelle, ersetzt: bisher.length !== vorhanden.length, fremde, fehlend, gaeste: neu.fahrer.filter((f) => f.gast).map((f) => f.name), rennen: { id: neu.id, strecke: neu.strecke, start: neu.start, gesamt: eingelesen.fahrer.length, gewertet: neu.fahrer.length } };
  },
  async "ergebnis-veroeffentlichen"(b, kat) {
    const serie = serieFinden(kat, b.serie);
    // Nicht gemeldete Fahrer werden nicht gewertet und auch nicht gespeichert.
    const { gemeldet, stamm } = await gemeldeteFahrer(kat, b.serie);
    const { ergebnis } = D.abgleichen(leseErgebnis(b.datei), gemeldet, b.zugelassen, stamm);
    if (!ergebnis.fahrer.length) throw new Hinweis("Keiner der Fahrer in dieser Datei ist für diese Serie gemeldet. Prüfe die Serie und die Datei oder lasse einzelne Fahrer als Gast zu.");
    // Ein Fehler bei der Zusatzprüfung darf das Veröffentlichen nicht verhindern.
    const pruefung = D.pruefungNachRennen(ergebnis, await erwarteteStarter(kat, serie, ergebnis).catch(() => []));
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
    const privat = await D.privatLesen(b.serie);
    const offen = (await R.alleReports(true)).some((r) => r.serie === serie.id && Math.abs(new Date(r.start) - new Date(ergebnis.start)) <= 12 * 3600e3 && (!r.urteil || ((r.einsprueche || []).length > 0 && !r.endgueltig)));
    if (offen) throw new Hinweis("Zu diesem Rennen sind noch Reports oder Einsprüche offen. Entscheide sie zuerst.");
    await D.privatSchreiben(b.serie, { ...privat, endgueltig: [...new Set([...(privat.endgueltig || []), ergebnis.start])] });
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
    const report = await R.lesen(b.id);
    darfEntscheiden(report, s);
    if (report.urteil) throw new Hinweis("Dieser Report ist bereits entschieden.");
    keinePunkteBeiEvents(kat, report.serie, (b.stimme || {}).art);
    await R.speichern(R.stimmeSetzen(report, s, R.pruefeStimme(b.stimme || {})));
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
    const privat = await D.privatLesen(b.serie);
    privat.strafen.push({ id: `${Date.now()}`, rennen: ergebnis.id, cust: fahrer.cust, name: fahrer.name, punkte, grund: String(b.grund || "").trim().slice(0, 200) });
    await D.privatSchreiben(b.serie, privat);
    await neuBerechnen(kat, b.serie);
    return {};
  },
  async "strafe-loeschen"(b, kat) {
    serieFinden(kat, b.serie);
    const privat = await D.privatLesen(b.serie);
    if (privat.strafen.some((s) => s.id === String(b.id) && s.reportId)) throw new Hinweis("Diese Strafe gehört zu einem Report. Bitte ändere dort das Urteil.");
    privat.strafen = privat.strafen.filter((s) => s.id !== String(b.id));
    await D.privatSchreiben(b.serie, privat);
    await neuBerechnen(kat, b.serie);
    return {};
  },
  async "einstufung-setzen"(b, kat) {
    const serie = serieFinden(kat, b.serie);
    if (!/^\d+$/.test(String(b.cust || ""))) throw new Hinweis("Für diesen Fahrer fehlt die iRacing-ID.");
    if (b.klasse && !serie.klassen.some((k) => k.id === b.klasse)) throw new Hinweis("Diese Klasse gibt es nicht.");
    const privat = await D.privatLesen(b.serie);
    if (b.klasse) privat.einstufung[b.cust] = b.klasse; else delete privat.einstufung[b.cust];
    await D.privatSchreiben(b.serie, privat);
    await neuBerechnen(kat, b.serie);
    return {};
  },
  async "report-status"(b, kat, s) {
    const report = await R.lesen(b.id);
    darfEntscheiden(report, s);
    if (report.urteil) throw new Hinweis("Dieser Report ist bereits entschieden.");
    report.status = b.status === "pruefung" ? "pruefung" : "offen";
    await R.speichern(report);
    return {};
  },
  async "report-notiz"(b, kat, s) {
    const report = await R.lesen(b.id);
    darfEntscheiden(report, s);
    report.notizen = String(b.notizen || "").slice(0, 5000);
    await R.speichern(report);
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
    const privat = R.urteilAnwenden(await D.privatLesen(report.serie), report.id, urteil, ziel);
    await D.privatSchreiben(report.serie, privat);
    const einsprueche = ((await R.alleReports(true)).find((r) => r.id === report.id) || {}).einsprueche || [];
    const vorher = report.urteil;
    report.urteil = { ...urteil, ...(ziel || {}), von: s.name, zeit: new Date().toISOString() };
    report.status = "entschieden";
    // Nach geprüftem Einspruch ist das Urteil endgültig.
    report.endgueltig = einsprueche.length > 0;
    await R.speichern(report);
    const warnungen = (await neuBerechnen(kat, report.serie)) || [];
    await R.discordMelden(report, urteil, vorher);
    return { warnungen: warnungen.filter((w) => w.startsWith("Zeitstrafe")) };
  },
  async "fahrer-aus-serie"(b, kat) {
    serieFinden(kat, b.serie);
    const alle = await eintraege();
    const ids = new Set(kat.rennen.filter((r) => r.serie === b.serie).map((r) => r.id));
    const weg = alle.filter((e) => e.discordId === String(b.discordId) && ((e.typ === "serie" && e.serieId === b.serie) || (e.typ !== "serie" && ids.has(e.rennenId))));
    if (weg.length) await blobDelete(weg.map((e) => e.pfad));
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
    return res.status(200).json({ angemeldet: true, name: s.name, serien: kat.serien, rennen: kat.rennen, strecken: kat.strecken, katalog: await Regeln.katalogLesen(), reglement: await Regeln.reglementLesen(), ...(await cockpitHinweise(kat).catch(() => COCKPIT_LEER)), nummernWuensche: await P.wuenscheLesen().catch(() => []), details, reports, kopfbildVersion: kat.einstellungen.kopfbildVersion || 0 });
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
  return res.status(200).json({ ok: true, ...antwort });
};
Object.assign(module.exports, { protokollPfad, leseProtokoll, protokollText });
