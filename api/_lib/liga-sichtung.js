// Liga-Sichtung über Garage-61-Trainingsrunden.
// Die Fahrer bauen den Server aus dem Steckbrief als Offline-Testfahrt nach, Garage 61 sammelt die Runden im Liga-Team.
// Gültig ist ein Versuch aus N sauberen Runden am Stück in derselben Session und demselben Run, mit dem in der Season gemeldeten Auto.
// Der Fahrer gibt seinen besten Versuch je Strecke selbst ab, danach ist der Wert eingefroren. Zurücksetzen kann nur die Rennleitung.
// Was bis zum Ende der Sichtung nicht abgegeben ist, fehlt. Die Sichtung ist intern: Fahrer sehen nur ihre eigenen Werte.
//   liga/daten/sichtung/<serie>/<discordId>.json  { name, abgaben: { <strecke>: { wert, beste, schnitt, runden, event, zeit, abgegeben } } }
//   Von Hand zugeordnete Garage-61-Fahrer stehen in den privaten Daten der Season: privat.sichtungZuordnung { <slug>: <discordId> }
const { blobInhalte, blobDelete } = require("./blob");
const D = require("./liga-daten");
const { Hinweis } = D;
const { berlinNachUtc } = require("./liga-anmeldung");
const { gleichesModell } = require("./liga-fahrzeuge");
const G61 = require("./g61");

const WURZEL = "liga/daten/sichtung/";
const TOKEN = "G61_SICHTUNG_TOKEN";
const teamSlug = () => process.env.G61_SICHTUNG_TEAM || "darkline-simracing-series";
const teamLink = () => `https://garage61.net/app/teams/${teamSlug()}`;
const pfad = (serieId, discordId) => `${WURZEL}${D.brauchtId(serieId)}/${D.brauchtId(discordId)}.json`;

/* ---------- Rechnen, ohne Speicher und Netz ---------- */

// Zeitraum der Sichtung in Millisekunden: vom ersten Tag 0 Uhr bis zum Ende des letzten Tages, Berliner Zeit.
function zeitraum(serie) {
  if (!serie.sichtungVon || !serie.sichtungBis) return null;
  return { von: berlinNachUtc(serie.sichtungVon, "00:00"), bis: berlinNachUtc(D.datumPlus(serie.sichtungBis, 1), "00:00") };
}
const laeuft = (serie, jetzt) => { const z = zeitraum(serie); return !!z && jetzt >= z.von && jetzt < z.bis; };
const vorbei = (serie, jetzt) => { const z = zeitraum(serie); return !!z && jetzt >= z.bis; };

// Strecke der Sichtung zu einer Garage-61-Runde: über die Garage-61-ID oder die iRacing-ID.
function streckeVon(track, serie) {
  if (!track) return null;
  return (serie.sichtungStrecken || []).find((s) => (s.g61 && Number(track.id) === s.g61) || (s.iracing && Number(track.platform_id) === s.iracing)) || null;
}

// Eine Runde ohne Zwischenfall. In- und Outlap zählen nicht.
const sauber = (l) => !!l.clean && !l.pitIn && !l.pitOut && !l.incomplete && !l.offtrack && Number(l.lapTime) > 0;

// Bedingungen wie im Steckbrief: trocken, kein Regen, Streckentemperatur im Bereich.
// trackWetness kommt als Stufe von iRacing (0 unbekannt, 1 trocken, ab 2 feucht). Fehlt ein Wert, wird er nicht geprüft.
function bedingungenOk(l, serie) {
  if (Number(l.precipitation) > 0) return false;
  if (Number(l.trackWetness) > 1) return false;
  const t = l.trackTemp === undefined || l.trackTemp === null || l.trackTemp === "" ? null : Number(l.trackTemp);
  if (t !== null && Number.isFinite(t)) {
    if (serie.sichtungTempMin !== null && serie.sichtungTempMin !== undefined && t < serie.sichtungTempMin) return false;
    if (serie.sichtungTempMax !== null && serie.sichtungTempMax !== undefined && t > serie.sichtungTempMax) return false;
  }
  return true;
}

