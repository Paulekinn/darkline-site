// Fahrerbereich der Liga. GET: Dashboard · POST { aktion }: profil, anmelden, abmelden, serie-anmelden, serie-abmelden, logout
// Ligafahrer haben ein eigenes Cookie (dpm_liga) und damit keinen Zugang zum Teambereich.
const { getLigaSession, clearLigaSession } = require("./session");
const { blobPut, blobGet, blobDelete, blobList } = require("./blob");
const A = require("./liga-anmeldung");
const D = require("./liga-daten");
const { Hinweis } = D;
const R = require("./liga-reports");
const { klasseFuer } = require("../../assets/liga-wertung.js");

const SCHLUSS_MINUTEN = 60;
const serienMap = (liste) => Object.fromEntries(liste.map((s) => [s.id, s]));

// Kurzer Zwischenspeicher pro Funktionsinstanz, nach eigenen Änderungen wird neu gelesen.
let liste = { bis: 0, wert: null };
async function eintraege(frisch) {
  if (!frisch && liste.wert && liste.bis > Date.now()) return liste.wert;
  const wert = (await blobList(A.PREFIX)).map(A.leseEintrag).filter(Boolean);
  liste = { bis: Date.now() + 15000, wert };
  return wert;
}
// Die Liste kann einer gerade geschriebenen Datei kurz hinterherhinken, deshalb wird der neue Stand direkt gemerkt.
const merke = (wert) => { liste = { bis: Date.now() + 15000, wert }; return wert; };
const jetztEintrag = (pathname) => A.leseEintrag({ pathname, uploadedAt: new Date().toISOString() });

async function profilLesen(id) {
  const t = await blobGet(A.profilPfad(id));
  return t ? JSON.parse(t) : null;
}

const optionen = (s, kat) => ({ jetzt: Date.now(), schlussMinuten: SCHLUSS_MINUTEN, discordId: s.id, serien: serienMap(kat.serien) });

// Rennen mit Discord-IDs, inklusive vergangener: nur intern für die Report-Prüfung
const rennenFuerReports = (s, kat, alle) => A.baueRennen(kat.rennen, alle, { ...optionen(s, kat), mitIds: true, auchVergangene: true });

// Reports für den Fahrerbereich: eigene Fälle, alle Urteile und die meldbaren Rennen
async function reportDaten(s, kat, alle, frisch) {
  const jetzt = Date.now();
  const serien = serienMap(kat.serien);
  const reports = await R.alleReports(frisch);
  const sicht = reports.map((r) => R.sichtFahrer(r, r.einsprueche, s.id, jetzt, serien[r.serie]));
  return {
    meldbar: R.meldbareRennen(rennenFuerReports(s, kat, alle), jetzt, serien),
    meine: sicht.filter((r) => r.beteiligt),
    urteile: sicht.filter((r) => r.urteil).slice(0, 50),
  };
}

// Tabellen der laufenden Serien, kurz zwischengespeichert. Ohne Tabelle fehlt nur die Karte, der Fahrerbereich bleibt nutzbar.
let tabellen = { bis: 0, wert: null };
async function laufendeTabellen(kat) {
  if (tabellen.wert && tabellen.bis > Date.now()) return tabellen.wert;
  const wert = new Map(await Promise.all(kat.serien.filter((x) => x.status !== "beendet").map(async (x) => [x.id, await D.tabelleLesen(x.id).catch(() => null)])));
  tabellen = { bis: Date.now() + 30000, wert };
  return wert;
}

async function antwort(res, s, profil, alle, kat, frisch) {
  return res.status(200).json({
    angemeldet: true,
    fahrer: { name: s.name, profil },
    meineKarten: profil ? A.eigeneKarten(kat.serien, await laufendeTabellen(kat), profil.iracingName) : [],
    serien: A.baueSerien(kat.serien, alle, { discordId: s.id, profil, klasseFuer }),
    rennen: A.baueRennen(kat.rennen, alle, optionen(s, kat)),
    reports: await reportDaten(s, kat, alle, frisch),
  });
}

