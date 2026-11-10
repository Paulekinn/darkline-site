// Events werden nach Platzierungen statt nach Punkten geführt. Wiederkehrende Events bilden über den Namen eine Reihe.
const jahrVon = (start) => String(start || "").slice(0, 4);

// Das Podium je Fahrzeugklasse aus dem Ergebnis des einzigen Rennens
function podienVon(tabelle) {
  const rennen = tabelle && Array.isArray(tabelle.rennen) ? tabelle.rennen[0] : null;
  if (!rennen || !Array.isArray(rennen.ergebnisse)) return null;
  const klassen = rennen.ergebnisse.map((b) => ({
    name: b.fahrzeugklasse,
    podium: b.zeilen.filter((z) => z.gesamt.status === "OK" && z.gesamt.platz >= 1 && z.gesamt.platz <= 3).sort((a, b2) => a.gesamt.platz - b2.gesamt.platz).map((z) => ({ platz: z.gesamt.platz, name: z.name, ...(z.pid ? { pid: z.pid } : {}) })),
  })).filter((k) => k.podium.length);
  return klassen.length ? { start: rennen.start, klassen } : null;
}

// serien: alle Events derselben Reihe. tabellen: Map Serie → Tabelle. vorlaeufig(serie, start): noch nicht endgültig?
// In die Bestenliste zählen nur endgültige Ergebnisse, damit eine spätere Strafe keine Medaille zurücknehmen muss.
function eventReihe(name, serien, tabellen, vorlaeufig) {
  const ausgaben = serien.map((s) => {
    const p = podienVon(tabellen.get(s.id));
    return p && { serie: s.id, name: s.name, jahr: jahrVon(p.start), start: p.start, vorlaeufig: vorlaeufig(s, p.start), klassen: p.klassen };
  }).filter(Boolean).sort((a, b) => String(b.start).localeCompare(String(a.start)));
  const zaehler = new Map();
  ausgaben.filter((a) => !a.vorlaeufig).forEach((a) => a.klassen.forEach((k) => k.podium.forEach((f) => {
    const schluessel = f.pid || f.name;
    const e = zaehler.get(schluessel) || { name: f.name, ...(f.pid ? { pid: f.pid } : {}), p1: 0, p2: 0, p3: 0 };
    e[`p${f.platz}`] += 1;
    zaehler.set(schluessel, e);
  })));
  // Bei Gleichstand entscheiden die zweiten, dann die dritten Plätze, wie im Reglement unter 4.5.
  const bestenliste = [...zaehler.values()].sort((a, b) => b.p1 - a.p1 || b.p2 - a.p2 || b.p3 - a.p3 || a.name.localeCompare(b.name, "de"));
  return { name, ausgaben, bestenliste };
}

// Erfolge für das Fahrerprofil: alle Podestplätze bei Events
function eventErfolge(serien, tabellen, pid) {
  return serien.filter((s) => s.typ === "event").flatMap((s) => {
    const p = podienVon(tabellen.get(s.id));
    if (!p) return [];
    const titel = s.eventReihe ? `${s.eventReihe} ${jahrVon(p.start)}` : s.name;
    return p.klassen.flatMap((k) => k.podium.filter((f) => f.pid === pid).map((f) => ({ serie: s.id, platz: f.platz, titel, klasse: p.klassen.length > 1 ? k.name : "", start: p.start })));
  }).sort((a, b) => String(b.start).localeCompare(String(a.start)));
}

module.exports = { podienVon, eventReihe, eventErfolge };
