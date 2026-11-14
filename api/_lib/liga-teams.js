// Teams der Liga. Jeder registrierte Fahrer kann ein Team gründen und ist dann Teamchef.
// Beitritt per Einladungslink (sofort) oder per Anfrage, die der Teamchef annimmt. Jeder Fahrer ist in höchstens einem Team.
// Ablage: liga/teams/<id>.json. Mitglieder stehen mit Discord-ID (intern) und anonymer Kennung (öffentlich) drin.
const crypto = require("crypto");
const { blobInhalte, blobDelete } = require("./blob");
const D = require("./liga-daten");
const { Hinweis } = D;
const { fahrerKennung } = require("./session");

const PREFIX = "liga/teams/";
const MAX_MITGLIEDER = 12;
const FARBEN = ["rot", "blau", "lila", "gruen", "gelb", "tuerkis"];
const TEAM_ID = /^[0-9a-f]{8}$/;
const CODE = /^[0-9a-f]{16}$/;
const pfad = (id) => {
  if (!TEAM_ID.test(String(id || ""))) throw new Hinweis("Dieses Team gibt es nicht.");
  return `${PREFIX}${id}.json`;
};
const zufall = (bytes) => crypto.randomBytes(bytes).toString("hex");

/* ---------- Lesen ---------- */
let cache = { bis: 0, wert: null };
async function alle(frisch) {
  if (!frisch && cache.wert && cache.bis > Date.now()) return cache.wert;
  const wert = (await blobInhalte(PREFIX)).map(([, t]) => { try { return JSON.parse(t); } catch (e) { return null; } }).filter((t) => t && TEAM_ID.test(t.id));
  cache = { bis: Date.now() + 15000, wert };
  return wert;
}
const vergessen = () => { cache = { bis: 0, wert: null }; };

const teamVon = (teams, discordId) => teams.find((t) => (t.mitglieder || []).some((m) => m.discordId === discordId)) || null;
const istChef = (team, discordId) => !!team && team.chef === discordId;

/* ---------- Prüfen, ohne Speicher ---------- */
function pruefe(eingabe, teams, eigeneId) {
  const name = String((eingabe && eingabe.name) || "").trim().replace(/\s+/g, " ");
  const kuerzel = String((eingabe && eingabe.kuerzel) || "").trim().toUpperCase();
  const farbe = String((eingabe && eingabe.farbe) || "rot");
  if (name.length < 2 || name.length > 40) throw new Hinweis("Bitte gib einen Teamnamen mit 2 bis 40 Zeichen an.");
  if (!/^[A-Z0-9]{2,4}$/.test(kuerzel)) throw new Hinweis("Das Kürzel besteht aus 2 bis 4 Buchstaben oder Ziffern.");
  if (!FARBEN.includes(farbe)) throw new Hinweis("Bitte wähle eine Teamfarbe aus der Liste.");
  const andere = teams.filter((t) => t.id !== eigeneId);
  if (andere.some((t) => t.name.toLowerCase() === name.toLowerCase())) throw new Hinweis(`Den Teamnamen „${name}“ gibt es schon.`);
  if (andere.some((t) => t.kuerzel === kuerzel)) throw new Hinweis(`Das Kürzel ${kuerzel} ist schon vergeben.`);
  return { name, kuerzel, farbe };
}

function mitgliedAus(discordId, profil) {
  if (!profil || !profil.iracingName || !profil.nummer) throw new Hinweis("Bitte registriere dich zuerst als Fahrer mit Startnummer.");
  return { discordId, pid: profil.custId ? fahrerKennung(profil.custId) : "", name: profil.iracingName, nummer: profil.nummer, seit: new Date().toISOString() };
}

// Öffentliche Sicht: ohne Discord-IDs, Einladungscode und Anfragen. Land und Bild aus den öffentlichen Profilangaben.
function oeffentlich(team, profile = {}) {
  const mitglieder = (team.mitglieder || []).map((m) => {
    const p = (m.pid && profile[m.pid]) || {};
    return { pid: m.pid, name: m.name, nummer: m.nummer || null, land: p.land || "", bild: p.bild || "", chef: m.discordId === team.chef };
  }).sort((a, b) => Number(b.chef) - Number(a.chef) || (a.nummer || 1000) - (b.nummer || 1000));
  return { id: team.id, name: team.name, kuerzel: team.kuerzel, farbe: team.farbe, erstellt: team.erstellt, mitglieder };
}

