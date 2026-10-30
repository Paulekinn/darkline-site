// Eigene Streckenkarte im Admin-Bereich (/admin/streckenkarte) für Strecken, deren iRacing-Version älter ist als das
// heutige Luftbild: entweder einen früheren Stand des Esri-Luftbilds (Wayback) wählen oder ein eigenes Bild (Streckenplan,
// SVG, Screenshot) über die schnellste Runde des Teams legen. Anmeldung mit GitHub wie im CMS; gespeichert wird als ein
// Commit direkt im Repository: content/trackmaps.json (Archivstand bzw. Lage des Bildes), Bilder unter img/trackmaps/.
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

  // source: "photo" (aktuelles Luftbild), "wayback" (Archiv-Luftbild) oder "image" (eigenes Bild);
  // wbList/wbPick: Archivstände der Strecke und die Auswahl; pairs: Passpunkte [[von, nach], …] zur Korrektur der Linie
  var sk = { tracks: [], maps: {}, track: null, map: null, image: null, place: null, overlay: null,
    source: null, lapPts: null, wbList: null, wbPick: null, wbLayer: null, busy: false, pairs: [], picking: null };

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
      return { value: t.id, label: trackName(t) + (sk.maps[t.id] ? " · angepasst ✓" : "") };
    })), value);
  }

  function pickTrack(id) {
    sk.track = sk.tracks.filter(function (t) { return String(t.id) === id; })[0];
    sk.image = sk.place = sk.wbList = sk.wbPick = null;
    sk.pairs = [];
    setPicking(null);
    [sk.overlay, sk.wbLayer].forEach(function (l) { if (l) l.remove(); });
    sk.overlay = sk.wbLayer = null;
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
    $("sk-photo").onchange = showPhoto;
    sk.pins = L.layerGroup().addTo(map);
    map.on("click", pickPoint);
    $("sk-opacity").oninput = function () { if (sk.overlay) sk.overlay.setOpacity(+this.value); };
    $("sk-rot").onchange = function () { if (sk.place && this.value !== "") { sk.place.rot = +this.value; refresh(); } };
    $("sk-width").onchange = function () { if (sk.place && +this.value >= 10) { sk.place.w = +this.value; refresh(); } };
  }

  function showLap(lap) {
    $("sk-work").hidden = false;
    if (!sk.map) initMap();
    sk.map.invalidateSize();
    // Rohdaten von iRacing; angezeigt wird die Linie mit der Korrektur aus den Passpunkten
    var pts = sk.lapPts = lap.points.lat.map(function (v, j) { return [v, lap.points.lon[j]]; });
    sk.line.forEach(function (l) { l.addTo(sk.map); });
    sk.start.addTo(sk.map);
    sk.bounds = L.latLngBounds(pts);
    sk.map.fitBounds(sk.bounds, { padding: [30, 30], animate: false });
    [sk.move, sk.turn].forEach(function (h) { h.remove(); });
    drawLine();
    controls();
  }

  // Vorhandene Anpassung dieser Strecke zum Weiterbearbeiten laden; ohne Anpassung mit dem aktuellen Luftbild beginnen
  function loadExisting() {
    var saved = sk.maps[sk.track.id];
    $("sk-delete").hidden = !saved;
    $("sk-file-info").textContent = "";
    sk.pairs = saved && saved.fix ? saved.fix.pairs.slice() : [];
    drawLine();
    if (!saved || !(saved.wayback || saved.image)) return setSource("photo");
    if (saved.wayback) return setSource("wayback", saved.wayback.release);
    setSource("image");
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

  var MAX = 4000; // längste Bildseite in Pixeln

  // Eine Datei als Bild laden. SVG wird in voller Größe (längste Seite MAX) gezeichnet, damit die Karte auch im Zoom scharf ist;
  // dafür bekommt sie Breite und Höhe aus der viewBox.
  function loadOne(file) {
    var svg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
    var source = svg ? file.text().then(function (text) {
      var doc = new DOMParser().parseFromString(text, "image/svg+xml"), root = doc.documentElement;
      if (root.nodeName.toLowerCase() !== "svg") throw new Error(file.name + " ist keine lesbare SVG-Datei.");
      var vb = (root.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
      var w = vb.length === 4 ? vb[2] : parseFloat(root.getAttribute("width")), h = vb.length === 4 ? vb[3] : parseFloat(root.getAttribute("height"));
      if (!(w > 0 && h > 0)) throw new Error(file.name + " hat keine Größenangabe (viewBox).");
      var s = MAX / Math.max(w, h);
      root.setAttribute("width", Math.round(w * s));
      root.setAttribute("height", Math.round(h * s));
      return new Blob([new XMLSerializer().serializeToString(doc)], { type: "image/svg+xml" });
    }) : Promise.resolve(file);
    return source.then(function (blob) {
      return new Promise(function (resolve, reject) {
        var src = URL.createObjectURL(blob), img = new Image();
        img.onload = function () { URL.revokeObjectURL(src); resolve(img); };
        img.onerror = function () { URL.revokeObjectURL(src); reject(new Error(file.name + " ist kein lesbares Bild.")); };
        img.src = src;
      });
    });
  }

  // Ebenen einer iRacing-Streckenkarte (track/assets) in dieser Reihenfolge übereinander, unbekannte Dateien danach
  var LAYERS = ["background", "inactive", "active", "pitroad", "start-finish", "turns"];
  var layerRank = function (f) { var i = LAYERS.indexOf(f.name.replace(/\.[^.]+$/, "").toLowerCase()); return i === -1 ? LAYERS.length : i; };

  // Eine oder mehrere Dateien zu einem Bild zusammenlegen (alle auf die Größe der ersten), höchstens MAX Pixel,
  // als WebP ablegen, damit der Teambereich schnell lädt. Transparenz bleibt erhalten.
  function readImage(files) {
    files = files.slice().sort(function (a, b) { return layerRank(a) - layerRank(b); });
    return Promise.all(files.map(loadOne)).then(function (imgs) {
      var s = Math.min(1, MAX / Math.max(imgs[0].naturalWidth, imgs[0].naturalHeight));
      var cv = el("canvas", { width: Math.round(imgs[0].naturalWidth * s), height: Math.round(imgs[0].naturalHeight * s) });
      var g = cv.getContext("2d");
      imgs.forEach(function (img) { g.drawImage(img, 0, 0, cv.width, cv.height); });
      return new Promise(function (resolve, reject) {
        // Browser ohne WebP-Export liefern PNG
        cv.toBlob(function (blob) {
          if (!blob) return reject(new Error("Das Bild konnte nicht umgewandelt werden."));
          resolve({ url: URL.createObjectURL(blob), blob: blob, aspect: cv.height / cv.width, w: cv.width, h: cv.height,
            names: files.map(function (f) { return f.name; }) });
        }, "image/webp", 0.88);
      });
    });
  }

  $("sk-file").addEventListener("change", function () {
    var files = [].slice.call(this.files);
    if (!files.length || !sk.track) return;
    $("sk-file-info").textContent = "Lese " + files.length + (files.length === 1 ? " Datei …" : " Dateien …");
    readImage(files).then(function (img) {
      var aspect = sk.image ? sk.image.aspect : null;
      sk.image = img;
      $("sk-file-info").textContent = img.names.join(" + ") + " · " + img.w + " × " + img.h + " px · " + Math.round(img.blob.size / 1024) + " KB";
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
    controls();
    refresh();
  }

  // ---------------------------------------------------------------- Quelle: Luftbild-Archiv oder eigenes Bild

  function setSource(src, release) {
    sk.source = src;
    document.querySelectorAll("[name=sk-source]").forEach(function (r) { r.checked = r.value === src; });
    $("sk-src-wayback").hidden = src !== "wayback";
    $("sk-src-image").hidden = src !== "image";
    // Bild und Ziehpunkte nur bei eigenem Bild, Archiv-Luftbild nur bei Archiv
    [sk.overlay, sk.overlay && sk.move, sk.overlay && sk.turn].forEach(function (l) { if (l) src === "image" ? l.addTo(sk.map) : l.remove(); });
    if (sk.wbLayer) src === "wayback" ? sk.wbLayer.addTo(sk.map) : sk.wbLayer.remove();
    if (src === "wayback") loadWayback(release);
    showPhoto();
    controls();
  }

  // Aktuelles Luftbild: als Hintergrund, beim eigenen Bild auf Wunsch darunter
  function showPhoto() {
    var on = sk.source === "photo" || (sk.source === "image" && $("sk-photo").checked);
    if (sk.map) on ? sk.photo.addTo(sk.map) : sk.photo.remove();
  }

  // ---------------------------------------------------------------- Linie korrigieren (Passpunkte)

  // Referenzrunde mit der Korrektur aus den Passpunkten zeichnen, dazu die Zielpunkte als nummerierte Marken
  function drawLine() {
    if (!sk.map || !sk.lapPts) return;
    var fix = L.dpmFix(sk.pairs);
    var pts = fix ? sk.lapPts.map(function (p) { return fix(p[0], p[1]); }) : sk.lapPts;
    sk.shown = pts;
    sk.line.forEach(function (l) { l.setLatLngs(pts); });
    sk.start.setLatLng(pts[0]);
    sk.pins.clearLayers();
    sk.pairs.forEach(function (p, i) {
      sk.pins.addLayer(L.marker(p[1], { interactive: false, keyboard: false, icon: L.divIcon({ className: "sk-pin", html: String(i + 1), iconSize: null }) }));
    });
    var m = function (v) { return Math.round(v).toLocaleString("de-DE") + " m"; };
    $("sk-fix-info").textContent = sk.picking === "from" ? "Jetzt einen Punkt auf der roten Linie anklicken."
      : sk.picking === "to" ? "Jetzt die Stelle auf dem Luftbild anklicken, an die dieser Punkt gehört."
      : !fix ? "Keine Korrektur."
      : sk.pairs.length + " Passpunkt" + (sk.pairs.length === 1 ? " (nur verschieben)" : "e") + ": verschoben um " + m(fix.shift) +
        (sk.pairs.length > 1 ? ", gedreht um " + fix.rot.toFixed(2).replace(".", ",") + "°, Maßstab " + (fix.scale * 100).toFixed(2).replace(".", ",") + " %" : "") + ".";
    controls();
  }

  // null = aus, "from" = Punkt auf der Linie wählen, "to" = Zielstelle wählen
  function setPicking(state) {
    sk.picking = state;
    $("sk-map").classList.toggle("picking", !!state);
    $("sk-fix-add").textContent = state ? "Abbrechen" : "Passpunkt setzen";
    // Beim Klicken auf Passpunkte das Bild nicht versehentlich verschieben
    [sk.move, sk.turn].forEach(function (h) { if (h && h.dragging) state ? h.dragging.disable() : h.dragging.enable(); });
    drawLine();
  }

  function pickPoint(e) {
    if (sk.picking === "from") {
      // nächster Punkt der angezeigten Linie; gespeichert wird der zugehörige Rohpunkt von iRacing
      var best = -1, dist = Infinity, c = sk.map.latLngToContainerPoint(e.latlng);
      sk.shown.forEach(function (p, j) { var d = sk.map.latLngToContainerPoint(p).distanceTo(c); if (d < dist) { dist = d; best = j; } });
      if (dist > 25) return; // zu weit von der Linie weg
      sk.from = sk.lapPts[best];
      setPicking("to");
    } else if (sk.picking === "to") {
      var r = function (v) { return +v.toFixed(7); };
      sk.pairs.push([[r(sk.from[0]), r(sk.from[1])], [r(e.latlng.lat), r(e.latlng.lng)]]);
      setPicking(null);
    }
  }

  $("sk-fix-add").addEventListener("click", function () { setPicking(sk.picking ? null : "from"); });
  $("sk-fix-undo").addEventListener("click", function () { sk.pairs.pop(); drawLine(); });

  document.querySelectorAll("[name=sk-source]").forEach(function (r) {
    r.addEventListener("change", function () { if (this.checked && sk.track) setSource(this.value); });
  });

  // Esri Wayback: Liste aller Archivstände (Nummer + Datum), neueste zuerst
  var WB_CONFIG = "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json";
  var WB_TILEMAP = "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tilemap/";
  var wbAll = null;
  function waybackReleases() {
    if (!wbAll) {
      wbAll = fetch(WB_CONFIG).then(function (r) { return r.json(); }).then(function (c) {
        return Object.keys(c).map(function (id) { var m = /(\d{4}-\d{2}-\d{2})/.exec(c[id].itemTitle || ""); return { id: +id, date: m ? m[1] : "" }; })
          .filter(function (r) { return r.date; }).sort(function (a, b) { return b.date.localeCompare(a.date); });
      });
      wbAll.catch(function () { wbAll = null; });
    }
    return wbAll;
  }

  // Kachel (x, y) einer Koordinate in Zoomstufe z
  function tileOf(lat, lon, z) {
    var n = Math.pow(2, z), r = lat * Math.PI / 180;
    return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)];
  }

  // Archivstände, in denen sich entlang der Strecke etwas geändert hat. Für einige Kacheln entlang der Runde nennt die
  // Tilemap, aus welchem Stand die Kachel stammt; von dort zum nächstälteren Stand springen, bis keine Aufnahme mehr kommt.
  function changedReleases(pts) {
    return waybackReleases().then(function (all) {
      var z = 15, tiles = {}, found = {};
      for (var k = 0; k < 10; k++) { var p = pts[Math.floor(k * pts.length / 10)], t = tileOf(p[0], p[1], z); tiles[t.join("/")] = t; }
      var index = {};
      all.forEach(function (r, i) { index[r.id] = i; });
      return Promise.all(Object.keys(tiles).map(function (key) {
        var walk = function (i, steps) {
          if (i >= all.length || steps > 60) return null;
          return fetch(WB_TILEMAP + all[i].id + "/" + z + "/" + tiles[key][1] + "/" + tiles[key][0]).then(function (r) { return r.json(); }).then(function (d) {
            if (!d.data || !d.data[0]) return null; // ab hier keine Aufnahme mehr
            var src = d.select && d.select[0] ? d.select[0] : all[i].id;
            found[src] = true;
            return walk(Math.max(i, index[src] != null ? index[src] : i) + 1, steps + 1);
          });
        };
        return walk(0, 0);
      })).then(function () { return all.filter(function (r) { return found[r.id]; }); });
    });
  }

  var germanDate = function (iso) { return iso.split("-").reverse().join("."); };

  // Archivstände der Strecke suchen (einmal pro Strecke) und einen anzeigen: den gespeicherten oder den neuesten
  function loadWayback(release) {
    if (sk.wbList) return pickRelease(release || (sk.wbPick && sk.wbPick.id));
    var track = sk.track;
    $("sk-wb").disabled = true;
    $("sk-wb-info").textContent = "Suche Archivstände entlang der Strecke …";
    changedReleases(sk.lapPts).then(function (list) {
      if (sk.track !== track) return; // inzwischen andere Strecke
      sk.wbList = list;
      if (!list.length) { $("sk-wb-info").textContent = "Für diese Strecke gibt es keine Archivstände."; return; }
      fillSelect($("sk-wb"), list.map(function (r) { return { value: r.id, label: germanDate(r.date) }; }));
      pickRelease(release);
    }).catch(function () {
      $("sk-wb-info").textContent = "Das Luftbild-Archiv ist gerade nicht erreichbar. Später erneut versuchen.";
    });
  }

  function pickRelease(id) {
    var list = sk.wbList || [];
    var i = Math.max(0, list.findIndex(function (r) { return r.id === +id; }));
    var r = sk.wbPick = list[i];
    if (!r) return controls();
    $("sk-wb").value = String(r.id);
    $("sk-wb-prev").disabled = i === 0;
    $("sk-wb-next").disabled = i === list.length - 1;
    $("sk-wb-info").textContent = "Archivstand vom " + germanDate(r.date) + " · " + (i + 1) + " von " + list.length +
      ". Das Datum ist das des Archivs; die Aufnahme selbst kann älter sein.";
    if (sk.wbLayer) sk.wbLayer.remove();
    sk.wbLayer = L.dpmWayback(r.id, r.date);
    if (sk.source === "wayback") sk.wbLayer.addTo(sk.map);
    controls();
  }

  $("sk-wb").addEventListener("change", function () { pickRelease(this.value); });
  var stepRelease = function (d) {
    var list = sk.wbList || [], i = list.indexOf(sk.wbPick) + d;
    if (list[i]) pickRelease(list[i].id);
  };
  $("sk-wb-prev").addEventListener("click", function () { stepRelease(-1); });
  $("sk-wb-next").addEventListener("click", function () { stepRelease(1); });

  // Bild, Ziehpunkte und Eingabefelder auf die aktuelle Lage setzen (den gerade gezogenen Punkt nicht)
  function refresh(dragging) {
    var c = cornersOf(sk.place, sk.image.aspect);
    sk.overlay.setCorners(c);
    if (dragging !== sk.move) sk.move.setLatLng([sk.place.lat, sk.place.lon]);
    if (dragging !== sk.turn) sk.turn.setLatLng([(sk.place.lat + c[1][0]) / 2, (sk.place.lon + c[1][1]) / 2]);
    if (document.activeElement !== $("sk-rot")) $("sk-rot").value = sk.place.rot.toFixed(1);
    if (document.activeElement !== $("sk-width")) $("sk-width").value = Math.round(sk.place.w);
  }

  // Eingabefelder und Speichern je nach Quelle und Stand freigeben
  function controls() {
    var image = sk.source === "image" && !!sk.overlay;
    $("sk-rot").disabled = $("sk-width").disabled = !image;
    // Speichern braucht einen fertigen Hintergrund; beim aktuellen Luftbild mindestens einen Passpunkt
    var ready = sk.source === "image" ? image : sk.source === "wayback" ? !!sk.wbPick : sk.pairs.length > 0;
    $("sk-save").disabled = sk.busy || !!sk.picking || !ready;
    $("sk-fix-add").disabled = sk.busy || !sk.lapPts;
    $("sk-fix-undo").disabled = sk.busy || !!sk.picking || !sk.pairs.length;
  }

  var imagePath = function (m) { return m && m.image ? m.image.replace(/^\//, "") : null; };

  $("sk-save").addEventListener("click", function () {
    var t = sk.track, id = String(t.id), old = sk.maps[id], oldPath = imagePath(old);
    var maps = JSON.parse(JSON.stringify(sk.maps));
    var files = {}, path = null;
    var entry = { name: trackName(t), updated: new Date().toISOString().slice(0, 19) + "Z" };
    if (sk.pairs.length) entry.fix = { pairs: sk.pairs.slice() };
    if (sk.source !== "image" && oldPath) files[oldPath] = null; // vorher eigenes Bild: Datei nicht liegen lassen
    if (sk.source === "wayback") {
      entry.wayback = { release: sk.wbPick.id, date: sk.wbPick.date };
    } else if (sk.source === "image") {
      path = sk.image.blob ? "img/trackmaps/" + id + "." + (sk.image.blob.type === "image/webp" ? "webp" : "png") : oldPath;
      var round = function (p) { return [+p[0].toFixed(7), +p[1].toFixed(7)]; };
      entry.image = "/" + path;
      entry.corners = cornersOf(sk.place, sk.image.aspect).map(round);
      // altes Bild mit anderer Endung (webp ↔ png) nicht liegen lassen
      if (sk.image.blob && oldPath && oldPath !== path) files[oldPath] = null;
    }
    maps[id] = entry;
    files[MAPS] = { text: JSON.stringify({ maps: maps }, null, 2) + "\n" };
    sk.busy = true;
    controls();
    message($("sk-status"), "Speichere …");
    var blob = sk.source === "image" && sk.image.blob;
    (blob ? base64(blob) : Promise.resolve(null)).then(function (data) {
      if (data) files[path] = { base64: data };
      return commit("Admin: Streckenkarte " + trackName(t), files);
    }).then(function () {
      sk.maps = maps;
      if (blob) sk.image.blob = null; // gespeichert; bei weiteren Änderungen nur noch die Lage
      fillTracks(id);
      $("sk-delete").hidden = false;
      message($("sk-status"), "Gespeichert. In etwa einer Minute gilt die Anpassung für " + trackName(t) + " im Teambereich.", "ok");
    }).catch(function (e) {
      message($("sk-status"), e.message, true);
    }).then(function () { sk.busy = false; controls(); });
  });

  $("sk-delete").addEventListener("click", function () {
    var t = sk.track, id = String(t.id), old = sk.maps[id];
    if (!old || !window.confirm("Hintergrund und Linien-Korrektur für " + trackName(t) + " entfernen? Im Teambereich gilt dann wieder das aktuelle Luftbild mit den unkorrigierten iRacing-Koordinaten.")) return;
    var maps = JSON.parse(JSON.stringify(sk.maps));
    delete maps[id];
    var files = {};
    files[MAPS] = { text: JSON.stringify({ maps: maps }, null, 2) + "\n" };
    if (imagePath(old)) files[imagePath(old)] = null;
    message($("sk-status"), "Entferne …");
    commit("Admin: Streckenkarte " + trackName(t) + " entfernt", files).then(function () {
      sk.maps = maps;
      fillTracks(id);
      // Archiv-Auswahl bleibt als Vorschlag stehen; eigenes Bild und Passpunkte werden verworfen
      sk.image = sk.place = null;
      sk.pairs = [];
      [sk.overlay, sk.move, sk.turn].forEach(function (l) { if (l) l.remove(); });
      sk.overlay = null;
      drawLine();
      $("sk-delete").hidden = true;
      $("sk-file").value = "";
      $("sk-file-info").textContent = "";
      message($("sk-status"), "Entfernt. In etwa einer Minute ist die Änderung im Teambereich zu sehen.", "ok");
    }).catch(function (e) { message($("sk-status"), e.message, true); });
  });

  // Start: mit gemerkter Anmeldung direkt los, sonst Anmeldeknopf
  if (storedToken()) start(); else showLogin();
})();