const rund3 = (x) => Math.round(x * 1000) / 1000;

// Bester Versuch aus den Runden eines Fahrers auf einer Strecke.
// runden: [{ lapTime, lapNumber, session, run, ok, event, zeit }], ok heißt sauber, passende Bedingungen und richtiges Auto.
// Ein Versuch sind n Runden am Stück (lückenlose Rundennummern) in derselben Session und demselben Run.
// wertung "beste": schnellste Runde darin, "schnitt": Mittelwert der n Runden. Liefert null ohne gültigen Versuch.
function besterVersuch(runden, n, wertung) {
  const gruppen = new Map();
  runden.forEach((r, i) => {
    const k = `${r.event ?? ""}|${r.session ?? ""}|${r.run ?? ""}`;
    if (!gruppen.has(k)) gruppen.set(k, []);
    gruppen.get(k).push({ ...r, nr: Number.isFinite(Number(r.lapNumber)) ? Number(r.lapNumber) : i });
  });
  let bester = null;
  for (const liste of gruppen.values()) {
    liste.sort((a, b) => a.nr - b.nr);
    let serie = [];
    const pruefen = () => {
      for (let i = 0; i + n <= serie.length; i++) {
        const fenster = serie.slice(i, i + n);
        const zeiten = fenster.map((r) => Number(r.lapTime));
        const beste = Math.min(...zeiten);
        const schnitt = zeiten.reduce((s, z) => s + z, 0) / n;
        const wert = wertung === "schnitt" ? schnitt : beste;
        const zweit = wertung === "schnitt" ? beste : schnitt;
        if (!bester || wert < bester.wert - 1e-9 || (Math.abs(wert - bester.wert) <= 1e-9 && zweit < bester.zweit)) {
          bester = { wert, zweit, beste, schnitt, runden: zeiten, event: fenster[0].event ?? null, zeit: fenster[0].zeit || null };
        }
      }
    };
    liste.forEach((r) => {
      if (r.ok && (!serie.length || r.nr === serie[serie.length - 1].nr + 1)) serie.push(r);
      else { pruefen(); serie = r.ok ? [r] : []; }
    });
    pruefen();
  }
  if (!bester) return null;
  return { wert: rund3(bester.wert), beste: rund3(bester.beste), schnitt: rund3(bester.schnitt), runden: bester.runden.map(rund3), event: bester.event, zeit: bester.zeit };
}

// Namen vergleichbar machen: Groß- und Kleinschreibung, Akzente, Leer- und Sonderzeichen zählen nicht.
const namensKern = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const g61Name = (d) => [d && d.firstName, d && d.lastName].filter(Boolean).join(" ").trim() || (d && (d.name || d.slug)) || "";

// Ordnet Garage-61-Fahrer den Season-Fahrern zu. fahrer: [{ discordId, name }], zuordnung: { slug: discordId } von der Rennleitung.
// Über den Namen nur, wenn genau ein Season-Fahrer so heißt. Liefert (driver) → Season-Fahrer oder null.
function zuordner(fahrer, zuordnung = {}) {
  const jeName = new Map();
  fahrer.forEach((f) => { const k = namensKern(f.name); if (k) jeName.set(k, [...(jeName.get(k) || []), f]); });
  const jeId = new Map(fahrer.map((f) => [f.discordId, f]));
  return (driver) => {
    if (!driver) return null;
    const hand = driver.slug && zuordnung[driver.slug];
    if (hand) return jeId.get(hand) || null;
    const treffer = jeName.get(namensKern(g61Name(driver))) || [];
    return treffer.length === 1 ? treffer[0] : null;
  };
}

// Session und Run kommen als Nummer oder als Objekt mit ID.
const kennung = (x) => (x && typeof x === "object" ? x.id ?? x.number ?? JSON.stringify(x) : x);