// Sicht im Fahrerbereich. Der Teamchef sieht zusätzlich Einladungscode, Anfragen und die Kennungen zum Verwalten.
function eigeneSicht(team, discordId, profile) {
  const chef = istChef(team, discordId);
  return {
    ...oeffentlich(team, profile),
    istChef: chef,
    ...(chef ? {
      einladung: team.einladung,
      anfragen: (team.anfragen || []).map((a) => ({ discordId: a.discordId, name: a.name, nummer: a.nummer || null, seit: a.seit })),
      verwaltung: (team.mitglieder || []).map((m) => ({ discordId: m.discordId, name: m.name, nummer: m.nummer || null, chef: m.discordId === team.chef })),
    } : {}),
  };
}

const kurzliste = (teams) => teams.map((t) => ({ id: t.id, name: t.name, kuerzel: t.kuerzel, farbe: t.farbe, anzahl: (t.mitglieder || []).length, voll: (t.mitglieder || []).length >= MAX_MITGLIEDER })).sort((a, b) => a.name.localeCompare(b.name, "de"));

/* ---------- Ändern ---------- */
async function aendern(id, fn) {
  const neu = await D.jsonAendern(pfad(id), (alt) => {
    if (!alt) throw new Hinweis("Dieses Team gibt es nicht mehr.");
    return fn(alt);
  });
  vergessen();
  return neu;
}

// Offene Anfragen eines Fahrers bei allen Teams entfernen, etwa nach einem Beitritt
async function anfragenWeg(discordId, teams, ausser) {
  for (const t of teams) if (t.id !== ausser && (t.anfragen || []).some((a) => a.discordId === discordId)) {
    await aendern(t.id, (alt) => ({ ...alt, anfragen: (alt.anfragen || []).filter((a) => a.discordId !== discordId) })).catch(() => {});
  }
}

function aufnehmen(alt, mitglied) {
  if ((alt.mitglieder || []).some((m) => m.discordId === mitglied.discordId)) return undefined;
  if ((alt.mitglieder || []).length >= MAX_MITGLIEDER) throw new Hinweis(`Das Team ist voll (höchstens ${MAX_MITGLIEDER} Fahrer).`);
  return { ...alt, mitglieder: [...(alt.mitglieder || []), mitglied], anfragen: (alt.anfragen || []).filter((a) => a.discordId !== mitglied.discordId) };
}

