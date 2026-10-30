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
  // Die Adresse bestimmt den sichtbaren Bereich: #rangliste (Standard), #wochenbericht, #telemetrie?strecke=…&auto=…&a=…&b=…&zoom=…,
  // #rennanalyse?event=…

  var TABS = ["rangliste", "wochenbericht", "telemetrie", "rennanalyse"];
  var weeklyLoaded = false;

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
    if (tab === "rennanalyse") initRace(new URLSearchParams(parts[1] || "").get("event") || "");
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
    var total = Math.round(sec / 60), h = Math.floor(total / 60), m = total % 60; // erst runden, sonst „60 min“
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

  // Abstände in Rundenpunkten sind für 1000 Punkte pro Runde gedacht; per() rechnet sie auf die echte Auflösung um
  var per = function (n, k) { return Math.max(1, Math.round(k * n / 1000)); };

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
    var on = false, out = [], gap = per(brake.length, 20);
    brake.forEach(function (b, i) {
      if (!on && b >= 15) {
        if (!out.length || i - out[out.length - 1] > gap) out.push(i);
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
    var segs = (on[0] > per(n, 10) ? [{ i0: 0, i1: on[0], start: true }] : []).concat(on.map(function (i0, k) {
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
        var near = s.start ? null : bOn.filter(function (j) { return Math.abs(j - s.i0) <= per(n, 30); })[0];
        if (near != null) c.brakeDiff = P.m[near] - P.m[s.i0]; // negativ = B bremst früher
      }
      return c;
    });
  }

  var signed = function (v, digits) { return (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v).toFixed(digits); };

  // Weiche Linie durch die Punkte i0…i1 (monotone kubische Kurve: rund, schießt aber nie über die Messwerte hinaus,
  // Gas und Bremse bleiben also zwischen 0 und 100 %). Im Zoom sieht man so den Verlauf statt Ecken zwischen Messpunkten.
  function smoothPath(i0, i1, xf, yf) {
    var xs = [], ys = [];
    for (var i = i0; i <= i1; i++) { xs.push(+xf(i)); ys.push(yf(i)); }
    var n = xs.length;
    if (n < 3) return xs.map(function (v, k) { return (k ? "L" : "M") + v + " " + ys[k]; }).join("");
    var dk = [], m = [];
    for (var k = 0; k < n - 1; k++) dk.push((ys[k + 1] - ys[k]) / ((xs[k + 1] - xs[k]) || 1));
    m[0] = dk[0];
    m[n - 1] = dk[n - 2];
    for (k = 1; k < n - 1; k++) m[k] = dk[k - 1] * dk[k] <= 0 ? 0 : (dk[k - 1] + dk[k]) / 2;
    for (k = 0; k < n - 1; k++) {
      if (dk[k] === 0) { m[k] = m[k + 1] = 0; continue; }
      var a = m[k] / dk[k], b = m[k + 1] / dk[k], h = a * a + b * b;
      if (h > 9) { var t = 3 / Math.sqrt(h); m[k] = t * a * dk[k]; m[k + 1] = t * b * dk[k]; }
    }
    var f = function (v) { return v.toFixed(1); };
    var d = "M" + f(xs[0]) + " " + f(ys[0]);
    for (k = 0; k < n - 1; k++) {
      var dx = (xs[k + 1] - xs[k]) / 3;
      d += "C" + f(xs[k] + dx) + " " + f(ys[k] + m[k] * dx) + " " + f(xs[k + 1] - dx) + " " + f(ys[k + 1] - m[k + 1] * dx) + " " + f(xs[k + 1]) + " " + f(ys[k + 1]);
    }
    return d;
  }

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
      if (opts.step) {
        for (var i = view.i0; i <= view.i1; i++) {
          var xx = x(i), yy = y(s.values[i]);
          d += i > view.i0 ? "H" + xx + "V" + yy : "M" + xx + " " + yy;
        }
      } else d = smoothPath(view.i0, view.i1, x, function (i) { return +y(s.values[i]); });
      svg.append(svgEl("path", { d: d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" }));
    });
    return el("div", { className: "tm-chart" }, [el("span", { className: "tm-name", textContent: name }), svg].concat(labels));
  }

  // Streckenkarte: Luftbild (Esri World Imagery) mit den GPS-Punkten der Runden darüber. iRacing liefert echte
  // Koordinaten der gescannten Strecken, die Fahrlinien liegen also auf dem echten Asphalt.
  // Ganze Runde: Fahrlinien, Kurvennummern und Positionspunkte. Im Zoom: Ausschnitt um den Abschnitt, Bremspunkte als Kreise.
  function trackMap(A, B, corners) {
    if (tm.map) tm.map.remove(); // Karte des vorigen Vergleichs freigeben
    // Rundenpunkt i (wie in den Diagrammen) → GPS-Punkt; die Karte ist anders aufgelöst (2000 GPS-Punkte)
    var idx = function (R, i) { var len = R.points.lat.length; return Math.min(len - 1, Math.round(i * (len - 1) / (R.points.t.length - 1))); };
    var ll = function (R, j) { return [R.points.lat[j], R.points.lon[j]]; };
    var at = function (R, i) { return ll(R, idx(R, i)); };
    var pathOf = function (R, i0, i1) {
      var out = [];
      for (var j = idx(R, i0); j <= idx(R, i1); j++) out.push(ll(R, j));
      return out;
    };
    var last = A.points.t.length - 1;

    // Am Handy kein Verschieben per Finger, damit die Seite scrollbar bleibt; gezoomt wird mit den Buttons
    var touch = L.Browser.mobile;
    var host = el("div", { className: "tm-map-canvas" });
    var map = L.map(host, { zoomControl: false, doubleClickZoom: false, dragging: !touch, touchZoom: !touch, tap: false,
      maxZoom: 21, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 120 });
    host.style.position = ""; // Leaflet setzt am noch nicht eingehängten Element "relative", die Position kommt aus dem CSS
    map.attributionControl.setPrefix(false);
    // Luftbilder gibt es bis Zoomstufe 19 (ca. 0,3 m pro Pixel), darüber wird vergrößert
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxNativeZoom: 19, maxZoom: 21, attribution: "Luftbild: Esri, Maxar, Earthstar Geographics"
    }).addTo(map);

    // Fahrlinie mit dunklem Rand, damit sie auf hellem Asphalt und auf Gras gleich gut zu sehen ist
    var line = function (color) {
      var edge = L.polyline([], { color: "#050606", weight: 5, opacity: 0.75, interactive: false }).addTo(map);
      var core = L.polyline([], { color: color, weight: 2.5, opacity: 1, interactive: false }).addTo(map);
      return function (pts) { edge.setLatLngs(pts); core.setLatLngs(pts); };
    };
    var lineB = B ? line(COLOR_B) : null, lineA = line(COLOR_A);
    var brakes = L.layerGroup();
    L.circleMarker(at(A, 0), { radius: 4, stroke: false, fillColor: "#ffd400", fillOpacity: 1, interactive: false }).addTo(map);
    corners.filter(function (c) { return c.num; }).forEach(function (c) {
      L.marker(at(A, c.apex), { interactive: false, keyboard: false,
        icon: L.divIcon({ className: "tm-map-num", html: String(c.num), iconSize: [24, 14], iconAnchor: [12, 20] }) }).addTo(map);
    });
    var dot = function (color) { return L.circleMarker(at(A, 0), { radius: 6, color: "#111416", weight: 2, fillColor: color, fillOpacity: 1, interactive: false }).addTo(map); };
    var dotB = B ? dot(COLOR_B) : null, dotA = dot(COLOR_A);
    var note = el("span", { className: "tm-map-note", hidden: true, textContent: "Fahrlinie A und B · ○ = Bremspunkt" });

    var bOnA = brakeOnsets(A.points.brake), bOnB = B ? brakeOnsets(B.points.brake) : [];
    var lapBounds = L.latLngBounds(pathOf(A, 0, last));
    var home = lapBounds, lapView = true, fitted = false;

    // Fahrlinien und Bremspunkte für den Bereich j0…j1 (Rundenpunkte wie in den Diagrammen)
    function setLines(j0, j1) {
      lineA(pathOf(A, j0, j1));
      if (lineB) lineB(pathOf(B, j0, j1));
      brakes.clearLayers();
      [[bOnA, A, COLOR_A], [bOnB, B, COLOR_B]].forEach(function (x) {
        if (!x[1]) return;
        x[0].filter(function (i) { return i >= j0 && i <= j1; }).forEach(function (i) {
          brakes.addLayer(L.circleMarker(at(x[1], i), { radius: 6, color: x[2], weight: 2, fill: false, interactive: false }));
        });
      });
    }

    // Bremspunkte: im Diagramm-Zoom immer, bei der ganzen Runde erst, wenn man in die Karte hineinzoomt
    var lapZoom = function () { return map.getBoundsZoom(lapBounds, false, L.point(28, 28)); };
    function update() {
      var show = !lapView || map.getZoom() >= lapZoom() + 1.5;
      if (show !== map.hasLayer(brakes)) show ? brakes.addTo(map) : brakes.remove();
      note.hidden = !show;
      zoomOut.disabled = map.getZoom() <= map.getMinZoom();
    }

    function goHome(animate) {
      if (!host.clientWidth || !host.clientHeight) return; // Karte noch nicht sichtbar: beim ersten Anzeigen nachholen
      map.invalidateSize();
      map.setMinZoom(Math.max(0, Math.floor(lapZoom()) - 1));
      map.fitBounds(home, { padding: [28, 28], maxZoom: 20, animate: animate });
      fitted = true;
    }

    // Ausschnitt passend zum Diagramm-Zoom
    function zoomTo(view, full) {
      lapView = full;
      if (full) {
        setLines(0, last);
        home = lapBounds;
      } else {
        // Etwas Anfahrt davor (ca. 60 m, damit frühere Bremspunkte sichtbar sind). Bei einer Kurve nur bis kurz nach
        // dem Scheitelpunkt, sonst wäre die folgende Gerade im Bild und die Kurve selbst zu klein.
        var j0 = Math.max(0, view.i0 - per(last + 1, 15));
        var j1 = view.num && view.apex != null ? Math.min(view.i1, view.apex + Math.max(per(last + 1, 25), view.apex - view.i0)) : view.i1;
        setLines(j0, j1);
        home = L.latLngBounds(pathOf(A, j0, j1).concat(B ? pathOf(B, j0, j1) : [])).pad(0.15);
      }
      goHome(fitted);
      update();
    }

    var tool = function (label, title, fn) {
      var b = el("button", { type: "button", textContent: label, title: title });
      b.setAttribute("aria-label", title);
      b.addEventListener("click", fn);
      return b;
    };
    var zoomIn = tool("+", "Karte vergrößern", function () { map.zoomIn(1); });
    var zoomOut = tool("−", "Karte verkleinern", function () { map.zoomOut(1); });
    var zoomHome = tool("⟲", "Karte zurücksetzen", function () { goHome(true); });
    var tools = el("div", { className: "tm-map-tools" }, [zoomIn, zoomOut, zoomHome]);

    map.on("zoomend", update);
    map.on("dblclick", function () { goHome(true); });
    // Größe der Spalte ändert sich (Fenster, Umbruch unter 1400 px, Bereich eingeblendet): Karte anpassen
    var ro = new ResizeObserver(function () {
      if (!host.clientWidth || !host.clientHeight) return;
      if (fitted) map.invalidateSize();
      else { goHome(false); update(); }
    });
    ro.observe(host);
    tm.map = { remove: function () { ro.disconnect(); map.remove(); } };

    setLines(0, last);
    return {
      node: el("div", { className: "tm-map" }, [host, tools, note]),
      move: function (i) {
        dotA.setLatLng(at(A, i));
        if (dotB) dotB.setLatLng(at(B, i));
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

    // Zoom als kurzer Code für den Link: k7 = Kurve 7, start, s2 = Sektor 2, r120-340 = aufgezogener Bereich.
    // Bereiche immer in Promille der Runde (0…999), damit Links unabhängig von der Auflösung gültig bleiben.
    var toMille = function (i) { return Math.round(i * 999 / (n - 1)); };
    var fromMille = function (v) { return Math.max(0, Math.min(n - 1, Math.round(v * (n - 1) / 999))); };
    var zoomCode = function (v) {
      if (v === full) return "";
      if (v.num) return "k" + v.num;
      if (v.name === "Start") return "start";
      if (v.short) return v.short.toLowerCase();
      return "r" + toMille(v.i0) + "-" + toMille(v.i1);
    };
    var fromCode = function (code) {
      var m = /^r(\d+)-(\d+)$/.exec(code);
      if (m) {
        var a = fromMille(+m[1]), b = fromMille(+m[2]);
        return b - a >= per(n, 8) ? { i0: a, i1: b, name: "Ausschnitt" } : null;
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
      if (b - a >= per(n, 8)) zoom({ i0: a, i1: b, name: "Ausschnitt" });
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

  // ---------------------------------------------------------------- Rennanalyse
  // Auswertung eines Teamrennens aus Garage 61. Rennen aus dem Kalender wählen, die passende Session wird gesucht.
  // Adresse: #rennanalyse?event=<Garage-61-Event>, damit sich eine Analyse als Link teilen lässt.

  var ra = { loaded: false, races: [], event: "", focus: null, chart: null };
  // Farben je Fahrer (feste Reihenfolge, Fahrer mit der meisten Fahrzeit zuerst)
  var RA_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

  var raSec = function (v, digits) { return v == null ? "–" : v.toFixed(digits == null ? 1 : digits).replace(".", ",") + " s"; };
  var raSigned = function (v) { return v == null ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v).toFixed(1).replace(".", ",") + " s"; };
  var raLap = function (v) { return v == null || !(v > 0) ? "–" : lapTime(v); };
  // Rennuhr: Zeit seit dem Start als h:mm
  var raClock = function (sec) { return Math.floor(sec / 3600) + ":" + String(Math.floor(sec % 3600 / 60)).padStart(2, "0") + " h"; };
  // längere Dauern als m:ss min (z. B. Zeit in der Box)
  var raMinutes = function (sec) { var m = Math.floor(sec / 60); return m + ":" + String(Math.round(sec - m * 60)).padStart(2, "0") + " min"; };

  function germanDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? m[3] + "." + m[2] + "." + m[1] : "";
  }

  function initRace(eventId) {
    if (eventId && eventId !== ra.event) showRaceAnalysis(eventId);
    if (ra.loaded) return;
    ra.loaded = true;
    $("ra-race").addEventListener("change", pickRaceEntry);
    $("ra-date").addEventListener("change", function () { if (this.value) findRaceEvents(this.value); });
    $("ra-event").addEventListener("change", function () { if (this.value) openRaceEvent(this.value); });
    fetch("/content/races.json", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) {
      ra.races = (d.races || []).filter(function (r) { return r.status === "abgeschlossen"; })
        .sort(function (a, b) { return String(b.datum || "").localeCompare(String(a.datum || "")); });
      fillSelect($("ra-race"), [{ value: "", label: ra.races.length ? "Rennen wählen …" : "Noch kein abgeschlossenes Rennen" }].concat(ra.races.map(function (r) {
        return { value: r.id, label: (r.datum ? germanDate(r.datum) + " · " : "") + r.titel };
      })), "");
      $("ra-race").disabled = !ra.races.length;
      $("ra-date").disabled = false;
      if (!ra.event) message($("ra-view"), "Wähle oben ein abgeschlossenes Rennen aus dem Kalender oder direkt einen Renntag. Die passende Session aus Garage 61 wird automatisch gesucht.");
      // per Link geöffnete Analyse war schneller als der Kalender: jetzt Rennen zuordnen (Start/Ziel)
      else if (ra.analysis && !raceEntry() && matchEntry(ra.analysis)) renderRaceAnalysis(ra.analysis);
    }).catch(function () {
      $("ra-date").disabled = false;
      if (!ra.event) message($("ra-view"), "Der Rennkalender konnte nicht geladen werden. Den Renntag kannst du oben trotzdem wählen.", true);
    });
  }

  function raceEntry() {
    return ra.races.filter(function (r) { return r.id === $("ra-race").value; })[0] || null;
  }

  // Analyse ohne gewähltes Rennen (geteilter Link): Kalendereintrag über das Datum finden.
  // Renndatum ist deutsche Zeit, Garage 61 UTC, daher ±1 Tag; nur bei genau einem Treffer.
  function matchEntry(a) {
    var t = new Date(a.start).getTime();
    var hits = ra.races.filter(function (r) {
      return r.datum && Math.abs(new Date(String(r.datum).slice(0, 10) + "T12:00:00Z").getTime() - t) < 1.5 * 86400000;
    });
    if (hits.length !== 1) return null;
    $("ra-race").value = hits[0].id;
    return hits[0];
  }

  function pickRaceEntry() {
    var race = raceEntry();
    fillSelect($("ra-event"), []);
    if (!race) return message($("ra-view"), "Wähle oben ein abgeschlossenes Rennen.");
    $("ra-date").value = race.datum ? String(race.datum).slice(0, 10) : "";
    if ($("ra-date").value) findRaceEvents($("ra-date").value);
    else message($("ra-view"), "Für dieses Rennen ist im Kalender kein Datum eingetragen. Bitte den Renntag oben auswählen.");
  }

  function findRaceEvents(datum) {
    var race = raceEntry();
    message($("ra-view"), "Suche Sessions in Garage 61 …");
    api("/api/team/race?datum=" + encodeURIComponent(datum)).then(function (d) {
      if (!d.events.length) { fillSelect($("ra-event"), []); return message($("ra-view"), "An diesem Tag hat Garage 61 keine Session des Teams aufgezeichnet."); }
      // Fahrer aus dem Kalender (ohne Zusätze wie „(Gast)") mit denen der Session abgleichen
      var crew = (race && race.crew || []).map(function (c) { return c.replace(/\s*\(.*\)\s*$/, "").toLowerCase(); });
      var score = function (e) {
        var hits = e.drivers.filter(function (n) { return crew.some(function (c) { return c.split(" ")[0] === n.toLowerCase().split(" ")[0]; }); }).length;
        return hits * 1000 + (e.official ? 500 : 0) + e.laps;
      };
      var list = d.events.slice().sort(function (a, b) { return score(b) - score(a); });
      fillSelect($("ra-event"), list.map(function (e) {
        var t = new Date(e.start).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        return { value: e.id, label: t + " · " + e.track + " · " + e.laps + " Runden · " + e.drivers.join(", ") };
      }), list[0].id);
      openRaceEvent(list[0].id);
    }).catch(function (e) { message($("ra-view"), e.message, true); });
  }

  function openRaceEvent(id) {
    history.replaceState(null, "", location.pathname + "#rennanalyse?event=" + encodeURIComponent(id));
    showRaceAnalysis(id);
  }

  function showRaceAnalysis(id) {
    ra.event = id;
    message($("ra-view"), "Werte das Rennen aus … Bei 24 Stunden kann das einen Moment dauern.");
    api("/api/team/race?event=" + encodeURIComponent(id)).then(function (a) {
      if (ra.event !== id) return; // inzwischen anderes Rennen gewählt
      if (a.empty) return message($("ra-view"), "In dieser Session gibt es keine Rennrunden. Wähle oben eine andere Session.");
      renderRaceAnalysis(a);
    }).catch(function (e) { if (ra.event === id) message($("ra-view"), e.message, true); });
  }

  // Tabelle mit anklickbaren Zeilen. rows: { cells: [...], color, onClick }
  // opts.text: Spalten mit Text (links, dürfen umbrechen), opts.opt: Spalten, die auf schmalen Bildschirmen wegfallen
  function raTable(head, rows, opts) {
    opts = opts || {};
    var cls = function (i) {
      if (i === 0) return "ra-nm";
      return (opts.text && opts.text.indexOf(i) !== -1 ? "ra-txt" : "num") + (opts.opt && opts.opt.indexOf(i) !== -1 ? " ra-opt" : "");
    };
    var body = el("tbody", null, rows.map(function (r) {
      var tr = el("tr", { tabIndex: 0 }, r.cells.map(function (c, i) {
        if (i === 0) return el("td", { className: "ra-nm" }, [r.color ? el("i", { style: "background:" + r.color }) : "", c]);
        return el("td", { className: cls(i) }, c);
      }));
      if (r.onClick) {
        tr.addEventListener("click", function () { r.onClick(tr); });
        tr.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); r.onClick(tr); } });
      }
      return tr;
    }));
    var table = el("table", { className: "ra-table" }, [
      el("thead", null, el("tr", null, head.map(function (h, i) { return el("th", { className: i ? cls(i) : "", textContent: h }); }))),
      body
    ]);
    return el("div", { className: "ra-scroll" }, table);
  }

  // Klick auf eine Zeile markiert die Runden im Diagramm, zweiter Klick hebt die Markierung auf
  function markRows(tr, from, to) {
    var on = tr.getAttribute("aria-pressed") !== "true";
    document.querySelectorAll("#ra-view .ra-table tr[aria-pressed]").forEach(function (r) { r.removeAttribute("aria-pressed"); });
    if (on) tr.setAttribute("aria-pressed", "true");
    ra.chart.mark(on ? { from: from, to: to } : null);
  }

  function renderRaceAnalysis(a) {
    var box = $("ra-view");
    ra.analysis = a;
    var entry = raceEntry() || matchEntry(a);
    ra.focus = null;
    var colors = {};
    a.drivers.forEach(function (d, i) { colors[d.driver] = RA_COLORS[i % RA_COLORS.length]; });

    var when = new Date(a.start).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    var head = el("div", { className: "wb-head" }, [
      el("h3", { textContent: entry ? entry.titel : a.track }),
      el("span", { textContent: [entry ? a.track : "", a.car, when + " Uhr"].filter(Boolean).join(" · ") })
    ]);

    var kpi = function (label, value, sub) {
      return el("div", { className: "wb-kpi" }, [el("span", { className: "lbl", textContent: label }), el("b", { textContent: value }), el("span", { className: "delta", textContent: sub })]);
    };
    var changes = a.stops.filter(function (s) { return s.change; }).length;
    var w = a.weather;
    var kpis = el("div", { className: "wb-kpis" }, [
      kpi("Renndauer", hours(a.duration), a.laps + " Runden · " + a.drivers.length + " Fahrer"),
      kpi("Boxenstopps", String(a.stops.length), changes + " mit Fahrerwechsel"),
      kpi("Zeit in der Box", raMinutes(a.stopLoss || 0), "Verlust gegenüber normalen Runden"),
      kpi("Verlust auf der Strecke", raMinutes(a.lossTime || 0), a.losses.length + " Runden langsamer als das Umfeld"),
      kpi("Schnellste Runde", a.bestLap ? lapTime(a.bestLap.time) : "–", a.bestLap ? a.bestLap.driver + " · Runde " + a.bestLap.lap : ""),
      kpi("Typische Runde", raLap(a.medianLap), "Median aller sauberen Runden"),
      kpi("Sprit pro Runde", a.fuelPerLap ? String(a.fuelPerLap).replace(".", ",") + " l" : "–", "Median der sauberen Runden"),
      kpi("Streckentemperatur", w.trackStart != null ? Math.round(w.trackStart) + " → " + Math.round(w.trackEnd) + " °C" : "–",
        w.trackMin != null ? "min " + Math.round(w.trackMin) + " · max " + Math.round(w.trackMax) + " °C" + (w.rain ? " · Regen" : "") : "")
    ]);

    // Fahrer-Buttons: heben einen Fahrer im Diagramm hervor
    var keys = el("div", { className: "ra-keys" }, a.drivers.map(function (d, i) {
      var b = el("button", { type: "button", className: "ra-key" }, [el("i", { style: "background:" + colors[d.driver] }), d.driver]);
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () { focusDriver(ra.focus === i ? null : i); });
      return b;
    }));
    var focusDriver = function (i) {
      ra.focus = i;
      keys.querySelectorAll("button").forEach(function (b, k) { b.setAttribute("aria-pressed", String(k === i)); });
      ra.chart.focus(i);
    };

    ra.chart = paceChart(a, colors);
    // Umschalter: Stint-Pace (übersichtlich) oder alle Einzelrunden mit Zwischenfällen
    var note = el("p", { className: "ra-note" });
    var modeBtns = [["Stint-Pace", false], ["Alle Runden", true]].map(function (m) {
      var b = el("button", { type: "button", className: "ra-mode", textContent: m[0] });
      b.addEventListener("click", function () { setMode(m[1]); });
      return b;
    });
    var setMode = function (all) {
      modeBtns.forEach(function (b, k) { b.setAttribute("aria-pressed", String(k === (all ? 1 : 0))); });
      note.textContent = all
        ? "● saubere Runde · ○ Runde mit Abflug oder Zwischenfall · ▲ langsamer als der sichtbare Bereich · Linie = typische Runde des Stints · gestrichelt = Boxenstopp · blau hinterlegt = Regen"
        : "Dicke Linie = typische Rundenzeit des Stints, blasse Punkte = Einzelrunden · gestrichelt = Boxenstopp · blau hinterlegt = Regen · Fahrer anklicken zeigt dessen Runden";
      ra.chart.allLaps(all);
    };
    var paceCard = el("div", { className: "ra-card" }, [
      el("div", { className: "ra-card-head" }, [
        el("h4", { textContent: "Rundenzeiten im Rennverlauf" }),
        el("div", { className: "ra-modes" }, modeBtns)
      ]),
      keys,
      ra.chart.node,
      note
    ]);
    setMode(false);

    var drivers = raTable(["Fahrer", "Stints", "Runden", "Fahrzeit", "Beste", "Typisch", "Zum Team", "Konstanz", "Abflüge", "Verlust"],
      a.drivers.map(function (d, i) {
        return {
          cells: [d.driver, String(d.stints), String(d.laps), hours(d.time), raLap(d.best), raLap(d.median), raSigned(d.vsTeam), d.spread == null ? "–" : "±" + raSec(d.spread, 2), String(d.offtracks),
            raSec(d.lossTime) + " (" + d.lossLaps + ")"],
          color: colors[d.driver],
          onClick: function () { focusDriver(ra.focus === i ? null : i); }
        };
      }), { opt: [1, 3, 4, 8] });

    var stints = raTable(["Stint", "Runden", "Dauer", "Typisch", "Zum Team", "Konstanz", "Abbau", "Sprit/Runde"],
      a.stints.map(function (s) {
        return {
          cells: [s.nr + " · " + s.driver, s.from + "–" + s.to + " (" + s.laps + ")", hours(s.time), raLap(s.median), raSigned(s.vsTeam), s.spread == null ? "–" : "±" + raSec(s.spread, 2),
            raSigned(s.fade), s.fuelPerLap ? String(s.fuelPerLap).replace(".", ",") + " l" : "–"],
          color: colors[s.driver],
          onClick: function (tr) { markRows(tr, s.from, s.to); }
        };
      }), { opt: [2, 5, 7] });

    // lange Stopps (deutlich über dem üblichen Stopp) markieren: meist Reparatur oder Strafe
    var usual = (function () {
      var v = a.stops.map(function (s) { return s.loss; }).filter(function (x) { return x != null; }).sort(function (x, y) { return x - y; });
      return v.length ? v[Math.floor(v.length / 2)] : null;
    })();
    var stops = a.stops.length ? raTable(["Runde", "Rennzeit", "Fahrer", "Sprit", "Verlust"],
      a.stops.map(function (s) {
        var long = usual && s.loss > usual * 1.6;
        return {
          cells: ["Runde " + s.lap, raClock(s.time), s.change ? s.from + " → " + s.to : s.from + " (kein Wechsel)", s.fuel ? String(s.fuel).replace(".", ",") + " l" : "–",
            el("span", null, [raSec(s.loss), long ? el("span", { className: "ra-tag", textContent: "lang" }) : ""])],
          onClick: function (tr) { markRows(tr, s.lap, s.lap + 1); }
        };
      }), { text: [2], opt: [1, 3] }) : el("p", { className: "msg", textContent: "Keine Boxenstopps aufgezeichnet." });

    var top = a.losses.slice(0, 10);
    var losses = top.length ? raTable(["Runde", "Rennzeit", "Fahrer", "Zeit", "Verlust", "Grund"],
      top.map(function (x) {
        return {
          cells: ["Runde " + x.lap, raClock(x.time), x.driver, lapTime(x.lapTime), "+" + raSec(x.loss), x.reason],
          color: colors[x.driver],
          onClick: function (tr) { markRows(tr, x.lap, x.lap); }
        };
      }), { text: [2, 5], opt: [1, 3] }) : el("p", { className: "msg", textContent: "Keine Runde war deutlich langsamer als das Umfeld." });

    var card = function (title, content, note, wide) {
      return el("div", { className: "ra-card" + (wide ? " ra-wide" : "") }, [el("h4", { textContent: title }), content].concat(note ? el("p", { className: "ra-note", textContent: note }) : []));
    };
    var grid = el("div", { className: "ra-grid" }, [
      card("Fahrervergleich · Zeile anklicken zum Hervorheben", drivers,
        "Typisch = Median der sauberen Runden ohne Box und Startrunde. Zum Team = faire Pace: jede saubere Runde gegen die Teamkollegen, die in den 40 Runden davor und danach bei gleich nasser Strecke gefahren sind (minus = schneller). So zählen Nacht, Regen und Gummi für alle gleich. Konstanz = typische Abweichung vom Median. Verlust = Zeit in Runden, die über 2 % langsamer als das Umfeld waren (Anzahl in Klammern).", true),
      card("Stints · Zeile anklicken zum Markieren", stints,
        "Abbau = Schnitt der letzten 5 gegen die ersten 5 sauberen Runden des Stints (plus = am Ende langsamer, z. B. durch Reifen). Erst ab 12 sauberen Runden.", true),
      card("Boxenstopps", stops,
        "Verlust = Zeit von der Einfahrt bis zur ersten normalen Runde, abzüglich der Rundenzeit im Umfeld. „lang“ = deutlich länger als üblich, oft Reparatur oder Strafe."),
      card("Größte Zeitverluste auf der Strecke", losses,
        "Runden ohne Boxenstopp, die über 2 % langsamer waren als die sauberen Runden des Teams davor und danach. Regen oder Nacht zählen so nicht mit. „Langsame Runde“ = sauber, aber langsam, z. B. Verkehr oder Gelbphase." +
        (a.losses.length > top.length ? " Gezeigt: die 10 größten von " + a.losses.length + "." : ""))
    ]);

    box.replaceChildren(head, positions(entry), kpis, paceCard, grid);
    ra.chart.draw();
  }

  // Start- und Zielposition aus dem Kalender (Garage 61 kennt keine Positionen)
  function positions(entry) {
    if (!entry) return "";
    var start = Number(entry.start) || null, ziel = Number(entry.ziel) || null;
    if (!start && !ziel) {
      return el("p", { className: "ra-pos-hint", textContent: "Start- und Zielposition fehlen im Kalender. Im Admin beim Rennen eintragen, dann erscheinen sie hier." });
    }
    var diff = start && ziel ? start - ziel : null;
    var txt = diff == null ? (ziel ? "Startplatz nicht eingetragen" : "Zielposition nicht eingetragen")
      : diff > 0 ? diff + (diff === 1 ? " Platz" : " Plätze") + " gutgemacht"
      : diff < 0 ? -diff + (diff === -1 ? " Platz" : " Plätze") + " verloren" : "Position gehalten";
    var pos = function (label, v) { return el("div", null, [el("span", { className: "lbl", textContent: label }), el("b", { textContent: v ? "P" + v : "–" })]); };
    return el("div", { className: "ra-pos" }, [
      pos("Start", start),
      el("span", { className: "ra-pos-arrow", textContent: "→", ariaHidden: "true" }),
      pos("Ziel", ziel),
      el("div", { className: "ra-pos-sum" }, [el("b", { textContent: txt }), el("span", { textContent: [entry.klasse ? "Klasse " + entry.klasse : "", entry.fazit || ""].filter(Boolean).join(" · ") })])
    ]);
  }

  // Rundenzeiten über das Rennen (Punkte je Fahrer), darunter die Stints als Band und die Streckentemperatur.
  // Wird in echter Pixelbreite gezeichnet, damit die Schrift auch auf dem Handy lesbar bleibt.
  function paceChart(a, colors) {
    var wrap = el("div", { className: "ra-chart" });
    var tip = el("div", { className: "tm-tip", hidden: true });
    var holder = el("div");
    wrap.append(holder, tip);

    var names = a.drivers.map(function (d) { return d.driver; });
    var rows = a.lapRows.filter(function (r) { return r[0] >= 1 && !(r[3] & 16); });
    var maxLap = Math.max.apply(null, a.lapRows.map(function (r) { return r[0]; })) || 1;
    var racing = function (r) { return (r[3] & 8) && !(r[3] & 3) && r[0] > 1 && r[2] > 0; };
    var pace = rows.filter(racing).map(function (r) { return r[2]; }).sort(function (x, y) { return x - y; });
    if (!pace.length) pace = rows.map(function (r) { return r[2]; }).filter(function (v) { return v > 0; }).sort(function (x, y) { return x - y; });
    var lo = Math.floor((pace[0] || 60) - 0.5);
    var hi = Math.ceil(Math.min(pace[Math.floor(pace.length * 0.92)] + 1, (a.medianLap || pace[0]) * 1.05));
    if (!(hi > lo + 2)) hi = lo + 3;
    var temps = a.lapRows.filter(function (r) { return typeof r[4] === "number"; });
    var tMin = Math.floor(Math.min.apply(null, temps.map(function (r) { return r[4]; })) - 1);
    var tMax = Math.ceil(Math.max.apply(null, temps.map(function (r) { return r[4]; })) + 1);
    var stintAt = function (lap) { return a.stints.filter(function (s) { return lap >= s.from && lap <= s.to; })[0]; };
    var marked = null, focus = null, lastW = 0;
    var allLaps = false; // Standard: Stint-Pace im Vordergrund, Einzelrunden nur blass im Hintergrund
    var geo = null;

    function draw() {
      var W = Math.max(280, Math.round(wrap.clientWidth || 900));
      lastW = W;
      var L = 50, R = 10, T = 10;
      var H1 = Math.round(Math.min(460, Math.max(240, W * 0.38)));
      var stripY = T + H1 + 26, stripH = 12;
      var tT = stripY + stripH + 30, H2 = temps.length ? 70 : 0;
      var H = tT + H2 + 22;
      var x = function (lap) { return L + lap / maxLap * (W - L - R); };
      var y = function (t) { return T + (hi - Math.min(hi, Math.max(lo, t))) / (hi - lo) * H1; };
      var y2 = function (t) { return tT + (tMax - t) / (tMax - tMin || 1) * H2; };
      geo = { L: L, R: R, W: W, x: x };
      var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, "class": "ra-svg" });

      // Regen hinterlegen
      var run = null;
      a.lapRows.concat([[maxLap + 1, 0, 0, 0]]).forEach(function (r) {
        var wet = r[3] & 32;
        if (wet && !run) run = { from: r[0] };
        if (!wet && run) {
          svg.append(svgEl("rect", { x: x(run.from), y: T, width: Math.max(2, x(r[0]) - x(run.from)), height: H1, fill: "rgba(57,135,229,.12)" }));
          run = null;
        }
      });

      // Raster: Rundenzeiten links, Runden unten
      var range = hi - lo, step = range > 24 ? 5 : range > 12 ? 2 : 1;
      for (var v = Math.ceil(lo / step) * step; v <= hi; v += step) {
        svg.append(svgEl("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: "#1b1f21" }));
        svg.append(svgEl("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, lapTime(v).replace(/\.000$/, "")));
      }
      var ls = [5, 10, 20, 25, 50, 100, 200].filter(function (s) { return maxLap / s <= (W < 600 ? 5 : 10); })[0] || 500;
      for (var n = 0; n <= maxLap; n += ls) {
        svg.append(svgEl("line", { x1: x(n), x2: x(n), y1: T + H1, y2: T + H1 + 4, stroke: "#3a4144" }));
        svg.append(svgEl("text", { x: x(n), y: T + H1 + 16, "text-anchor": "middle" }, String(n)));
      }
      svg.append(svgEl("text", { x: W - R, y: T + H1 + 16, "text-anchor": "end" }, "Runde"));

      // Boxenstopps
      a.stops.forEach(function (s) {
        svg.append(svgEl("line", { x1: x(s.lap), x2: x(s.lap), y1: T, y2: T + H1, stroke: "#2a2f31", "stroke-dasharray": "2 4" }));
      });

      // Punkte je Fahrer
      var groups = names.map(function (_, i) { return svgEl("g", { "data-d": i }); });
      rows.forEach(function (r) {
        if (r[3] & 3 || !(r[2] > 0)) return; // Boxenrunden zeigen die senkrechten Striche
        var c = colors[names[r[1]]], g = groups[r[1]];
        if (!g) return;
        if (r[2] > hi) { if (allLaps) g.append(svgEl("path", { d: "M" + (x(r[0]) - 3) + " " + (T + 6) + "h6l-3 -5z", fill: c })); }
        else if (r[3] & 8 || !allLaps) g.append(svgEl("circle", { cx: x(r[0]), cy: y(r[2]), r: allLaps ? 2.4 : 1.8, fill: c }));
        else g.append(svgEl("circle", { cx: x(r[0]), cy: y(r[2]), r: 2.6, fill: "none", stroke: c, "stroke-width": 1.4 }));
      });
      groups.forEach(function (g) { g.setAttribute("class", allLaps ? "" : "ra-faint"); svg.append(g); });

      // typische Runde je Stint als Linie, mit dunklem Rand gegen die Punkte
      a.stints.forEach(function (s) {
        if (s.median == null) return;
        var d = names.indexOf(s.driver);
        var g = svgEl("g", { "data-d": d });
        var sw = allLaps ? 2.5 : 4;
        g.append(svgEl("line", { x1: x(s.from), x2: x(s.to), y1: y(s.median), y2: y(s.median), stroke: "#101315", "stroke-width": sw + 3, "stroke-linecap": "round" }));
        g.append(svgEl("line", { x1: x(s.from), x2: x(s.to), y1: y(s.median), y2: y(s.median), stroke: colors[s.driver], "stroke-width": sw, "stroke-linecap": "round" }));
        svg.append(g);
      });

      // Stints als Band
      svg.append(svgEl("text", { x: L - 6, y: stripY + 10, "text-anchor": "end" }, "Stints"));
      a.stints.forEach(function (s) {
        svg.append(svgEl("rect", { "data-d": names.indexOf(s.driver), x: x(s.from), y: stripY, width: Math.max(1, x(s.to + 1) - x(s.from) - 2), height: stripH, rx: 2, fill: colors[s.driver] }));
      });

      // Streckentemperatur
      if (H2) {
        svg.append(svgEl("text", { x: L, y: tT - 10 }, "Streckentemperatur"));
        [tMin, tMax].forEach(function (t) {
          svg.append(svgEl("line", { x1: L, x2: W - R, y1: y2(t), y2: y2(t), stroke: "#1b1f21" }));
          svg.append(svgEl("text", { x: L - 6, y: y2(t) + 4, "text-anchor": "end" }, t + " °C"));
        });
        svg.append(svgEl("polyline", { points: temps.map(function (r) { return x(r[0]).toFixed(1) + "," + y2(r[4]).toFixed(1); }).join(" "), fill: "none", stroke: "#c4cbc8", "stroke-width": 2, "stroke-linejoin": "round" }));
      }

      // markierte Runden (aus den Tabellen)
      if (marked) {
        var x0 = x(marked.from), x1 = x(marked.to + (marked.to > marked.from ? 1 : 0));
        svg.append(svgEl("rect", { x: Math.min(x0, x1) - 2, y: T, width: Math.max(4, Math.abs(x1 - x0) + 4), height: (H2 ? tT + H2 : stripY + stripH) - T, fill: "rgba(232,236,234,.08)", stroke: "rgba(232,236,234,.5)" }));
      }

      var cursor = svgEl("line", { y1: T, y2: H2 ? tT + H2 : stripY + stripH, stroke: "rgba(232,236,234,.55)", visibility: "hidden" });
      svg.append(cursor);
      geo.cursor = cursor;
      holder.replaceChildren(svg);
      applyFocus();
    }

    function applyFocus() {
      holder.querySelectorAll("[data-d]").forEach(function (g) {
        // hervorgehobener Fahrer: auch seine Einzelrunden voll zeigen
        g.style.opacity = focus == null ? "" : Number(g.getAttribute("data-d")) === focus ? "1" : ".12";
      });
    }

    // Hover: nächstgelegene Runde mit allen Angaben
    function hover(e) {
      if (!geo) return;
      var rect = holder.getBoundingClientRect();
      var px = e.clientX - rect.left;
      var lap = Math.round((px - geo.L) / (geo.W - geo.L - geo.R) * maxLap);
      if (lap < 0 || lap > maxLap) return leave();
      var r = null;
      a.lapRows.forEach(function (row) { if (!r || Math.abs(row[0] - lap) < Math.abs(r[0] - lap)) r = row; });
      if (!r) return leave();
      var s = stintAt(r[0]);
      var flags = [r[3] & 1 ? "Box rein" : "", r[3] & 2 ? "Box raus" : "", r[3] & 4 ? "Abflug" : "", !(r[3] & 8) && !(r[3] & 4) ? "Zwischenfall" : "", r[3] & 32 ? "Regen" : ""].filter(Boolean);
      var line = function (k, v) { return el("tr", null, [el("td", { textContent: k }), el("td", { textContent: v })]); };
      tip.replaceChildren(
        el("b", { textContent: "Runde " + r[0] + " · nach " + raClock(r[5] || 0) }),
        el("table", null, [
          line("Fahrer", names[r[1]] || "–"),
          line("Zeit", raLap(r[2])),
          s && s.median && r[2] > 0 && !(r[3] & 3) ? line("zum Stint", raSigned(r[2] - s.median)) : "",
          typeof r[4] === "number" ? line("Strecke", Math.round(r[4]) + " °C") : "",
          flags.length ? line("Hinweis", flags.join(", ")) : ""
        ])
      );
      tip.hidden = false;
      var cx = geo.x(r[0]);
      geo.cursor.setAttribute("x1", cx);
      geo.cursor.setAttribute("x2", cx);
      geo.cursor.setAttribute("visibility", "visible");
      var tw = tip.offsetWidth;
      tip.style.left = (cx + 16 + tw > geo.W ? Math.max(0, cx - 16 - tw) : cx + 16) + "px";
    }
    function leave() {
      tip.hidden = true;
      if (geo && geo.cursor) geo.cursor.setAttribute("visibility", "hidden");
    }
    holder.addEventListener("pointermove", hover);
    holder.addEventListener("pointerleave", leave);

    if (window.ResizeObserver) new ResizeObserver(function () { if (wrap.isConnected && Math.abs(wrap.clientWidth - lastW) > 4) draw(); }).observe(wrap);

    return {
      node: wrap,
      draw: draw,
      focus: function (i) { focus = i; applyFocus(); },
      allLaps: function (on) { allLaps = on; draw(); },
      mark: function (m) { marked = m; draw(); if (m) wrap.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
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
