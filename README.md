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
| Lineup + Fahrerseiten | Fahrer | Status *aktiv/auf Probe/inaktiv*. Jeder Fahrer bekommt automatisch eine Seite `/fahrer/vorname-nachname` mit Rennhistorie und Statistik; optional iRacing-Profil- und Stream-Link. Starts und bestes Ergebnis rechnet die Seite selbst aus den Rennen aus – dafür den Namen exakt gleich schreiben. |
| Kalender | Rennen & Berichte | Status **geplant** → erscheint im Kalender, als „Nächstes Rennen“ oben und im abonnierbaren Kalender `/kalender.ics` (Startzeit in deutscher Zeit, Dauer z. B. `6h` oder `2:40h`). Bericht-Feld = Rennvorschau. |
| Klassement | Rennen & Berichte | Status **abgeschlossen** + Zielposition → erscheint im Klassement. Startplatz eintragen für die Plätze-Grafik. Bericht-Feld = Rennbericht (Klick auf das Rennen öffnet ihn). |
| News | News | Mit „Zugehöriges Rennen“ (Kennung des Rennens) werden News und Rennbericht verlinkt. |
| Garage | Garage | Livery-Bilder im Querformat 3:2. |
| Shop | Shop | Status „Coming soon/Verfügbar/Ausverkauft“, optional Preis und Shop-Link (sonst Anfrage per E-Mail). |
| Partner | Partner | Helles Logo auf transparentem Hintergrund. |
| Links, Open Seat | Einstellungen | Discord, E-Mail, Socials, Open Seat ein/aus. |

**Eigene Werkzeuge** (Buttons unten links im Admin, gleiche GitHub-Anmeldung):

| Werkzeug | Wofür |
|---|---|
| `/admin/rennbericht` | Teamrennen aus Garage 61 auswerten und als News-Entwurf öffnen. |
| `/admin/streckenkarte` | Anpassung der Streckenkarte im Telemetrie-Vergleich, pro Strecke. **Linie korrigieren:** Liegen die iRacing-Koordinaten gedreht oder verschoben neben der echten Strecke (Le Mans ca. 2°), mit zwei bis drei Passpunkten (Punkt auf der Linie → richtige Stelle auf dem Luftbild) Verschiebung, Drehung und Maßstab korrigieren; gilt für alle Runden der Strecke. **Kurvennamen:** Stelle auf der Linie anklicken und Namen eingeben (gespeichert als Position auf der Runde); im Vergleich heißt die nächstgelegene erkannte Kurve dann z. B. „Mulsanne (K4)“. **Hintergrund** (wenn das heutige Luftbild nicht passt): **Luftbild-Archiv:** einen früheren Stand des Esri-Luftbilds (Wayback) wählen, passt ohne Ausrichten; angeboten werden nur Stände, in denen sich entlang der Strecke etwas geändert hat. **Eigenes Bild:** Bild (Streckenplan, älteres Luftbild, Screenshot; PNG, JPG, WebP oder SVG, bei iRacing-Karten alle SVG-Ebenen zusammen auswählen) hochladen und über die schnellste Team-Runde legen (rotes Quadrat = verschieben, weißer Punkt = drehen/vergrößern). Speichern legt das Bild unter `img/trackmaps/<Strecken-ID>.webp` und die Lage in `content/trackmaps.json` ab, als ein Commit. Im Teambereich ersetzt die Karte dann das Luftbild für diese Strecke ganz; der Button ▦ wechselt nur noch zum Schema. Nach jedem Speichern startet jeder wieder mit der Streckenkarte. Zur Auswahl stehen die Strecken, die das Team in den letzten 4 Wochen gefahren ist. |

**Referenzrunden** (unten auf `/admin/streckenkarte`): Unser Garage-61-Zugang darf die Telemetrie fremder Fahrer nicht abrufen. Schnelle, öffentlich geteilte Runden lassen sich aber in Garage 61 als CSV exportieren und hier mit Auto, Fahrername und Rundenzeit hochladen. Sie liegen im privaten Vercel-Blob-Speicher (nicht im öffentlichen Repository) und erscheinen im Telemetrie-Vergleich als „★ Referenz“ bei Runde A und B. Hochladen kann auch jedes Teammitglied direkt im Teambereich (Button „★ Referenz importieren“ neben Runde B); entfernen nur Admins hier.

Der **Dateiname** eines Rennens oder Beitrags wird zur eigenen Adresse (`/rennen/spa-24h-2026`, `/news/…`). Neue Einträge bekommen ihn automatisch (Jahr-Monat-Titel). Beim Deploy entsteht für jede Seite eine Vorschaukarte für Discord, WhatsApp & Co. (Bild = Banner bzw. News-Bild).

## Teambereich (/team)

