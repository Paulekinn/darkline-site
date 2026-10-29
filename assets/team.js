// Teambereich: zeigt Anmeldung oder Inhalte, je nachdem ob ein gültiger Login besteht.
(function () {
  var ERRORS = {
    "abgebrochen": "Die Anmeldung wurde abgebrochen.",
    "ungueltig": "Die Anmeldung ist abgelaufen oder ungültig. Bitte noch einmal versuchen.",
    "konfiguration": "Der Teambereich ist noch nicht fertig eingerichtet. Bitte bei der Teamleitung melden.",
    "discord": "Discord hat die Anmeldung nicht bestätigt. Bitte noch einmal versuchen.",
    "kein-mitglied": "Dein Discord-Konto ist nicht auf unserem Server.",
    "keine-rolle": "Dein Discord-Konto hat keine Rolle mit Zugang (Teammitglied oder VIP).",
    "technik": "Technischer Fehler bei der Anmeldung. Bitte später noch einmal versuchen."
  };
  var $ = function (id) { return document.getElementById(id); };

  function showGate() {
    var code = new URLSearchParams(location.search).get("fehler");
    if (code) {
      $("gate-error").textContent = ERRORS[code] || ERRORS.technik;
      $("gate-error").hidden = false;
      history.replaceState(null, "", "/team");
    }
    $("loading").hidden = true;
    $("gate").hidden = false;
  }

  function showArea(user) {
    $("who-name").textContent = user.name;
    $("who").hidden = false;
    $("loading").hidden = true;
    $("area").hidden = false;
    loadTracks();
    loadWeekly();
  }

  // ---------------------------------------------------------------- Hilfen

  // Baut ein Element: el("td", { className: "time" }, "1:38.270")
  function el(tag, props, children) {
    var n = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) { n[k] = props[k]; });
    [].concat(children || []).forEach(function (c) { n.append(c); });
    return n;
  }

  // Fehler werden dort angezeigt, wo geladen wurde. Kein automatischer Seitenwechsel.
  function api(path) {
    return fetch(path, { credentials: "same-origin", cache: "no-store" }).then(function (r) {
      if (r.status === 401) throw new Error("Deine Anmeldung ist abgelaufen. Bitte die Seite neu laden und erneut anmelden. (Code 401)");
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error((d.error || "Fehler beim Laden.") + " (Code " + r.status + ")");
        return d;
      });
    });
  }

  function message(target, text, isError) {
    target.replaceChildren(el("p", { className: "msg" + (isError ? " err" : ""), textContent: text }));
  }

  function lapTime(s) {
    var m = Math.floor(s / 60);
    return m + ":" + (s - m * 60).toFixed(3).padStart(6, "0");
  }

  function hours(sec) {
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return h ? h + " h " + String(m).padStart(2, "0") + " min" : m + " min";
  }

  function day(iso) {
    return iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "";
  }

  // ---------------------------------------------------------------- Rangliste

  // Eine Zeile pro Strecke. Klick klappt darunter die Bestzeiten auf (nur eine Strecke gleichzeitig offen).
  function loadTracks() {
    var box = $("rl-tracks");
    api("/api/team/leaderboard").then(function (d) {
      if (!d.tracks.length) return message(box, "In den letzten " + d.days + " Tagen ist niemand aus dem Team gefahren.");
      var head = el("tr", null, [
        el("th", { textContent: "Strecke" }),
        el("th", { className: "num", textContent: "Fahrzeit" }),
        el("th", { className: "num opt", textContent: "Runden" }),
        el("th", { className: "num opt", textContent: "Fahrer" }),
        el("th", { className: "num", textContent: "Zuletzt" })
      ]);
      var body = el("tbody");
      d.tracks.forEach(function (t) {
        var row = el("tr", { className: "trk", tabIndex: 0 }, [
          el("td", { className: "name" }, [el("b", { textContent: t.name })].concat(t.variant ? el("small", { textContent: t.variant }) : [])),
          el("td", { className: "num", textContent: hours(t.time) }),
          el("td", { className: "num opt", textContent: String(t.laps) }),
          el("td", { className: "num opt", textContent: String(t.drivers) }),
          el("td", { className: "num", textContent: day(t.last) })
        ]);
        row.setAttribute("aria-expanded", "false");
        var toggle = function () { toggleTrack(t, row); };
        row.addEventListener("click", toggle);
        row.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
        body.append(row);
      });
      var search = el("input", { type: "search", className: "search", placeholder: "Strecke suchen …", autocomplete: "off" });
      search.setAttribute("aria-label", "Strecke suchen");
      var none = el("p", { className: "msg", textContent: "Keine Strecke gefunden.", hidden: true });
      search.addEventListener("input", function () { filterTracks(search.value, none); });
      box.replaceChildren(search, el("div", { className: "scroll" }, el("table", { className: "tracks" }, [el("thead", null, head), body])), none);
      initTelemetry(d.tracks);
    }).catch(function (e) {
      message(box, e.message, true);
      message($("tm-view"), e.message, true);
    });
  }

  // Blendet Strecken aus, deren Name oder Variante den Suchtext nicht enthält.
  function filterTracks(text, none) {
    var q = text.trim().toLowerCase();
    var shown = 0;
    document.querySelectorAll("#rl-tracks tr.trk").forEach(function (row) {
      var hit = !q || row.querySelector("td.name").textContent.toLowerCase().indexOf(q) !== -1;
      row.hidden = !hit;
      var detail = row.nextElementSibling;
      if (detail && detail.classList.contains("trk-open")) detail.hidden = !hit;
      if (hit) shown++;
    });
    none.hidden = shown > 0;
  }

  function toggleTrack(track, row) {
    var wasOpen = row.getAttribute("aria-expanded") === "true";
    document.querySelectorAll("#rl-tracks tr.trk-open").forEach(function (r) { r.remove(); });
    document.querySelectorAll("#rl-tracks tr.trk").forEach(function (r) { r.setAttribute("aria-expanded", "false"); });
    if (wasOpen) return;

    row.setAttribute("aria-expanded", "true");
    var box = el("div", { className: "cars" }, el("p", { className: "lbl", textContent: "Lade Bestzeiten …" }));
    var cell = el("td", null, box);
    cell.addEventListener("click", function (e) { e.stopPropagation(); });
    cell.colSpan = 5;
    row.after(el("tr", { className: "trk-open" }, cell));
    api("/api/team/leaderboard?track=" + encodeURIComponent(track.id)).then(function (d) {
      if (!d.cars.length) return message(box, "Für diese Strecke sind keine Runden des Teams sichtbar.");
      showCars(box, d.cars, track.id);
    }).catch(function (e) { message(box, e.message, true); });
  }

  // Oben ein Button pro Auto, darunter nur die Tabelle des gewählten Autos (hält den Bereich kurz).
  function showCars(box, cars, trackId) {
    var table = el("div");
    var tabs = el("div", { className: "cartabs" });
    cars.forEach(function (car, i) {
      var b = el("button", { type: "button" }, [
        el("b", { textContent: car.name }),
        el("span", { textContent: lapTime(car.laps[0].time) + " · " + car.laps.length + " Fahrer" })
      ]);
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        tabs.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        table.replaceChildren(carTable(car, trackId));
      });
      b.setAttribute("aria-pressed", String(i === 0));
      tabs.append(b);
    });
    table.replaceChildren(carTable(cars[0], trackId));
    box.replaceChildren(tabs, table);
  }

  function carTable(car, trackId) {
    var best = car.laps[0].time;
    var rows = car.laps.map(function (l, i) {
      return el("tr", { className: i === 0 ? "p1" : "" }, [
        el("td", { className: "pos", textContent: String(i + 1) }),
        el("td", { className: "drv", textContent: l.driver }),
        el("td", { className: "time", textContent: lapTime(l.time) }),
        el("td", { className: "gap", textContent: i === 0 ? "" : "+" + (l.time - best).toFixed(3) }),
        el("td", { textContent: day(l.date) }),
        el("td", { className: "gap", textContent: l.trackTemp != null ? Math.round(l.trackTemp) + " °C" : "" })
      ]);
    });
    var head = el("tr", null, ["#", "Fahrer", "Zeit", "Abstand", "Datum", "Strecke"].map(function (h) { return el("th", { textContent: h }); }));
    return el("article", { className: "car" }, [
      el("header", null, [
        el("h3", { textContent: car.name }),
        el("span", { className: "car-links" }, [
          car.laps.filter(function (l) { return l.telemetry; }).length >= 2
            ? compareButton(trackId, car.id) : "",
          el("a", { href: car.link, target: "_blank", rel: "noopener", textContent: "In Garage 61 öffnen ↗" })
        ])
      ]),
      el("div", { className: "scroll" }, el("table", null, [el("thead", null, head), el("tbody", null, rows)]))
    ]);
  }

  // ---------------------------------------------------------------- Wochenbericht

  function isoWeek(day) {
    var d = new Date(day + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
    var jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  }

  function shortDay(day) {
    var p = day.split("-");
    return p[2] + "." + p[1] + ".";
  }

  function delta(now, before, unit) {
    if (!before) return now ? "neu gegenüber Vorwoche" : "wie Vorwoche";
    var pct = Math.round((now - before) / before * 100);
    return (pct > 0 ? "+" : pct < 0 ? "−" : "±") + Math.abs(pct) + " % zur Vorwoche";
  }

  function loadWeekly() {
    var box = $("wb");
    api("/api/team/weekly").then(function (d) {
      var weeks = d.weeks;
      // Standard: laufende Woche, außer sie ist noch leer, dann die letzte Woche mit Fahrzeit
      var sel = weeks.length - 1;
      if (!weeks[sel].time) for (var i = sel; i >= 0; i--) if (weeks[i].time) { sel = i; break; }
      renderWeekly(box, weeks, sel);
    }).catch(function (e) { message(box, e.message, true); });
  }

  function renderWeekly(box, weeks, sel) {
    var max = Math.max.apply(null, weeks.map(function (w) { return w.time; })) || 1;
    var last = weeks.length - 1;

    var trend = el("div", { className: "wb-trend" });
    var axis = el("div", { className: "wb-axis" });
    weeks.forEach(function (w, i) {
      var label = "KW " + isoWeek(w.start);
      var col = el("button", { type: "button", className: "wb-col", title: label + ": " + hours(w.time) + " · " + w.laps + " Runden" }, [
        el("span", { className: "v", textContent: w.time ? Math.round(w.time / 3600) + " h" : "–" }),
        el("span", { className: "bar-fill" })
      ]);
      col.lastChild.style.height = Math.max(1, w.time / max * 100) + "%";
      col.setAttribute("aria-pressed", String(i === sel));
      col.setAttribute("aria-label", label + ", " + hours(w.time) + ", " + w.laps + " Runden");
      col.addEventListener("click", function () { renderWeekly(box, weeks, i); });
      trend.append(col);
      axis.append(el("span", { className: i === sel ? "on" : "", textContent: i === last ? "Jetzt" : label }));
    });

    var w = weeks[sel], prev = weeks[sel - 1];
    var head = el("div", { className: "wb-head" }, [
      el("h3", { textContent: "KW " + isoWeek(w.start) + (sel === last ? " · laufende Woche" : "") }),
      el("span", { textContent: shortDay(w.start) + " – " + shortDay(w.end) })
    ]);

    var kpi = function (label, value, sub) {
      return el("div", { className: "wb-kpi" }, [el("span", { className: "lbl", textContent: label }), el("b", { textContent: value }), el("span", { className: "delta", textContent: sub })]);
    };
    var kpis = el("div", { className: "wb-kpis" }, [
      kpi("Fahrzeit", hours(w.time), prev ? delta(w.time, prev.time) : ""),
      kpi("Runden", String(w.laps), prev ? delta(w.laps, prev.laps) : ""),
      kpi("Saubere Runden", w.laps ? Math.round(w.clean / w.laps * 100) + " %" : "–", w.clean + " von " + w.laps),
      kpi("Aktive Fahrer", String(w.drivers.length), w.events + " Sessions")
    ]);

    if (!w.time) {
      box.replaceChildren(trend, axis, head, el("p", { className: "msg", textContent: "In dieser Woche ist niemand aus dem Team gefahren." }));
      return;
    }

    // Eine Balkenzeile: Name links, Wert rechts, Balken darunter (Breite relativ zu "top")
    var hbar = function (x, top, sub, cls) {
      var fill = el("i");
      fill.style.width = (top ? x.time / top * 100 : 0) + "%";
      return el("div", { className: "hbar" + (cls ? " " + cls : "") }, [
        el("span", { className: "lab" }, [x.name].concat(x.variant ? el("small", { textContent: x.variant }) : [])),
        el("span", { className: "val" }, [hours(x.time) + " ", el("small", { textContent: sub(x) })]),
        el("span", { className: "track" }, fill)
      ]);
    };
    var laps = function (x) { return "· " + x.laps + " Runden"; };

    // Balkenliste einer Karte. Einträge mit Fahrer-Aufschlüsselung (x.by) lassen sich aufklappen.
    // Mit "limit" werden zuerst nur so viele Einträge gezeigt, der Rest über "Alle anzeigen".
    var bars = function (title, items, sub, limit) {
      var top = items.reduce(function (m, x) { return Math.max(m, x.time); }, 0) || 1;
      var rows = items.map(function (x) {
        var row = hbar(x, top, sub);
        if (!x.by || !x.by.length) return row;
        var subTop = x.by[0].time;
        var detail = el("div", { className: "hbar-by", hidden: true }, x.by.map(function (d) {
          return hbar(d, subTop, function (y) { return "· " + y.laps + " Runden · " + Math.round(y.time / x.time * 100) + " %"; }, "hbar-sub");
        }));
        row.classList.add("has-by");
        row.tabIndex = 0;
        row.setAttribute("role", "button");
        row.setAttribute("aria-expanded", "false");
        var toggle = function () {
          var open = row.getAttribute("aria-expanded") !== "true";
          row.setAttribute("aria-expanded", String(open));
          detail.hidden = !open;
        };
        row.addEventListener("click", toggle);
        row.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
        return el("div", { className: "hbar-group" }, [row, detail]);
      });
      var card = el("div", { className: "wb-card" }, [el("h4", { textContent: title })]);
      if (!limit || rows.length <= limit) {
        card.append.apply(card, rows);
        return card;
      }
      var more = el("div", { className: "hbar-more", hidden: true }, rows.slice(limit));
      var btn = el("button", { type: "button", className: "wb-more", textContent: "Alle anzeigen (" + rows.length + ")" });
      btn.setAttribute("aria-expanded", "false");
      btn.addEventListener("click", function () {
        var open = more.hidden;
        more.hidden = !open;
        btn.setAttribute("aria-expanded", String(open));
        btn.textContent = open ? "Weniger anzeigen" : "Alle anzeigen (" + rows.length + ")";
      });
      card.append.apply(card, rows.slice(0, limit).concat(more, btn));
      return card;
    };
    var share = function (x) { return "· " + Math.round(x.time / w.time * 100) + " %"; };
    var grid = el("div", { className: "wb-grid" }, [
      bars("Fahrzeit pro Fahrer", w.drivers, laps),
      bars("Training, Quali, Rennen", w.sessions, share),
      bars("Meistgefahrene Strecken", w.tracks, laps, 5),
      bars("Meistgefahrene Autos", w.cars, laps, 5)
    ]);

    box.replaceChildren(trend, axis, head, kpis, grid);
  }

  // ---------------------------------------------------------------- Telemetrie

  var tm = { cars: [], laps: {} };
  var SVG = "http://www.w3.org/2000/svg";

  function svgEl(tag, attrs, children) {
    var n = document.createElementNS(SVG, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    [].concat(children || []).forEach(function (c) { n.append(c); });
    return n;
  }

  function fillSelect(sel, options, value) {
    sel.replaceChildren.apply(sel, options.map(function (o) { return el("option", { value: String(o.value), textContent: o.label }); }));
    sel.disabled = !options.length;
    if (value != null) sel.value = String(value);
  }

  function initTelemetry(tracks) {
    fillSelect($("tm-track"), [{ value: "", label: "Strecke wählen …" }].concat(tracks.map(function (t) {
      return { value: t.id, label: t.name + (t.variant ? " (" + t.variant + ")" : "") };
    })), "");
    fillSelect($("tm-car"), []);
    fillSelect($("tm-lap-a"), []);
    fillSelect($("tm-lap-b"), []);
    $("tm-track").onchange = function () { if (this.value) loadCompareCars(Number(this.value)); };
    $("tm-car").onchange = function () { fillLaps(Number(this.value)); };
    $("tm-lap-a").onchange = $("tm-lap-b").onchange = showCompare;
    message($("tm-view"), "Strecke und Auto wählen. Verglichen werden die Bestzeiten der Fahrer, die ihre Telemetrie in Garage 61 teilen.");
  }

  // Aus der Rangliste: Strecke und Auto vorauswählen und zur Telemetrie springen
  function compareButton(trackId, carId) {
    var b = el("button", { type: "button", className: "tm-open", textContent: "Telemetrie vergleichen ↓" });
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      $("tm-track").value = String(trackId);
      loadCompareCars(trackId, carId);
      $("telemetrie").scrollIntoView({ behavior: "smooth" });
    });
    return b;
  }

  function loadCompareCars(trackId, carId) {
    fillSelect($("tm-car"), []);
    fillSelect($("tm-lap-a"), []);
    fillSelect($("tm-lap-b"), []);
    message($("tm-view"), "Lade Runden …");
    api("/api/team/leaderboard?track=" + encodeURIComponent(trackId)).then(function (d) {
      tm.cars = d.cars.map(function (c) {
        return { id: c.id, name: c.name, laps: c.laps.filter(function (l) { return l.telemetry; }) };
      }).filter(function (c) { return c.laps.length; });
      if (!tm.cars.length) return message($("tm-view"), "Auf dieser Strecke teilt niemand aus dem Team seine Telemetrie.");
      var pick = tm.cars.some(function (c) { return c.id === carId; }) ? carId : tm.cars[0].id;
      fillSelect($("tm-car"), tm.cars.map(function (c) { return { value: c.id, label: c.name + " · " + c.laps.length + " Fahrer" }; }), pick);
      fillLaps(pick);
    }).catch(function (e) { message($("tm-view"), e.message, true); });
  }

  // Runde A = schnellste, Runde B = zweitschnellste (sofern vorhanden)
  function fillLaps(carId) {
    var car = tm.cars.filter(function (c) { return c.id === carId; })[0];
    if (!car) return;
    var opts = car.laps.map(function (l) { return { value: l.id, label: l.driver + " · " + lapTime(l.time) }; });
    fillSelect($("tm-lap-a"), opts, opts[0].value);
    fillSelect($("tm-lap-b"), [{ value: "", label: "– keine –" }].concat(opts), opts[1] ? opts[1].value : "");
    showCompare();
  }

  function telemetry(id) {
    if (!tm.laps[id]) {
      tm.laps[id] = api("/api/team/telemetry?lap=" + encodeURIComponent(id));
      tm.laps[id].catch(function () { delete tm.laps[id]; });
    }
    return tm.laps[id];
  }

  function showCompare() {
    var a = $("tm-lap-a").value, b = $("tm-lap-b").value;
    if (!a) return;
    message($("tm-view"), "Lade Telemetrie …");
    Promise.all([telemetry(a), b && b !== a ? telemetry(b) : null]).then(function (r) {
      renderCompare(r[0], r[1]);
    }).catch(function (e) { message($("tm-view"), e.message, true); });
  }

  var COLOR_A = "#d3121b", COLOR_B = "#e8ecea";

  // Liniendiagramm über die Runde. series: [{ values, color }], Index 0…999 = Rundenposition
  function lineChart(name, height, series, min, max, opts) {
    opts = opts || {};
    var top = 26, bottom = 8, n = series[0].values.length;
    var y = function (v) { return top + (1 - (v - min) / (max - min || 1)) * (height - top - bottom); };
    var svg = svgEl("svg", { viewBox: "0 0 1000 " + height, preserveAspectRatio: "none", height: height, "aria-hidden": "true" });
    if (opts.zero) svg.append(svgEl("line", { x1: 0, x2: 1000, y1: y(0), y2: y(0), stroke: "#3a4144", "stroke-dasharray": "4 4", "vector-effect": "non-scaling-stroke" }));
    series.forEach(function (s) {
      var d = "";
      s.values.forEach(function (v, i) {
        var x = (i / (n - 1) * 1000).toFixed(1), yy = y(v).toFixed(1);
        if (opts.step && i) d += "H" + x + "V" + yy; else d += (i ? "L" : "M") + x + " " + yy;
      });
      svg.append(svgEl("path", { d: d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" }));
    });
    return el("div", { className: "tm-chart" }, [el("span", { className: "tm-name", textContent: name }), svg]);
  }

  // Streckenkarte aus den GPS-Punkten von Runde A, Punkte für die aktuelle Position beider Runden
  function trackMap(A, B) {
    var lat = A.points.lat, lon = A.points.lon;
    var k = Math.cos(lat.reduce(function (s, v) { return s + v; }, 0) / lat.length * Math.PI / 180);
    var xs = lon.map(function (v) { return v * k; }), ys = lat.map(function (v) { return -v; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    // Ausschnitt in der Form der Strecke (längste Seite = 200), damit die Karte den Platz voll ausnutzt
    var size = 200, pad = 10, s = (size - 2 * pad) / Math.max(maxX - minX, maxY - minY);
    var vw = (maxX - minX) * s + 2 * pad, vh = (maxY - minY) * s + 2 * pad;
    var px = function (la, lo) { return [((lo * k - minX) * s + pad).toFixed(1), ((-la - minY) * s + pad).toFixed(1)]; };
    var pts = lat.map(function (la, i) { return px(la, lon[i]).join(","); }).join(" ");
    var start = px(lat[0], lon[0]);
    var dotA = svgEl("circle", { r: 5, fill: COLOR_A, stroke: "#111416", "stroke-width": 2 });
    var dotB = B ? svgEl("circle", { r: 5, fill: COLOR_B, stroke: "#111416", "stroke-width": 2 }) : null;
    var svg = svgEl("svg", { viewBox: "0 0 " + vw.toFixed(1) + " " + vh.toFixed(1), role: "img", "aria-label": "Streckenkarte" }, [
      svgEl("polyline", { points: pts, fill: "none", stroke: "#3a4144", "stroke-width": 7, "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" }),
      svgEl("circle", { cx: start[0], cy: start[1], r: 3, fill: "#ffd400" })
    ].concat(dotB ? [dotB] : [], dotA));
    var place = function (dot, L, i) {
      var j = Math.min(L.points.lat.length - 1, Math.floor(i / 4));
      var p = px(L.points.lat[j], L.points.lon[j]);
      dot.setAttribute("cx", p[0]); dot.setAttribute("cy", p[1]);
    };
    var move = function (i) { place(dotA, A, i); if (dotB) place(dotB, B, i); };
    move(0);
    return { node: el("div", { className: "tm-map" }, svg), move: move };
  }

  function renderCompare(A, B) {
    var P = A.points, Q = B ? B.points : null, n = P.pct.length;
    var both = function (key) { return [{ values: P[key], color: COLOR_A }].concat(Q ? [{ values: Q[key], color: COLOR_B }] : []).reverse(); };
    var range = function (key) {
      var all = P[key].concat(Q ? Q[key] : []);
      return [Math.min.apply(null, all), Math.max.apply(null, all)];
    };
    var charts = [];
    var delta = Q ? Q.t.map(function (t, i) { return Math.round((t - P.t[i]) * 1000) / 1000; }) : null;
    if (delta) {
      var dMax = Math.max(0.1, Math.max.apply(null, delta.map(Math.abs)));
      charts.push(lineChart("Abstand B zu A (s) · oben = B langsamer", 130, [{ values: delta, color: COLOR_B }], -dMax, dMax, { zero: true }));
    }
    var sp = range("speed");
    charts.push(lineChart("Speed (km/h)", 260, both("speed"), Math.floor(sp[0] / 10) * 10, Math.ceil(sp[1] / 10) * 10));
    charts.push(lineChart("Gas (%)", 110, both("throttle"), 0, 100));
    charts.push(lineChart("Bremse (%)", 110, both("brake"), 0, 100));
    var g = range("gear");
    charts.push(lineChart("Gang", 100, both("gear"), Math.max(0, g[0] - 0.5), g[1] + 0.5, { step: true }));

    var len = A.length;
    var axis = el("div", { className: "tm-axis" }, [0, 0.25, 0.5, 0.75, 1].map(function (f) { return el("span", { textContent: Math.round(len * f) + " m" }); }));
    var cursor = el("div", { className: "tm-cursor", hidden: true });
    var tip = el("div", { className: "tm-tip", hidden: true });
    var box = el("div", { className: "tm-charts" }, charts.concat(axis, cursor, tip));
    var map = trackMap(A, B);

    var fmt = function (v, unit) { return v == null ? "–" : v + unit; };
    box.addEventListener("pointermove", function (e) {
      var r = box.getBoundingClientRect();
      var inner = r.width - 28;
      var f = Math.min(1, Math.max(0, (e.clientX - r.left - 14) / inner));
      var i = Math.round(f * (n - 1));
      var x = 14 + f * inner;
      cursor.style.left = x + "px";
      cursor.hidden = false;
      var row = function (label, key, unit) {
        return el("tr", null, [el("td", { textContent: label }), el("td", { textContent: fmt(P[key][i], unit) })].concat(Q ? el("td", { textContent: fmt(Q[key][i], unit) }) : []));
      };
      tip.replaceChildren(
        el("b", { textContent: P.m[i] + " m" + (delta ? " · Abstand " + (delta[i] > 0 ? "+" : "") + delta[i].toFixed(3) + " s" : "") }),
        el("table", null, [
          el("tr", null, [el("td", { textContent: "" }), el("td", { className: "tm-a", textContent: "A" })].concat(Q ? el("td", { className: "tm-b", textContent: "B" }) : [])),
          row("Speed", "speed", " km/h"), row("Gas", "throttle", " %"), row("Bremse", "brake", " %"), row("Gang", "gear", ""), row("Lenkung", "steer", "°")
        ])
      );
      tip.hidden = false;
      var w = tip.offsetWidth;
      // rechts neben dem Cursor, sonst links davon, aber immer innerhalb der Diagrammfläche
      var left = x + 12 + w > r.width ? x - 12 - w : x + 12;
      tip.style.left = Math.max(4, Math.min(r.width - w - 4, left)) + "px";
      map.move(i);
    });
    box.addEventListener("pointerleave", function () { cursor.hidden = true; tip.hidden = true; });

    var key = function (cls, L, label) {
      return el("div", { className: "tm-key" }, [el("i", { className: cls }), el("b", { textContent: label + " " + L.driver }), el("span", { textContent: lapTime(L.lapTime) + " · " + day(L.date) })]);
    };
    var sum = el("div", { className: "tm-sum" }, [
      el("div", null, [el("span", { textContent: "Strecke" }), A.track]),
      el("div", null, [el("span", { textContent: "Auto" }), A.car]),
      el("div", null, [el("span", { textContent: "Länge (errechnet)" }), len + " m"]),
      el("div", null, [el("span", { textContent: "Top-Speed A" }), Math.max.apply(null, P.speed) + " km/h"])
    ].concat(B ? [
      el("div", null, [el("span", { textContent: "Top-Speed B" }), Math.max.apply(null, Q.speed) + " km/h"]),
      el("div", null, [el("span", { textContent: "Differenz" }), (B.lapTime - A.lapTime >= 0 ? "+" : "−") + Math.abs(B.lapTime - A.lapTime).toFixed(3) + " s"])
    ] : []));

    $("tm-view").replaceChildren(el("div", { className: "tm-wide" }, [
      el("div", { className: "tm-keys" }, [key("a", A, "A")].concat(B ? key("b", B, "B") : [])),
      el("div", { className: "tm-layout" }, [box, el("div", { className: "tm-side" }, [map.node, sum])])
    ]));
  }

  $("logout").addEventListener("click", function () {
    fetch("/api/team/session", { method: "POST", credentials: "same-origin" }).finally(function () {
      location.href = "/team";
    });
  });

  fetch("/api/team/session", { credentials: "same-origin", cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (user) { user ? showArea(user) : showGate(); })
    .catch(showGate);
})();
