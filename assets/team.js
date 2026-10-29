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

  var AFTER_LOGIN = "dpm_team_ziel"; // geteilter Link (#telemetrie?…), der nach dem Discord-Login wieder geöffnet wird

  function showGate() {
    try { if (location.hash.length > 1) sessionStorage.setItem(AFTER_LOGIN, location.hash); } catch (e) { /* ohne Speicher: Startansicht */ }
    var code = new URLSearchParams(location.search).get("fehler");
    if (code) {
      $("gate-error").textContent = ERRORS[code] || ERRORS.technik;
      $("gate-error").hidden = false;
      history.replaceState(null, "", location.pathname);
    }
    $("loading").hidden = true;
    $("gate").hidden = false;
  }

  function showArea(user) {
    $("who-name").textContent = user.name;
    $("who").hidden = false;
    $("loading").hidden = true;
    $("area").hidden = false;
    try {
      var target = sessionStorage.getItem(AFTER_LOGIN);
      sessionStorage.removeItem(AFTER_LOGIN);
      if (target && location.hash.length <= 1) history.replaceState(null, "", location.pathname + target);
    } catch (e) { /* ohne Speicher: Startansicht */ }
    document.querySelectorAll(".tiles [data-tab]").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        if (location.hash.split("?")[0] !== "#" + a.dataset.tab) history.pushState(null, "", location.pathname + "#" + a.dataset.tab); // Pfad nötig wegen <base href="/">
        route();
      });
    });
    window.addEventListener("popstate", route);
    window.addEventListener("hashchange", route);
    loadTracks();
    route();
  }

  // ---------------------------------------------------------------- Bereiche
  // Die Adresse bestimmt den sichtbaren Bereich: #rangliste (Standard), #wochenbericht, #telemetrie?strecke=…&auto=…&a=…&b=…&zoom=…

  var TABS = ["rangliste", "wochenbericht", "telemetrie", "rennbericht"];
  var weeklyLoaded = false, racesLoaded = false;

  function route() {
    var parts = location.hash.slice(1).split("?");
    var tab = TABS.indexOf(parts[0]) === -1 ? "rangliste" : parts[0];
    TABS.forEach(function (t) {
      $(t).hidden = t !== tab;
      if (t === tab) $("tile-" + t).setAttribute("aria-current", "page"); else $("tile-" + t).removeAttribute("aria-current");
    });
    if (tab === "wochenbericht" && !weeklyLoaded) {
      weeklyLoaded = true;
      loadWeekly();
    }
    if (tab === "rennbericht" && !racesLoaded) {
      racesLoaded = true;
      loadRaceList();
    }
    if (tab === "telemetrie" && parts[1]) {
      var q = new URLSearchParams(parts[1]);
      var share = { track: Number(q.get("strecke")), car: Number(q.get("auto")), a: q.get("a") || "", b: q.get("b") || "", zoom: q.get("zoom") || "" };
      // nur neu laden, wenn der Link etwas anderes zeigt als die aktuelle Auswahl
      if (share.track && share.a && (share.a !== $("tm-lap-a").value || share.b !== $("tm-lap-b").value)) {
        tm.share = share;
        if (tm.ready) openShare();
      }
    }
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
      if (!weeks || !weeks.length) return message(box, "Keine Daten für den Wochenbericht.");
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
    tm.ready = true;
    if (tm.share) openShare();
  }

  // Geteilten Link öffnen: Strecke, Auto und Runden vorauswählen; den Zoom setzt renderCompare
  function openShare() {
    var s = tm.share;
    if (!s || !s.track) return;
    $("tm-track").value = String(s.track);
    loadCompareCars(s.track, s.car);
  }

  // Aus der Rangliste: Strecke und Auto vorauswählen und zur Telemetrie springen
  function compareButton(trackId, carId) {
    var b = el("button", { type: "button", className: "tm-open", textContent: "Telemetrie vergleichen ↓" });
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      history.pushState(null, "", location.pathname + "#telemetrie");
      route();
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
    var has = function (id) { return opts.some(function (o) { return o.value === id; }); };
    var s = tm.share;
    // aus einem geteilten Link, sonst schnellste und zweitschnellste Runde
    fillSelect($("tm-lap-a"), opts, s && has(s.a) ? s.a : opts[0].value);
    fillSelect($("tm-lap-b"), [{ value: "", label: "– keine –" }].concat(opts), s && (s.b === "" || has(s.b)) ? s.b : opts[1] ? opts[1].value : "");
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

  // ---- Analyse: Sektoren und Kurven-Abschnitte (Grenzen aus Runde A) ----

  // Erster Punkt, an dem die Runde die Zeit t erreicht
  function indexAtTime(times, t) {
    for (var i = 0; i < times.length; i++) if (times[i] >= t) return i;
    return times.length - 1;
  }

  // Sektorgrenzen aus den offiziellen Sektorzeiten von A (Garage 61 liefert nur die Zeiten, nicht die Lage)
  function sectorRanges(A, B) {
    if (!A.sectors) return [];
    var n = A.points.t.length, acc = 0, start = 0;
    var bOk = B && B.sectors && B.sectors.length === A.sectors.length;
    return A.sectors.map(function (s, k) {
      acc += s;
      var end = k === A.sectors.length - 1 ? n - 1 : indexAtTime(A.points.t, acc);
      var r = { name: "Sektor " + (k + 1), short: "S" + (k + 1), i0: start, i1: end, a: s, b: bOk ? B.sectors[k] : null };
      start = end;
      return r;
    });
  }

  // Bremspunkte: Bremse steigt über 15 %. Liegen zwei näher als 2 % der Runde beieinander, zählen sie als eine Kurve.
  function brakeOnsets(brake) {
    var on = false, out = [];
    brake.forEach(function (b, i) {
      if (!on && b >= 15) {
        if (!out.length || i - out[out.length - 1] > 20) out.push(i);
        on = true;
      } else if (on && b < 5) on = false;
    });
    return out;
  }

  // Ein Abschnitt pro Kurve: vom Bremspunkt bis zum nächsten Bremspunkt (Anbremsen, Kurve, Herausbeschleunigen)
  function cornerRanges(A, B, delta) {
    var P = A.points, Q = B ? B.points : null, n = P.t.length;
    var on = brakeOnsets(P.brake);
    if (!on.length) return [];
    var bOn = Q ? brakeOnsets(Q.brake) : [];
    var minAt = function (arr, i0, i1) { var m = i0; for (var i = i0; i <= i1; i++) if (arr[i] < arr[m]) m = i; return m; };
    var segs = (on[0] > 10 ? [{ i0: 0, i1: on[0], start: true }] : []).concat(on.map(function (i0, k) {
      return { i0: i0, i1: k + 1 < on.length ? on[k + 1] : n - 1, num: k + 1 };
    }));
    return segs.map(function (s) {
      // Scheitelpunkt = langsamste Stelle im Abschnitt (am Ende, vor dem nächsten Bremspunkt, ist der Wagen wieder schnell)
      var look = s.i1;
      var apex = s.start ? s.i0 : minAt(P.speed, s.i0, look);
      var c = { name: s.start ? "Start" : "Kurve " + s.num, num: s.num, i0: s.i0, i1: s.i1, apex: apex, minA: P.speed[apex] };
      if (Q) {
        c.minB = s.start ? Q.speed[s.i0] : Q.speed[minAt(Q.speed, s.i0, look)];
        c.gain = Math.round((delta[s.i1] - delta[s.i0]) * 1000) / 1000;
        var near = s.start ? null : bOn.filter(function (j) { return Math.abs(j - s.i0) <= 30; })[0];
        if (near != null) c.brakeDiff = P.m[near] - P.m[s.i0]; // negativ = B bremst früher
      }
      return c;
    });
  }

  var signed = function (v, digits) { return (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v).toFixed(digits); };

  // Liniendiagramm für den sichtbaren Bereich view = { i0, i1 }. marks: senkrechte Linien mit Beschriftung.
  function lineChart(name, height, series, min, max, view, opts) {
    opts = opts || {};
    var top = 26, bottom = 8, span = view.i1 - view.i0 || 1;
    var x = function (i) { return ((i - view.i0) / span * 1000).toFixed(1); };
    var y = function (v) { return (top + (1 - (v - min) / (max - min || 1)) * (height - top - bottom)).toFixed(1); };
    var svg = svgEl("svg", { viewBox: "0 0 1000 " + height, preserveAspectRatio: "none", height: height, "aria-hidden": "true" });
    var labels = [];
    (opts.marks || []).forEach(function (m) {
      if (m.i <= view.i0 || m.i >= view.i1) return;
      svg.append(svgEl("line", { x1: x(m.i), x2: x(m.i), y1: 0, y2: height, stroke: m.strong ? "#59625f" : "#2a3032", "vector-effect": "non-scaling-stroke" }));
      if (m.label) labels.push(el("span", { className: "tm-mark" + (m.strong ? " strong" : ""), textContent: m.label, style: "left:calc(14px + (100% - 28px) * " + ((m.i - view.i0) / span).toFixed(4) + ")" }));
    });
    if (opts.zero) svg.append(svgEl("line", { x1: 0, x2: 1000, y1: y(0), y2: y(0), stroke: "#3a4144", "stroke-dasharray": "4 4", "vector-effect": "non-scaling-stroke" }));
    series.forEach(function (s) {
      var d = "";
      for (var i = view.i0; i <= view.i1; i++) {
        var xx = x(i), yy = y(s.values[i]);
        if (opts.step && i > view.i0) d += "H" + xx + "V" + yy; else d += (i > view.i0 ? "L" : "M") + xx + " " + yy;
      }
      svg.append(svgEl("path", { d: d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" }));
    });
    return el("div", { className: "tm-chart" }, [el("span", { className: "tm-name", textContent: name }), svg].concat(labels));
  }

  // Streckenkarte aus den GPS-Punkten. Ganze Runde: Strecke mit Kurvennummern und Positionspunkten.
  // Im Zoom: Ausschnitt um den Abschnitt, Strecke in ungefähr echter Breite, Fahrlinien von A und B, Bremspunkte als Kreise.
  function trackMap(A, B, corners) {
    var lat = A.points.lat, lon = A.points.lon;
    var k = Math.cos(lat.reduce(function (s, v) { return s + v; }, 0) / lat.length * Math.PI / 180);
    var xs = lon.map(function (v) { return v * k; }), ys = lat.map(function (v) { return -v; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    // Ausschnitt in der Form der Strecke (längste Seite = 200), damit die Karte den Platz voll ausnutzt
    var size = 200, pad = 14, s = (size - 2 * pad) / Math.max(maxX - minX, maxY - minY);
    var vw = (maxX - minX) * s + 2 * pad, vh = (maxY - minY) * s + 2 * pad;
    var unitsPerMeter = s / 111320; // 1 Grad Breite ≈ 111,32 km
    var px = function (la, lo) { return [(lo * k - minX) * s + pad, (-la - minY) * s + pad]; };
    // Rundenpunkt i (0…999 wie in den Diagrammen) → Kartenpunkt; die Karte ist feiner aufgelöst (2000 GPS-Punkte)
    var idx = function (L, i) { var len = L.points.lat.length; return Math.min(len - 1, Math.round(i * (len - 1) / (L.points.t.length - 1))); };
    var at = function (L, i) { var j = idx(L, i); return px(L.points.lat[j], L.points.lon[j]); };
    var pathOf = function (L, i0, i1) {
      var out = [];
      for (var j = idx(L, i0); j <= idx(L, i1); j++) out.push(px(L.points.lat[j], L.points.lon[j]));
      return out;
    };
    var str = function (pts) { return pts.map(function (p) { return p[0].toFixed(2) + "," + p[1].toFixed(2); }).join(" "); };
    var poly = function (stroke, width) {
      return svgEl("polyline", { fill: "none", stroke: stroke, "stroke-width": width, "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" });
    };

    var track = poly("#3a4144", 7);
    track.setAttribute("points", str(pathOf(A, 0, A.points.t.length - 1)));
    var lineA = poly(COLOR_A, 2.5), lineB = B ? poly(COLOR_B, 2.5) : null;
    var brakes = svgEl("g");
    var p0 = px(lat[0], lon[0]);
    var start = svgEl("circle", { cx: p0[0].toFixed(1), cy: p0[1].toFixed(1), fill: "#ffd400" });
    var nums = corners.filter(function (c) { return c.num; }).map(function (c) {
      var p = at(A, c.apex);
      return { p: p, node: svgEl("text", { x: p[0].toFixed(2), "text-anchor": "middle", fill: "#8a9390", "font-family": "IBM Plex Mono, monospace" }, String(c.num)) };
    });
    var dotA = svgEl("circle", { fill: COLOR_A, stroke: "#111416" });
    var dotB = B ? svgEl("circle", { fill: COLOR_B, stroke: "#111416" }) : null;
    var svg = svgEl("svg", { viewBox: "0 0 " + vw.toFixed(1) + " " + vh.toFixed(1), role: "img", "aria-label": "Streckenkarte" },
      [track].concat(lineB ? [lineB] : [], lineA, brakes, start, nums.map(function (n) { return n.node; }), dotB ? [dotB] : [], dotA));
    var note = el("span", { className: "tm-map-note", hidden: true, textContent: "Fahrlinie A und B · ○ = Bremspunkt" });

    var bOnA = brakeOnsets(A.points.brake), bOnB = B ? brakeOnsets(B.points.brake) : [];
    var fullBox = { x: 0, y: 0, w: vw, h: vh };
    var home = fullBox, box = fullBox, lapView = true;
    var MIN = 25 * unitsPerMeter; // engster Zoom: ca. 25 m Kartenbreite

    // Ausschnitt anwenden. Punkte, Schrift und Kreise behalten ihre Größe (sc = Anteil des Ausschnitts an der ganzen Karte).
    function apply(b) {
      box = b;
      svg.setAttribute("viewBox", [b.x, b.y, b.w, b.h].map(function (v) { return v.toFixed(3); }).join(" "));
      var sc = Math.max(b.w, b.h) / Math.max(vw, vh);
      var near = sc < 0.6;
      // nah dran: Strecke in ungefähr echter Breite (12 m), nie dünner als die Linien darauf; weit weg: feste 7 px
      if (near) {
        track.removeAttribute("vector-effect");
        track.setAttribute("stroke-width", Math.max(12 * unitsPerMeter, 3 * sc).toFixed(4));
      } else {
        track.setAttribute("vector-effect", "non-scaling-stroke");
        track.setAttribute("stroke-width", 7);
      }
      // Fahrlinien und Bremspunkte: im Diagramm-Zoom immer, bei der ganzen Runde erst, wenn man in die Karte hineinzoomt
      var lines = near || !lapView;
      [lineA, lineB, brakes].forEach(function (n) { if (n) n.style.display = lines ? "" : "none"; });
      note.hidden = !lines;
      [dotA, dotB].forEach(function (d) { if (d) { d.setAttribute("r", 5 * sc); d.setAttribute("stroke-width", 2 * sc); } });
      start.setAttribute("r", 3 * sc);
      nums.forEach(function (n) { n.node.setAttribute("font-size", 7 * sc); n.node.setAttribute("y", (n.p[1] - 6 * sc).toFixed(3)); });
      [].forEach.call(brakes.children, function (c) { c.setAttribute("r", 4 * sc); });
      zoomOut.disabled = b === fullBox;
    }

    // Fahrlinien und Bremspunkte für den Bereich j0…j1 (Rundenpunkte wie in den Diagrammen)
    function setLines(j0, j1) {
      lineA.setAttribute("points", str(pathOf(A, j0, j1)));
      if (lineB) lineB.setAttribute("points", str(pathOf(B, j0, j1)));
      var marks = [];
      [[bOnA, A, COLOR_A], [bOnB, B, COLOR_B]].forEach(function (x) {
        if (!x[1]) return;
        x[0].filter(function (i) { return i >= j0 && i <= j1; }).forEach(function (i) {
          var p = at(x[1], i);
          marks.push(svgEl("circle", { cx: p[0].toFixed(3), cy: p[1].toFixed(3), fill: "none", stroke: x[2], "stroke-width": 2, "vector-effect": "non-scaling-stroke" }));
        });
      });
      brakes.replaceChildren.apply(brakes, marks);
    }

    // Ausschnitt passend zum Diagramm-Zoom
    function zoomTo(view, full) {
      lapView = full;
      if (full) {
        setLines(0, A.points.t.length - 1);
        home = fullBox;
        apply(home);
        return;
      }
      // Etwas Anfahrt davor (ca. 60 m, damit frühere Bremspunkte sichtbar sind). Bei einer Kurve nur bis kurz nach
      // dem Scheitelpunkt, sonst wäre die folgende Gerade im Bild und die Kurve selbst zu klein.
      var j0 = Math.max(0, view.i0 - 15);
      var j1 = view.num && view.apex != null ? Math.min(view.i1, view.apex + Math.max(25, view.apex - view.i0)) : view.i1;
      setLines(j0, j1);
      var all = pathOf(A, j0, j1).concat(B ? pathOf(B, j0, j1) : []);
      var x0 = Math.min.apply(null, all.map(function (p) { return p[0]; })), x1 = Math.max.apply(null, all.map(function (p) { return p[0]; }));
      var y0 = Math.min.apply(null, all.map(function (p) { return p[1]; })), y1 = Math.max.apply(null, all.map(function (p) { return p[1]; }));
      var m = Math.max(x1 - x0, y1 - y0, 40 * unitsPerMeter) * 0.18 + 15 * unitsPerMeter;
      home = { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
      apply(home);
    }

    // Eigener Karten-Zoom um einen Punkt (Kartenkoordinaten), f < 1 = näher heran
    function zoomAt(cx, cy, f) {
      var w = box.w * f, h = box.h * f, big = Math.max(w, h);
      if (big < MIN) { w *= MIN / big; h *= MIN / big; }
      if (Math.max(w, h) >= Math.max(vw, vh)) return apply(fullBox);
      apply({ x: cx - (cx - box.x) * (w / box.w), y: cy - (cy - box.y) * (h / box.h), w: w, h: h });
    }
    // Bildschirmposition → Kartenkoordinaten (das SVG ist zentriert eingepasst)
    function toMap(e) {
      var r = svg.getBoundingClientRect(), k2 = Math.min(r.width / box.w, r.height / box.h);
      var ox = (r.width - box.w * k2) / 2, oy = (r.height - box.h * k2) / 2;
      return { x: box.x + (e.clientX - r.left - ox) / k2, y: box.y + (e.clientY - r.top - oy) / k2, k: k2 };
    }
    var center = function () { return [box.x + box.w / 2, box.y + box.h / 2]; };

    svg.addEventListener("wheel", function (e) {
      e.preventDefault();
      var p = toMap(e);
      zoomAt(p.x, p.y, e.deltaY < 0 ? 0.8 : 1.25);
    }, { passive: false });
    var pan = null;
    svg.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "touch" || e.button !== 0) return; // am Handy: Buttons, damit die Seite scrollbar bleibt
      pan = { x: e.clientX, y: e.clientY, box: box, k: toMap(e).k };
      svg.setPointerCapture(e.pointerId);
      svg.classList.add("panning");
    });
    svg.addEventListener("pointermove", function (e) {
      if (!pan) return;
      apply({ x: pan.box.x - (e.clientX - pan.x) / pan.k, y: pan.box.y - (e.clientY - pan.y) / pan.k, w: pan.box.w, h: pan.box.h });
    });
    var endPan = function () { pan = null; svg.classList.remove("panning"); };
    svg.addEventListener("pointerup", endPan);
    svg.addEventListener("pointercancel", endPan);
    svg.addEventListener("dblclick", function () { apply(home); });

    var tool = function (label, title, fn) {
      var b = el("button", { type: "button", textContent: label, title: title });
      b.setAttribute("aria-label", title);
      b.addEventListener("click", fn);
      return b;
    };
    var zoomIn = tool("+", "Karte vergrößern", function () { var c = center(); zoomAt(c[0], c[1], 0.66); });
    var zoomOut = tool("−", "Karte verkleinern", function () { var c = center(); zoomAt(c[0], c[1], 1.5); });
    var zoomHome = tool("⟲", "Karte zurücksetzen", function () { apply(home); });
    var tools = el("div", { className: "tm-map-tools" }, [zoomIn, zoomOut, zoomHome]);

    setLines(0, A.points.t.length - 1);
    apply(fullBox);
    return {
      node: el("div", { className: "tm-map" }, [svg, tools, note]),
      move: function (i) {
        var a = at(A, i); dotA.setAttribute("cx", a[0].toFixed(3)); dotA.setAttribute("cy", a[1].toFixed(3));
        if (dotB) { var b = at(B, i); dotB.setAttribute("cx", b[0].toFixed(3)); dotB.setAttribute("cy", b[1].toFixed(3)); }
      },
      highlight: zoomTo
    };
  }

  function renderCompare(A, B) {
    var P = A.points, Q = B ? B.points : null, n = P.pct.length;
    var delta = Q ? Q.t.map(function (t, i) { return Math.round((t - P.t[i]) * 1000) / 1000; }) : null;
    var sectors = sectorRanges(A, B);
    var corners = cornerRanges(A, B, delta);
    var full = { i0: 0, i1: n - 1, name: "Ganze Runde" };
    var view = full;
    var map = trackMap(A, B, corners);
    var both = function (key) { return [{ values: P[key], color: COLOR_A }].concat(Q ? [{ values: Q[key], color: COLOR_B }] : []).reverse(); };
    var range = function (arrs) {
      var lo = Infinity, hi = -Infinity;
      arrs.forEach(function (a) { for (var i = view.i0; i <= view.i1; i++) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; } });
      return [lo, hi];
    };

    // Markierungen: Sektorgrenzen kräftig (Beschriftung nur im obersten Diagramm), Kurven fein mit Nummer
    var sectorMarks = sectors.slice(1).map(function (s) { return { i: s.i0, label: s.short, strong: true }; });
    var marks = sectorMarks.map(function (m) { return { i: m.i, strong: true }; });
    var cornerMarks = corners.filter(function (c) { return c.num; }).map(function (c) { return { i: c.apex, label: String(c.num) }; });

    var plots = el("div", { className: "tm-plots" });
    var axis = el("div", { className: "tm-axis" });
    var cursor = el("div", { className: "tm-cursor", hidden: true });
    var tip = el("div", { className: "tm-tip", hidden: true });
    var sel = el("div", { className: "tm-sel", hidden: true });
    var box = el("div", { className: "tm-charts" }, [plots, axis, sel, cursor, tip]);
    var viewName = el("span", { className: "tm-view-name" });
    var reset = el("button", { type: "button", className: "tm-reset", textContent: "Ganze Runde ↺" });
    reset.addEventListener("click", function () { zoom(full); });

    // Zoom als kurzer Code für den Link: k7 = Kurve 7, start, s2 = Sektor 2, r120-340 = aufgezogener Bereich
    var zoomCode = function (v) {
      if (v === full) return "";
      if (v.num) return "k" + v.num;
      if (v.name === "Start") return "start";
      if (v.short) return v.short.toLowerCase();
      return "r" + v.i0 + "-" + v.i1;
    };
    var fromCode = function (code) {
      var m = /^r(\d+)-(\d+)$/.exec(code);
      if (m) {
        var a = Math.max(0, Math.min(n - 1, +m[1])), b = Math.max(0, Math.min(n - 1, +m[2]));
        return b - a >= 8 ? { i0: a, i1: b, name: "Ausschnitt" } : null;
      }
      return corners.concat(sectors).filter(function (v) { return zoomCode(v) === code; })[0] || null;
    };
    // Adresse immer auf dem aktuellen Stand halten, damit sie direkt geteilt werden kann
    var shareQuery = function () {
      var q = new URLSearchParams({ strecke: $("tm-track").value, auto: $("tm-car").value, a: A.id });
      if (B) q.set("b", B.id);
      if (zoomCode(view)) q.set("zoom", zoomCode(view));
      return q.toString();
    };
    var shareUrl = function () { return "#telemetrie?" + shareQuery(); };
    var copy = el("button", { type: "button", className: "tm-copy", textContent: "Link kopieren" });
    copy.addEventListener("click", function () {
      // /vergleich liefert Discord eine Vorschau (Strecke, Fahrer, Zeiten) und leitet dann hierher weiter
      var url = location.origin + "/vergleich?" + shareQuery();
      var done = function () { copy.textContent = "Link kopiert ✓"; setTimeout(function () { copy.textContent = "Link kopieren"; }, 2000); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { window.prompt("Link zum Kopieren:", url); });
      else window.prompt("Link zum Kopieren:", url);
    });

    function draw() {
      var isFull = view === full;
      if (!$("telemetrie").hidden) history.replaceState(null, "", location.pathname + shareUrl());
      var charts = [];
      if (delta) {
        // im Zoom: Abstand ab Beginn des Ausschnitts, damit Gewinn und Verlust darin direkt ablesbar sind
        var base = isFull ? 0 : delta[view.i0];
        var rel = delta.map(function (v) { return Math.round((v - base) * 1000) / 1000; });
        var dr = range([rel]), dMax = Math.max(0.05, Math.abs(dr[0]), Math.abs(dr[1]));
        charts.push(lineChart(isFull ? "Abstand B zu A (s) · oben = B langsamer" : "Abstand B zu A ab Abschnittsbeginn (s) · oben = B langsamer", 130,
          [{ values: rel, color: COLOR_B }], -dMax, dMax, view, { zero: true, marks: sectorMarks }));
      }
      var sp = range([P.speed].concat(Q ? [Q.speed] : []));
      charts.push(lineChart("Speed (km/h)", 260, both("speed"), Math.floor(sp[0] / 10) * 10, Math.ceil(sp[1] / 10) * 10, view, { marks: (delta ? marks : sectorMarks).concat(cornerMarks) }));
      charts.push(lineChart("Gas (%)", 110, both("throttle"), 0, 100, view, { marks: marks }));
      charts.push(lineChart("Bremse (%)", 110, both("brake"), 0, 100, view, { marks: marks }));
      var g = range([P.gear].concat(Q ? [Q.gear] : []));
      charts.push(lineChart("Gang", 100, both("gear"), Math.max(0, g[0] - 0.5), g[1] + 0.5, view, { step: true, marks: marks }));
      plots.replaceChildren.apply(plots, charts);
      axis.replaceChildren.apply(axis, [0, 0.25, 0.5, 0.75, 1].map(function (f) {
        return el("span", { textContent: P.m[Math.round(view.i0 + f * (view.i1 - view.i0))] + " m" });
      }));
      viewName.textContent = "Ansicht: " + view.name + (isFull ? "" : " · " + P.m[view.i0] + "–" + P.m[view.i1] + " m");
      reset.hidden = isFull;
      document.querySelectorAll("#tm-view [data-zoom]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.zoom === view.name)); });
      map.highlight(view, isFull);
      map.move(view.i0);
      cursor.hidden = tip.hidden = true;
    }

    function zoom(v) {
      view = v;
      draw();
    }

    // Position unter dem Mauszeiger: Anteil 0…1 im Diagramm und Punkt in der Runde
    var pos = function (e) {
      var r = box.getBoundingClientRect(), inner = r.width - 28;
      var f = Math.min(1, Math.max(0, (e.clientX - r.left - 14) / inner));
      return { r: r, f: f, x: 14 + f * inner, i: Math.round(view.i0 + f * (view.i1 - view.i0)) };
    };
    var fmt = function (v, unit) { return v == null ? "–" : v + unit; };
    var drag = null;

    box.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      drag = pos(e);
      e.preventDefault();
    });
    box.addEventListener("pointermove", function (e) {
      var p = pos(e);
      cursor.style.left = p.x + "px";
      cursor.hidden = false;
      if (drag) {
        sel.style.left = Math.min(drag.x, p.x) + "px";
        sel.style.width = Math.abs(p.x - drag.x) + "px";
        sel.hidden = Math.abs(p.x - drag.x) < 4;
      }
      var i = p.i;
      var row = function (label, key, unit) {
        return el("tr", null, [el("td", { textContent: label }), el("td", { textContent: fmt(P[key][i], unit) })].concat(Q ? el("td", { textContent: fmt(Q[key][i], unit) }) : []));
      };
      var gap = delta ? delta[i] - (view === full ? 0 : delta[view.i0]) : null;
      tip.replaceChildren(
        el("b", { textContent: P.m[i] + " m" + (delta ? " · Abstand " + signed(gap, 3) + " s" : "") }),
        el("table", null, [
          el("tr", null, [el("td", { textContent: "" }), el("td", { className: "tm-a", textContent: "A" })].concat(Q ? el("td", { className: "tm-b", textContent: "B" }) : [])),
          row("Speed", "speed", " km/h"), row("Gas", "throttle", " %"), row("Bremse", "brake", " %"), row("Gang", "gear", ""), row("Lenkung", "steer", "°")
        ])
      );
      tip.hidden = false;
      var w = tip.offsetWidth;
      // rechts neben dem Cursor, sonst links davon, aber immer innerhalb der Diagrammfläche
      var left = p.x + 12 + w > p.r.width ? p.x - 12 - w : p.x + 12;
      tip.style.left = Math.max(4, Math.min(p.r.width - w - 4, left)) + "px";
      map.move(i);
    });
    // Loslassen auch außerhalb der Diagramme erkennen; nur ein Handler, auch nach mehreren Vergleichen
    if (tm.pointerUp) window.removeEventListener("pointerup", tm.pointerUp);
    window.addEventListener("pointerup", tm.pointerUp = function (e) {
      if (!drag) return;
      var p = pos(e), a = Math.min(drag.i, p.i), b = Math.max(drag.i, p.i);
      drag = null;
      sel.hidden = true;
      if (b - a >= 8) zoom({ i0: a, i1: b, name: "Ausschnitt" });
    });
    box.addEventListener("pointerleave", function () { if (!drag) { cursor.hidden = true; tip.hidden = true; } });
    box.addEventListener("dblclick", function () { zoom(full); });

    // Sektorleiste: Zeit A, Zeit B, Differenz. Klick zoomt auf den Sektor.
    var sectorBar = sectors.length ? el("div", { className: "tm-sectors" }, sectors.map(function (s) {
      var btn = el("button", { type: "button", className: "tm-sec" }, [
        el("b", { textContent: s.name }),
        el("span", { className: "tm-a", textContent: s.a.toFixed(3) })
      ].concat(s.b != null ? [el("span", { className: "tm-b", textContent: s.b.toFixed(3) }), el("em", { textContent: "B " + signed(s.b - s.a, 3) + " s" })] : []));
      btn.dataset.zoom = s.name;
      btn.addEventListener("click", function () { zoom(view.name === s.name ? full : s); });
      return btn;
    })) : null;

    // Kurventabelle: Zeitgewinn/-verlust pro Abschnitt, Min-Speed, Bremspunkt. Klick zoomt auf die Kurve.
    var cornerTable = null;
    if (corners.length) {
      var losses = Q ? corners.map(function (c) { return c.gain; }).sort(function (x, y) { return y - x; }) : [];
      var worst = losses.length ? losses[Math.min(2, losses.length - 1)] : Infinity;
      var head = el("tr", null, ["Abschnitt", "Bereich", Q ? "B zu A" : null, "Min-Speed A", Q ? "Min-Speed B" : null, Q ? "Bremspunkt B" : null]
        .filter(function (h) { return h !== null; }).map(function (h, k) { return el("th", { className: k > 1 ? "num" : "", textContent: h }); }));
      var rows = corners.map(function (c) {
        var cells = [el("td", { className: "tm-nm", textContent: c.name }), el("td", { textContent: P.m[c.i0] + "–" + P.m[c.i1] + " m" })];
        if (Q) cells.push(el("td", { className: "num tm-gain", textContent: signed(c.gain, 3) + " s" }));
        cells.push(el("td", { className: "num", textContent: Math.round(c.minA) + " km/h" }));
        if (Q) {
          cells.push(el("td", { className: "num", textContent: Math.round(c.minB) + " km/h" }));
          cells.push(el("td", { className: "num", textContent: c.brakeDiff == null ? "–" : c.brakeDiff === 0 ? "gleich" : Math.abs(c.brakeDiff) + " m " + (c.brakeDiff < 0 ? "früher" : "später") }));
        }
        var tr = el("tr", { className: Q && c.gain > 0 && c.gain >= worst ? "tm-loss" : "", tabIndex: 0 }, cells);
        tr.dataset.zoom = c.name;
        var go = function () { zoom(view.name === c.name ? full : c); box.scrollIntoView({ behavior: "smooth", block: "nearest" }); };
        tr.addEventListener("click", go);
        tr.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
        return tr;
      });
      cornerTable = el("div", { className: "tm-corners" }, [
        el("h4", { textContent: "Kurven" + (Q ? " · B zu A: + = B verliert Zeit, die drei größten Verluste sind markiert" : "") }),
        el("div", { className: "scroll" }, el("table", null, [el("thead", null, head), el("tbody", null, rows)])),
        el("p", { className: "lbl", textContent: "Abschnitt = vom Bremspunkt bis zum nächsten Bremspunkt (aus Runde A erkannt). Zeile anklicken zum Zoomen." })
      ]);
    }

    var key = function (cls, L, label) {
      return el("div", { className: "tm-key" }, [el("i", { className: cls }), el("b", { textContent: label + " " + L.driver }), el("span", { textContent: lapTime(L.lapTime) + " · " + day(L.date) })]);
    };
    var sum = el("div", { className: "tm-sum" }, [
      el("div", null, [el("span", { textContent: "Strecke" }), A.track]),
      el("div", null, [el("span", { textContent: "Auto" }), A.car]),
      el("div", null, [el("span", { textContent: "Länge (errechnet)" }), A.length + " m"]),
      el("div", null, [el("span", { textContent: "Top-Speed A" }), Math.max.apply(null, P.speed) + " km/h"])
    ].concat(B ? [
      el("div", null, [el("span", { textContent: "Top-Speed B" }), Math.max.apply(null, Q.speed) + " km/h"]),
      el("div", null, [el("span", { textContent: "Differenz" }), signed(B.lapTime - A.lapTime, 3) + " s"])
    ] : []));

    $("tm-view").replaceChildren(el("div", { className: "tm-wide" }, [
      el("div", { className: "tm-keys" }, [key("a", A, "A")].concat(B ? key("b", B, "B") : [])),
      sectorBar || "",
      el("div", { className: "tm-zoombar" }, [viewName, reset, el("span", { className: "tm-hint", textContent: "Bereich mit der Maus aufziehen zum Zoomen · Doppelklick = ganze Runde" }), copy]),
      el("div", { className: "tm-layout" }, [box, el("div", { className: "tm-side" }, [map.node, sum])]),
      cornerTable || ""
    ]));
    // geteilter Link: dessen Zoom übernehmen, danach gilt wieder die normale Auswahl
    var s = tm.share;
    tm.share = null;
    var start = s && s.zoom && s.a === A.id ? fromCode(s.zoom) : null;
    if (start) view = start;
    draw();
  }

  // ---------------------------------------------------------------- Rennbericht
  // Teamrennen aus dem Kalender (content/races.json) + Auswertung aus Garage 61 → Textentwurf nach Vorlage → News im Admin

  var rb = { races: [] };

  function loadRaceList() {
    fetch("/content/races.json", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) {
      rb.races = (d.races || []).filter(function (r) { return r.status === "abgeschlossen"; })
        .sort(function (a, b) { return String(b.datum || "").localeCompare(String(a.datum || "")); });
      if (!rb.races.length) return message($("rb-view"), "Im Kalender gibt es noch kein abgeschlossenes Rennen.");
      fillSelect($("rb-race"), [{ value: "", label: "Rennen wählen …" }].concat(rb.races.map(function (r) {
        return { value: r.id, label: (r.datum ? germanDate(r.datum) + " · " : "") + r.titel + (r.crew && r.crew.length ? " · " + r.crew.length + " Fahrer" : "") };
      })), "");
      $("rb-race").onchange = function () { pickRace(); };
      $("rb-date").onchange = function () { if (this.value) findEvents(this.value); };
      $("rb-event").onchange = function () { if (this.value) showRace(this.value); };
      message($("rb-view"), "Wähle oben ein abgeschlossenes Rennen. Die passende Session aus Garage 61 wird dann automatisch gesucht.");
    }).catch(function () { message($("rb-view"), "Der Rennkalender konnte nicht geladen werden.", true); });
  }

  function germanDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? m[3] + "." + m[2] + "." + m[1] : "";
  }

  function currentRace() {
    return rb.races.filter(function (r) { return r.id === $("rb-race").value; })[0] || null;
  }

  function pickRace() {
    var race = currentRace();
    fillSelect($("rb-event"), []);
    $("rb-date").disabled = !race;
    if (!race) return message($("rb-view"), "Wähle oben ein abgeschlossenes Rennen.");
    $("rb-date").value = race.datum ? String(race.datum).slice(0, 10) : "";
    if ($("rb-date").value) findEvents($("rb-date").value);
    else message($("rb-view"), "Für dieses Rennen ist im Kalender kein Datum eingetragen. Bitte den Renntag oben auswählen.");
  }

  function findEvents(datum) {
    var race = currentRace();
    message($("rb-view"), "Suche Sessions in Garage 61 …");
    api("/api/team/race?datum=" + encodeURIComponent(datum)).then(function (d) {
      if (!d.events.length) return message($("rb-view"), "An diesem Tag hat Garage 61 keine Session des Teams aufgezeichnet.");
      // Fahrer aus dem Kalender (ohne Zusätze wie „(Gast)") mit denen der Session abgleichen
      var crew = (race && race.crew || []).map(function (c) { return c.replace(/\s*\(.*\)\s*$/, "").toLowerCase(); });
      var score = function (e) {
        var hits = e.drivers.filter(function (n) { return crew.some(function (c) { return c.split(" ")[0] === n.toLowerCase().split(" ")[0]; }); }).length;
        return hits * 1000 + (e.official ? 500 : 0) + e.laps;
      };
      var list = d.events.slice().sort(function (a, b) { return score(b) - score(a); });
      fillSelect($("rb-event"), list.map(function (e) {
        var t = new Date(e.start).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        return { value: e.id, label: t + " · " + e.track + " · " + e.car + " · " + e.laps + " Runden · " + e.drivers.join(", ") };
      }), list[0].id);
      showRace(list[0].id);
    }).catch(function (e) { message($("rb-view"), e.message, true); });
  }

  function showRace(id) {
    message($("rb-view"), "Werte das Rennen aus …");
    api("/api/team/race?event=" + encodeURIComponent(id)).then(function (a) {
      if (a.empty) return message($("rb-view"), "In dieser Session gibt es keine Rennrunden. Wähle oben eine andere Session.");
      renderRace(currentRace(), a);
    }).catch(function (e) { message($("rb-view"), e.message, true); });
  }

  var sec = function (v) { return v == null ? "–" : v.toFixed(3).replace(".", ",") + " s"; };
  var lt = function (v) { return v == null ? "–" : lapTime(v); };

  function renderRace(race, a) {
    var kpi = function (label, value, sub) {
      return el("div", { className: "wb-kpi" }, [el("span", { className: "lbl", textContent: label }), el("b", { textContent: value }), el("span", { className: "delta", textContent: sub || "" })]);
    };
    var kpis = el("div", { className: "wb-kpis" }, [
      kpi("Renndauer", hours(a.duration), germanDate(a.start.slice(0, 10))),
      kpi("Runden", String(a.laps), a.stints.length + " Stints · " + a.pits + " Boxenstopps"),
      kpi("Schnellste Runde", lt(a.bestLap && a.bestLap.time), a.bestLap ? a.bestLap.driver + " · Runde " + a.bestLap.lap : ""),
      kpi("Saubere Runden", Math.round(a.cleanShare * 100) + " %", a.offtracks + " Ausrutscher")
    ]);
    var table = function (title, head, rows) {
      return el("div", { className: "rb-card" }, [
        el("h4", { textContent: title }),
        el("div", { className: "scroll" }, el("table", null, [
          el("thead", null, el("tr", null, head.map(function (h, i) { return el("th", { className: i > 0 ? "num" : "", textContent: h }); }))),
          el("tbody", null, rows.map(function (cells) {
            return el("tr", null, cells.map(function (c, i) { return el("td", { className: i === 0 ? "rb-name" : "num", textContent: c }); }));
          }))
        ]))
      ]);
    };
    var drivers = table("Fahrer", ["Fahrer", "Stints", "Runden", "Fahrzeit", "Bestzeit", "Ø Runde", "Konstanz", "Ausrutscher"],
      a.drivers.map(function (d) { return [d.driver, String(d.stints), String(d.laps), hours(d.time), lt(d.best), lt(d.median), d.spread == null ? "–" : "±" + sec(d.spread), String(d.offtracks)]; }));
    var stints = table("Stints", ["Fahrer", "Nr.", "Beginn", "Runden", "Dauer", "Bestzeit", "Ø Runde", "Boxenstopps"],
      a.stints.map(function (s) {
        return [s.driver, String(s.nr), new Date(s.start).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }), s.from + "–" + s.to, hours(s.time), lt(s.best), lt(s.median), String(s.pits)];
      }));

    var draft = reportDraft(race, a);
    var title = el("input", { type: "text", value: draft.titel });
    var teaser = el("input", { type: "text", value: draft.teaser });
    var text = el("textarea", { value: draft.inhalt, spellcheck: true });
    var copy = el("button", { type: "button", className: "rb-btn rb-ghost", textContent: "Text kopieren" });
    copy.addEventListener("click", function () {
      var done = function () { copy.textContent = "Kopiert ✓"; setTimeout(function () { copy.textContent = "Text kopieren"; }, 2000); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text.value).then(done, function () { text.select(); });
      else text.select();
    });
    var open = el("button", { type: "button", className: "rb-btn", textContent: "Als News-Entwurf öffnen" });
    open.addEventListener("click", function () {
      // Neuer News-Eintrag im Admin, Felder per Adresse vorausgefüllt (Dynamic Default Values wie bei Decap CMS)
      var q = new URLSearchParams({ titel: title.value, kategorie: "Rennbericht", datum: new Date().toISOString().slice(0, 10), teaser: teaser.value, inhalt: text.value });
      if (race && race.id) q.set("rennen", race.id);
      if (race && race.banner) q.set("bild", race.banner);
      window.open("/admin/#/collections/news/new?" + q.toString(), "_blank", "noopener");
    });

    $("rb-view").replaceChildren(
      kpis, drivers, stints,
      el("div", { className: "rb-draft" }, [
        el("h4", { className: "lbl", textContent: "Entwurf für die News · alles hier ist änderbar" }),
        el("label", null, [el("span", { className: "lbl", textContent: "Titel" }), title]),
        el("label", null, [el("span", { className: "lbl", textContent: "Kurztext" }), teaser]),
        el("label", null, [el("span", { className: "lbl", textContent: "Text (Markdown)" }), text]),
        el("div", { className: "rb-actions" }, [open, copy, el("span", { className: "lbl", textContent: "Im Admin ergänzen, prüfen und speichern, erst dann wird die News veröffentlicht." })])
      ])
    );
  }

  // Textvorlage: sachlicher Bericht aus Kalender (Titel, Crew, Start/Ziel) und Garage 61 (Stints, Pace, Wetter)
  function reportDraft(race, a) {
    race = race || {};
    var car = race.fahrzeug || a.car;
    var track = race.strecke || a.track;
    var names = a.drivers.map(function (d) { return d.driver; });
    var list = function (arr) { return arr.length < 2 ? arr.join("") : arr.slice(0, -1).join(", ") + " und " + arr[arr.length - 1]; };
    var dauer = race.dauer || hours(a.duration);
    var p = [];

    var intro = "Am " + germanDate(a.start.slice(0, 10)) + " ging Darkline Performance Motorsport beim " + (race.titel || "Rennen") +
      (race.serie ? " der " + race.serie : "") + " auf " + track + " an den Start. ";
    intro += names.length > 1 ? "Im " + car + " teilten sich " + list(names) + " das Cockpit." : names[0] + " fuhr den " + car + " allein über die volle Distanz.";
    if (race.start) intro += " Ins Rennen ging es von Startplatz " + race.start + ".";
    p.push(intro);

    var first = a.stints[0];
    var top = a.drivers[0];
    var verlauf = (names.length > 1 ? "Den Start übernahm " + first.driver + " und fuhr im ersten Stint " + first.laps + " Runden. " : "") +
      "Über " + dauer + " absolvierte das Team " + a.laps + " Runden" + (names.length > 1 ? ", verteilt auf " + a.stints.length + " Stints" : "") +
      " mit " + a.pits + (a.pits === 1 ? " Boxenstopp." : " Boxenstopps.");
    if (names.length > 1) verlauf += " Die meiste Zeit am Steuer verbrachte " + top.driver + " mit " + hours(top.time) + " in " + top.stints + (top.stints === 1 ? " Stint." : " Stints.");
    p.push(verlauf);

    if (a.bestLap) {
      var pace = "Die schnellste Runde des Teams fuhr " + a.bestLap.driver + " mit " + lapTime(a.bestLap.time) + " in Runde " + a.bestLap.lap + ".";
      if (a.medianLap) pace += " Die typische Rennrunde lag bei " + lapTime(a.medianLap) + ".";
      var steady = a.drivers.filter(function (d) { return d.spread != null && d.laps >= 10; }).sort(function (x, y) { return x.spread - y.spread; })[0];
      if (steady && names.length > 1) pace += " Am konstantesten war " + steady.driver + " mit einer typischen Abweichung von nur ±" + sec(steady.spread) + ".";
      p.push(pace);
    }

    var w = a.weather;
    var wetter = "Zu Beginn zeigte das Thermometer " + Math.round(w.airStart) + " °C Luft- und " + Math.round(w.trackStart) + " °C Streckentemperatur";
    wetter += w.trackMax - w.trackMin >= 8 ? ", im Rennverlauf schwankte die Strecke zwischen " + Math.round(w.trackMin) + " und " + Math.round(w.trackMax) + " °C." : ".";
    if (w.rain) wetter += " Zwischenzeitlich sorgte Regen für schwierige Bedingungen.";
    if (a.fuelPerLap) wetter += " Der Verbrauch lag im Schnitt bei " + String(a.fuelPerLap).replace(".", ",") + " Litern pro Runde.";
    p.push(wetter);

    if (race.ziel) {
      var ziel = "Am Ende sah der " + car + " auf Platz " + race.ziel + " die Zielflagge";
      var diff = race.start ? race.start - race.ziel : 0;
      ziel += diff > 0 ? ", " + diff + (diff === 1 ? " Platz" : " Plätze") + " besser als in der Startaufstellung." : ".";
      p.push(ziel);
    }

    p.push("> ✏️ Hier ergänzen: Schlüsselmomente, Zwischenfälle, Strategie und Stimmung im Team.");
    p.push("Danke an alle Zuschauer im Stream und an unsere Partner für die Unterstützung!");

    var rows = a.drivers.map(function (d) { return "| " + d.driver + " | " + d.stints + " | " + d.laps + " | " + hours(d.time) + " | " + lt(d.best) + " |"; });
    p.push("## Zahlen zum Rennen\n\n| Fahrer | Stints | Runden | Fahrzeit | Bestzeit |\n|---|---:|---:|---:|---:|\n" + rows.join("\n"));

    return {
      titel: race.bericht_titel || (race.titel || "Rennbericht") + (race.ziel ? ": P" + race.ziel + " im Ziel" : ""),
      teaser: [car, race.start && race.ziel ? "von P" + race.start + " auf P" + race.ziel : race.ziel ? "P" + race.ziel + " im Ziel" : "", a.laps + " Runden in " + dauer].filter(Boolean).join(" · "),
      inhalt: p.join("\n\n")
    };
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
