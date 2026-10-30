// Eigene Streckenkarte als Bild auf der Leaflet-Karte, festgelegt über drei Ecken (oben links, oben rechts, unten links).
// Leaflets ImageOverlay kann nur nach Norden ausgerichtete Rechtecke; die Bilder sind aber gedreht und skaliert.
// Genutzt im Teambereich (Telemetrie-Vergleich) und im Admin (/admin/streckenkarte).
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