// Führt eine Aktion aus dem Fahrerbereich aus. Gibt optional eine Nachricht für Discord zurück: { an, text }.
async function aktion(art, discordId, profil, body = {}) {
  const teams = await alle(true);
  const meins = teamVon(teams, discordId);
  const chefPflicht = () => {
    if (!meins) throw new Hinweis("Du bist in keinem Team.");
    if (!istChef(meins, discordId)) throw new Hinweis("Das darf nur der Teamchef.");
    return meins;
  };

  if (art === "team-gruenden") {
    if (meins) throw new Hinweis(`Du bist schon im Team ${meins.name}. Verlasse es zuerst.`);
    const daten = pruefe(body, teams, null);
    const team = { id: zufall(4), ...daten, chef: discordId, mitglieder: [mitgliedAus(discordId, profil)], anfragen: [], einladung: zufall(8), erstellt: new Date().toISOString() };
    await D.jsonAendern(pfad(team.id), (alt) => { if (alt) throw new Hinweis("Bitte versuche es noch einmal."); return team; });
    vergessen();
    await anfragenWeg(discordId, teams, team.id);
    return null;
  }

  if (art === "team-beitreten") {
    const code = String(body.code || "");
    const team = CODE.test(code) ? teams.find((t) => t.einladung === code) : null;
    if (!team) throw new Hinweis("Dieser Einladungslink ist ungültig oder abgelaufen. Frag den Teamchef nach einem neuen.");
    if (meins) throw new Hinweis(meins.id === team.id ? "Du bist schon in diesem Team." : `Du bist schon im Team ${meins.name}. Verlasse es zuerst.`);
    const mitglied = mitgliedAus(discordId, profil);
    await aendern(team.id, (alt) => (alt.einladung === code ? aufnehmen(alt, mitglied) : (() => { throw new Hinweis("Dieser Einladungslink ist nicht mehr gültig."); })()));
    await anfragenWeg(discordId, teams, team.id);
    return { an: team.chef, text: `👋 **${mitglied.name}** (#${mitglied.nummer}) ist über den Einladungslink deinem Team **${team.name}** beigetreten.` };
  }

  if (art === "team-anfragen") {
    if (meins) throw new Hinweis(`Du bist schon im Team ${meins.name}.`);
    const team = teams.find((t) => t.id === body.team);
    if (!team) throw new Hinweis("Dieses Team gibt es nicht.");
    if ((team.mitglieder || []).length >= MAX_MITGLIEDER) throw new Hinweis("Das Team ist voll.");
    const m = mitgliedAus(discordId, profil);
    let neu = false;
    await aendern(team.id, (alt) => {
      if ((alt.anfragen || []).some((a) => a.discordId === discordId)) return undefined;
      neu = true;
      return { ...alt, anfragen: [...(alt.anfragen || []), { discordId, pid: m.pid, name: m.name, nummer: m.nummer, seit: m.seit }].slice(-30) };
    });
    return neu ? { an: team.chef, text: `📨 **${m.name}** (#${m.nummer}) möchte in dein Team **${team.name}**. Annehmen oder ablehnen kannst du im Fahrerbereich: https://darklineperformance.de/fahrerbereich` } : null;
  }

  if (art === "team-anfrage-zurueck") {
    const team = teams.find((t) => t.id === body.team);
    if (team) await aendern(team.id, (alt) => ((alt.anfragen || []).some((a) => a.discordId === discordId) ? { ...alt, anfragen: alt.anfragen.filter((a) => a.discordId !== discordId) } : undefined));
    return null;
  }

  if (art === "team-anfrage-entscheiden") {
    const team = chefPflicht();
    const wer = String(body.fahrer || "");
    const anfrage = (team.anfragen || []).find((a) => a.discordId === wer);
    if (!anfrage) throw new Hinweis("Diese Anfrage liegt nicht mehr vor.");
    if (body.ja === true) {
      const anderes = teamVon(teams, wer);
      if (anderes) {
        await aendern(team.id, (alt) => ({ ...alt, anfragen: (alt.anfragen || []).filter((a) => a.discordId !== wer) }));
        throw new Hinweis(`${anfrage.name} ist inzwischen im Team ${anderes.name}.`);
      }
      await aendern(team.id, (alt) => aufnehmen(alt, { discordId: wer, pid: anfrage.pid, name: anfrage.name, nummer: anfrage.nummer, seit: new Date().toISOString() }));
      await anfragenWeg(wer, teams, team.id);
      return { an: wer, text: `✅ Du bist jetzt im Team **${team.name}**.` };
    }
    await aendern(team.id, (alt) => ({ ...alt, anfragen: (alt.anfragen || []).filter((a) => a.discordId !== wer) }));
    return { an: wer, text: `❌ Deine Anfrage für das Team **${team.name}** wurde abgelehnt.` };
  }

  if (art === "team-verlassen") {
    if (!meins) return null;
    const andere = (meins.mitglieder || []).filter((m) => m.discordId !== discordId);
    if (istChef(meins, discordId) && andere.length) throw new Hinweis("Als Teamchef übergib zuerst die Leitung an ein anderes Mitglied oder löse das Team auf.");
    if (!andere.length) { await blobDelete([pfad(meins.id)]); vergessen(); return null; }
    await aendern(meins.id, (alt) => ({ ...alt, mitglieder: (alt.mitglieder || []).filter((m) => m.discordId !== discordId) }));
    return { an: meins.chef, text: `🚪 **${(profil && profil.iracingName) || "Ein Fahrer"}** hat dein Team **${meins.name}** verlassen.` };
  }

  if (art === "team-entfernen") {
    const team = chefPflicht();
    const wer = String(body.fahrer || "");
    if (wer === discordId) throw new Hinweis("Dich selbst kannst du nicht entfernen.");
    const m = (team.mitglieder || []).find((x) => x.discordId === wer);
    if (!m) return null;
    await aendern(team.id, (alt) => ({ ...alt, mitglieder: (alt.mitglieder || []).filter((x) => x.discordId !== wer) }));
    return { an: wer, text: `Du bist nicht mehr im Team **${team.name}**.` };
  }

  if (art === "team-bearbeiten") {
    const team = chefPflicht();
    const daten = pruefe(body, teams, team.id);
    await aendern(team.id, (alt) => ({ ...alt, ...daten }));
    return null;
  }

  if (art === "team-link-neu") {
    const team = chefPflicht();
    await aendern(team.id, (alt) => ({ ...alt, einladung: zufall(8) }));
    return null;
  }

  if (art === "team-chef") {
    const team = chefPflicht();
    const wer = String(body.fahrer || "");
    if (!(team.mitglieder || []).some((m) => m.discordId === wer) || wer === discordId) throw new Hinweis("Bitte wähle ein anderes Mitglied des Teams.");
    await aendern(team.id, (alt) => ({ ...alt, chef: wer }));
    return { an: wer, text: `👑 Du bist jetzt Teamchef von **${team.name}**.` };
  }

  if (art === "team-aufloesen") {
    const team = chefPflicht();
    await blobDelete([pfad(team.id)]);
    vergessen();
    return null;
  }

  throw new Hinweis("Unbekannte Aktion.");
}

