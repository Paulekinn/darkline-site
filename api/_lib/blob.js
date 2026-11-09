// Privater Vercel-Blob-Speicher (Store "darkline-referenzrunden") für Referenzrunden fremder Fahrer.
// Die gehören nicht ins öffentliche Repository; lesen dürfen sie nur die Daten-Funktionen (Teambereich mit Login).
// Direkt per HTTP wie das offizielle SDK @vercel/blob (API-Version 13), damit das Projekt ohne npm-Abhängigkeiten bleibt.
const crypto = require("crypto");
const API = "https://vercel.com/api/blob";

// Vercel erlaubt im kostenlosen Tarif nur 2.000 Uploads und Auflistungen im Monat, wird das überschritten, ist der Speicher bis zu 30 Tage gesperrt.
// Deshalb werden Auflistungen als eigene Datei gemerkt und jeder Schreibzugriff löscht die betroffenen Merker, Löschen ist kostenlos.
const MERKER = "listen-merker/";
const KURZ_MS = 90e3;
const LANG_MS = 24 * 3600e3;
const merkerPfad = (art, prefix) => `${MERKER}${art}-${crypto.createHash("sha256").update(prefix).digest("hex").slice(0, 32)}.json`;
const ANMELDUNG = /^liga\/(serien|anmeldungen|abmeldungen)\//;

// Merker, die eine Änderung an dieser Datei ungültig macht. „liga/“ umfasst fast alles, wird aber nur für Anmeldungen ausgewertet.
function merkerVon(pathname) {
  if (!pathname.startsWith("liga")) return [];
  const teile = pathname.split("/");
  const pfade = [];
  for (let i = 1; i < teile.length; i++) {
    const prefix = `${teile.slice(0, i).join("/")}/`;
    if (prefix !== "liga/" || ANMELDUNG.test(pathname)) pfade.push(merkerPfad("liste", prefix), merkerPfad("inhalt", prefix));
  }
  return pfade;
}

// Zugang: fester Token (BLOB_READ_WRITE_TOKEN) oder, wie bei neu verbundenen Stores, das kurzlebige OIDC-Token,
// das Vercel jeder Anfrage mitgibt (Header x-vercel-oidc-token), zusammen mit BLOB_STORE_ID.
// Das OIDC-Token gehört zum Projekt, nicht zur Person; useRequest(req) merkt sich das der aktuellen Anfrage.
let requestOidc = "";
function useRequest(req) {
  requestOidc = (req && req.headers && req.headers["x-vercel-oidc-token"]) || "";
}

function auth() {
  const rw = process.env.BLOB_READ_WRITE_TOKEN;
  // Store-ID in Original-Schreibweise: der Header x-vercel-blob-store-id unterscheidet Groß- und Kleinschreibung
  if (rw) return { token: rw, store: rw.split("_")[3] || "" }; // vercel_blob_rw_<store>_<geheim>
  const oidc = requestOidc || process.env.VERCEL_OIDC_TOKEN;
  const store = (process.env.BLOB_STORE_ID || "").replace(/^store_/, "");
  if (!oidc || !store) throw new Error("Kein Zugang zum privaten Speicher: BLOB_STORE_ID oder OIDC-Token fehlt.");
  return { token: oidc, store };
}

const fileUrl = (store, pathname) => `https://${store.toLowerCase()}.private.blob.vercel-storage.com/${pathname}`;
const failure = async (what, r) => new Error(`${what} im privaten Speicher fehlgeschlagen (Code ${r.status}${await r.text().then((t) => (t ? ": " + t.slice(0, 160) : ""), () => "")}).`);

