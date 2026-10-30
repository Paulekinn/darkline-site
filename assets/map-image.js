// Eigene Streckenkarten auf der Leaflet-Karte, genutzt im Teambereich (Telemetrie-Vergleich) und im Admin (/admin/streckenkarte).

// Früherer Stand des Esri-Luftbilds (World Imagery Wayback): gleiche Kacheln und Koordinaten wie das aktuelle Luftbild,
// passt also ohne Ausrichten. release = Nummer des Archivstands, date = dessen Datum (JJJJ-MM-TT).
L.dpmWayback = function (release, date, options) {
  return L.tileLayer("https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/" + release + "/{z}/{y}/{x}",
    L.extend({ maxNativeZoom: 19, maxZoom: 21, attribution: "Luftbild (Archiv " + date.split("-").reverse().join(".") + "): Esri, Maxar, Earthstar Geographics" }, options));
};

// Korrektur der iRacing-Koordinaten einer Strecke aus Passpunkten [[von, nach], …] (je [lat, lon]). Manche Strecken
// liegen in iRacing gegenüber der echten Welt leicht gedreht, verschoben oder skaliert (z. B. Le Mans um gut 2°).
// Ergebnis: Funktion (lat, lon) → [lat, lon] mit Verschiebung, Drehung und Maßstab (Helmert-Transformation nach der
// Methode der kleinsten Quadrate; ein Paar = nur verschieben). rot (Grad), scale und shift (m) beschreiben sie.
L.dpmFix = function (pairs) {
  var n = pairs && pairs.length;
  if (!n) return null;
  var lat0 = 0, lon0 = 0;
  pairs.forEach(function (p) { lat0 += p[0][0] / n; lon0 += p[0][1] / n; });
  var M = 111320, kx = M * Math.cos(lat0 * Math.PI / 180);
  var loc = function (p) { return [(p[1] - lon0) * kx, (p[0] - lat0) * M]; }; // Meter Ost/Nord um den Schwerpunkt
  var src = pairs.map(function (p) { return loc(p[0]); }), dst = pairs.map(function (p) { return loc(p[1]); });
  var mean = function (pts, k) { return pts.reduce(function (s, p) { return s + p[k]; }, 0) / n; };
  var sx = mean(src, 0), sy = mean(src, 1), dx = mean(dst, 0), dy = mean(dst, 1);
  var a = 1, b = 0, q = 0, ra = 0, rb = 0;
  if (n > 1) {
    src.forEach(function (p, i) {
      var u = p[0] - sx, v = p[1] - sy, U = dst[i][0] - dx, V = dst[i][1] - dy;
      q += u * u + v * v; ra += u * U + v * V; rb += u * V - v * U;
    });
    if (q > 0) { a = ra / q; b = rb / q; }
  }
  var fix = function (lat, lon) {
    var x = (lon - lon0) * kx - sx, y = (lat - lat0) * M - sy;
    return [lat0 + (b * x + a * y + dy) / M, lon0 + (a * x - b * y + dx) / kx];
  };
  fix.rot = -Math.atan2(b, a) * 180 / Math.PI; // im Uhrzeigersinn
  fix.scale = Math.hypot(a, b);
  fix.shift = Math.hypot(dx - sx, dy - sy);
  return fix;
};

// Bild, festgelegt über drei Ecken (oben links, oben rechts, unten links).
// Leaflets ImageOverlay kann nur nach Norden ausgerichtete Rechtecke; die Bilder sind aber gedreht und skaliert.
L.RotatedImage = L.Layer.extend({
  options: { pane: "overlayPane", opacity: 1 },

  initialize: function (url, corners, options) {
    this._url = url;
    this._corners = corners;
    L.setOptions(this, options);
  },

  onAdd: function (map) {
    // leaflet-zoom-hide: während der Zoom-Animation ausblenden, danach neu einpassen
    var img = this._img = L.DomUtil.create("img", "leaflet-image-layer leaflet-zoom-hide");
    img.alt = "";
    img.style.cssText = "position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none";
    img.style.opacity = this.options.opacity;
    img.onload = L.bind(this._reset, this);
    img.src = this._url;
    this.getPane().appendChild(img);
    map.on("zoomend viewreset", this._reset, this);
    this._reset();
  },

  onRemove: function (map) {
    L.DomUtil.remove(this._img);
    map.off("zoomend viewreset", this._reset, this);
  },

  setCorners: function (corners) {
    this._corners = corners;
    if (this._map) this._reset();
    return this;
  },

  setOpacity: function (v) {
    this.options.opacity = v;
    if (this._img) this._img.style.opacity = v;
    return this;
  },

  // Bildpixel → Kartenpixel als Matrix aus den drei Ecken
  _reset: function () {
    var img = this._img, w = img.naturalWidth, h = img.naturalHeight;
    if (!this._map || !w || !h) return;
    var p = this._corners.map(this._map.latLngToLayerPoint, this._map);
    img.style.transform = "matrix(" + [(p[1].x - p[0].x) / w, (p[1].y - p[0].y) / w, (p[2].x - p[0].x) / h, (p[2].y - p[0].y) / h, p[0].x, p[0].y].join(",") + ")";
  }
});