// Wertet Garage-61-Sessions aus. events: [{ id, startedAt, laps }]. fahrer: Season-Fahrer [{ discordId, name, modell }].
// Liefert { versuche: Map discordId → { <strecke>: Versuch }, unbekannt: [{ slug, name, runden }] }.
function auswerten(serie, events, fahrer, zuordnung, mitAuto = (serie.modelle || []).length > 0) {
  const zu = zuordner(fahrer, zuordnung);
  const z = zeitraum(serie);
  const n = serie.sichtungRunden || 7;
  const gesammelt = new Map(); // discordId → Map strecke → Runden
  const unbekannt = new Map();
  for (const ev of events) {
    const start = new Date(ev.startedAt || ev.start || 0).getTime();
    if (z && (start < z.von || start >= z.bis)) continue;
    for (const l of ev.laps || []) {
      const strecke = streckeVon(l.track || ev.track, serie);
      if (!strecke) continue;
      const f = zu(l.driver);
      if (!f) {
        const slug = (l.driver && l.driver.slug) || g61Name(l.driver);
        if (slug) { const u = unbekannt.get(slug) || { slug, name: g61Name(l.driver), runden: 0 }; u.runden++; unbekannt.set(slug, u); }
        continue;
      }
      const auto = (l.car || ev.car || {}).name;
      const autoOk = !mitAuto || (!!f.modell && gleichesModell(auto, f.modell));
      if (!gesammelt.has(f.discordId)) gesammelt.set(f.discordId, new Map());
      const jeStrecke = gesammelt.get(f.discordId);
      if (!jeStrecke.has(strecke.key)) jeStrecke.set(strecke.key, []);
      jeStrecke.get(strecke.key).push({ lapTime: l.lapTime, lapNumber: l.lapNumber, session: kennung(l.session), run: kennung(l.run), event: ev.id, zeit: ev.startedAt || null, ok: sauber(l) && bedingungenOk(l, serie) && autoOk });
    }
  }
  const versuche = new Map();
  gesammelt.forEach((jeStrecke, discordId) => {
    const beste = {};
    jeStrecke.forEach((runden, key) => { const v = besterVersuch(runden, n, serie.sichtungWertung); if (v) beste[key] = v; });
    versuche.set(discordId, beste);
  });
  return { versuche, unbekannt: [...unbekannt.values()].sort((a, b) => b.runden - a.runden) };
}

// Klassenvorschlag aus den abgegebenen Werten. fahrer: [{ discordId, cust, name, irating }], abgaben: Map discordId → Datei.
function vorschlag(serie, fahrer, abgaben, einstufung = {}) {
  const eintraege = fahrer.map((f) => ({ cust: f.cust, discordId: f.discordId, name: f.name, irating: f.irating, werte: Object.fromEntries(Object.entries(((abgaben.get(f.discordId) || {}).abgaben) || {}).map(([k, a]) => [k, a.wert])) }));
  return D.sichtungVorschlag(serie, eintraege, einstufung);
}

/* ---------- Speicher ---------- */

const lesenAlle = async (serieId) => new Map((await blobInhalte(`${WURZEL}${D.brauchtId(serieId)}/`)).map(([p, t]) => [p.split("/").pop().replace(/\.json$/, ""), JSON.parse(t)]));

// Der Fahrer gibt seinen besten Versuch für eine Strecke ab. versuch kommt immer aus der Auswertung auf dem Server.
async function abgeben(serie, discordId, key, versuch, name, jetzt = Date.now()) {
  const strecke = (serie.sichtungStrecken || []).find((s) => s.key === key);
  if (!strecke) throw new Hinweis("Diese Strecke gehört nicht zur Sichtung.");
  if (!zeitraum(serie)) throw new Hinweis("Für diese Season ist noch kein Sichtungszeitraum eingerichtet.");
  if (!laeuft(serie, jetzt)) throw new Hinweis(vorbei(serie, jetzt) ? "Die Sichtung ist vorbei, eine Abgabe ist nicht mehr möglich." : "Die Sichtung hat noch nicht begonnen.");
  if (!versuch) throw new Hinweis(`Für ${strecke.name} gibt es noch keinen gültigen Versuch mit ${serie.sichtungRunden} sauberen Runden am Stück.`);
  return D.jsonAendern(pfad(serie.id, discordId), (alt) => {
    if (alt.abgaben[key]) throw new Hinweis(`Dein Ergebnis für ${strecke.name} ist schon abgegeben. Ändern kann es nur die Rennleitung.`);
    return { ...alt, name: String(name || alt.name || "").slice(0, 80), abgaben: { ...alt.abgaben, [key]: { ...versuch, wertung: serie.sichtungWertung, abgegeben: new Date(jetzt).toISOString() } } };
  }, () => ({ name: "", abgaben: {} }));
}

