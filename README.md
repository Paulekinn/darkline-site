# Darkline Performance Motorsport – Teamseite

Statische Website ohne Build-Schritt. Alle Inhalte (Fahrer, Rennen mit Berichten, News, Garage, Links) liegen als JSON-Dateien im Ordner `content/` und werden über den Admin-Bereich unter `/admin` gepflegt.

```
index.html          Seite
assets/site.css     Design
assets/site.js      lädt content/*.json und baut die Seite auf
content/            drivers.json · races.json · news.json · cars.json · settings.json
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

1. Erledigt: Vercel-Projekt `darkline-site` ist mit dem Repo verbunden, jeder Push auf `main` geht live (https://darkline-site.vercel.app).
2. Framework Preset: **Other**. Build Command und Output Directory leer lassen.
3. Deploy.
4. Domain umziehen: Im **alten** Vercel-Projekt unter Settings → Domains `darklineperformance.de` (und `www.`) entfernen, dann im **neuen** Projekt hinzufügen.

> Impressum und Datenschutz liegen als `impressum.html` und `datenschutz.html` im Repo. Bei neuen Funktionen (Analytics, Einbettungen, Formulare) die Datenschutzerklärung anpassen.

## 3. Admin-Bereich benutzen

Aufruf: `https://www.darklineperformance.de/admin`

**Anmeldung per Token (ohne zusätzlichen Server):**

1. Jede Person, die pflegen soll, muss Mitglied (Collaborator) im GitHub-Repo sein.
2. Auf GitHub: Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
   - Repository access: *Only select repositories* → `darkline-site`
   - Permissions → Repository permissions → **Contents: Read and write**
3. Im Admin **„Mit Zugriffstoken anmelden“** wählen und den Token einfügen. (Der Button „Mit GitHub anmelden“ funktioniert erst mit dem optionalen OAuth-Helfer unten.)

Optional bequemer („Login with GitHub“-Button): einen OAuth-Helfer wie `sveltia-cms-auth` (Cloudflare Worker) einrichten und dessen Adresse als `base_url` unter `backend` in `admin/config.yml` eintragen.

**Ablauf:** Inhalt ändern → Speichern. Das CMS macht daraus einen Commit, Vercel veröffentlicht automatisch. Nach ca. 30–60 Sekunden ist die Änderung live.

## Was wo gepflegt wird

| Bereich | Admin-Menü | Hinweise |
|---|---|---|
| Nennliste | Fahrer | Status *aktiv/inaktiv*. Starts und bestes Ergebnis rechnet die Seite selbst aus den Rennen aus – dafür den Namen exakt gleich schreiben. |
| Kalender | Rennen & Berichte | Status **geplant** → erscheint im Kalender und als „Nächstes Rennen“ oben. Bericht-Feld = Rennvorschau. |
| Klassement | Rennen & Berichte | Status **abgeschlossen** + Zielposition → erscheint im Klassement. Startplatz eintragen für die Plätze-Grafik. Bericht-Feld = Rennbericht (Klick auf das Rennen öffnet ihn). |
| News | News | Mit „Zugehöriges Rennen“ (Kennung des Rennens) werden News und Rennbericht verlinkt. |
| Garage | Garage | Livery-Bilder im Querformat 3:2. |
| Links, Open Seat | Einstellungen | Discord, E-Mail, Socials, Open Seat ein/aus. |

Die **Kennung** eines Rennens oder Beitrags wird Teil des Links (`/#rennen-spa-24h-2026`, `/#news-…`) und sollte nach dem Veröffentlichen nicht mehr geändert werden.

## Lokal ansehen

```
python3 -m http.server 8000
```
Dann `http://localhost:8000` öffnen (direkt per Doppelklick funktioniert es nicht, weil die Inhalte nachgeladen werden).
