// Privater Vercel-Blob-Speicher (Store "darkline-referenzrunden") für Referenzrunden fremder Fahrer.
// Die gehören nicht ins öffentliche Repository; lesen dürfen sie nur die Daten-Funktionen (Teambereich mit Login).
// Direkt per HTTP wie das offizielle SDK @vercel/blob (API-Version 13), damit das Projekt ohne npm-Abhängigkeiten bleibt.
const API = "https://vercel.com/api/blob";

function auth() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN fehlt in den Vercel-Umgebungsvariablen.");
  return { token, store: (token.split("_")[3] || "").toLowerCase() }; // vercel_blob_rw_<store>_<geheim>
}

const fileUrl = (store, pathname) => `https://${store}.private.blob.vercel-storage.com/${pathname}`;

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
  if (!r.ok) throw new Error(`Speichern im privaten Speicher fehlgeschlagen (Code ${r.status}).`);
  return r.json();
}

// Inhalt als Text, null wenn es die Datei nicht gibt
async function blobGet(pathname) {
  const { token, store } = auth();
  const r = await fetch(fileUrl(store, pathname), { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Lesen aus dem privaten Speicher fehlgeschlagen (Code ${r.status}).`);
  return r.text();
}

async function blobDelete(pathnames) {
  const { token, store } = auth();
  const r = await fetch(`${API}/delete`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "x-api-version": "13", "x-vercel-blob-store-id": store, "content-type": "application/json" },
    body: JSON.stringify({ urls: pathnames.map((p) => fileUrl(store, p)) }),
  });
  if (!r.ok) throw new Error(`Löschen im privaten Speicher fehlgeschlagen (Code ${r.status}).`);
}

module.exports = { blobPut, blobGet, blobDelete };