async function reportMelden(s, profil, body, alle, kat) {
  if (!profil) throw new Hinweis("Bitte fülle zuerst dein Fahrerprofil aus.");
  const meldbar = R.meldbareRennen(rennenFuerReports(s, kat, alle), Date.now(), serienMap(kat.serien)).find((r) => r.id === body.rennen);
  if (!meldbar) throw new Hinweis("Für dieses Rennen kannst du gerade keinen Vorfall melden.");
  const stand = rennenFuerReports(s, kat, alle).find((r) => r.id === body.rennen);
  const gegner = stand.starter.find((f) => f.name === body.gegen && f.discordId !== s.id);
  if (!gegner) throw new Hinweis("Bitte wähle den beteiligten Fahrer aus.");
  const daten = R.pruefeMeldung(body);
  const reports = await R.alleReports(true);
  if (reports.filter((r) => r.rennen === stand.id && r.von.discordId === s.id).length >= R.MAX_JE_RENNEN) throw new Hinweis("Du hast für dieses Rennen die höchste Anzahl an Reports erreicht. Bitte wende dich an die Rennleitung.");
  const gegnerProfilText = await blobGet(A.profilPfad(gegner.discordId));
  const gegnerProfil = gegnerProfilText ? JSON.parse(gegnerProfilText) : null;
  await R.speichern({
    id: R.neueId(), rennen: stand.id, rennenTitel: stand.titel, serie: stand.serie, serieName: stand.serieName, serieFarbe: stand.serieFarbe, start: stand.start, erstellt: new Date().toISOString(),
    von: { discordId: s.id, name: profil.iracingName, cust: profil.custId },
    gegen: { discordId: gegner.discordId, name: gegner.name, cust: gegnerProfil ? gegnerProfil.custId : "" },
    ...daten, status: "offen", notizen: "", urteil: null, endgueltig: false,
  });
}

async function reportEinspruch(s, profil, body, kat) {
  const report = await R.lesen(body.id);
  const einsprueche = (await R.alleReports(true)).find((r) => r.id === body.id);
  const sicht = R.sichtFahrer(report, einsprueche ? einsprueche.einsprueche : [], s.id, Date.now(), serienMap(kat.serien)[report.serie]);
  if (!sicht.kannEinspruch) throw new Hinweis("Für dieses Urteil ist kein Einspruch mehr möglich.");
  const text = String(body.text || "").trim().slice(0, 2000);
  if (text.length < 10) throw new Hinweis("Bitte begründe deinen Einspruch in mindestens einem Satz.");
  await R.einspruchSpeichern(report.id, s.id, { discordId: s.id, name: profil ? profil.iracingName : s.name, text, zeit: new Date().toISOString() });
}

// Schreibende Anfragen müssen von der eigenen Seite kommen.
function gleicheHerkunft(req) {
  try {
    return new URL(req.headers.origin).host === (req.headers["x-forwarded-host"] || req.headers.host);
  } catch (e) {
    return false;
  }
}

function fahrzeugklasseWaehlen(klassen, gewaehlt) {
  if (klassen.length < 2) return klassen[0] || "";
  if (!klassen.includes(gewaehlt)) throw new Hinweis("Bitte wähle deine Fahrzeugklasse aus.");
  return gewaehlt;
}

function rennenPruefen(s, kat, alle, id) {
  const rennen = kat.rennen.find((r) => r.id === id);
  if (!rennen) throw new Hinweis("Dieses Rennen gibt es nicht.");
  const stand = A.baueRennen(kat.rennen, alle, optionen(s, kat)).find((r) => r.id === id);
  if (!stand || !stand.offen) return { rennen, stand: null };
  return { rennen, stand };
}

async function anmelden(s, profil, body, alle, kat) {
  if (!profil) throw new Hinweis("Bitte fülle zuerst dein Fahrerprofil aus.");
  const { rennen, stand } = rennenPruefen(s, kat, alle, body.rennen);
  if (!stand) throw new Hinweis("Die Anmeldung für dieses Rennen ist geschlossen.");
  if (stand.ich) return alle;
  const parallel = A.kollisionen(kat.rennen, rennen.id, alle, optionen(s, kat));
  if (parallel.length) throw new Hinweis(`Dieses Rennen überschneidet sich mit: ${parallel.join(", ")}. Melde dich dort zuerst ab.`);
  // Serienfahrer, die sich für dieses Rennen abgemeldet hatten, kommen zurück.
  const eigeneAbmeldung = alle.filter((e) => e.typ === "abmeldung" && e.rennenId === rennen.id && e.discordId === s.id);
  if (eigeneAbmeldung.length) {
    await blobDelete(eigeneAbmeldung.map((e) => e.pfad));
    return merke(alle.filter((e) => !eigeneAbmeldung.includes(e)));
  }
  const klassen = (serienMap(kat.serien)[rennen.serie] || {}).fahrzeugklassen || [];
  const pfad = A.anmeldungPfad(rennen.id, s.id, fahrzeugklasseWaehlen(klassen, String(body.fahrzeugklasse || "")), profil.iracingName);
  await blobPut(pfad, "1", "text/plain");
  return merke([...alle, jetztEintrag(pfad)]);
}

