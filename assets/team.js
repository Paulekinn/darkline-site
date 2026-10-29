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
    }).catch(function (e) { message(box, e.message, true); });
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
      showCars(box, d.cars);
    }).catch(function (e) { message(box, e.message, true); });
  }

  // Oben ein Button pro Auto, darunter nur die Tabelle des gewählten Autos (hält den Bereich kurz).
  function showCars(box, cars) {
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
        table.replaceChildren(carTable(car));
      });
      b.setAttribute("aria-pressed", String(i === 0));
      tabs.append(b);
    });
    table.replaceChildren(carTable(cars[0]));
    box.replaceChildren(tabs, table);
  }

  function carTable(car) {
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
        el("a", { href: car.link, target: "_blank", rel: "noopener", textContent: "In Garage 61 öffnen ↗" })
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
    var bars = function (title, items, sub) {
      var top = items.reduce(function (m, x) { return Math.max(m, x.time); }, 0) || 1;
      return el("div", { className: "wb-card" }, [el("h4", { textContent: title })].concat(items.map(function (x) {
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
      })));
    };
    var share = function (x) { return "· " + Math.round(x.time / w.time * 100) + " %"; };
    var grid = el("div", { className: "wb-grid" }, [
      bars("Fahrzeit pro Fahrer", w.drivers, laps),
      bars("Training, Quali, Rennen", w.sessions, share),
      bars("Meistgefahrene Strecken", w.tracks, laps),
      bars("Meistgefahrene Autos", w.cars, laps)
    ]);

    box.replaceChildren(trend, axis, head, kpis, grid);
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
