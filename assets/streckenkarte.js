// Eigene Streckenkarte im Admin-Bereich (/admin/streckenkarte): ein Bild (Streckenplan, älteres Luftbild …) über die
// schnellste Runde des Teams legen und für den Telemetrie-Vergleich speichern. Gedacht für Strecken, deren iRacing-Version
// älter ist als das heutige Luftbild. Anmeldung mit GitHub wie im CMS; gespeichert wird als ein Commit direkt im
// Repository: Bild unter img/trackmaps/<Strecken-ID>.webp, Lage (drei Ecken) in content/trackmaps.json.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var TOKEN_KEY = "dpm_admin_github";
  var REPO = "Paulekinn/darkline-site", BRANCH = "main", MAPS = "content/trackmaps.json";
  var COLOR = "#d3121b";

  // ---------------------------------------------------------------- Hilfen

  function el(tag, props, children) {
    var n = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) { n[k] = props[k]; });
    [].concat(children || []).forEach(function (c) { n.append(c); });
    return n;
  }

  // kind: true = Fehler, "ok" = erledigt
  function message(target, text, kind) {
    target.replaceChildren(el("p", { className: "msg" + (kind === true ? " err" : kind === "ok" ? " ok" : ""), textContent: text }));
  }

  function fillSelect(sel, options, value) {
    sel.replaceChildren.apply(sel, options.map(function (o) { return el("option", { value: String(o.value), textContent: o.label }); }));
    sel.disabled = !options.length;
    if (value != null) sel.value = String(value);
  }

  function lapTime(s) {
    var m = Math.floor(s / 60);
    return m + ":" + (s - m * 60).toFixed(3).padStart(6, "0");
  }

  // ---------------------------------------------------------------- GitHub-Anmeldung (wie in rennbericht.js und im CMS)

  function storedToken() {
    try {
      var t = sessionStorage.getItem(TOKEN_KEY);
      if (t) return t;
      // Wer im CMS schon angemeldet ist, muss sich hier nicht noch einmal anmelden
      var cms = JSON.parse(localStorage.getItem("sveltia-cms.user") || localStorage.getItem("decap-cms-user") || "null");
      return cms && cms.token ? cms.token : "";
    } catch (e) {
      return "";
    }
  }

  // Gleicher Ablauf wie das CMS: Fenster /api/auth → GitHub → /api/callback schickt den Zugang per postMessage zurück
  function githubLogin() {
    return new Promise(function (resolve, reject) {
      var popup = window.open("/api/auth?provider=github&scope=repo", "github-login", "width=600,height=720");
      if (!popup) return reject(new Error("Das Anmeldefenster wurde blockiert. Bitte Pop-ups für diese Seite erlauben."));
      var onMessage = function (e) {
        if (e.origin !== location.origin || typeof e.data !== "string") return;
        if (e.data === "authorizing:github") { popup.postMessage(e.data, e.origin); return; }
        var m = /^authorization:github:(success|error):([\s\S]*)$/.exec(e.data);
        if (!m) return;
        window.removeEventListener("message", onMessage);
        var content = {};
        try { content = JSON.parse(m[2]); } catch (err) { /* leer lassen */ }
        if (m[1] === "success" && content.token) resolve(content.token);
        else reject(new Error(content.message || "Anmeldung fehlgeschlagen."));
      };
      window.addEventListener("message", onMessage);
    });
  }

  // Teamdaten (Garage 61) über die eigenen Funktionen; sie prüfen den GitHub-Zugang
  function api(path) {
    return fetch(path, { headers: { Authorization: "Bearer " + storedToken() }, cache: "no-store" }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 401 || r.status === 403) {
          try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* egal */ }
          showLogin(d.error);
          throw new Error(d.error || "Nicht angemeldet.");
        }
        if (!r.ok) throw new Error((d.error || "Fehler beim Laden.") + " (Code " + r.status + ")");
        return d;
      });
    });
  }

  function showLogin(error) {
    $("sk-app").hidden = true;
    $("sk-login").hidden = false;
    $("sk-login-error").hidden = !error;
    $("sk-login-error").textContent = error || "";
  }

  $("sk-login-btn").addEventListener("click", function () {
    githubLogin().then(function (token) {
      try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) { /* nur für diese Sitzung nötig */ }
      start();
    }).catch(function (e) { showLogin(e.message); });
  });

  // ---------------------------------------------------------------- Repository: lesen und als ein Commit schreiben

  function gh(path, opts) {
    opts = opts || {};
    return fetch("https://api.github.com/repos/" + REPO + path, {
      method: opts.method || "GET",
      headers: { Authorization: "Bearer " + storedToken(), Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store"
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 404 && opts.allow404) return null;
        if (!r.ok) {
          var err = new Error("GitHub: " + (d.message || "Fehler") + " (Code " + r.status + ")");
          err.status = r.status;
          throw err;
        }
        return d;
      });
    });
  }

  // content/trackmaps.json direkt aus dem Repository: auf der Website fehlt eine Änderung bis zum nächsten Deploy
  function readMaps() {
    return gh("/contents/" + MAPS + "?ref=" + BRANCH, { allow404: true }).then(function (d) {
      if (!d) return {};
      var bytes = Uint8Array.from(atob(d.content.replace(/\n/g, "")), function (c) { return c.charCodeAt(0); });
      return JSON.parse(new TextDecoder().decode(bytes)).maps || {};
    });
  }

  // Mehrere Dateien in einem Commit (ein Deploy). files: { Pfad: { text } | { base64 } | null = löschen }.
  // Hat in der Zwischenzeit jemand anderes gespeichert, lehnt GitHub das Umsetzen von main ab (kein Überschreiben).
  function commit(text, files) {
    var head;
    return gh("/git/ref/heads/" + BRANCH).then(function (ref) {
      head = ref.object.sha;
      return gh("/git/commits/" + head);
    }).then(function (c) {
      return Promise.all(Object.keys(files).map(function (path) {
        var f = files[path];
        if (!f) return { path: path, mode: "100644", type: "blob", sha: null };
        var blob = f.base64 != null ? { content: f.base64, encoding: "base64" } : { content: f.text, encoding: "utf-8" };
        return gh("/git/blobs", { method: "POST", body: blob }).then(function (b) { return { path: path, mode: "100644", type: "blob", sha: b.sha }; });
      })).then(function (tree) {
        return gh("/git/trees", { method: "POST", body: { base_tree: c.tree.sha, tree: tree } });
      });
    }).then(function (t) {
      return gh("/git/commits", { method: "POST", body: { message: text, tree: t.sha, parents: [head] } });
    }).then(function (c) {
      return gh("/git/refs/heads/" + BRANCH, { method: "PATCH", body: { sha: c.sha } }).catch(function (e) {
        if (e.status === 422) throw new Error("Inzwischen hat jemand anderes im Admin gespeichert. Seite neu laden und erneut versuchen.");
        throw e;
      });
    });
  }

  function base64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(",")[1]); };
      r.onerror = function () { reject(new Error("Das Bild konnte nicht gelesen werden.")); };
      r.readAsDataURL(blob);
    });
  }

  // ---------------------------------------------------------------- Lage des Bildes
  // Mitte, Breite in Metern und Drehung im Uhrzeigersinn; gespeichert werden daraus die drei Ecken
  // (oben links, oben rechts, unten links), die L.RotatedImage im Teambereich direkt verwendet.

  var M = 111320; // Meter pro Breitengrad

  function cornersOf(p, aspect) {
    var kx = M * Math.cos(p.lat * Math.PI / 180), r = p.rot * Math.PI / 180, h = p.w * aspect;
    var u = [Math.cos(r), -Math.sin(r)], v = [-Math.sin(r), -Math.cos(r)]; // Bild nach rechts / nach unten, in Metern Ost/Nord
    var at = function (a, b) { return [p.lat + (a * u[1] + b * v[1]) / M, p.lon + (a * u[0] + b * v[0]) / kx]; };
    return [at(-p.w / 2, -h / 2), at(p.w / 2, -h / 2), at(-p.w / 2, h / 2)];
  }

  function placeOf(c) {
    var lat = (c[1][0] + c[2][0]) / 2, lon = (c[1][1] + c[2][1]) / 2; // Mitte der Diagonale oben rechts – unten links
    var kx = M * Math.cos(lat * Math.PI / 180);
    var e = (c[1][1] - c[0][1]) * kx, n = (c[1][0] - c[0][0]) * M; // Oberkante in Metern
    return { lat: lat, lon: lon, w: Math.hypot(e, n), rot: -Math.atan2(n, e) * 180 / Math.PI };
  }

  // ---------------------------------------------------------------- Editor

  var sk = { tracks: [], maps: {}, track: null, map: null, image: null, place: null, overlay: null };

  var trackName = function (t) { return t.name + (t.variant ? " (" + t.variant + ")" : ""); };

  function start() {
    $("sk-login").hidden = true;
    $("sk-app").hidden = false;
    message($("sk-status"), "Lade Strecken …");
    Promise.all([api("/api/team/leaderboard"), readMaps()]).then(function (r) {
      sk.tracks = r[0].tracks;
      sk.maps = r[1];
      fillTracks("");
      $("sk-track").onchange = function () { if (this.value) pickTrack(this.value); };
      message($("sk-status"), "Strecke wählen. Als Referenz wird die schnellste Runde des Teams mit freigegebener Telemetrie geladen.");
    }).catch(function (e) { message($("sk-status"), e.message, true); });
  }

  function fillTracks(value) {
    fillSelect($("sk-track"), [{ value: "", label: "Strecke wählen …" }].concat(sk.tracks.map(function (t) {
      return { value: t.id, label: trackName(t) + (sk.maps[t.id] ? " · eigene Karte ✓" : "") };
    })), value);
  }

  function pickTrack(id) {
    sk.track = sk.tracks.filter(function (t) { return String(t.id) === id; })[0];
    sk.image = sk.place = null;
    if (sk.overlay) sk.overlay.remove();
    $("sk-file").value = "";
    $("sk-file-info").textContent = "";
    $("sk-lap").textContent = "";
    message($("sk-status"), "Lade die schnellste Runde …");
    api("/api/team/leaderboard?track=" + encodeURIComponent(id)).then(function (d) {
      var laps = [];
      d.cars.forEach(function (c) { c.laps.forEach(function (l) { if (l.telemetry) laps.push({ lap: l, car: c.name }); }); });
      if (!laps.length) throw new Error("Auf dieser Strecke teilt niemand aus dem Team seine Telemetrie. Ohne Runde lässt sich die Karte nicht ausrichten.");
      var best = laps.sort(function (a, b) { return a.lap.time - b.lap.time; })[0];
      $("sk-lap").textContent = "Referenz: " + best.lap.driver + " · " + best.car + " · " + lapTime(best.lap.time);
      return api("/api/team/telemetry?lap=" + encodeURIComponent(best.lap.id));
    }).then(function (lap) {
      if (sk.track !== sk.tracks.filter(function (t) { return String(t.id) === id; })[0]) return; // inzwischen andere Strecke
      $("sk-status").replaceChildren();
      showLap(lap);
      loadExisting();
    }).catch(function (e) { $("sk-work").hidden = true; message($("sk-status"), e.message, true); });
  }

  function initMap() {
    var map = sk.map = L.map("sk-map", { maxZoom: 21, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 120 });
    map.attributionControl.setPrefix(false);
    sk.photo = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxNativeZoom: 19, maxZoom: 21, attribution: "Luftbild: Esri, Maxar, Earthstar Geographics"
    });
    // Referenzrunde über dem Bild, mit dunklem Rand wie im Teambereich
    sk.line = [L.polyline([], { color: "#050606", weight: 5, opacity: 0.75, interactive: false }),
      L.polyline([], { color: COLOR, weight: 2.5, interactive: false })];
    sk.start = L.circleMarker([0, 0], { radius: 4, stroke: false, fillColor: "#ffd400", fillOpacity: 1, interactive: false });
    var handle = function (cls, title) {
      return L.marker([0, 0], { draggable: true, title: title, zIndexOffset: 1000, icon: L.divIcon({ className: "sk-handle" + cls, iconSize: null }) });
    };
    sk.move = handle("", "Bild verschieben");
    sk.turn = handle(" rot", "Bild drehen und vergrößern");
    sk.move.on("drag", function (e) {
      sk.place.lat = e.latlng.lat;
      sk.place.lon = e.latlng.lng;
      refresh(sk.move);
    });
    // Griff auf halbem Weg zur Ecke oben rechts (bleibt auch bei großen Bildern im Ausschnitt):
    // Abstand zur Mitte = Größe, Richtung = Drehung (Seitenverhältnis bleibt)
    sk.turn.on("drag", function (e) {
      var p = sk.place, a = sk.image.aspect;
      var de = (e.latlng.lng - p.lon) * M * Math.cos(p.lat * Math.PI / 180), dn = (e.latlng.lat - p.lat) * M;
      p.w = Math.max(10, 4 * Math.hypot(de, dn) / Math.hypot(1, a));
      p.rot = (Math.atan2(a, 1) - Math.atan2(dn, de)) * 180 / Math.PI;
      p.rot = ((p.rot + 540) % 360) - 180;
      refresh(sk.turn);
    });
    $("sk-photo").onchange = function () { this.checked ? sk.photo.addTo(map) : sk.photo.remove(); };
    $("sk-opacity").oninput = function () { if (sk.overlay) sk.overlay.setOpacity(+this.value); };
    $("sk-rot").onchange = function () { if (sk.place && this.value !== "") { sk.place.rot = +this.value; refresh(); } };
    $("sk-width").onchange = function () { if (sk.place && +this.value >= 10) { sk.place.w = +this.value; refresh(); } };
  }

  function showLap(lap) {
    $("sk-work").hidden = false;
    if (!sk.map) initMap();
    sk.map.invalidateSize();
    var pts = lap.points.lat.map(function (v, j) { return [v, lap.points.lon[j]]; });
    sk.line.forEach(function (l) { l.setLatLngs(pts).addTo(sk.map); });
    sk.start.setLatLng(pts[0]).addTo(sk.map);
    sk.bounds = L.latLngBounds(pts);
    sk.map.fitBounds(sk.bounds, { padding: [30, 30], animate: false });
    [sk.move, sk.turn].forEach(function (h) { h.remove(); });
    controls(false);
  }

  // Vorhandene Karte dieser Strecke zum Weiterbearbeiten laden
  function loadExisting() {
    var saved = sk.maps[sk.track.id];
    $("sk-delete").hidden = !saved;
    if (!saved) {
      $("sk-file-info").textContent = "Für diese Strecke gibt es noch keine eigene Karte.";
      return;
    }
    var img = new Image();
    img.onload = function () {
      sk.image = { url: saved.image, aspect: img.naturalHeight / img.naturalWidth, blob: null };
      sk.place = placeOf(saved.corners);
      $("sk-file-info").textContent = "Gespeicherte Karte vom " + (saved.updated ? new Date(saved.updated).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "–") + ". Neues Bild wählen, um sie zu ersetzen.";
      showOverlay();
    };
    img.onerror = function () {
      $("sk-file-info").textContent = "Die gespeicherte Karte ist noch nicht online (Deploy läuft?) oder fehlt. Neues Bild wählen oder später neu laden.";
    };
    img.src = saved.image;
  }

  // Bild verkleinern (längste Seite höchstens 4000 px) und als WebP ablegen, damit der Teambereich schnell lädt
  function readImage(file) {
    return new Promise(function (resolve, reject) {
      var src = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var s = Math.min(1, 4000 / Math.max(img.naturalWidth, img.naturalHeight));
        var cv = el("canvas", { width: Math.round(img.naturalWidth * s), height: Math.round(img.naturalHeight * s) });
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(src);
        // Browser ohne WebP-Export liefern PNG
        cv.toBlob(function (blob) {
          if (!blob) return reject(new Error("Das Bild konnte nicht umgewandelt werden."));
          resolve({ url: URL.createObjectURL(blob), blob: blob, aspect: cv.height / cv.width, w: cv.width, h: cv.height });
        }, "image/webp", 0.88);
      };
      img.onerror = function () { URL.revokeObjectURL(src); reject(new Error("Die Datei ist kein lesbares Bild.")); };
      img.src = src;
    });
  }

  $("sk-file").addEventListener("change", function () {
    var f = this.files[0];
    if (!f || !sk.track) return;
    readImage(f).then(function (img) {
      var aspect = sk.image ? sk.image.aspect : null;
      sk.image = img;
      $("sk-file-info").textContent = f.name + " · " + img.w + " × " + img.h + " px · " + Math.round(img.blob.size / 1024) + " KB";
      // Neue Strecke oder anderes Seitenverhältnis: Bild über die ganze Runde legen, sonst die bisherige Lage behalten
      if (!sk.place || Math.abs(aspect - img.aspect) > 0.01) sk.place = fitPlace(img.aspect);
      showOverlay();
    }).catch(function (e) { $("sk-file-info").textContent = e.message; });
  });

  // Bild etwas größer als die Runde, mittig, nicht gedreht
  function fitPlace(aspect) {
    var b = sk.bounds, c = b.getCenter(), kx = M * Math.cos(c.lat * Math.PI / 180);
    var w = (b.getEast() - b.getWest()) * kx, h = (b.getNorth() - b.getSouth()) * M;
    return { lat: c.lat, lon: c.lng, w: Math.max(w, h / aspect) * 1.15, rot: 0 };
  }

  function showOverlay() {
    if (sk.overlay) sk.overlay.remove();
    sk.overlay = new L.RotatedImage(sk.image.url, cornersOf(sk.place, sk.image.aspect), { opacity: +$("sk-opacity").value }).addTo(sk.map);
    sk.move.addTo(sk.map);
    sk.turn.addTo(sk.map);
    controls(true);
    refresh();
  }

  // Bild, Ziehpunkte und Eingabefelder auf die aktuelle Lage setzen (den gerade gezogenen Punkt nicht)
  function refresh(dragging) {
    var c = cornersOf(sk.place, sk.image.aspect);
    sk.overlay.setCorners(c);
    if (dragging !== sk.move) sk.move.setLatLng([sk.place.lat, sk.place.lon]);
    if (dragging !== sk.turn) sk.turn.setLatLng([(sk.place.lat + c[1][0]) / 2, (sk.place.lon + c[1][1]) / 2]);
    if (document.activeElement !== $("sk-rot")) $("sk-rot").value = sk.place.rot.toFixed(1);
    if (document.activeElement !== $("sk-width")) $("sk-width").value = Math.round(sk.place.w);
  }

  function controls(on) {
    ["sk-rot", "sk-width", "sk-save"].forEach(function (id) { $(id).disabled = !on; });
  }

  $("sk-save").addEventListener("click", function () {
    var t = sk.track, id = String(t.id), old = sk.maps[id];
    var path = sk.image.blob ? "img/trackmaps/" + id + "." + (sk.image.blob.type === "image/webp" ? "webp" : "png") : old.image.replace(/^\//, "");
    var maps = JSON.parse(JSON.stringify(sk.maps));
    var round = function (p) { return [+p[0].toFixed(7), +p[1].toFixed(7)]; };
    maps[id] = { name: trackName(t), image: "/" + path, corners: cornersOf(sk.place, sk.image.aspect).map(round), updated: new Date().toISOString().slice(0, 19) + "Z" };
    var files = {};
    files[MAPS] = { text: JSON.stringify({ maps: maps }, null, 2) + "\n" };
    // altes Bild mit anderer Endung (webp ↔ png) nicht liegen lassen
    if (sk.image.blob && old && old.image.replace(/^\//, "") !== path) files[old.image.replace(/^\//, "")] = null;
    controls(false);
    message($("sk-status"), "Speichere …");
    (sk.image.blob ? base64(sk.image.blob) : Promise.resolve(null)).then(function (data) {
      if (data) files[path] = { base64: data };
      return commit("Admin: Streckenkarte " + trackName(t), files);
    }).then(function () {
      sk.maps = maps;
      sk.image.blob = null; // gespeichert; bei weiteren Änderungen nur noch die Lage
      fillTracks(id);
      $("sk-delete").hidden = false;
      message($("sk-status"), "Gespeichert. In etwa einer Minute ist die Karte für " + trackName(t) + " im Teambereich zu sehen.", "ok");
    }).catch(function (e) {
      message($("sk-status"), e.message, true);
    }).then(function () { controls(true); });
  });

  $("sk-delete").addEventListener("click", function () {
    var t = sk.track, id = String(t.id), old = sk.maps[id];
    if (!old || !window.confirm("Eigene Karte für " + trackName(t) + " entfernen? Im Teambereich gibt es dann wieder nur Luftbild und Schema.")) return;
    var maps = JSON.parse(JSON.stringify(sk.maps));
    delete maps[id];
    var files = {};
    files[MAPS] = { text: JSON.stringify({ maps: maps }, null, 2) + "\n" };
    files[old.image.replace(/^\//, "")] = null;
    message($("sk-status"), "Entferne …");
    commit("Admin: Streckenkarte " + trackName(t) + " entfernt", files).then(function () {
      sk.maps = maps;
      fillTracks(id);
      sk.image = sk.place = null;
      [sk.overlay, sk.move, sk.turn].forEach(function (l) { if (l) l.remove(); });
      controls(false);
      $("sk-delete").hidden = true;
      $("sk-file").value = "";
      $("sk-file-info").textContent = "Für diese Strecke gibt es noch keine eigene Karte.";
      message($("sk-status"), "Entfernt. In etwa einer Minute ist die Änderung im Teambereich zu sehen.", "ok");
    }).catch(function (e) { message($("sk-status"), e.message, true); });
  });

  // Start: mit gemerkter Anmeldung direkt los, sonst Anmeldeknopf
  if (storedToken()) start(); else showLogin();
})();