// Nach einer Profiländerung: Name und Startnummer im Team mitziehen
async function mitgliedAktualisieren(discordId, profil) {
  if (!profil) return;
  const team = teamVon(await alle(true), discordId);
  if (!team) return;
  await aendern(team.id, (alt) => {
    const m = (alt.mitglieder || []).find((x) => x.discordId === discordId);
    if (!m || (m.name === profil.iracingName && m.nummer === profil.nummer)) return undefined;
    return { ...alt, mitglieder: alt.mitglieder.map((x) => (x.discordId === discordId ? { ...x, name: profil.iracingName, nummer: profil.nummer, pid: profil.custId ? fahrerKennung(profil.custId) : x.pid } : x)) };
  });
}

// Für die Rennleitung
async function adminLoeschen(id) {
  await blobDelete([pfad(id)]);
  vergessen();
}
async function adminEntfernen(id, discordId) {
  return aendern(id, (alt) => {
    const rest = (alt.mitglieder || []).filter((m) => m.discordId !== discordId);
    if (rest.length === (alt.mitglieder || []).length) return undefined;
    if (!rest.length) throw new Hinweis("Das ist das letzte Mitglied. Lösche stattdessen das Team.");
    return { ...alt, mitglieder: rest, chef: alt.chef === discordId ? rest[0].discordId : alt.chef };
  });
}
async function adminBearbeiten(id, eingabe) {
  const teams = await alle(true);
  const daten = pruefe(eingabe, teams, id);
  return aendern(id, (alt) => ({ ...alt, ...daten }));
}

// Team je anonymer Kennung, für Fahrerübersicht und Profile
// mitgliedName nur zur internen Verwendung (Fahrerübersicht), vor der Ausgabe mit teamKurz() entfernen
const nachPid = (teams) => new Map(teams.flatMap((t) => (t.mitglieder || []).filter((m) => m.pid).map((m) => [m.pid, { id: t.id, name: t.name, kuerzel: t.kuerzel, farbe: t.farbe, mitgliedName: m.name }])));
const teamKurz = (t) => (t ? { id: t.id, name: t.name, kuerzel: t.kuerzel, farbe: t.farbe } : null);

// ?r=teams (öffentlich): alle Teams mit Mitgliedern
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Nicht erlaubt" });
  const P = require("./liga-profil");
  const [teams, profile] = await Promise.all([alle(false), P.oeffentlicheProfile()]);
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
  return res.status(200).json({ teams: teams.map((t) => oeffentlich(t, profile)).sort((a, b) => b.mitglieder.length - a.mitglieder.length || a.name.localeCompare(b.name, "de")) });
}

module.exports = handler;
Object.assign(module.exports, { MAX_MITGLIEDER, FARBEN, alle, teamVon, istChef, pruefe, mitgliedAus, oeffentlich, eigeneSicht, kurzliste, aktion, mitgliedAktualisieren, adminLoeschen, adminEntfernen, adminBearbeiten, nachPid, teamKurz, aufnehmen });
