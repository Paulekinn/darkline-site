// Rennbericht im Admin-Bereich (/admin/rennbericht): Teamrennen aus dem Kalender auswerten und daraus einen
// News-Entwurf erstellen. Anmeldung mit GitHub wie im CMS; die Daten liefert /api/team/race (prüft den GitHub-Zugang).
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var TOKEN_KEY = "dpm_admin_github";

  // ---------------------------------------------------------------- Hilfen

  function el(tag, props, children) {
    var n = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) { n[k] = props[k]; });
    [].concat(children || []).forEach(function (c) { n.append(c); });
    return n;
  }

  function message(target, text, isError) {
    target.replaceChildren(el("p", { className: "msg" + (isError ? " err" : ""), textContent: text }));
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

  function hours(sec) {
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return h ? h + " h " + String(m).padStart(2, "0") + " min" : m + " min";
  }

  // ---------------------------------------------------------------- GitHub-Anmeldung (wie im CMS)

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
    $("rb-app").hidden = true;
    $("rb-login").hidden = false;
    $("rb-login-error").hidden = !error;
    $("rb-login-error").textContent = error || "";
  }

  $("rb-login-btn").addEventListener("click", function () {
    githubLogin().then(function (token) {
      try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) { /* nur für diese Sitzung nötig */ }
      start();
    }).catch(function (e) { showLogin(e.message); });
  });

  function start() {
    $("rb-login").hidden = true;
    $("rb-app").hidden = false;
    loadRaceList();
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
  var signed = function (v) { return v == null ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v).toFixed(1).replace(".", ",") + " s"; };
  // längere Dauern als m:ss min, kürzere in Sekunden
  var span = function (s) { var m = Math.floor(s / 60); return s < 90 ? Math.round(s) + " Sekunden" : m + ":" + String(Math.round(s - m * 60)).padStart(2, "0") + " Minuten"; };
  var stopCount = function (a) { return a.stops ? a.stops.length : a.pits; };

  function renderRace(race, a) {
    var kpi = function (label, value, sub) {
      return el("div", { className: "wb-kpi" }, [el("span", { className: "lbl", textContent: label }), el("b", { textContent: value }), el("span", { className: "delta", textContent: sub || "" })]);
    };
    var kpis = el("div", { className: "wb-kpis" }, [
      kpi("Renndauer", hours(a.duration), germanDate(a.start.slice(0, 10))),
      kpi("Runden", String(a.laps), a.stints.length + " Stints · " + stopCount(a) + " Boxenstopps"),
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
    var drivers = table("Fahrer", ["Fahrer", "Stints", "Runden", "Fahrzeit", "Bestzeit", "Ø Runde", "Zum Team", "Konstanz", "Ausrutscher"],
      a.drivers.map(function (d) { return [d.driver, String(d.stints), String(d.laps), hours(d.time), lt(d.best), lt(d.median), signed(d.vsTeam), d.spread == null ? "–" : "±" + sec(d.spread), String(d.offtracks)]; }));
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
      location.href = "/admin/#/collections/news/new?" + q.toString();
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
      " mit " + stopCount(a) + (stopCount(a) === 1 ? " Boxenstopp." : " Boxenstopps.");
    if (names.length > 1) verlauf += " Die meiste Zeit am Steuer verbrachte " + top.driver + " mit " + hours(top.time) + " in " + top.stints + (top.stints === 1 ? " Stint." : " Stints.");
    p.push(verlauf);

    if (a.bestLap) {
      var pace = "Die schnellste Runde des Teams fuhr " + a.bestLap.driver + " mit " + lapTime(a.bestLap.time) + " in Runde " + a.bestLap.lap + ".";
      if (a.medianLap) pace += " Die typische Rennrunde lag bei " + lapTime(a.medianLap) + ".";
      var steady = a.drivers.filter(function (d) { return d.spread != null && d.laps >= 10; }).sort(function (x, y) { return x.spread - y.spread; })[0];
      if (steady && names.length > 1) pace += " Am konstantesten war " + steady.driver + " mit einer typischen Abweichung von nur ±" + sec(steady.spread) + ".";
      // faire Pace: gegen die Teamkollegen im selben Zeitraum, Bedingungen herausgerechnet
      var strong = a.drivers.filter(function (d) { return d.vsTeam != null && d.laps >= 10; }).sort(function (x, y) { return x.vsTeam - y.vsTeam; })[0];
      if (strong && names.length > 1 && strong.vsTeam <= -0.2) {
        pace += " Rechnet man Tageszeit und Streckenbedingungen heraus, hatte " + strong.driver + " die stärkste Pace: im Schnitt " +
          Math.abs(strong.vsTeam).toFixed(1).replace(".", ",") + " Sekunden pro Runde schneller als die Teamkollegen im selben Zeitraum.";
      }
      p.push(pace);
    }

    // Boxenstopps und Zeitverluste (nur Teamwerte, keine Schuldzuweisung an einzelne Fahrer)
    if (a.stops && a.stops.length) {
      var changes = a.stops.filter(function (s) { return s.change; }).length;
      var losses = a.stops.map(function (s) { return s.loss; }).filter(function (x) { return x != null; }).sort(function (x, y) { return x - y; });
      var usual = losses.length ? losses[Math.floor(losses.length / 2)] : null;
      var box = "In der Box war das Team " + a.stops.length + "-mal" + (changes ? ", davon " + changes + "-mal mit Fahrerwechsel" : "") + ".";
      if (usual) box += " Ein normaler Stopp kostete rund " + span(usual) + " gegenüber einer Runde auf der Strecke.";
      var long = a.stops.filter(function (s) { return usual && s.loss > usual * 1.6; }).sort(function (x, y) { return y.loss - x.loss; });
      if (long.length === 1) box += " Deutlich länger dauerte nur der Stopp in Runde " + long[0].lap + ", er kostete etwa " + span(long[0].loss) + ".";
      else if (long.length > 1) box += " " + long.length + " Stopps dauerten deutlich länger als üblich, der längste in Runde " + long[0].lap + " kostete etwa " + span(long[0].loss) + ".";
      if (a.lossTime >= 5) box += " Abseits der Box kosteten langsame Runden, Verkehr und Zwischenfälle zusammen rund " + span(a.lossTime) + ".";
      p.push(box);
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

  // Start: mit gemerkter Anmeldung direkt los, sonst Anmeldeknopf
  if (storedToken()) start(); else showLogin();
})();
