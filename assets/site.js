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
  // Adresse einer Fahrerseite aus dem Namen, z. B. "Paul Wiez" -> "paul-wiez"
  const slugify = (s) => String(s || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  // Renndauer: "24h", "6 h", "2:40h", "1h30", "45min" -> Minuten
  const parseDur = (s) => {
    const t = String(s || "").toLowerCase().replace(",", ".").trim(); if (!t) return null; let m;
    if ((m = t.match(/^(\d+)\s*[:.]\s*(\d{1,2})\s*h?/))) return +m[1] * 60 + +m[2];
    if ((m = t.match(/^(\d+(?:\.\d+)?)\s*h\w*\s*(?:(\d+)\s*m\w*)?$/))) return Math.round(+m[1] * 60) + (+m[2] || 0);
    if ((m = t.match(/^(\d+)\s*m/))) return +m[1];
    if ((m = t.match(/^(\d+(?:\.\d+)?)$/))) return Math.round(+m[1] * 60);
    return null;
  };
  const durText = (r) => { const m = parseDur(r.dauer); if (!m) return r.dauer || ""; const h = Math.floor(m / 60), mi = m % 60; return h ? (mi ? `${h}:${String(mi).padStart(2, "0")} h` : `${h} h`) : `${mi} min`; };
  const cleanName = (c) => String(c).replace(/\s*\(.*\)$/, "").trim();
  const short = (name) => { const p = String(name).replace(/\s*\(.*\)$/, "").trim().split(/\s+/); return p.length > 1 ? p.slice(0, -1).map((x) => x[0] + ".").join(" ") + " " + p[p.length - 1] : name; };

  async function load(name) {
    try { const r = await fetch("content/" + name + ".json", { cache: "no-cache" }); if (!r.ok) throw 0; return await r.json(); }
    catch (e) { return null; }
  }

  let D = { drivers: [], races: [], posts: [], cars: [], settings: {} };

  /* ---------- Mobiles Menü ---------- */
  const bar = document.querySelector(".bar"), mb = $("menu-btn");
  const setMenu = (o) => { bar.classList.toggle("open", o); mb.setAttribute("aria-expanded", o); mb.setAttribute("aria-label", o ? "Menü schließen" : "Menü öffnen"); };
  mb.addEventListener("click", () => setMenu(!bar.classList.contains("open")));
  $("mainnav").addEventListener("click", (e) => { if (e.target.closest("a")) setMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });

  /* ---------- Kalender-Link kopieren ---------- */
  $("cal-copy").addEventListener("click", async (e) => {
    const b = e.currentTarget, url = "https://darklineperformance.de/kalender.ics";
    try { await navigator.clipboard.writeText(url); b.textContent = "Kopiert ✓"; } catch (err) { window.prompt("Kalender-Link:", url); }
    setTimeout(() => { b.textContent = "Link kopieren"; }, 2000);
  });

  /* ---------- Bewerbungsvorlage kopieren ---------- */
  document.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    const text = $(b.dataset.copy).textContent;
    try { await navigator.clipboard.writeText(text); b.textContent = "Kopiert ✓"; } catch (err) { window.prompt("Vorlage kopieren:", text); }
    setTimeout(() => { b.textContent = "Vorlage kopieren"; }, 2000);
  }));

  /* ---------- Einstellungen: Links ---------- */
  function applySettings() {
    const s = D.settings || {};
    document.querySelectorAll("[data-link]").forEach((a) => {
      const k = a.dataset.link, v = s[k];
      if (!v) return;
      a.href = k === "email" ? "mailto:" + v : v;
    });
    document.querySelectorAll("[data-text]").forEach((el) => { const v = s[el.dataset.text]; if (v) el.textContent = v; });
    // Open Seat im CMS ausgeschaltet: Bewerbungen bleiben möglich, aber ohne Versprechen eines freien Cockpits
    if (s.open_seat === false && $("box-title")) $("box-title").textContent = "Initiativ bewerben.";
    $("year").textContent = today.getFullYear();
  }

  /* ---------- Hilfswerte aus den Rennen ---------- */
  const finished = () => D.races.filter((r) => r.status === "abgeschlossen" && r.ziel)
    .sort((a, b) => (parseDate(b.datum) || 0) - (parseDate(a.datum) || 0));
  const upcoming = () => D.races.filter((r) => r.status !== "abgeschlossen" && (!parseDate(r.datum) || parseDate(r.datum) >= today))
    .sort((a, b) => (parseDate(a.datum) || new Date(9e15)) - (parseDate(b.datum) || new Date(9e15)));
  const racesOf = (name) => finished().filter((r) => (r.crew || []).some((c) => cleanName(c) === name));
  const statsFor = (name) => {
    const mine = racesOf(name);
    const year = today.getFullYear();
    const starts = mine.filter((r) => { const d = parseDate(r.datum); return !d || d.getFullYear() === year; }).length;
    const best = mine.length ? Math.min(...mine.map((r) => +r.ziel)) : null;
    const top10 = mine.filter((r) => +r.ziel <= 10).length;
    const avg = mine.length ? mine.reduce((t, r) => t + +r.ziel, 0) / mine.length : null;
    const gained = mine.filter((r) => r.start).reduce((t, r) => t + (+r.start - +r.ziel), 0);
    const klassen = [...new Set(mine.map((r) => r.klasse).filter(Boolean))];
    return { starts, total: mine.length, best, top10, avg, gained, klassen, mine };
  };
  const driverByName = (name) => D.drivers.find((d) => d.name === cleanName(name));

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
      $("nextrace").href = "/rennen/" + n.id;
      $("nr-title").textContent = n.titel;
      $("nr-meta").textContent = [parseDate(n.datum) ? fmt(n.datum) : "Datum folgt", n.startzeit ? n.startzeit + " Uhr" : "", durText(n), n.serie, n.klasse].filter(Boolean).join(" · ");
      $("sess-text").textContent = "Nächstes Rennen: " + n.titel + (parseDate(n.datum) ? " · " + fmt(n.datum) : "");
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
      $("sess-text").textContent = "Nächstes Rennen: in Planung";
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
    const rank = { aktiv: 0, "auf Probe": 1, inaktiv: 2 };
    const list = [...D.drivers].sort((a, b) => (rank[a.status] ?? 0) - (rank[b.status] ?? 0));
    const active = list.filter((d) => (d.status || "aktiv") === "aktiv").length;
    const trial = list.filter((d) => d.status === "auf Probe").length;
    const s = D.settings || {};
    const year = today.getFullYear();
    $("entries-meta").textContent = `${list.length} Fahrer · ${active} aktiv${trial ? " · " + trial + " auf Probe" : ""}${s.open_seat !== false ? " · 1 Open Seat" : ""}`;
    let html = list.map((d) => {
      const st = statsFor(d.name), on = d.status !== "inaktiv", trialD = d.status === "auf Probe";
      const kl = (d.klassen || []).map((c) => `<i class="${c === "GTP" ? "gtp" : ""}">${esc(c)}</i>`).join("");
      return `<article class="slot ${on ? (trialD ? "trial" : "") : "off"}"><span class="gp" aria-hidden="true">${esc(d.kuerzel || "")}</span>
        <div class="card"><div class="ph">${d.foto ? `<img src="${esc(src(d.foto))}" alt="${esc(d.name)}" loading="lazy">` : ""}</div>
        <div class="bd"><div class="st"><span class="pill">${trialD ? "Auf Probe" : on ? "Aktiv" : "Inaktiv"}</span><span class="chips">${kl}</span></div>
        <h3 class="wide"><a class="stretch" href="/fahrer/${slugify(d.name)}">${esc(d.name)}</a></h3><span class="role">${esc(d.rolle || "")}</span>
        ${d.zitat ? `<blockquote>${esc(d.zitat)}</blockquote>` : ""}
        <div class="nums"><div><span class="lbl">Starts ${year}</span><b>${st.starts}</b></div><div><span class="lbl">Bestes Ergebnis</span><b>${st.best ? "P" + st.best : "–"}</b></div><span class="profile-go">Profil →</span></div></div></div></article>`;
    }).join("");
    if (s.open_seat !== false) {
      html += `<article class="slot open"><span class="gp" aria-hidden="true">—</span><div class="card"><span class="pill" style="color:var(--red)">Open Seat</span><h3 class="wide">Dein Platz?</h3><span class="role">${esc(s.open_seat_text || "Bewerbung offen")}</span><a href="#box">Jetzt bewerben →</a></div></article>`;
    }
    $("entries").innerHTML = html;
  }

  /* ---------- Kalender + Klassement ---------- */
  function renderCalendar() {
    const up = upcoming();
    $("calendar").innerHTML = up.length ? up.map((r) => `<a href="/rennen/${esc(r.id)}">
        <span class="d">${esc(fmt(r.datum))}<small>${esc(r.startzeit ? r.startzeit + " Uhr" : "Uhrzeit folgt")}</small></span>
        <span class="t">${esc(r.titel)}<small>${[r.serie, r.klasse, durText(r), r.strecke].filter(Boolean).map(esc).join(" · ")}</small>${crewHtml(r)}</span>
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
  const RESULTS_MAX = 5;
  let resultsOpen = false;
  function renderResults() {
    const fin = finished();
    $("results-meta").textContent = `${fin.length} Ergebnisse · ${upcoming().length} geplant`;
    $("results").innerHTML = fin.map((r, i) => `<li${i >= RESULTS_MAX ? ' class="extra" hidden' : ""}><a class="row" href="/rennen/${esc(r.id)}">
      <span class="fin ${+r.ziel <= 10 ? "top" : ""}">P${esc(r.ziel)}</span>
      <div class="ev">${esc(r.titel)}<small>${[r.serie, r.klasse, fmt(r.datum), durText(r), r.fahrzeug].filter(Boolean).map(esc).join(" · ")}${r.fazit ? " · " + esc(r.fazit) : ""}</small>${crewHtml(r).replace('class="crew"', 'class="crew"')}</div>
      ${gainSvg(r)}
      <span class="open">${r.bericht && r.bericht.trim() ? "Rennbericht →" : "Details →"}</span></a></li>`).join("");
    const extra = Math.max(0, fin.length - RESULTS_MAX);
    $("results-more").hidden = extra === 0;
    $("results-more-btn").textContent = resultsOpen ? "Weniger anzeigen" : `Alle Ergebnisse anzeigen (+${extra})`;
    $("results").querySelectorAll("li.extra").forEach((li) => { li.hidden = !resultsOpen; });
  }
  $("results-more-btn").addEventListener("click", () => {
    resultsOpen = !resultsOpen; renderResults();
    if (!resultsOpen) $("klassement").scrollIntoView({ block: "start" });
  });

  /* ---------- News: Slider mit 3 sichtbaren Beiträgen, läuft automatisch ---------- */
  const NEWS_MAX = 12;
  let newsTimer = null, newsPausedUntil = 0, newsHover = false;
  const track = $("news-grid");
  const perView = () => { const c = track.querySelector(".news-card"); return c ? Math.max(1, Math.round(track.clientWidth / (c.getBoundingClientRect().width + 18))) : 1; };
  const stepW = () => { const c = track.querySelector(".news-card"); return c ? c.getBoundingClientRect().width + 18 : track.clientWidth; };
  const curIdx = () => Math.round(track.scrollLeft / stepW());
  const maxIdx = () => Math.max(0, track.querySelectorAll(".news-card").length - perView());
  function goNews(i, user) {
    const m = maxIdx(); i = i > m ? 0 : i < 0 ? m : i;
    track.scrollTo({ left: i * stepW(), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    if (user) newsPausedUntil = Date.now() + 15000;
  }
  function updateDots() {
    const m = maxIdx(), c = Math.min(curIdx(), m);
    $("news-ctrl").hidden = m === 0;
    $("news-dots").innerHTML = Array.from({ length: m + 1 }, (_, i) => `<button type="button" role="tab" aria-label="Position ${i + 1}" aria-selected="${i === c}" data-i="${i}"></button>`).join("");
  }
  function renderNews() {
    const posts = [...D.posts].sort((a, b) => (parseDate(b.datum) || 0) - (parseDate(a.datum) || 0)).slice(0, NEWS_MAX);
    track.innerHTML = posts.map((p) => `<a class="news-card" href="/news/${esc(p.id)}">
      <div class="im">${p.bild ? `<img src="${esc(src(p.bild))}" alt="" loading="lazy">` : ""}</div>
      <div class="tx"><div class="k"><b>${esc(p.kategorie || "News")}</b><span class="lbl">${esc(fmt(p.datum))}</span></div>
      <h3>${esc(p.titel)}</h3>${p.teaser ? `<p>${esc(p.teaser)}</p>` : ""}</div></a>`).join("") ||
      `<div style="padding:22px;color:var(--muted)">Noch keine News.</div>`;
    track.scrollLeft = 0; updateDots();
    clearInterval(newsTimer);
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      newsTimer = setInterval(() => {
        if (newsHover || document.hidden || Date.now() < newsPausedUntil || !$("detail").hidden || maxIdx() === 0) return;
        goNews(curIdx() + 1);
      }, 6000);
    }
  }
  let scrollT = null;
  track.addEventListener("scroll", () => { clearTimeout(scrollT); scrollT = setTimeout(updateDots, 80); }, { passive: true });
  $("news-prev").addEventListener("click", () => goNews(curIdx() - 1, true));
  $("news-next").addEventListener("click", () => goNews(curIdx() + 1, true));
  $("news-dots").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) goNews(+b.dataset.i, true); });
  $("news-car").addEventListener("mouseenter", () => { newsHover = true; });
  $("news-car").addEventListener("mouseleave", () => { newsHover = false; });
  $("news-car").addEventListener("focusin", () => { newsHover = true; });
  $("news-car").addEventListener("focusout", () => { newsHover = false; });
  track.addEventListener("touchstart", () => { newsPausedUntil = Date.now() + 15000; }, { passive: true });
  track.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") { e.preventDefault(); goNews(curIdx() + 1, true); } if (e.key === "ArrowLeft") { e.preventDefault(); goNews(curIdx() - 1, true); } });
  window.addEventListener("resize", () => { clearTimeout(scrollT); scrollT = setTimeout(updateDots, 150); });

  /* ---------- Garage ---------- */
  let selC = 0;
  function renderCars(fromUser) {
    const cars = D.cars;
    $("cars-meta").textContent = `${cars.length} Team-Liverys`;
    if (!cars.length) { $("showroom").hidden = true; return; }
    selC = (selC + cars.length) % cars.length;
    const c = cars[selC], pad = (n) => String(n).padStart(2, "0");
    $("carlist").innerHTML = cars.map((x, i) => `<button type="button" role="tab" data-i="${i}" aria-selected="${i === selC}">
      <span class="th">${x.bild ? `<img src="${esc(src(x.bild))}" alt="" loading="lazy">` : ""}</span>
      <span class="tn"><span class="mono">${pad(i + 1)}</span>${esc(x.marke)} ${esc(x.modell)}</span></button>`).join("");
    const img = $("carimg");
    const swap = () => { img.src = src(c.bild); img.alt = `${c.marke} ${c.modell} in Darkline-Livery`; img.classList.remove("out"); };
    if (fromUser && img.getAttribute("src")) { img.classList.add("out"); setTimeout(swap, 180); } else swap();
    $("carcount").textContent = `${pad(selC + 1)} / ${pad(cars.length)}`;
    $("carmake").textContent = c.marke; $("carname").textContent = c.modell;
    $("carspecs").innerHTML = [["Klasse", c.klasse], ["Motor", c.motor], ["Antrieb", c.antrieb]].filter((x) => x[1]).map((s) => `<div><dt>${s[0]}</dt><dd>${esc(s[1])}</dd></div>`).join("");
    // Im Einsatz: Rennen aus dem Kalender, bei denen dieses Fahrzeug eingetragen ist
    const used = carRaces(c);
    $("carraces").hidden = !used.length;
    $("carraces").innerHTML = used.length ? "Im Einsatz: " + used.slice(0, 3).map((r) =>
      r.status === "geplant" ? `<b>${esc(r.titel)}</b> am ${esc(fmt(r.datum))}` : `<b>${esc(r.titel)}</b>${r.ziel ? " · P" + esc(r.ziel) : ""}`).join(" · ") : "";
    $("car-prev").hidden = $("car-next").hidden = cars.length < 2;
    if ($("car-lightbox").open) $("car-lightbox-img").src = src(c.bild);
  }
  // Rennen, deren Feld "Fahrzeug" zu Marke und Modell passt (z. B. "Mercedes-AMG GT3 2020" ↔ Mercedes · AMG GT3)
  const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9äöüß]+/g, " ").trim().split(" ").filter((w) => w.length > 1);
  function carRaces(car) {
    const need = words(car.marke).slice(0, 1).concat(words(car.modell));
    if (!need.length) return [];
    return D.races.filter((r) => { const have = words(r.fahrzeug); return have.length && need.every((w) => have.some((h) => h === w || h.startsWith(w))); })
      .sort((a, b) => (a.status === "geplant") - (b.status === "geplant") || String(b.datum || "").localeCompare(String(a.datum || "")));
  }
  // Vollbild: das Bild in Originalgröße, Pfeiltasten wechseln das Auto, Klick oder Esc schließt
  $("car-zoom").addEventListener("click", () => { const c = D.cars[selC]; if (!c) return; $("car-lightbox-img").src = src(c.bild); $("car-lightbox-img").alt = `${c.marke} ${c.modell} in Darkline-Livery`; $("car-lightbox").showModal(); });
  $("car-lightbox-close").addEventListener("click", () => $("car-lightbox").close());
  $("car-lightbox").addEventListener("click", (e) => { if (e.target === $("car-lightbox") || e.target === $("car-lightbox-img")) $("car-lightbox").close(); });
  $("car-lightbox").addEventListener("keydown", (e) => { if (e.key === "ArrowRight") goCar(1); if (e.key === "ArrowLeft") goCar(-1); });
  const goCar = (d) => { selC += d; renderCars(true); };
  $("car-prev").addEventListener("click", () => goCar(-1));
  $("car-next").addEventListener("click", () => goCar(1));
  $("carlist").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { selC = +b.dataset.i; renderCars(true); $("carlist").querySelector(`[data-i="${selC}"]`).focus(); } });
  $("showroom").addEventListener("keydown", (e) => { if (e.key === "ArrowRight") { e.preventDefault(); goCar(1); } if (e.key === "ArrowLeft") { e.preventDefault(); goCar(-1); } });
  let tx = null;
  $("carimg").parentElement.addEventListener("touchstart", (e) => { tx = e.touches[0].clientX; }, { passive: true });
  $("carimg").parentElement.addEventListener("touchend", (e) => { if (tx == null) return; const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 50) goCar(dx < 0 ? 1 : -1); tx = null; });

  /* ---------- Shop ---------- */
  function renderShop() {
    const s = D.shop || {}, st = D.settings || {};
    $("shop-intro").textContent = s.intro || "";
    const flag = (x) => (x === "Verfügbar" ? "ok" : x === "Ausverkauft" ? "out" : "");
    $("shop-grid").innerHTML = (s.products || []).map((p) => {
      const href = p.link || (st.email ? "mailto:" + st.email + "?subject=" + encodeURIComponent("Merch-Anfrage: " + p.name) : "#box");
      return `<article class="product"><div class="im">${p.bild ? `<img src="${esc(src(p.bild))}" alt="${esc(p.name)} von Darkline" loading="lazy">` : ""}${p.status ? `<span class="flag ${flag(p.status)}">${esc(p.status)}</span>` : ""}</div>
        <div class="tx"><span class="line">${esc(p.linie || "Teamwear")}</span><h3>${esc(p.name)}</h3>
        <div class="row"><span class="price">${esc(p.preis || "")}</span><a class="ask" href="${esc(href)}">${p.link ? "Zum Shop →" : "Anfragen →"}</a></div></div></article>`;
    }).join("");
  }

  /* ---------- Partner ---------- */
  function renderPartners() {
    $("partner-list").innerHTML = (D.partners || []).map((p) => `<a class="pcard" href="${esc(p.url || "#partner")}">
      <span class="plate">${p.logo ? `<img src="${esc(src(p.logo))}" alt="${esc(p.name)}" loading="lazy">` : `<b>${esc(p.name)}</b>`}</span>
      <span class="info"><span class="k">${esc(p.kategorie || "Partner")}</span><b>${esc(p.name)}</b><span>${esc(p.beschreibung || "")}</span></span>
      <span class="go">${p.url ? esc(p.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")) + " ↗" : ""}</span></a>`).join("");
  }

  /* ---------- Detailansicht: Rennbericht / News ---------- */
  let lastFocus = null, backTo = "";
  function openDetail(html, back) {
    lastFocus = document.activeElement; backTo = back;
    $("d-content").innerHTML = html;
    $("detail").hidden = false; $("detail").scrollTop = 0;
    document.body.classList.add("locked");
    $("d-close").focus({ preventScroll: true });
  }
  const detailPath = () => location.pathname.match(/^\/(rennen|news|fahrer)\/([^/]+)\/?$/);
  function closeDetail(updateUrl) {
    if ($("detail").hidden) return;
    $("detail").hidden = true; document.body.classList.remove("locked");
    if (updateUrl && detailPath()) history.pushState(null, "", "/#" + backTo);
    const sec = document.getElementById(backTo); if (sec) sec.scrollIntoView({ block: "start" });
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  $("d-close").addEventListener("click", () => closeDetail(true));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(true); });

  // Interne Links auf Rennberichte/News ohne Neuladen öffnen
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest("a[href]"); if (!a) return;
    const href = a.getAttribute("href");
    if (/^\/(rennen|news|fahrer)\/[^/]+$/.test(href)) { e.preventDefault(); history.pushState(null, "", href); route(); return; }
    if (href.startsWith("#") && a.closest("#detail")) { e.preventDefault(); backTo = href.slice(1); closeDetail(true); }
  });

  // Teilen
  const shareBtn = () => `<button type="button" class="share" data-share>Teilen ↗</button>`;
  $("detail").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-share]"); if (!b) return;
    const url = location.origin + location.pathname, title = document.title;
    if (navigator.share) { try { await navigator.share({ title, url }); } catch (err) {} return; }
    try { await navigator.clipboard.writeText(url); b.textContent = "Link kopiert ✓"; }
    catch (err) { window.prompt("Link kopieren:", url); }
    setTimeout(() => { b.textContent = "Teilen ↗"; }, 2000);
  });

  function raceDetail(r) {
    const done = r.status === "abgeschlossen" && r.ziel;
    const g = done && r.start ? r.start - r.ziel : null;
    const box = done ? `<div class="result-box">
        <div><span class="lbl">Start</span><b>${r.start ? "P" + esc(r.start) : "–"}</b></div>
        <div><span class="lbl">Ziel</span><b class="r">P${esc(r.ziel)}</b></div>
        <div><span class="lbl">Plätze</span><b class="${g > 0 ? "g" : ""}">${g == null ? "–" : (g >= 0 ? "+" : "−") + Math.abs(g)}</b></div></div>`
      : `<div class="result-box"><div><span class="lbl">Datum</span><b>${esc(fmt(r.datum))}</b></div><div><span class="lbl">Start</span><b>${esc(r.startzeit || "–")}</b></div><div><span class="lbl">Dauer</span><b>${esc(durText(r) || "–")}</b></div></div>`;
    const related = D.posts.filter((p) => p.rennen === r.id);
    const body = md(r.bericht);
    return `<section class="dhero">${r.banner ? `<div class="bg"><img src="${esc(src(r.banner))}" alt=""></div>` : ""}
      <div class="wrap"><div><span class="eyb">${done ? "Rennbericht" : "Rennvorschau"} · ${esc(r.klasse || "")}</span>
      <h1 class="wide" id="d-title">${esc(r.titel)}</h1>
      <div class="meta">${[r.serie, r.strecke, fmt(r.datum), r.startzeit ? r.startzeit + " Uhr" : "", durText(r) ? "Dauer " + durText(r) : "", r.fahrzeug].filter(Boolean).map(esc).join(" · ")}</div>
      ${shareBtn()}</div>${box}</div></section>
      <div class="wrap dbody"><article class="prose">${r.bericht_titel ? `<h2>${esc(r.bericht_titel)}</h2>` : ""}${body || `<p class="pending">${done ? "Der ausführliche Rennbericht folgt." : "Die Rennvorschau mit Lineup und Stream-Infos folgt."}</p>`}</article>
      <aside class="aside">
        ${r.crew && r.crew.length ? `<div class="box"><span class="lbl">Fahrer</span><div class="crew">${r.crew.map((c) => driverByName(c) ? `<a href="/fahrer/${slugify(cleanName(c))}">${esc(c)}</a>` : `<span>${esc(c)}</span>`).join("")}</div></div>` : ""}
        ${r.fazit ? `<div class="box"><span class="lbl">Kurzfazit</span><p style="margin:0">${esc(r.fazit)}</p></div>` : ""}
        ${related.length ? `<div class="box"><span class="lbl">Passende News</span>${related.map((p) => `<a class="link" href="/news/${esc(p.id)}">${esc(p.titel)} →</a>`).join("")}</div>` : ""}
        <div class="box"><a class="link" href="#klassement">← Zum Klassement</a></div>
      </aside></div>`;
  }
  function driverDetail(d) {
    const st = statsFor(d.name), on = d.status !== "inaktiv", trialD = d.status === "auf Probe";
    const kl = (d.klassen || []).map((c) => `<i class="${c === "GTP" ? "gtp" : ""}">${esc(c)}</i>`).join("");
    const links = [d.iracing ? `<a class="hbtn" href="${esc(d.iracing)}">iRacing-Profil ↗</a>` : "", d.stream ? `<a class="hbtn ghost" href="${esc(d.stream)}">Stream ↗</a>` : ""].join("");
    const hist = st.mine.map((r) => { const g = r.start ? r.start - r.ziel : null;
      return `<a class="hrow" href="/rennen/${esc(r.id)}"><span class="hd">${esc(parseDate(r.datum) ? fmt(r.datum) : "–")}</span>
        <span class="ht">${esc(r.titel)}<small>${[r.serie, r.klasse].filter(Boolean).map(esc).join(" · ")}</small></span>
        <span class="hp ${+r.ziel <= 10 ? "top" : ""}">P${esc(r.ziel)}</span>
        <span class="hg ${g > 0 ? "up" : g < 0 ? "dn" : ""}">${g == null ? "" : (g > 0 ? "+" : g < 0 ? "−" : "±") + Math.abs(g)}</span></a>`; }).join("");
    return `<section class="dhero driver-hero ${on ? (trialD ? "trial" : "") : "off"}">
      <div class="wrap"><div class="dh-main">
        <div class="dh-photo">${d.foto ? `<img src="${esc(src(d.foto))}" alt="${esc(d.name)}">` : ""}<span>${esc(d.kuerzel || "")}</span></div>
        <div class="dh-text"><span class="eyb"><span class="pill">${trialD ? "Auf Probe" : on ? "Aktiv" : "Inaktiv"}</span> · Fahrerprofil</span>
          <h1 class="wide" id="d-title">${esc(d.name)}</h1>
          <div class="meta">${esc(d.rolle || "")}</div>
          <div class="dh-row"><span class="chips">${kl}</span></div>
          <div class="dh-row">${links}${shareBtn()}</div></div></div>
        <div class="result-box"><div><span class="lbl">Rennen</span><b>${st.total}</b></div><div><span class="lbl">Bestes</span><b class="r">${st.best ? "P" + st.best : "–"}</b></div><div><span class="lbl">Top 10</span><b>${st.top10}</b></div></div>
      </div></section>
      <div class="wrap dbody"><article class="prose">
        ${d.zitat ? `<blockquote>${esc(d.zitat)}</blockquote>` : ""}
        ${d.bio ? `<p>${esc(d.bio)}</p>` : ""}
        <h2 style="margin-top:36px">Rennhistorie</h2>
        ${hist ? `<div class="hist">${hist}</div>` : `<p class="pending">Noch keine gewerteten Rennen für Darkline.</p>`}
      </article>
      <aside class="aside">
        ${(d.aufgaben || []).length ? `<div class="box"><span class="lbl">Aufgaben im Team</span><div class="crew">${d.aufgaben.map((t) => `<span>${esc(t)}</span>`).join("")}</div></div>` : ""}
        <div class="box"><span class="lbl">Statistik</span><dl class="dstats">
          <div><dt>Ø Zielposition</dt><dd>${st.avg ? "P" + st.avg.toFixed(1).replace(".", ",") : "–"}</dd></div>
          <div><dt>Plätze gutgemacht</dt><dd class="${st.gained > 0 ? "up" : ""}">${st.total ? (st.gained > 0 ? "+" : "") + st.gained : "–"}</dd></div>
          <div><dt>Gefahrene Klassen</dt><dd>${st.klassen.length ? st.klassen.map(esc).join(", ") : "–"}</dd></div>
        </dl></div>
        <div class="box"><a class="link" href="#lineup">← Zum Lineup</a></div>
      </aside></div>`;
  }
  function newsDetail(p) {
    const race = p.rennen ? D.races.find((r) => r.id === p.rennen) : null;
    return `<section class="dhero">${p.bild ? `<div class="bg"><img src="${esc(src(p.bild))}" alt=""></div>` : ""}
      <div class="wrap"><div><span class="eyb">${esc(p.kategorie || "News")} · ${esc(fmt(p.datum))}</span>
      <h1 class="wide" id="d-title" style="font-size:clamp(2rem,5.5vw,4.2rem)">${esc(p.titel)}</h1>
      ${p.teaser ? `<div class="meta" style="max-width:60ch;font-family:var(--f-wide);font-size:1rem;letter-spacing:0">${esc(p.teaser)}</div>` : ""}
      ${shareBtn()}</div></div></section>
      <div class="wrap dbody"><article class="prose">${md(p.inhalt) || `<p class="pending">Kein weiterer Text.</p>`}</article>
      <aside class="aside">
        ${race ? `<div class="box"><span class="lbl">Zum Rennen</span><a class="link" href="/rennen/${esc(race.id)}">${esc(race.titel)}${race.ziel ? " · P" + esc(race.ziel) : ""} →</a></div>` : ""}
        <div class="box"><a class="link" href="#news">← Alle News</a></div>
      </aside></div>`;
  }
  const baseTitle = document.title;
  function route() {
    let m = detailPath();
    const legacy = decodeURIComponent(location.hash.slice(1)).match(/^(rennen|news)-(.+)$/);
    if (!m && legacy) { history.replaceState(null, "", "/" + legacy[1] + "/" + legacy[2]); m = detailPath(); }
    if (m) {
      const id = decodeURIComponent(m[2]);
      if (m[1] === "rennen") { const r = D.races.find((x) => x.id === id); if (r) { document.title = r.titel + (r.ziel && r.status === "abgeschlossen" ? " – P" + r.ziel : "") + " · Darkline Performance Motorsport"; return openDetail(raceDetail(r), "klassement"); } }
      if (m[1] === "fahrer") { const d = D.drivers.find((x) => slugify(x.name) === id); if (d) { document.title = d.name + " · Darkline Performance Motorsport"; return openDetail(driverDetail(d), "lineup"); } }
      if (m[1] === "news") { const p = D.posts.find((x) => x.id === id); if (p) { document.title = p.titel + " · Darkline Performance Motorsport"; return openDetail(newsDetail(p), "news"); } }
    }
    document.title = baseTitle;
    closeDetail(false);
  }
  window.addEventListener("popstate", route);
  window.addEventListener("hashchange", () => { if (/^#(rennen|news)-/.test(location.hash)) route(); });

  /* ---------- Start ---------- */
  (async function init() {
    const [drivers, races, news, cars, settings, partners, shop] = await Promise.all(["drivers", "races", "news", "cars", "settings", "partners", "shop"].map(load));
    D = {
      drivers: (drivers && drivers.drivers) || [],
      races: (races && races.races) || [],
      posts: (news && news.posts) || [],
      cars: (cars && cars.cars) || [],
      settings: settings || {},
      partners: (partners && partners.partners) || [],
      shop: shop || {},
    };
    applySettings(); renderPitwall(); renderDrivers(); renderCalendar(); renderResults(); renderNews(); renderCars(); renderShop(); renderPartners();
    if (detailPath() || /^#(rennen|news)-/.test(location.hash)) route();
  })();
})();