Interner Bereich mit Rangliste, Wochenbericht, Telemetrie und Rennanalyse aus Garage 61. Anmeldung mit Discord: Zugang hat, wer auf unserem Discord-Server ist und eine der freigeschalteten Rollen hat (Teammitglied, VIP).

```
api/discord-login.js      startet die Discord-Anmeldung
api/discord-callback.js   prüft Server und Rolle, setzt das Anmelde-Cookie
api/team/session.js       wer ist angemeldet? / abmelden
api/team/leaderboard.js   Rangliste: Strecken der letzten 4 Wochen, Bestzeiten pro Auto
api/team/weekly.js        Wochenbericht: 8 Wochen aus der Team-Statistik
api/team/telemetry.js     Telemetrie einer Runde, verdichtet auf 4000 Punkte (GPS für die Karte etwa alle 2 m);
                          dazu Referenzrunden fremder Fahrer (CSV-Upload im Admin, privater Speicher)
api/_lib/blob.js          privater Vercel-Blob-Speicher „darkline-referenzrunden“ (BLOB_READ_WRITE_TOKEN)
assets/map-image.js       gedrehtes Kartenbild (eigene Streckenkarten), auch im Admin genutzt
api/team/race.js          Rennbericht (Admin) und Rennanalyse (Teambereich): Sessions am Renntag, Auswertung
                          (Stints, Fahrer, Boxenstopps, Zeitverluste, alle Runden fürs Pace-Diagramm, Wetter)
api/team/preview.js       Vorschau für geteilte Vergleichslinks (/vergleich), Weiterleitung in den Teambereich
api/_lib/session.js       signiertes Cookie (keine Datenbank)
api/_lib/g61.js           Garage-61-Zugriff mit Zwischenspeicher
team.html, assets/team.js Seite
```

Einmalige Einrichtung:
1. Discord Developer Portal → Anwendung des Bots → **OAuth2 → Redirects**: `https://darklineperformance.de/api/discord-callback` eintragen (zum Testen zusätzlich die Vorschau-Adresse von Vercel mit `/api/discord-callback`).
2. In Vercel → Projekt `darkline-site` → Settings → Environment Variables:
   - `DISCORD_CLIENT_ID` = Application ID der Discord-Anwendung
   - `DISCORD_CLIENT_SECRET` = Client Secret (OAuth2-Seite)
   - `DISCORD_GUILD_ID` = Server-ID (Rechtsklick auf den Server → ID kopieren, Entwicklermodus nötig)
   - `DISCORD_ROLE_IDS` = Rollen-IDs mit Zugang, Komma-getrennt (leer = jeder auf dem Server)
   - `SESSION_SECRET` = zufällige Zeichenkette, mindestens 32 Zeichen
   - `GARAGE61_TOKEN` = persönliches Token der Garage-61-Anwendung „Darkline Website“ (eigene Anwendung, damit sich Website und Bestzeiten-Bot kein Anfragelimit teilen)
   - `G61_TEAM_SLUG` = `darkline-performance-motorsport`
3. Neu deployen.

Die Rollen werden bei der Anmeldung geprüft. Wer eine Rolle verliert, bleibt bis zum Ablauf des Cookies (7 Tage) angemeldet.

## Discord-Ankündigungen

Nach jedem Speichern im Admin postet eine GitHub Action (`.github/workflows/discord.yml`, Skript `scripts/discord-notify.js`) automatisch in den Discord-Ankündigungskanal:

- **neue News** (Rennvorschau, Rennbericht, Team …)
- **neues Rennen** mit Status *geplant* → Termin mit Datum, Fahrern und Fahrzeug
- **Rennen auf *abgeschlossen* gesetzt** (mit Zielposition) → Ergebnis mit Start, Ziel und Plätzen

Nur Neues wird gepostet; Korrekturen an bestehenden Einträgen lösen keinen Post aus. Ist eine neue News mit einem Rennen verknüpft, kommt nur die News. Die Action wartet, bis der Eintrag live ist, damit der Link funktioniert.

Einrichtung: in Discord im Kanal → Integrationen → Webhooks einen Webhook anlegen und die URL in GitHub unter Settings → Secrets and variables → Actions als `DISCORD_WEBHOOK_URL` speichern.

Rollen-Ping (z. B. @Community): Rollen-ID in Discord kopieren (Entwicklermodus an → Rechtsklick auf die Rolle → „Rollen-ID kopieren“) und in GitHub unter Settings → Secrets and variables → Actions → **Variables** als `DISCORD_PING_ROLE` speichern. Ohne Variable wird niemand erwähnt.

## Lokal ansehen

```
node scripts/build-content.js
python3 -m http.server 8000
```
Dann `http://localhost:8000` öffnen (direkt per Doppelklick funktioniert es nicht, weil die Inhalte nachgeladen werden).
