// Liga-Admin (/liga-admin): nur für die Rolle aus LIGA_ADMIN_ROLE_IDS, mit eigenem Cookie.
const { getLigaAdminSession, clearLigaAdminSession } = require("./session");
const { blobPut, blobGet, blobDelete, blobList } = require("./blob");
const A = require("./liga-anmeldung");
const D = require("./liga-daten");
const R = require("./liga-reports");
const { Hinweis } = D;
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
  const profile = await Promise.all(ids.map(async (d) => { const t = await blobGet(A.profilPfad(d)); return t ? JSON.parse(t) : null; }));
  return new Map(profile.filter((p) => p && p.custId).map((p) => [String(p.custId), p.iracingName]));
}

// Details einer Serie: Fahrer mit Profil, Rennen mit Listen, Ergebnisse und Strafen
async function serienDetails(kat, id) {
  const serie = serieFinden(kat, id);
  const [alle, ergebnisse, privat] = await Promise.all([eintraege(), D.ergebnisseLesen(id), D.privatLesen(id)]);
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
    return { discordId: d, name: eintrag.name, mitglied: mitglieder.some((e) => e.discordId === d), fahrzeugklasse: eintrag.fahrzeugklasse, custId: p ? p.custId : "", iratingAngabe: p ? p.irating : null, iratingErgebnis: p && ausErgebnis.has(p.custId) ? ausErgebnis.get(p.custId) : null, klasseAuto: auto, klasseFest: p ? privat.einstufung[p.custId] || "" : "" };
  }).sort((a, b) => a.name.localeCompare(b.name, "de"));
  const opt = { jetzt: Date.now(), schlussMinuten: 60, discordId: "", serien: { [id]: serie }, mitIds: true };
  return {
    serie: id, fahrer,
    rennen: A.baueRennen(kat.rennen.filter((r) => r.serie === id), alle, opt).map(({ id: rid, titel, start, status, plaetze, starter, warteliste }) => ({ id: rid, titel, start, status, plaetze, starter, warteliste })),
    ergebnisse: ergebnisse.map((e) => ({ id: e.id, start: e.start, strecke: e.strecke, variante: e.variante, fahrer: e.fahrer.map((f) => ({ cust: f.cust, name: f.name })) })).sort((a, b) => String(a.start).localeCompare(String(b.start))),
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

// Bildziel „strecke:<id>“ führt zu einer Strecke der Bibliothek.
function streckeZiel(kat, ziel) {
  const m = /^strecke:(.+)$/.exec(String(ziel || ""));
  if (!m) return null;
  const strecke = kat.strecken.find((s) => s.id === m[1]);
  if (!strecke) throw new Hinweis("Diese Strecke gibt es nicht.");
  return strecke;
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
    await D.streckeLoeschen(b.id);
    if (strecke.kartenVersion) await D.bildLoeschen(`strecke-${b.id}`);
    return {};
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
    const { ergebnis: neu, fremde, fehlend } = D.abgleichen(eingelesen, await gemeldeteFahrer(kat, b.serie), b.zugelassen);
    const vorhanden = await D.ergebnisseLesen(b.serie);
    const bisher = vorhanden.filter((e) => e.id !== neu.id);
    const { warnungen, ...tabelle } = berechneTabelle([...bisher, neu], serie, await D.privatLesen(b.serie));
    return { warnungen, tabelle, ersetzt: bisher.length !== vorhanden.length, fremde, fehlend, rennen: { id: neu.id, strecke: neu.strecke, start: neu.start, gesamt: eingelesen.fahrer.length, gewertet: neu.fahrer.length } };
  },
  async "ergebnis-veroeffentlichen"(b, kat) {
    serieFinden(kat, b.serie);
    // Nicht gemeldete Fahrer werden nicht gewertet und auch nicht gespeichert.
    const { ergebnis } = D.abgleichen(leseErgebnis(b.datei), await gemeldeteFahrer(kat, b.serie), b.zugelassen);
    if (!ergebnis.fahrer.length) throw new Hinweis("Keiner der Fahrer in dieser Datei ist für diese Serie gemeldet. Prüfe die Serie und die Datei oder lasse einzelne Fahrer als Gast zu.");
    await D.ergebnisSpeichern(b.serie, ergebnis);
    return { warnungen: (await neuBerechnen(kat, b.serie)) || [] };
  },
  async "ergebnis-loeschen"(b, kat) {
    serieFinden(kat, b.serie);
    await D.ergebnisLoeschen(b.serie, b.id);
    await neuBerechnen(kat, b.serie);
    return {};
  },
  async "strafe-hinzufuegen"(b, kat) {
    serieFinden(kat, b.serie);
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
    report.urteil = { ...urteil, ...(ziel || {}), von: s.name, zeit: new Date().toISOString() };
    report.status = "entschieden";
    // Nach geprüftem Einspruch ist das Urteil endgültig.
    report.endgueltig = einsprueche.length > 0;
    await R.speichern(report);
    const warnungen = (await neuBerechnen(kat, report.serie)) || [];
    await R.discordMelden(report, urteil);
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
    const kat = await D.katalog(true);
    const details = D.istId((req.query || {}).serie) && kat.serien.some((x) => x.id === req.query.serie) ? await serienDetails(kat, req.query.serie) : null;
    const reports = (await R.alleReports(true)).map((r) => ({ ...r, ichBeteiligt: R.beteiligt(r, s.id) }));
    return res.status(200).json({ angemeldet: true, name: s.name, serien: kat.serien, rennen: kat.rennen, strecken: kat.strecken, details, reports, kopfbildVersion: kat.einstellungen.kopfbildVersion || 0 });
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
  return res.status(200).json({ ok: true, ...(await aktionen[body.aktion](body, await D.katalog(true), s)) });
};