// Nur die Rennleitung: Abgabe einer Strecke zurücknehmen, danach kann der Fahrer neu abgeben.
async function zuruecksetzen(serieId, discordId, key) {
  let gefunden = false;
  await D.jsonAendern(pfad(serieId, discordId), (alt) => {
    if (!alt || !alt.abgaben || !alt.abgaben[key]) return undefined;
    gefunden = true;
    const { [key]: weg, ...rest } = alt.abgaben;
    return { ...alt, abgaben: rest };
  });
  if (!gefunden) throw new Hinweis("Diese Abgabe gibt es nicht mehr.");
}

const derSerieLoeschen = async (serieId) => {
  const pfade = (await blobInhalte(`${WURZEL}${D.brauchtId(serieId)}/`)).map(([p]) => p);
  if (pfade.length) await blobDelete(pfade);
};

/* ---------- Garage 61 ---------- */

// Sessions des Liga-Teams im Zeitraum mit allen Runden. Abgeschlossene Sessions ändern sich nicht und werden länger gemerkt.
async function eventsLaden(serie) {
  const z = zeitraum(serie);
  if (!z || !(serie.sichtungStrecken || []).length) return [];
  const bis = Math.min(z.bis, Date.now() + 60e3);
  const params = { team: teamSlug(), after: new Date(z.von).toISOString(), before: new Date(bis).toISOString(), limit: 100 };
  const liste = [];
  const gesehen = new Set();
  for (let seite = 0; seite < 20; seite++) {
    const abruf = () => G61.cached(`sichtung-events:${JSON.stringify(params)}:${seite}`, 120, () => G61.g61Get("/events", seite ? { ...params, offset: seite * params.limit } : params, TOKEN));
    // Ob Garage 61 weitere Seiten über „offset“ liefert, ist nicht dokumentiert. Scheitert eine Folgeseite, zählt, was bis dahin da ist.
    let teil;
    try { teil = G61.items(await abruf()); } catch (e) { if (!seite) throw e; console.warn("Liga-Sichtung: Folgeseite nicht lesbar:", e.message); break; }
    const neu = teil.filter((e) => e && e.id && !gesehen.has(e.id));
    neu.forEach((e) => { gesehen.add(e.id); liste.push(e); });
    if (teil.length < params.limit || !neu.length) break;
  }
  // Steht die Strecke schon in der Liste, fallen fremde Strecken vor dem Abruf der Runden weg.
  const passend = liste.filter((e) => !e.track || (e.track.id === undefined && e.track.platform_id === undefined) || streckeVon(e.track, serie));
  const ergebnis = [];
  for (let i = 0; i < passend.length; i += 6) {
    ergebnis.push(...(await Promise.all(passend.slice(i, i + 6).map(async (e) => {
      const detail = await G61.cached(`sichtung-event:${e.id}`, 600, () => G61.g61Get(`/events/${encodeURIComponent(e.id)}`, {}, TOKEN));
      return { id: e.id, startedAt: e.startedAt || detail.startedAt, track: e.track || detail.track, car: e.car || detail.car, laps: detail.laps || [] };
    }))));
  }
  return ergebnis;
}

// Mitglieder des Garage-61-Teams als Namen und Slugs.
async function teamMitglieder() {
  const t = await G61.cached(`sichtung-team:${teamSlug()}`, 300, () => G61.g61Get(`/teams/${teamSlug()}`, {}, TOKEN));
  return (t.members || t.drivers || []).map((m) => ({ slug: m.slug || "", name: g61Name(m) }));
}

