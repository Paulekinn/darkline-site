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
