// Fahrerbereich der Liga. GET: Dashboard · POST { aktion }: profil, anmelden, abmelden, serie-anmelden, serie-abmelden, logout
// Ligafahrer haben ein eigenes Cookie (dpm_liga) und damit keinen Zugang zum Teambereich.
const { getLigaSession, clearLigaSession, fahrerKennung, kalenderSchluessel } = require("./session");
const P = require("./liga-profil");
const { blobPut, blobGet, blobDelete, blobList } = require("./blob");
const A = require("./liga-anmeldung");
const D = require("./liga-daten");
const { Hinweis } = D;
const R = require("./liga-reports");
const Dc = require("./liga-discord");
const F = require("./liga-fahrzeuge");
const Sichtung = require("./liga-sichtung");
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
    cooldownBis: R.cooldownBis(rennenFuerReports(s, kat, alle), jetzt),
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

// Seasons mit Sichtung, in denen der Fahrer gemeldet ist
const sichtungSerien = (kat, alle, discordId) => kat.serien.filter((x) => x.einstufungArt === "sichtung" && x.status !== "beendet" && alle.some((e) => e.typ === "serie" && e.serieId === x.id && e.discordId === discordId));

async function antwort(res, s, profil, alle, kat, frisch, extra = {}) {
  const pid = profil ? fahrerKennung(profil.custId) : "";
  // Fahrzeug je Season mit Fahrzeugwahl, in der der Fahrer gemeldet ist
  const mitWahl = kat.serien.filter((x) => (x.modelle || []).length && x.status !== "beendet" && alle.some((e) => e.typ === "serie" && e.serieId === x.id && e.discordId === s.id));
  // Die Abfragen hängen nicht voneinander ab und laufen deshalb gleichzeitig.
  const [oeffentlich, wunsch, tabellen, reports, fahrzeuge, sichtungOffen] = await Promise.all([
    pid ? P.angabenVon(pid).catch(() => null) : null,
    P.wunschLesen(s.id).catch(() => null),
    profil ? laufendeTabellen(kat) : null,
    reportDaten(s, kat, alle, frisch),
    Promise.all(mitWahl.map(async (x) => { const f = await F.lesen(x.id, s.id).catch(() => null); return [x.id, f ? { modell: f.modell, antrag: f.antrag ? f.antrag.nach : "", freiUebrig: F.freiUebrig(x, f), wechsel: (f.wechsel || []).length } : null]; })),
    // Offene Strecken in laufenden Sichtungen, damit der Reiter auffällt. Ein Fehler hier blendet nur den Hinweis aus.
    Promise.all(sichtungSerien(kat, alle, s.id).map((x) => Sichtung.offeneStrecken(x, s.id).catch(() => 0))).then((n) => n.reduce((a, b) => a + b, 0)),
  ]);
  return res.status(200).json({
    ...extra,
    sichtung: sichtungSerien(kat, alle, s.id).map((x) => x.id),
    sichtungOffen,
    fahrzeuge: Object.fromEntries(fahrzeuge.filter(([, f]) => f)),
    angemeldet: true,
    kalender: `/liga-kalender/${kalenderSchluessel(s.id)}`,
    fahrer: { name: s.name, profil, pid, oeffentlich, nummerWunsch: (wunsch || {}).nach || null },
    meineKarten: profil ? A.eigeneKarten(kat.serien, tabellen, profil.iracingName, pid) : [],
    serien: A.baueSerien(kat.serien, alle, { discordId: s.id, profil, klasseFuer }),
    // Termine beendeter Serien gehören nicht mehr in den Fahrerbereich.
    rennen: A.baueRennen(kat.rennen, alle, optionen(s, kat)).filter((r) => (serienMap(kat.serien)[r.serie] || {}).status !== "beendet"),
    reports,
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
  await R.teamMelden(R.reportKarte({ serie: stand.serieName, rennen: stand.titel, stelle: daten.stelle, von: profil.iracingName, gegen: gegner.name, beschreibung: daten.beschreibung, clip: daten.clip }));
}

async function reportEinspruch(s, profil, body, kat) {
  const report = await R.lesen(body.id);
  const einsprueche = (await R.alleReports(true)).find((r) => r.id === body.id);
  const sicht = R.sichtFahrer(report, einsprueche ? einsprueche.einsprueche : [], s.id, Date.now(), serienMap(kat.serien)[report.serie]);
  if (!sicht.kannEinspruch) throw new Hinweis("Für dieses Urteil ist kein Einspruch mehr möglich.");
  const text = String(body.text || "").trim().slice(0, 2000);
  if (text.length < 10) throw new Hinweis("Bitte begründe deinen Einspruch in mindestens einem Satz.");
  await R.einspruchSpeichern(report.id, s.id, { discordId: s.id, name: profil ? profil.iracingName : s.name, text, zeit: new Date().toISOString() });
  await R.teamMelden(R.einspruchKarte({ serie: report.serieName, rennen: report.rennenTitel, von: profil ? profil.iracingName : s.name, gegen: report.gegen.name, text }));
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

// Ältere Profile haben eventuell noch keine Startnummer.
function profilVollstaendig(profil) {
  if (!profil) throw new Hinweis("Bitte fülle zuerst dein Fahrerprofil aus.");
  if (!profil.nummer) throw new Hinweis("Bitte trage zuerst eine Startnummer in deinem Profil ein.");
}

async function anmelden(s, profil, body, alle, kat) {
  profilVollstaendig(profil);
  const { rennen, stand } = rennenPruefen(s, kat, alle, body.rennen);
  if (!stand) throw new Hinweis("Die Anmeldung für dieses Rennen ist geschlossen.");
  if (stand.ich) return alle;
  if (stand.anmeldungFolgt) throw new Hinweis("Die Anmeldung für diese Serie ist noch nicht geöffnet.");
  if (stand.anmeldungZu) throw new Hinweis("Die Anmeldung für diese Serie ist geschlossen.");
  const parallel = A.kollisionen(kat.rennen, rennen.id, alle, optionen(s, kat));
  if (parallel.length) throw new Hinweis(`Dieses Rennen überschneidet sich mit: ${parallel.join(", ")}. Melde dich dort zuerst ab.`);
  // Wer sich abgemeldet hatte und zurückkommt, wird als neue Meldung hinten eingereiht und verdrängt keinen Nachrücker. Die Abmeldung bleibt bestehen.
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
  profilVollstaendig(profil);
  const serie = kat.serien.find((x) => x.id === body.serie);
  if (!serie) throw new Hinweis("Diese Serie gibt es nicht.");
  if (serie.status === "geplant") throw new Hinweis("Die Anmeldung für diese Serie ist noch nicht geöffnet.");
  if (serie.anmeldungOffen === false || serie.status === "beendet") throw new Hinweis("Die Anmeldung für diese Serie ist geschlossen.");
  if (alle.some((e) => e.typ === "serie" && e.serieId === serie.id && e.discordId === s.id)) return alle;
  // Das Fahrzeug wird vor der Anmeldung geprüft, damit niemand ohne Auto in der Season steht.
  F.modellPruefen(serie, String(body.modell || ""));
  const pfad = A.mitgliedPfad(serie.id, s.id, fahrzeugklasseWaehlen(serie.fahrzeugklassen || [], String(body.fahrzeugklasse || "")), profil.iracingName);
  await F.waehlen(serie, s.id, String(body.modell || ""), profil.iracingName);
  await blobPut(pfad, "1", "text/plain");
  // Bei Sichtung: Direktnachricht mit Team-Link und Steckbrief. Scheitert sie, bleibt die Anmeldung gültig.
  if (serie.einstufungArt === "sichtung" && !serie.ohneKlassen) await Dc.nachricht(s.id, Sichtung.einladungText(serie, F.modellPruefen(serie, String(body.modell || "")))).catch(() => {});
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
  await F.loeschen(serie.id, s.id).catch(() => {});
  return merke(alle.filter((e) => !weg.includes(e)));
}

// Eine geänderte Startnummer wird nicht übernommen, sondern geht als Antrag an die Rennleitung. Die erste Nummer darf der Fahrer selbst wählen.
async function profilSpeichern(s, bisher, eingaben) {
  const grunddaten = A.pruefeProfil(eingaben);
  const eingabe = A.pruefeExtras(eingaben);
  A.nummerPflicht(eingabe);
  const wunsch = bisher && bisher.nummer && eingabe.nummer !== bisher.nummer ? eingabe.nummer : null;
  const extras = wunsch ? { ...eingabe, nummer: bisher.nummer } : eingabe;
  const neu = wunsch ? await P.wunschSetzen(s, grunddaten.iracingName, bisher.nummer, wunsch) : false;
  const felder = { ...grunddaten, ...extras, discordId: s.id, gespeichert: new Date().toISOString() };
  // Discord-Stand und Nummernentscheid kommen aus dem aktuellen Profil, sie schreiben der Abgleich und die Rennleitung.
  const mitStand = (p) => ({ ...felder, ...(p && p.discord ? { discord: p.discord } : {}), ...(p && p.nummerEntscheid ? { nummerEntscheid: p.nummerEntscheid } : {}) });
  await P.speichern(s, mitStand(bisher), extras).catch(async (e) => {
    if (neu) await P.wunschLoeschen(s.id).catch(() => {});
    throw e;
  });
  const profil = await D.jsonAendern(A.profilPfad(s.id), (aktuell) => {
    // Hat die Rennleitung die Nummer gerade geändert, würde das Speichern sie zurückdrehen.
    if ((aktuell && aktuell.nummer) !== (bisher && bisher.nummer)) throw new Hinweis("Die Rennleitung hat gerade dein Profil geändert. Bitte lade die Seite neu.");
    return mitStand(aktuell);
  });
  if (bisher && !wunsch) await P.wunschLoeschen(s.id);
  if (neu) await R.teamMelden({ title: "Startnummer: Änderung beantragt", url: "https://darklineperformance.de/liga-admin", color: 0xd3121b, fields: [{ name: "Fahrer", value: grunddaten.iracingName, inline: true }, { name: "Bisher", value: `#${bisher.nummer}`, inline: true }, { name: "Neu", value: `#${wunsch}`, inline: true }] });
  return profil;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const s = getLigaSession(req);
  if (req.method === "GET") {
    if (!s) return res.status(200).json({ angemeldet: false });
    if ((req.query || {}).nur === "status") return res.status(200).json({ angemeldet: true, leitung: !!s.leitung });
    // Sichtung: nur die eigenen Werte, erst beim Öffnen der Ansicht, weil dafür Garage 61 gelesen wird.
    if ((req.query || {}).nur === "sichtung") {
      const [alle, kat] = await Promise.all([eintraege(false), D.katalog(false)]);
      return res.status(200).json({ angemeldet: true, sichtung: await Sichtung.fahrerStand(sichtungSerien(kat, alle, s.id), alle, s.id) });
    }
    // Mit Discord-Abgleich wird frisch gelesen: Eine veraltete Liste würde einem gerade gemeldeten Fahrer die Rolle wieder nehmen.
    const [gespeichert, gelesen, katalog] = await Promise.all([profilLesen(s.id), eintraege(Dc.aktiv()), D.katalog(false)]);
    // Profilbild (öffentliches Profil) und Discord-Stand (privates Profil) schreiben in verschiedene Einträge und dürfen gleichzeitig laufen.
    const [, abgeglichen] = await Promise.all([
      P.bildNachziehen(s, gespeichert).catch((e) => console.warn("Liga: Profilbild:", e.message)),
      Dc.abgleichen(s.id, gespeichert, gelesen, katalog.serien),
    ]);
    return await antwort(res, s, abgeglichen, gelesen, katalog, false);
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Nicht erlaubt" });
  if (!gleicheHerkunft(req)) return res.status(403).json({ error: "Anfrage abgelehnt." });
  const body = req.body && typeof req.body === "object" ? req.body : {};
  if (body.aktion === "logout") {
    clearLigaSession(res);
    return res.status(200).json({ angemeldet: false });
  }
  if (!s) return res.status(401).json({ error: "Bitte melde dich erneut an." });

  const [profilVorher, alleVorher, kat] = await Promise.all([profilLesen(s.id), eintraege(true), D.katalog(false)]);
  let profil = profilVorher;
  let alle = alleVorher;
  const extra = {};
  // Klick auf „Team beitreten“ in der Sichtung: Meldung an die Rennleitung, die Seite wird dafür nicht neu aufgebaut.
  if (body.aktion === "sichtung-team") {
    const serie = sichtungSerien(kat, alle, s.id).find((x) => x.id === body.serie);
    if (!serie) return res.status(200).json({ ok: false });
    const name = (profil && profil.iracingName) || s.name;
    const imTeam = await Sichtung.teamMitglieder().then((m) => m.some((x) => Sichtung.namensKern(x.name) === Sichtung.namensKern(name)), () => false);
    if (!imTeam && (await Sichtung.teamAnfrageMerken(serie, s.id, name))) await R.teamMelden(Sichtung.teamAnfrageKarte(serie, name)).catch(() => {});
    return res.status(200).json({ ok: true });
  }
  if (body.aktion === "profil") {
    profil = await profilSpeichern(s, profil, body.profil);
  } else if (body.aktion === "nummer-gelesen") {
    if (profil && profil.nummerEntscheid) {
      profil = await D.jsonAendern(A.profilPfad(s.id), (aktuell) => {
        if (!aktuell) return undefined;
        const { nummerEntscheid, ...rest } = aktuell;
        return rest;
      }) || profil;
    }
  } else if (body.aktion === "anmelden") {
    alle = await anmelden(s, profil, body, alle, kat);
  } else if (body.aktion === "abmelden") {
    alle = await abmelden(s, body, alle, kat);
  } else if (body.aktion === "serie-anmelden") {
    alle = await serieAnmelden(s, profil, body, alle, kat);
  } else if (body.aktion === "serie-abmelden") {
    alle = await serieAbmelden(s, body, alle, kat);
  } else if (body.aktion === "fahrzeug-wechseln") {
    const serie = kat.serien.find((x) => x.id === body.serie);
    if (!serie || serie.status === "beendet") throw new Hinweis("Diese Season gibt es nicht oder sie ist beendet.");
    const { art, eintrag } = await F.wechseln(serie, s.id, String(body.modell || ""));
    if (art === "antrag") await R.teamMelden({ title: "Fahrzeugwechsel beantragt", url: "https://darklineperformance.de/liga-admin", color: 0xd3121b, fields: [{ name: "Fahrer", value: (profil && profil.iracingName) || s.name, inline: true }, { name: "Season", value: serie.name, inline: true }, { name: "Von → Nach", value: `${eintrag.modell} → ${eintrag.antrag.nach}` }] }).catch(() => {});
    extra.fahrzeugWechsel = art;
  } else if (body.aktion === "sichtung-abgeben") {
    const serie = sichtungSerien(kat, alle, s.id).find((x) => x.id === body.serie);
    if (!serie) throw new Hinweis("Du bist für keine Season mit dieser Sichtung angemeldet.");
    await Sichtung.abgebenAusGarage(serie, alle, s.id, String(body.strecke || ""));
    extra.sichtungAbgegeben = true;
  } else if (body.aktion === "report-melden") {
    await reportMelden(s, profil, body, alle, kat);
  } else if (body.aktion === "report-einspruch") {
    await reportEinspruch(s, profil, body, kat);
  } else {
    return res.status(400).json({ error: "Unbekannte Aktion." });
  }
  profil = await Dc.abgleichen(s.id, profil, alle, kat.serien);
  return await antwort(res, s, profil, alle, kat, true, extra);
};