// Lesbare Fehlermeldung, damit die Seite trotzdem die gespeicherten Abgaben zeigen kann.
function g61Fehlertext(e) {
  if (e && e.retryAfter) return `Garage 61 ist gerade ausgelastet. Bitte in ${Math.ceil(e.retryAfter / 60)} Minute(n) noch einmal versuchen.`;
  console.error("Liga-Sichtung Garage 61:", e && e.message);
  return `Garage 61 ist gerade nicht erreichbar${e && e.status ? ` (Code ${e.status})` : ""}. Abgegebene Werte bleiben gültig.`;
}

/* ---------- Ansichten ---------- */

// Fahrer der Season mit Profil und gemeldetem Auto. alle: Anmeldungen (liga-anmeldung.leseEintrag).
async function seasonFahrer(serie, alle) {
  const { blobGet } = require("./blob");
  const A = require("./liga-anmeldung");
  const F = require("./liga-fahrzeuge");
  const mitglieder = alle.filter((e) => e.typ === "serie" && e.serieId === serie.id);
  const ids = [...new Set(mitglieder.map((e) => e.discordId))];
  const [profile, fahrzeuge] = await Promise.all([
    Promise.all(ids.map(async (d) => { const t = await blobGet(A.profilPfad(d)); return t ? JSON.parse(t) : null; })),
    F.derSerie(serie.id).catch(() => new Map()),
  ]);
  return ids.map((d, i) => {
    const p = profile[i];
    return { discordId: d, name: (p && p.iracingName) || mitglieder.find((e) => e.discordId === d).name, cust: p && p.custId ? String(p.custId) : "", irating: p ? p.irating : null, modell: (fahrzeuge.get(d) || {}).modell || "" };
  });
}

const eckdaten = (serie, jetzt) => ({
  von: serie.sichtungVon || "", bis: serie.sichtungBis || "", laeuft: laeuft(serie, jetzt), vorbei: vorbei(serie, jetzt),
  runden: serie.sichtungRunden || 7, wertung: serie.sichtungWertung || "beste", tempMin: serie.sichtungTempMin ?? null, tempMax: serie.sichtungTempMax ?? null,
  steckbrief: serie.sichtungSteckbrief || {}, teamLink: teamLink(),
});

// Stand der Sichtung für die Rennleitung: je Fahrer und Strecke fehlt, gefahren oder abgegeben, dazu Vorschlag und Garage-61-Team.
async function adminStand(serie, alle, privat, jetzt = Date.now()) {
  const zuordnung = privat.sichtungZuordnung || {};
  const [fahrer, abgaben] = await Promise.all([seasonFahrer(serie, alle), lesenAlle(serie.id)]);
  let auswertung = null;
  let mitglieder = null;
  const fehler = [];
  await Promise.all([
    eventsLaden(serie).then((events) => { auswertung = auswerten(serie, events, fahrer, zuordnung); }, (e) => fehler.push(g61Fehlertext(e))),
    teamMitglieder().then((m) => { mitglieder = m; }, (e) => fehler.push(g61Fehlertext(e))),
  ]);
  return standZusammen(serie, fahrer, abgaben, auswertung, mitglieder, privat, jetzt, fehler);
}

