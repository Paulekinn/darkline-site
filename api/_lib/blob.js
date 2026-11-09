// Privater Vercel-Blob-Speicher (Store "darkline-referenzrunden") für Referenzrunden fremder Fahrer.
// Die gehören nicht ins öffentliche Repository; lesen dürfen sie nur die Daten-Funktionen (Teambereich mit Login).
// Direkt per HTTP wie das offizielle SDK @vercel/blob (API-Version 13), damit das Projekt ohne npm-Abhängigkeiten bleibt.
const API = "https://vercel.com/api/blob";

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
  return r.json();
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
  const { token, store } = auth();
  const r = await fetch(`${API}/delete`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "x-api-version": "13", "x-vercel-blob-store-id": store, "content-type": "application/json" },
    body: JSON.stringify({ urls: pathnames.map((p) => fileUrl(store, p)) }),
  });
  if (!r.ok) throw await failure("Löschen", r);
}

// Inhalt als Buffer (Bilder), null wenn es die Datei nicht gibt
async function blobGetBinaer(pathname) {
  const { token, store } = auth();
  const r = await fetch(fileUrl(store, pathname), { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw await failure("Lesen", r);
  return Buffer.from(await r.arrayBuffer());
}

// Alle Dateien unter einem Pfad, mit pathname und uploadedAt
async function blobList(prefix) {
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
  return blobs;
}

module.exports = { useRequest, blobPut, blobGet, blobGetBinaer, blobDelete, blobList };
