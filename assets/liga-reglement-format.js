/* Reglement als einfacher Text zum Bearbeiten und zurück in Blöcke. Läuft in Browser und Node. */
(function (root, fabrik) {
  const api = fabrik();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LigaReglementFormat = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Sortiert 4.3 vor 5.8 und 5.8 vor 5.10. Eine leere oder ungültige Nummer kommt ans Ende.
  function nummerVergleich(a, b) {
    const teile = (n) => String(n || "").trim().split(".").map((x) => (x === "" || Number.isNaN(Number(x)) ? Infinity : Number(x)));
    const x = teile(a);
    const y = teile(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const p = x[i] ?? -1;
      const q = y[i] ?? -1;
      if (p !== q) return p < q ? -1 : 1;
    }
    return 0;
  }

  function bloeckeZuText(bloecke) {
    return bloecke.map((b) => {
      if (b.art === "ul") return b.items.map((x) => `- ${x}`).join("\n");
      if (b.art === "zeilen") return b.items.join("\n");
      if (b.art === "tabelle") return [b.kopf, ...b.zeilen].map((z) => `| ${z.join(" | ")} |`).join("\n");
      if (b.art === "bild") return `[bild ${b.src} | ${b.text} | ${b.alt}]`;
      return b.text;
    }).join("\n\n");
  }

  function textZuBloecke(text) {
    return String(text || "").replace(/\r/g, "").split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean).map((teil) => {
      const zeilen = teil.split("\n").map((z) => z.trim()).filter(Boolean);
      if (zeilen.every((z) => z.startsWith("- "))) return { art: "ul", items: zeilen.map((z) => z.slice(2).trim()) };
      if (zeilen.every((z) => z.startsWith("|"))) {
        const [kopf, ...rest] = zeilen.map((z) => z.replace(/^\||\|$/g, "").split("|").map((w) => w.trim()));
        return { art: "tabelle", kopf, zeilen: rest };
      }
      // Bilder nur aus dem eigenen Ordner, damit über das Formular keine fremden Adressen eingebunden werden.
      const bild = /^\[bild (img\/regeln\/[\w.-]+) \| (.*?) \| (.*)\]$/.exec(teil);
      if (bild) return { art: "bild", src: bild[1], text: bild[2], alt: bild[3] };
      return zeilen.length > 1 ? { art: "zeilen", items: zeilen } : { art: "p", text: zeilen[0] };
    });
  }

  // Ein Punkt gehört zu dem Abschnitt, auf den seine Nummer zeigt. Aus 5.8 wird mit der Nummer 4.3 also ein Punkt von Abschnitt 4.
  function ordneReglement(r) {
    const nachNummer = new Map(r.abschnitte.map((h) => [String(h.nr), h]));
    r.abschnitte.forEach((h) => {
      const bleiben = [];
      h.unter.forEach((u) => {
        const ziel = nachNummer.get(String(u.nr).split(".")[0].trim());
        if (ziel && ziel !== h) { ziel.unter.push(u); ziel.offen = true; } else bleiben.push(u);
      });
      h.unter = bleiben;
    });
    const nachNr = (a, b) => nummerVergleich(a.nr, b.nr);
    r.abschnitte.sort(nachNr);
    r.abschnitte.forEach((h) => h.unter.sort(nachNr));
    return r;
  }

  // Einheitliche Form zum Bearbeiten und Speichern
  const zuBearbeitung = (r) => ({ titel: r.titel, version: r.version, stand: r.stand, abschnitte: r.abschnitte.map((h) => ({ nr: h.nr, titel: h.titel, unter: h.unter.map((u) => ({ nr: u.nr, titel: u.titel, text: u.text !== undefined ? u.text : bloeckeZuText(u.bloecke) })) })) });
  const zuAnzeige = (r) => ({ ...r, abschnitte: r.abschnitte.map((h) => ({ ...h, unter: h.unter.map((u) => ({ nr: u.nr, titel: u.titel, bloecke: u.bloecke || textZuBloecke(u.text) })) })) });

  return { nummerVergleich, ordneReglement, bloeckeZuText, textZuBloecke, zuBearbeitung, zuAnzeige };
});