// Baut den Stand aus bereits geladenen Daten. Auch die Demo nutzt das. auswertung/mitglieder: null, wenn Garage 61 nicht lesbar war.
function standZusammen(serie, fahrer, abgaben, auswertung, mitglieder, privat = {}, jetzt = Date.now(), fehler = []) {
  const zuordnung = privat.sichtungZuordnung || {};
  const zu = zuordner(fahrer, zuordnung);
  const imTeam = new Set((mitglieder || []).map((m) => zu(m)).filter(Boolean).map((f) => f.discordId));
  const v = vorschlag(serie, fahrer, abgaben, privat.einstufung || {});
  const jeId = new Map(fahrer.map((f) => [f.discordId, f]));
  const zeilen = v.fahrer.map((vf) => {
    const f = jeId.get(vf.discordId);
    const eigene = (abgaben.get(f.discordId) || {}).abgaben || {};
    const versuche = auswertung ? auswertung.versuche.get(f.discordId) || {} : {};
    return {
      discordId: f.discordId, name: f.name, cust: f.cust, irating: f.irating, modell: f.modell, imTeam: mitglieder ? imTeam.has(f.discordId) : null,
      strecken: (serie.sichtungStrecken || []).map((s, i) => (eigene[s.key] ? { status: "abgegeben", wert: eigene[s.key].wert, prozent: vf.zeiten[i] ? vf.zeiten[i].prozent : null, abgegeben: eigene[s.key].abgegeben, gefahren: versuche[s.key] ? versuche[s.key].wert : null } : versuche[s.key] ? { status: "gefahren", wert: versuche[s.key].wert } : { status: "fehlt" })),
      prozent: vf.prozent, vollstaendig: vf.vollstaendig, vorschlag: vf.vorschlag, nachIrating: vf.nachIrating, fest: vf.fest,
    };
  });
  return {
    serie: serie.id, ...eckdaten(serie, jetzt), strecken: (serie.sichtungStrecken || []).map(({ key, name }) => ({ key, name })), klassen: v.klassen, grenzen: v.grenzen,
    fahrer: zeilen, unbekannt: auswertung ? auswertung.unbekannt : [], zuordnung: Object.entries(zuordnung).map(([slug, discordId]) => ({ slug, discordId, name: (jeId.get(discordId) || {}).name || "" })),
    fehler: [...new Set(fehler)].join(" "),
  };
}

// Sicht eines Fahrers: nur die eigenen Werte, dazu Steckbrief und Link zum Garage-61-Team. serien: Seasons mit Sichtung, in denen er gemeldet ist.
async function fahrerStand(serien, alle, discordId, jetzt = Date.now()) {
  return Promise.all(serien.map(async (serie) => {
    const privat = await D.privatLesen(serie.id).catch(() => ({}));
    const fahrer = await seasonFahrer(serie, alle);
    const ich = fahrer.find((f) => f.discordId === discordId) || { discordId, name: "", modell: "" };
    const eigene = ((await lesenAlle(serie.id).catch(() => new Map())).get(discordId) || {}).abgaben || {};
    const strecken = serie.sichtungStrecken || [];
    let versuche = {};
    let fehler = "";
    if (laeuft(serie, jetzt) && strecken.some((s) => !eigene[s.key])) {
      try { versuche = auswerten(serie, await eventsLaden(serie), fahrer, privat.sichtungZuordnung || {}).versuche.get(discordId) || {}; } catch (e) { fehler = g61Fehlertext(e); }
    }
    return {
      id: serie.id, name: serie.name, ...eckdaten(serie, jetzt), modell: ich.modell, mitAuto: (serie.modelle || []).length > 0, iracingName: ich.name,
      strecken: strecken.map((s) => ({ key: s.key, name: s.name, abgabe: eigene[s.key] || null, versuch: eigene[s.key] ? null : versuche[s.key] || null })), fehler,
    };
  }));
}

// Abgabe aus dem Fahrerbereich: Der Versuch wird hier frisch aus Garage 61 bestimmt, nie vom Browser übernommen.
async function abgebenAusGarage(serie, alle, discordId, key) {
  const strecke = (serie.sichtungStrecken || []).find((s) => s.key === key);
  if (!strecke) throw new Hinweis("Diese Strecke gehört nicht zur Sichtung.");
  if (!laeuft(serie, Date.now())) return abgeben(serie, discordId, key, null, "");
  const privat = await D.privatLesen(serie.id).catch(() => ({}));
  const fahrer = await seasonFahrer(serie, alle);
  const ich = fahrer.find((f) => f.discordId === discordId);
  if (!ich) throw new Hinweis("Du bist für diese Season nicht angemeldet.");
  let events;
  try { events = await eventsLaden(serie); } catch (e) { throw new Hinweis(g61Fehlertext(e)); }
  const versuch = (auswerten(serie, events, fahrer, privat.sichtungZuordnung || {}).versuche.get(discordId) || {})[key] || null;
  return abgeben(serie, discordId, key, versuch, ich.name);
}