async function abmelden(s, body, alle, kat) {
  const { rennen, stand } = rennenPruefen(s, kat, alle, body.rennen);
  if (!stand) throw new Hinweis("Die Abmeldung ist online nicht mehr möglich. Bitte melde dich im Discord bei der Rennleitung.");
  if (!stand.ich) return alle;
  if (stand.ich.quelle === "serie") {
    const pfad = A.abmeldungPfad(rennen.id, s.id);
    await blobPut(pfad, "1", "text/plain");
    return merke([...alle, jetztEintrag(pfad)]);
  }
  const eigene = alle.filter((e) => e.typ === "rennen" && e.rennenId === rennen.id && e.discordId === s.id);
  if (eigene.length) await blobDelete(eigene.map((e) => e.pfad));
  return merke(alle.filter((e) => !eigene.includes(e)));
}

async function serieAnmelden(s, profil, body, alle, kat) {
  if (!profil) throw new Hinweis("Bitte fülle zuerst dein Fahrerprofil aus.");
  const serie = kat.serien.find((x) => x.id === body.serie);
  if (!serie) throw new Hinweis("Diese Serie gibt es nicht.");
  if (serie.anmeldungOffen === false || serie.status === "beendet") throw new Hinweis("Die Anmeldung für diese Serie ist geschlossen.");
  if (alle.some((e) => e.typ === "serie" && e.serieId === serie.id && e.discordId === s.id)) return alle;
  const pfad = A.mitgliedPfad(serie.id, s.id, fahrzeugklasseWaehlen(serie.fahrzeugklassen || [], String(body.fahrzeugklasse || "")), profil.iracingName);
  await blobPut(pfad, "1", "text/plain");
  return merke([...alle, jetztEintrag(pfad)]);
}

async function serieAbmelden(s, body, alle, kat) {
  const serie = kat.serien.find((x) => x.id === body.serie);
  if (!serie) throw new Hinweis("Diese Serie gibt es nicht.");
  const rennen = kat.rennen.filter((r) => r.serie === serie.id);
  const stand = A.baueRennen(rennen, alle, optionen(s, kat));
  // Ein Rennen kurz vor dem Start darf nicht durch den Austritt aus der Serie seine Starterliste ändern.
  if (stand.some((r) => !r.offen && r.status !== "abgesagt" && r.ich)) throw new Hinweis("Eines deiner Rennen startet gleich. Bitte melde dich dafür im Discord bei der Rennleitung ab.");
  const ids = new Set(rennen.map((r) => r.id));
  const weg = alle.filter((e) => e.discordId === s.id && ((e.typ === "serie" && e.serieId === serie.id) || (e.typ !== "serie" && ids.has(e.rennenId))));
  if (weg.length) await blobDelete(weg.map((e) => e.pfad));
  return merke(alle.filter((e) => !weg.includes(e)));
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const s = getLigaSession(req);
  if (req.method === "GET") {
    if (!s) return res.status(200).json({ angemeldet: false });
    return await antwort(res, s, await profilLesen(s.id), await eintraege(false), await D.katalog(false), false);
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Nicht erlaubt" });
  if (!gleicheHerkunft(req)) return res.status(403).json({ error: "Anfrage abgelehnt." });
  const body = req.body && typeof req.body === "object" ? req.body : {};
  if (body.aktion === "logout") {
    clearLigaSession(res);
    return res.status(200).json({ angemeldet: false });
  }
  if (!s) return res.status(401).json({ error: "Bitte melde dich erneut an." });

  let profil = await profilLesen(s.id);
  let alle = await eintraege(true);
  const kat = await D.katalog(false);
  if (body.aktion === "profil") {
    profil = A.pruefeProfil(body.profil);
    await blobPut(A.profilPfad(s.id), JSON.stringify({ ...profil, discordId: s.id, gespeichert: new Date().toISOString() }), "application/json");
  } else if (body.aktion === "anmelden") {
    alle = await anmelden(s, profil, body, alle, kat);
  } else if (body.aktion === "abmelden") {
    alle = await abmelden(s, body, alle, kat);
  } else if (body.aktion === "serie-anmelden") {
    alle = await serieAnmelden(s, profil, body, alle, kat);
  } else if (body.aktion === "serie-abmelden") {
    alle = await serieAbmelden(s, body, alle, kat);
  } else if (body.aktion === "report-melden") {
    await reportMelden(s, profil, body, alle, kat);
  } else if (body.aktion === "report-einspruch") {
    await reportEinspruch(s, profil, body, kat);
  } else {
    return res.status(400).json({ error: "Unbekannte Aktion." });
  }
  return await antwort(res, s, profil, alle, kat, true);
};
