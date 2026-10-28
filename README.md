# Darkline Performance Motorsport – Teamseite

Statische Website ohne Build-Schritt. Alle Inhalte (Fahrer, Rennen mit Berichten, News, Garage, Links) liegen als JSON-Dateien im Ordner `content/` und werden über den Admin-Bereich unter `/admin` gepflegt.

```
index.html          Seite
assets/site.css     Design
assets/site.js      lädt content/*.json und baut die Seite auf
content/            drivers.json · cars.json · shop.json · partners.json · settings.json
content/races/      ein Rennen pro Datei (Dateiname = Link)
content/news/       ein Beitrag pro Datei
scripts/            build-content.js fasst Rennen und News beim Deploy zusammen
img/                Logo, Fahrerfotos, Liverys, Partnerlogos, Rennbanner
img/news/ …         Bilder aus dem Admin landen im passenden Unterordner
admin/              Admin-Bereich (Sveltia CMS) + config.yml
vercel.json         Header für Vercel
```

## 1. Auf GitHub hochladen

1. Auf GitHub ein neues Repository anlegen, z. B. `darkline-site`.
2. Den Inhalt dieses Ordners hochladen (GitHub Desktop oder „Add file → Upload files“).
3. In `admin/config.yml` ist `repo: Paulekinn/darkline-site` eingetragen – bei einem Umzug des Repos dort anpassen.

## 2. Mit Vercel verbinden

1. Erledigt: Vercel-Projekt `darkline-site` ist mit dem Repo verbunden, jeder Push auf `main` geht live (https://darklineperformance.de).
2. Framework Preset: **Other**. Build Command und Output Directory leer lassen.
3. Deploy.
4. Erledigt: `darklineperformance.de` hängt am Projekt `darkline-site`, `www.` leitet darauf weiter. DNS liegt bei IONOS (A-Record auf Vercel).

> Impressum und Datenschutz liegen als `impressum.html` und `datenschutz.html` im Repo. Bei neuen Funktionen (Analytics, Einbettungen, Formulare) die Datenschutzerklärung anpassen.

## 3. Admin-Bereich benutzen

Aufruf: `https://darklineperformance.de/admin`

**Anmeldung mit GitHub (empfohlen):** Im Admin auf „Mit GitHub anmelden“ klicken. Der Login läuft über die Funktionen `api/auth.js` und `api/callback.js` in diesem Projekt.

Einmalige Einrichtung:
1. GitHub → Settings → Developer settings → **OAuth Apps → New OAuth App**
   - Homepage URL: `https://darklineperformance.de`
   - Authorization callback URL: `https://darklineperformance.de/api/callback`
2. Client ID kopieren und ein **Client Secret** erzeugen.
3. In Vercel → Projekt `darkline-site` → Settings → Environment Variables anlegen:
   - `GITHUB_CLIENT_ID` = Client ID
   - `GITHUB_CLIENT_SECRET` = Client Secret
   - optional `ALLOWED_GITHUB_USERS` = erlaubte GitHub-Namen, Komma-getrennt (z. B. `Paulekinn,pascal-xyz`)
4. Neu deployen (Deployments → Redeploy).

Wer pflegen soll, braucht ein GitHub-Konto mit Schreibrechten im Repo (Collaborator).
Beim Domain-Umzug `base_url` in `admin/config.yml` sowie Homepage- und Callback-URL der OAuth App auf die neue Domain ändern.

**Alternative ohne Einrichtung:** „Mit Zugriffstoken anmelden“ mit einem Fine-grained Token (Repository `darkline-site`, Contents: Read and write).

**Ablauf:** Inhalt ändern → Speichern. Das CMS macht daraus einen Commit, Vercel veröffentlicht automatisch. Nach ca. 30–60 Sekunden ist die Änderung live.

## Was wo gepflegt wird

| Bereich | Admin-Menü | Hinweise |
|---|---|---|
| Lineup | Fahrer | Status *aktiv/inaktiv*. Starts und bestes Ergebnis rechnet die Seite selbst aus den Rennen aus – dafür den Namen exakt gleich schreiben. |
| Kalender | Rennen & Berichte | Status **geplant** → erscheint im Kalender und als „Nächstes Rennen“ oben. Bericht-Feld = Rennvorschau. |
| Klassement | Rennen & Berichte | Status **abgeschlossen** + Zielposition → erscheint im Klassement. Startplatz eintragen für die Plätze-Grafik. Bericht-Feld = Rennbericht (Klick auf das Rennen öffnet ihn). |
| News | News | Mit „Zugehöriges Rennen“ (Kennung des Rennens) werden News und Rennbericht verlinkt. |
| Garage | Garage | Livery-Bilder im Querformat 3:2. |
| Shop | Shop | Status „Coming soon/Verfügbar/Ausverkauft“, optional Preis und Shop-Link (sonst Anfrage per E-Mail). |
| Partner | Partner | Helles Logo auf transparentem Hintergrund. |
| Links, Open Seat | Einstellungen | Discord, E-Mail, Socials, Open Seat ein/aus. |

Der **Dateiname** eines Rennens oder Beitrags wird Teil des Links (`/#rennen-spa-24h-2026`, `/#news-…`). Neue Einträge bekommen ihn automatisch (Jahr-Monat-Titel).

## Lokal ansehen

```
node scripts/build-content.js
python3 -m http.server 8000
```
Dann `http://localhost:8000` öffnen (direkt per Doppelklick funktioniert es nicht, weil die Inhalte nachgeladen werden).
