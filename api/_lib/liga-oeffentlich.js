// Öffentliche Ligadaten für /liga: Serien, Termine und auf Wunsch die Tabelle einer Serie. Kein Passwort, kein Briefing, keine iRacing-IDs.
const D = require("./liga-daten");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Nicht erlaubt" });
  const { serien, rennen, einstellungen } = await D.katalog(false);
  const antwort = { serien, rennen: rennen.map(D.oeffentlichesRennen), kopfbildVersion: einstellungen.kopfbildVersion || 0 };
  const kennung = (req.query || {}).serie;
  if (D.istId(kennung) && serien.some((s) => s.id === kennung)) antwort.tabelle = await D.tabelleLesen(kennung);
  // Das iRating dient nur der Einstufung und bleibt bei der Rennleitung.
  if (antwort.tabelle) [...(antwort.tabelle.klassen || []), ...(antwort.tabelle.gesamt || [])].forEach((k) => k.fahrer.forEach((f) => { delete f.irating; }));
  // Die CDN-Kopie schont den Speicher, Änderungen sind nach spätestens rund einer Minute sichtbar.
  res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=40");
  return res.status(200).json(antwort);
};
