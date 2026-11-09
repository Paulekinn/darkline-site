// Liefert die im Liga-Admin hochgeladenen Bilder aus dem privaten Speicher aus.
const D = require("./liga-daten");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Nicht erlaubt" });
  const schluessel = (req.query || {}).k;
  if (!D.istId(schluessel)) return res.status(404).json({ error: "Nicht gefunden" });
  const buf = await D.bildLesen(schluessel);
  const typ = buf && D.bildTyp(buf);
  if (!typ) return res.status(404).json({ error: "Nicht gefunden" });
  res.statusCode = 200;
  res.setHeader("Content-Type", typ);
  // Die Adresse enthält die Version, ein neues Bild bekommt also eine neue Adresse.
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.end(buf);
};
