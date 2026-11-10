// Privater Speicher der Website in einer Supabase-Tabelle. Jeder Eintrag verhält sich wie eine Datei mit Pfad, deshalb kennen die übrigen Module nur Pfade.
// Vercel Blob wurde abgelöst, weil dort schon 2.000 Uploads und Auflistungen im Monat den Speicher sperren. Direkt per HTTP, ohne npm-Abhängigkeiten.
// Benötigt SUPABASE_URL und SUPABASE_SECRET_KEY. Der Schlüssel darf nie in den Browser gelangen.
const TABELLE = "dateien";
const SEITE = 1000;
const LOESCHEN_JE_ANFRAGE = 25;

function zugang() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Kein Zugang zum Speicher: SUPABASE_URL oder SUPABASE_SECRET_KEY fehlt.");
  return { url, key };
}

// Wird nur noch aufgerufen, weil früher jede Anfrage ihr Zugangstoken mitbrachte.
function useRequest() {}

async function anfrage(was, parameter, init = {}) {
  const { url, key } = zugang();
  // Neue Schlüssel (sb_secret_) gehören nur in den apikey-Header, ältere service_role-Schlüssel zusätzlich in Authorization.
  const headers = { apikey: key, ...(key.startsWith("eyJ") ? { authorization: `Bearer ${key}` } : {}), ...init.headers };
  const r = await fetch(`${url}/rest/v1/${TABELLE}?${new URLSearchParams(parameter)}`, { ...init, headers, cache: "no-store" });
  if (!r.ok) throw new Error(`${was} im Speicher fehlgeschlagen (Code ${r.status}${await r.text().then((t) => (t ? ": " + t.slice(0, 160) : ""), () => "")}).`);
  return r;
}

// Holt alle Zeilen unter einem Pfad, seitenweise. Supabase liefert höchstens 1.000 Zeilen je Anfrage.
async function zeilen(prefix, spalten) {
  const like = `${prefix.replace(/[\\%_*]/g, "\\$&")}*`;
  const alle = [];
  for (let offset = 0; ; offset += SEITE) {
    const r = await anfrage("Auflisten", { select: spalten, pfad: `like.${like}`, order: "pfad", limit: String(SEITE), offset: String(offset) });
    const seite = await r.json();
    alle.push(...seite);
    if (seite.length < SEITE) return alle;
  }
}

const einZeile = async (pathname, spalten) => (await (await anfrage("Lesen", { select: spalten, pfad: `eq.${pathname}`, limit: "1" })).json())[0] || null;
const alsText = (z) => (z.binaer ? Buffer.from(z.inhalt, "base64").toString("utf8") : z.inhalt);

// Datei anlegen oder überschreiben
async function blobPut(pathname, body, contentType) {
  const binaer = body instanceof Uint8Array;
  const zeile = { pfad: pathname, inhalt: binaer ? Buffer.from(body).toString("base64") : String(body), binaer, typ: contentType || "", geaendert: new Date().toISOString() };
  await anfrage("Speichern", { on_conflict: "pfad" }, {
    method: "POST",
    headers: { "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([zeile]),
  });
  return { pathname };
}

// Inhalt als Text, null wenn es die Datei nicht gibt
async function blobGet(pathname) {
  const z = await einZeile(pathname, "inhalt,binaer");
  return z ? alsText(z) : null;
}

// Inhalt samt Änderungsstand. Der Stand ist der Nachweis für blobPutWenn, dass seitdem niemand anderes geschrieben hat.
async function blobGetMitStand(pathname) {
  const z = await einZeile(pathname, "inhalt,binaer,geaendert");
  return z ? { text: alsText(z), stand: z.geaendert } : { text: null, stand: null };
}

// Schreibt nur, wenn die Datei noch den gelesenen Stand hat. Stand null heißt: nur anlegen, wenn es sie noch nicht gibt.
// Gibt false zurück, wenn jemand anderes dazwischen gespeichert hat. Dann liest der Aufrufer neu und versucht es noch einmal.
async function blobPutWenn(pathname, body, contentType, stand) {
  // Der neue Stand muss sich vom alten unterscheiden, auch wenn zwei Schreibvorgänge in dieselbe Millisekunde fallen.
  const vorher = stand ? Date.parse(stand) : 0;
  const geaendert = new Date(Math.max(Date.now(), vorher + 1)).toISOString();
  const zeile = { inhalt: String(body), binaer: false, typ: contentType || "", geaendert };
  const r = stand === null
    ? await anfrage("Speichern", { on_conflict: "pfad", select: "pfad" }, { method: "POST", headers: { "content-type": "application/json", prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify([{ pfad: pathname, ...zeile }]) })
    : await anfrage("Speichern", { pfad: `eq.${pathname}`, geaendert: `eq.${stand}`, select: "pfad" }, { method: "PATCH", headers: { "content-type": "application/json", prefer: "return=representation" }, body: JSON.stringify(zeile) });
  return (await r.json()).length === 1;
}

// Inhalt als Buffer (Bilder), null wenn es die Datei nicht gibt
async function blobGetBinaer(pathname) {
  const z = await einZeile(pathname, "inhalt,binaer");
  if (!z) return null;
  return z.binaer ? Buffer.from(z.inhalt, "base64") : Buffer.from(z.inhalt, "utf8");
}

async function blobDelete(pathnames) {
  const zitiere = (p) => `"${p.replace(/[\\"]/g, "\\$&")}"`;
  for (let i = 0; i < pathnames.length; i += LOESCHEN_JE_ANFRAGE) {
    await anfrage("Löschen", { pfad: `in.(${pathnames.slice(i, i + LOESCHEN_JE_ANFRAGE).map(zitiere).join(",")})` }, { method: "DELETE", headers: { prefer: "return=minimal" } });
  }
}

// Alle Dateien unter einem Pfad, mit pathname und uploadedAt
const blobList = async (prefix) => (await zeilen(prefix, "pfad,geaendert")).map((z) => ({ pathname: z.pfad, uploadedAt: new Date(z.geaendert).toISOString() }));

// Alle Textdateien unter einem Pfad als [pathname, Inhalt], mit einer Abfrage statt einer je Datei
const blobInhalte = async (prefix) => (await zeilen(prefix, "pfad,inhalt,binaer")).map((z) => [z.pfad, alsText(z)]);

module.exports = { useRequest, blobPut, blobGet, blobGetMitStand, blobPutWenn, blobGetBinaer, blobDelete, blobList, blobInhalte };
