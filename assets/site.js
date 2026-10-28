/* Darkline Performance Motorsport – lädt alle Inhalte aus /content/*.json (gepflegt über /admin) */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Bildpfade aus dem CMS beginnen mit "/" – relativ machen, damit die Seite auch in Unterordnern läuft
  const src = (p) => (p ? String(p).replace(/^\/+/, "") : "");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const parseDate = (d) => { if (!d) return null; const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const fmt = (d) => { const x = parseDate(d); return x ? x.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "Datum folgt"; };
  const md = (text) => {
    if (!text || !String(text).trim()) return "";
    const html = window.marked ? window.marked.parse(String(text)) : "<p>" + esc(text).replace(/\n{2,}/g, "</p><p>") + "</p>";
    return window.DOMPurify ? window.DOMPurify.sanitize(html) : html;
  };
  const short = (name) => { const p = String(name).replace(/\s*\(.*\)$/, "").trim().split(/\s+/); return p.length > 1 ? p.slice(0, -1).map((x) => x[0] + ".").join(" ") + " " + p[p.length - 1] : name; };

  async function load(name) {
    try { const r = await fetch("content/" + name + ".json", { cache: "no-cache" }); if (!r.ok) throw 0; return await r.json(); }
    catch (e) { return null; }
  }

  let D = { drivers: [], races: [], posts: [], cars: [], settings: {} };

  /* ---------- Einstellungen: Links ---------- */
  function applySettings() {
    const s = D.settings || {};
    document.querySelectorAll("[data-link]").forEach((a) => {
      const k = a.dataset.link, v = s[k];
      if (!v) return;
      a.href = k === "email" ? "mailto:" + v : v;
    });
    document.querySelectorAll("[data-text]").forEach((el) => { const v = s[el.dataset.text]; if (v) el.textContent = v; });
    $("year").textContent = today.getFullYear();
  }

  /* ---------- Hilfswerte aus den Rennen ---------- */
  const finished = () => D.races.filter((r) => r.status === "abgeschlossen" && r.ziel)
    .sort((a, b) => (parseDate(b.datum) || 0) - (parseDate(a.datum) || 0));
  const upcoming = () => D.races.filter((r) => r.status !== "abgeschlossen" && (!parseDate(r.datum) || parseDate(r.datum) >= today))
    .sort((a, b) => (parseDate(a.datum) || new Date(9e15)) - (parseDate(b.datum) || new Date(9e15)));
  const statsFor = (name) => {
    const mine = finished().filter((r) => (r.crew || []).some((c) => c.replace(/\s*\(.*\)$/, "").trim() === name));
    const year = today.getFullYear();
    const starts = mine.filter((r) => { const d = parseDate(r.datum); return !d || d.getFullYear() === year; }).length;
    const best = mine.length ? Math.min(...mine.map((r) => +r.ziel)) : null;
    return { starts, best };
  };

  /* ---------- Pitwall: nächstes Rennen + Saisonbilanz ---------- */
  let cdTimer = null;
  function startOf(r) {
    const d = parseDate(r.datum); if (!d) return null;
    const m = String(r.startzeit || "").match(/(\d{1,2})[:.](\d{2})/);
    if (m) d.setHours(+m[1], +m[2]); else d.setHours(23, 59);
    return d;
  }
  function renderPitwall() {
    const year = today.getFullYear();
    const n = upcoming()[0];
    const s = D.settings || {};
    if (n) {
      $("nextrace").href = "#rennen-" + n.id;
      $("nr-title").textContent = n.titel;
      $("nr-meta").textContent = [parseDate(n.datum) ? fmt(n.datum) : "Datum folgt", n.startzeit ? n.startzeit + " Uhr" : "", n.serie, n.klasse].filter(Boolean).join(" · ");
      $("sess-text").textContent = "Saison " + year + " · Nächstes Rennen: " + n.titel + (parseDate(n.datum) ? " · " + fmt(n.datum) : "");
      const start = startOf(n);
      const tick = () => {
        const ms = start ? start - new Date() : -1;
        if (!start || ms <= 0) { $("nr-cd").hidden = true; return; }
        const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, mi = Math.floor(ms / 6e4) % 60;
        $("nr-cd").innerHTML = [[d, "Tage"], [h, "Std"], [mi, "Min"]].map(([v, l]) => `<span><b>${String(v).padStart(2, "0")}</b><small>${l}</small></span>`).join("");
        $("nr-cd").hidden = false;
      };
      tick(); clearInterval(cdTimer); cdTimer = setInterval(tick, 30000);
    } else {
      $("nextrace").href = s.discord || "#klassement";
      $("nr-title").textContent = "In Planung";
      $("nr-meta").textContent = "Termine kündigen wir zuerst im Discord an →";
      $("nr-cd").hidden = true;
      $("sess-text").textContent = "Saison " + year + " · Nächstes Rennen in Planung";
    }
    const fin = finished();
    const thisYear = fin.filter((r) => { const d = parseDate(r.datum); return !d || d.getFullYear() === year; });
    const pool = thisYear.length ? thisYear : fin;
    const label = thisYear.length ? " " + year : "";
    const best = pool.length ? pool.reduce((a, r) => (+r.ziel < +a.ziel ? r : a)) : null;
    const top10 = pool.filter((r) => +r.ziel <= 10).length;
    const gained = pool.filter((r) => r.start).reduce((t, r) => t + (+r.start - +r.ziel), 0);
    $("season").innerHTML = [
      [pool.length, "Rennen" + label, ""],
      [best ? "P" + best.ziel : "–", "Bestes Ergebnis" + (best ? " · <em>" + esc(best.titel) + "</em>" : ""), "r"],
      [top10, "Top-10-Ergebnisse", ""],
      [(gained > 0 ? "+" : "") + gained, "Plätze gutgemacht", gained > 0 ? "g" : ""],
    ].map(([v, l, c]) => `<div><b class="${c}">${esc(v)}</b><small>${l}</small></div>`).join("");
  }

  /* ---------- Lineup ---------- */
  function renderDrivers() {
    const list = [...D.drivers].sort((a, b) => (a.status === "inaktiv") - (b.status === "inaktiv"));
    const active = list.filter((d) => d.status !== "inaktiv").length;
    const s = D.settings || {};
    const year = today.getFullYear();
    $("entries-meta").textContent = `${list.length} Fahrer · ${active} aktiv${s.open_seat !== false ? " · 1 Open Seat" : ""}`;
    let html = list.map((d) => {
      const st = statsFor(d.name), on = d.status !== "inaktiv";
      const kl = (d.klassen || []).map((c) => `<i class="${c === "GTP" ? "gtp" : ""}">${esc(c)}</i>`).join("");
      return `<article class="slot ${on ? "" : "off"}"><span class="gp" aria-hidden="true">${esc(d.kuerzel || "")}</span>
        <div class="card"><div class="ph">${d.foto ? `<img src="${esc(src(d.foto))}" alt="${esc(d.name)}" loading="lazy">` : ""}</div>
        <div class="bd"><div class="st"><span class="pill">${on ? "Aktiv" : "Inaktiv"}</span><span class="chips">${kl}</span></div>
        <h3 class="wide">${esc(d.name)}</h3><span class="role">${esc(d.rolle || "")}</span>
        ${d.zitat ? `<blockquote>${esc(d.zitat)}</blockquote>` : ""}
        <div class="nums"><div><span class="lbl">Starts ${year}</span><b>${st.starts}</b></div><div><span class="lbl">Bestes Ergebnis</span><b>${st.best ? "P" + st.best : "–"}</b></div></div></div></div></article>`;
    }).join("");
    if (s.open_seat !== false) {
      html += `<article class="slot open"><span class="gp" aria-hidden="true">—</span><div class="card"><span class="pill" style="color:var(--red)">Open Seat</span><h3 class="wide">Dein Platz?</h3><span class="role">${esc(s.open_seat_text || "Bewerbung offen")}</span><a href="#box">Jetzt bewerben →</a></div></article>`;
    }
    $("entries").innerHTML = html;
  }

  /* ---------- Kalender + Klassement ---------- */
  function renderCalendar() {
    const up = upcoming();
    $("calendar").innerHTML = up.length ? up.map((r) => `<a href="#rennen-${esc(r.id)}">
        <span class="d">${esc(fmt(r.datum))}<small>${esc(r.startzeit ? r.startzeit + " Uhr" : "Uhrzeit folgt")}</small></span>
        <span class="t">${esc(r.titel)}<small>${[r.serie, r.klasse, r.strecke].filter(Boolean).map(esc).join(" · ")}</small>${crewHtml(r)}</span>
        <span class="open lbl">Vorschau →</span></a>`).join("")
      : `<div class="empty">Das nächste Rennen ist in Planung. Ankündigungen kommen zuerst im Discord.</div>`;
  }
  const crewHtml = (r) => (r.crew && r.crew.length ? `<span class="crew">${r.crew.map((c) => `<span>${esc(short(c))}</span>`).join("")}</span>` : "");
  function gainSvg(r) {
    const MAXP = Math.max(50, +r.start || 0, +r.ziel || 0);
    const px = (p) => 2 + ((p - 1) / (MAXP - 1)) * 96;
    const g = r.start ? r.start - r.ziel : null;
    const ticks = [1, 10, 20, 30, 40, 50].filter((p) => p <= MAXP).map((p) => `<line x1="${px(p)}%" x2="${px(p)}%" y1="11" y2="23" stroke="var(--rule)" stroke-width="1.5"/>`).join("");
    const line = r.start ? `<line x1="${px(r.start)}%" y1="17" x2="${px(r.ziel)}%" y2="17" stroke="${g >= 0 ? "#167a3a" : "var(--red)"}" stroke-width="3"/><circle cx="${px(r.start)}%" cy="17" r="5" fill="var(--paper)" stroke="var(--ink)" stroke-width="2"/>` : "";
    return `<div class="gain"><svg aria-hidden="true"><line x1="2%" y1="17" x2="98%" y2="17" stroke="var(--rule)" stroke-width="2"/>${ticks}${line}<circle cx="${px(r.ziel)}%" cy="17" r="6" fill="var(--ink)"/></svg>
      <div class="gl"><span>${r.start ? "Start P" + r.start : "Start –"}</span><b class="${g == null ? "" : g >= 0 ? "up" : "dn"}">${g == null ? "Ziel P" + r.ziel : (g >= 0 ? "+" : "−") + Math.abs(g) + (Math.abs(g) === 1 ? " Platz" : " Plätze")}</b><span>P1 ← · → P${MAXP}</span></div></div>`;
  }
  function renderResults() {
    const fin = finished();
    $("results-meta").textContent = `${fin.length} Ergebnisse · ${upcoming().length} geplant`;
    $("results").innerHTML = fin.map((r) => `<li><a class="row" href="#rennen-${esc(r.id)}">
      <span class="fin ${+r.ziel <= 10 ? "top" : ""}">P${esc(r.ziel)}</span>
      <div class="ev">${esc(r.titel)}<small>${[r.serie, r.klasse, fmt(r.datum), r.fahrzeug].filter(Boolean).map(esc).join(" · ")}${r.fazit ? " · " + esc(r.fazit) : ""}</small>${crewHtml(r).replace('class="crew"', 'class="crew"')}</div>
      ${gainSvg(r)}
      <span class="open">${r.bericht && r.bericht.trim() ? "Rennbericht →" : "Details →"}</span></a></li>`).join("");
  }

  /* ---------- News ---------- */
  let newsShown = 6;
  function renderNews() {
    const posts = [...D.posts].sort((a, b) => (parseDate(b.datum) || 0) - (parseDate(a.datum) || 0));
    $("news-grid").innerHTML = posts.slice(0, newsShown).map((p) => `<a class="news-card" href="#news-${esc(p.id)}">
      <div class="im">${p.bild ? `<img src="${esc(src(p.bild))}" alt="" loading="lazy">` : ""}</div>
      <div class="tx"><div class="k"><b>${esc(p.kategorie || "News")}</b><span class="lbl">${esc(fmt(p.datum))}</span></div>
      <h3>${esc(p.titel)}</h3>${p.teaser ? `<p>${esc(p.teaser)}</p>` : ""}</div></a>`).join("") ||
      `<div style="padding:22px;color:var(--muted)">Noch keine News.</div>`;
    $("news-more").hidden = posts.length <= newsShown;
  }
  $("news-more-btn").addEventListener("click", () => { newsShown += 6; renderNews(); });

  /* ---------- Garage ---------- */
  let selC = 0;
  function renderCars() {
    const cars = D.cars;
    $("cars-meta").textContent = `${cars.length} Team-Liverys`;
    if (!cars.length) return;
    selC = Math.min(selC, cars.length - 1);
    $("carlist").innerHTML = cars.map((c, i) => `<li><button type="button" data-i="${i}" aria-pressed="${i === selC}"><span class="i">${String(i + 1).padStart(2, "0")}</span><span class="n">${esc(c.marke)} ${esc(c.modell)}</span></button></li>`).join("");
    const c = cars[selC];
    $("carimg").src = src(c.bild); $("carimg").alt = `${c.marke} ${c.modell} in Darkline-Livery`;
    $("carmake").textContent = c.marke; $("carname").textContent = c.modell;
    $("carspecs").innerHTML = [["Klasse", c.klasse], ["Motor", c.motor], ["Antrieb", c.antrieb]].filter((x) => x[1]).map((s) => `<div><span class="lbl">${s[0]}</span><b>${esc(s[1])}</b></div>`).join("");
  }
  $("carlist").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { selC = +b.dataset.i; renderCars(); $("carlist").querySelector(`[data-i="${selC}"]`).focus(); } });

  /* ---------- Detailansicht: Rennbericht / News ---------- */
  let lastFocus = null, backTo = "";
  function openDetail(html, back) {
    lastFocus = document.activeElement; backTo = back;
    $("d-content").innerHTML = html;
    $("detail").hidden = false; $("detail").scrollTop = 0;
    document.body.classList.add("locked");
    $("d-close").focus({ preventScroll: true });
  }
  function closeDetail(updateHash) {
    if ($("detail").hidden) return;
    $("detail").hidden = true; document.body.classList.remove("locked");
    if (updateHash) history.replaceState(null, "", "#" + backTo);
    const sec = document.getElementById(backTo); if (sec) sec.scrollIntoView({ block: "start" });
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  $("d-close").addEventListener("click", () => closeDetail(true));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(true); });

  function raceDetail(r) {
    const done = r.status === "abgeschlossen" && r.ziel;
    const g = done && r.start ? r.start - r.ziel : null;
    const box = done ? `<div class="result-box">
        <div><span class="lbl">Start</span><b>${r.start ? "P" + esc(r.start) : "–"}</b></div>
        <div><span class="lbl">Ziel</span><b class="r">P${esc(r.ziel)}</b></div>
        <div><span class="lbl">Plätze</span><b class="${g > 0 ? "g" : ""}">${g == null ? "–" : (g >= 0 ? "+" : "−") + Math.abs(g)}</b></div></div>`
      : `<div class="result-box"><div><span class="lbl">Datum</span><b>${esc(fmt(r.datum))}</b></div><div><span class="lbl">Start</span><b>${esc(r.startzeit || "–")}</b></div></div>`;
    const related = D.posts.filter((p) => p.rennen === r.id);
    const body = md(r.bericht);
    return `<section class="dhero">${r.banner ? `<div class="bg"><img src="${esc(src(r.banner))}" alt=""></div>` : ""}
      <div class="wrap"><div><span class="eyb">${done ? "Rennbericht" : "Rennvorschau"} · ${esc(r.klasse || "")}</span>
      <h1 class="wide" id="d-title">${esc(r.titel)}</h1>
      <div class="meta">${[r.serie, r.strecke, fmt(r.datum), r.startzeit ? r.startzeit + " Uhr" : "", r.fahrzeug].filter(Boolean).map(esc).join(" · ")}</div></div>${box}</div></section>
      <div class="wrap dbody"><article class="prose">${r.bericht_titel ? `<h2>${esc(r.bericht_titel)}</h2>` : ""}${body || `<p class="pending">${done ? "Der ausführliche Rennbericht folgt." : "Die Rennvorschau mit Lineup und Stream-Infos folgt."}</p>`}</article>
      <aside class="aside">
        ${r.crew && r.crew.length ? `<div class="box"><span class="lbl">Fahrer</span><div class="crew">${r.crew.map((c) => `<span>${esc(c)}</span>`).join("")}</div></div>` : ""}
        ${r.fazit ? `<div class="box"><span class="lbl">Kurzfazit</span><p style="margin:0">${esc(r.fazit)}</p></div>` : ""}
        ${related.length ? `<div class="box"><span class="lbl">Passende News</span>${related.map((p) => `<a class="link" href="#news-${esc(p.id)}">${esc(p.titel)} →</a>`).join("")}</div>` : ""}
        <div class="box"><a class="link" href="#klassement">← Zum Klassement</a></div>
      </aside></div>`;
  }
  function newsDetail(p) {
    const race = p.rennen ? D.races.find((r) => r.id === p.rennen) : null;
    return `<section class="dhero">${p.bild ? `<div class="bg"><img src="${esc(src(p.bild))}" alt=""></div>` : ""}
      <div class="wrap"><div><span class="eyb">${esc(p.kategorie || "News")} · ${esc(fmt(p.datum))}</span>
      <h1 class="wide" id="d-title" style="font-size:clamp(2rem,5.5vw,4.2rem)">${esc(p.titel)}</h1>
      ${p.teaser ? `<div class="meta" style="max-width:60ch;font-family:var(--f-wide);font-size:1rem;letter-spacing:0">${esc(p.teaser)}</div>` : ""}</div></div></section>
      <div class="wrap dbody"><article class="prose">${md(p.inhalt) || `<p class="pending">Kein weiterer Text.</p>`}</article>
      <aside class="aside">
        ${race ? `<div class="box"><span class="lbl">Zum Rennen</span><a class="link" href="#rennen-${esc(race.id)}">${esc(race.titel)}${race.ziel ? " · P" + esc(race.ziel) : ""} →</a></div>` : ""}
        <div class="box"><a class="link" href="#news">← Alle News</a></div>
      </aside></div>`;
  }
  function route() {
    const h = decodeURIComponent(location.hash.slice(1));
    let m;
    if ((m = h.match(/^rennen-(.+)$/))) { const r = D.races.find((x) => x.id === m[1]); if (r) return openDetail(raceDetail(r), "klassement"); }
    if ((m = h.match(/^news-(.+)$/))) { const p = D.posts.find((x) => x.id === m[1]); if (p) return openDetail(newsDetail(p), "news"); }
    closeDetail(false);
  }
  window.addEventListener("hashchange", route);

  /* ---------- Start ---------- */
  (async function init() {
    const [drivers, races, news, cars, settings] = await Promise.all(["drivers", "races", "news", "cars", "settings"].map(load));
    D = {
      drivers: (drivers && drivers.drivers) || [],
      races: (races && races.races) || [],
      posts: (news && news.posts) || [],
      cars: (cars && cars.cars) || [],
      settings: settings || {},
    };
    applySettings(); renderPitwall(); renderDrivers(); renderCalendar(); renderResults(); renderNews(); renderCars();
    if (/^(rennen|news)-/.test(location.hash.slice(1))) route();
  })();
})();
