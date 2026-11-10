// Einstieg für alle Liga-Anfragen: ?r=oeffentlich, ?r=bild, ?r=fahrer oder ?r=admin. Eine Funktion statt drei hält die Zahl der Vercel-Funktionen klein.
const { useRequest, blobGet } = require("./_lib/blob");
const { Hinweis } = require("./_lib/liga-daten");
// Täglicher Aufruf (vercel.json), damit das kostenlose Supabase-Projekt in ruhigen Wochen nicht pausiert.
// Derselbe Aufruf postet am Renntag die Erinnerung. Ein Fehler dabei darf das Wachhalten nicht verhindern.
const Renntag = require("./_lib/liga-renntag");
const wachhalten = async (req, res) => {
  await blobGet("wachhalten");
  await Renntag.erinnern().catch((e) => console.error("Liga-Erinnerung:", e.message));
  return res.status(200).json({ ok: true });
};
const bereiche = { wach: wachhalten, kalender: Renntag.kalender, regeln: require("./_lib/liga-regeln").regeln, bild: require("./_lib/liga-bild"), oeffentlich: require("./_lib/liga-oeffentlich"), teilen: require("./_lib/liga-teilen"), profil: require("./_lib/liga-profil"), fahrer: require("./_lib/liga-fahrer"), admin: require("./_lib/liga-admin") };

// Texte aus Eingabe- und Dateiprüfung sind für den Nutzer gedacht, technische Fehler nicht.
const FUER_NUTZER = /^(Bitte|Die iRacing|Diese iRacing|Die Startnummer|Regeln:|Einstufung:|Das ist keine|In der Datei|Die Rennsession|Teamrennen|Unerwartete|Ein Rennen)/;

module.exports = async (req, res) => {
  const bereich = Object.prototype.hasOwnProperty.call(bereiche, (req.query || {}).r) ? bereiche[req.query.r] : null;
  if (!bereich) return res.status(404).json({ error: "Nicht gefunden" });
  try {
    useRequest(req);
    return await bereich(req, res);
  } catch (e) {
    if (e instanceof Hinweis || FUER_NUTZER.test(e.message)) return res.status(400).json({ error: e.message });
    console.error("Liga:", e);
    return res.status(500).json({ error: "Technischer Fehler. Bitte versuche es gleich noch einmal." });
  }
};