// Datei anlegen oder überschreiben
async function blobPut(pathname, body, contentType) {
  const { token, store } = auth();
  const r = await fetch(`${API}/?${new URLSearchParams({ pathname })}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "x-api-version": "13",
      "x-vercel-blob-store-id": store,
      "x-vercel-blob-access": "private",
      "x-add-random-suffix": "0",
      "x-allow-overwrite": "1",
      "x-content-type": contentType,
    },
    body,
  });
  if (!r.ok) throw await failure("Speichern", r);
  const antwort = await r.json();
  await merkerLoeschen(merkerVon(pathname));
  return antwort;
}

async function loeschenRoh(pathnames) {
  const { token, store } = auth();
  const r = await fetch(`${API}/delete`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "x-api-version": "13", "x-vercel-blob-store-id": store, "content-type": "application/json" },
    body: JSON.stringify({ urls: pathnames.map((p) => fileUrl(store, p)) }),
  });
  if (!r.ok) throw await failure("Löschen", r);
}

// Ein Fehler hier darf die eigentliche Änderung nicht zurückdrehen, der Merker läuft spätestens nach einem Tag ab.
async function merkerLoeschen(pfade) {
  if (!pfade.length) return;
  try {
    await loeschenRoh(pfade);
  } catch (e) {
    console.error("Blob-Merker:", e.message);
  }
}

// Inhalt als Text, null wenn es die Datei nicht gibt
async function blobGet(pathname) {
  const { token, store } = auth();
  const r = await fetch(fileUrl(store, pathname), { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw await failure("Lesen", r);
  return r.text();
}

async function blobDelete(pathnames) {
  await loeschenRoh(pathnames);
  await merkerLoeschen([...new Set(pathnames.flatMap(merkerVon))]);
}

// Inhalt als Buffer (Bilder), null wenn es die Datei nicht gibt
async function blobGetBinaer(pathname) {
  const { token, store } = auth();
  const r = await fetch(fileUrl(store, pathname), { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw await failure("Lesen", r);
  return Buffer.from(await r.arrayBuffer());
}

// Alle Dateien unter einem Pfad, mit pathname und uploadedAt. Jede Seite zählt als Auflistung, deshalb nur über die Merker aufrufen.
async function blobListeDirekt(prefix) {
  const { token, store } = auth();
  const blobs = [];
  let cursor = "";
  do {
    const query = new URLSearchParams({ prefix, limit: "1000" });
    if (cursor) query.set("cursor", cursor);
    const r = await fetch(`${API}/?${query}`, { headers: { authorization: `Bearer ${token}`, "x-api-version": "13", "x-vercel-blob-store-id": store }, cache: "no-store" });
    if (!r.ok) throw await failure("Auflisten", r);
    const d = await r.json();
    blobs.push(...d.blobs);
    cursor = d.hasMore ? d.cursor : "";
  } while (cursor);
  return blobs.map(({ pathname, uploadedAt }) => ({ pathname, uploadedAt }));
}

// Liefert den gemerkten Stand oder baut ihn neu. Direkt nach einer Änderung kann die Auflistung noch hinterherhinken:
// Der erste neue Stand gilt deshalb nur kurz, erst der zweite einen Tag.
async function gemerkt(art, prefix, erzeugen) {
  const pfad = merkerPfad(art, prefix);
  let alt = null;
  try {
    alt = JSON.parse((await blobGet(pfad)) || "null");
  } catch (e) {
    alt = null;
  }
  if (alt && alt.bis > Date.now()) return alt.wert;
  const wert = await erzeugen();
  try {
    await blobPut(pfad, JSON.stringify({ bis: Date.now() + (alt ? LANG_MS : KURZ_MS), wert }), "application/json");
  } catch (e) {
    console.error("Blob-Merker:", e.message);
  }
  return wert;
}

const blobList = (prefix) => gemerkt("liste", prefix, () => blobListeDirekt(prefix));

// Alle Textdateien unter einem Pfad als [pathname, Inhalt], eine einzige Abfrage statt einer je Datei.
const blobInhalte = (prefix) => gemerkt("inhalt", prefix, async () => {
  const blobs = await blobListeDirekt(prefix);
  const dateien = await Promise.all(blobs.map(async (b) => [b.pathname, await blobGet(b.pathname)]));
  return dateien.filter(([, t]) => t !== null);
});

module.exports = { useRequest, blobPut, blobGet, blobGetBinaer, blobDelete, blobList, blobListeDirekt, blobInhalte };