// Kurzer Fortschritt für das Cockpit, ohne Garage 61: wie viele Fahrer haben alle Strecken abgegeben.
async function fortschritt(serie, alle, jetzt = Date.now()) {
  const ids = new Set(alle.filter((e) => e.typ === "serie" && e.serieId === serie.id).map((e) => e.discordId));
  const abgaben = await lesenAlle(serie.id).catch(() => new Map());
  const keys = (serie.sichtungStrecken || []).map((s) => s.key);
  let komplett = 0;
  let teil = 0;
  ids.forEach((d) => { const a = (abgaben.get(d) || {}).abgaben || {}; const n = keys.filter((k) => a[k]).length; if (keys.length && n === keys.length) komplett++; else if (n) teil++; });
  return { serie: serie.id, serieName: serie.name, farbe: serie.farbe, von: serie.sichtungVon || "", bis: serie.sichtungBis || "", laeuft: laeuft(serie, jetzt), vorbei: vorbei(serie, jetzt), eingerichtet: !!(zeitraum(serie) && keys.length), fahrer: ids.size, komplett, teil };
}

const datumDe = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ""); return m ? `${m[3]}.${m[2]}.${m[1]}` : ""; };
const WERTUNG = { beste: "beste Runde", schnitt: "Durchschnitt der sauberen Runden" };
// Steckbrief als Text für Discord und den Fahrerbereich
function steckbriefZeilen(serie) {
  const b = serie.sichtungSteckbrief || {};
  const temp = serie.sichtungTempMin !== null && serie.sichtungTempMin !== undefined || serie.sichtungTempMax !== null && serie.sichtungTempMax !== undefined ? `${serie.sichtungTempMin ?? "?"} bis ${serie.sichtungTempMax ?? "?"} °C Strecke` : "";
  return [["Uhrzeit", b.uhrzeit], ["Wetter", b.wetter], ["Streckenzustand", b.zustand], ["Setup", b.setup], ["Temperatur", b.temperatur || temp]].filter(([, w]) => w);
}
// Direktnachricht nach der Anmeldung zu einer Season mit Sichtung
function einladungText(serie, modell) {
  const z = serie.sichtungVon && serie.sichtungBis ? `vom ${datumDe(serie.sichtungVon)} bis ${datumDe(serie.sichtungBis)}` : "im Zeitraum, den die Rennleitung noch bekannt gibt";
  return [
    `🏁 Du bist für **${serie.name}** angemeldet. Deine Klasse bestimmt die **Sichtung** ${z}.`,
    "",
    `**So geht's:** Tritt dem Garage-61-Team der Liga bei (Beitritt mit Freigabe): ${teamLink()}`,
    `Bau den Server aus dem Steckbrief als Offline-Testfahrt in iRacing nach und fahr ${serie.sichtungRunden || 7} saubere Runden am Stück${modell ? ` mit deinem **${modell}**` : ""}. Gewertet wird die ${WERTUNG[serie.sichtungWertung] || WERTUNG.beste}.`,
    (serie.sichtungStrecken || []).length ? `**Strecken:** ${serie.sichtungStrecken.map((s) => s.name).join(", ")}` : "",
    ...steckbriefZeilen(serie).map(([k, w]) => `**${k}:** ${w}`),
    "",
    "Im Fahrerbereich siehst du je Strecke deinen besten gültigen Versuch und gibst ihn dort ab. Danach ist er eingefroren. Was bis zum Ende der Sichtung nicht abgegeben ist, fehlt.",
    "https://darklineperformance.de/fahrer",
  ].filter((z, i, a) => z !== "" || (a[i - 1] !== "" && i > 0)).join("\n");
}

module.exports = { standZusammen, einladungText, steckbriefZeilen, seasonFahrer, adminStand, fahrerStand, abgebenAusGarage, fortschritt, WURZEL, teamSlug, teamLink, zeitraum, laeuft, vorbei, streckeVon, sauber, bedingungenOk, besterVersuch, namensKern, g61Name, zuordner, auswerten, vorschlag, lesenAlle, abgeben, zuruecksetzen, derSerieLoeschen, eventsLaden, teamMitglieder, g61Fehlertext };
