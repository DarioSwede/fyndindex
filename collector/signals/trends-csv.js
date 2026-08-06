// Reservvägen för Google Trends: CSV-filen du laddar ner för hand.
//
// Poängen: den odokumenterade endpointen i google-trends.js slutar fungera
// den dag Google vill det, och strypa redan idag. Nedladdningsknappen på
// trends.google.com gör det inte. När automatiken tystnar öppnar du
//
//   https://trends.google.com/trends/explore?geo=SE&q=porslin
//
// klickar på nedladdningsikonen vid "Intresse över tid", och släpper filen
// i appen. Samma import-mönster som packlistans transfer.js -- läs, tolka,
// visa vad som hittades innan något sparas.
//
// Node-fri: körs både i collectorn och direkt i webbläsaren.

/**
 * Tolkar en Trends-CSV. Google levererar tre olika format beroende på
 * vilken panel du laddar ner från, och vi känner igen alla tre på deras
 * rubrikrad i stället för att kräva att du väljer rätt i en meny.
 *
 * @param {string} text
 * @returns {{kind: string, term: string|null, rows: Array}}
 */
export function parseTrendsCsv(text) {
  const lines = String(text).replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
  if (!lines.length) throw new Error("Filen är tom.");

  // Rad 1 är alltid en etikett ("Kategori: Alla kategorier" eller liknande),
  // rad 2 är rubrikraden. Ibland saknas rad 1 -- därför letar vi efter
  // rubrikraden i stället för att räkna rader.
  const headerIndex = lines.findIndex((l) => /^(Vecka|Dag|Månad|Week|Day|Month|Region|TOPP|STIGANDE|TOP|RISING)/i.test(l));
  if (headerIndex < 0) throw new Error("Hittar ingen rubrikrad -- är det en Trends-export?");

  const header = splitCsvLine(lines[headerIndex]);
  const body = lines.slice(headerIndex + 1).map(splitCsvLine).filter((c) => c.length >= 2);
  const term = (header[1] || "").replace(/:\s*\(.*\)$/, "").trim() || null;

  if (/^(Vecka|Dag|Månad|Week|Day|Month)/i.test(header[0])) {
    return {
      kind: "interest-over-time",
      term,
      rows: body.map(([t, v]) => ({
        t,
        // "<1" betyder "under 1 %", inte noll -- men i vår skala är
        // skillnaden meningslös, så vi behandlar det som 0.
        v: v === "<1" ? 0 : Number(v),
      })).filter((r) => Number.isFinite(r.v)),
    };
  }

  if (/^Region/i.test(header[0])) {
    return { kind: "by-region", term, rows: body.map(([region, v]) => ({ region, v: Number(v) || 0 })) };
  }

  // TOPP/STIGANDE: värdekolumnen är antingen ett tal 0–100 eller
  // "Kraftig ökning" / "Breakout" för termer som växt över mätbart.
  return {
    kind: /stigande|rising/i.test(header[0]) ? "rising-queries" : "top-queries",
    term,
    rows: body.map(([query, v]) => ({
      query,
      label: v,
      breakout: /kraftig|breakout/i.test(v),
      v: /kraftig|breakout/i.test(v) ? 5000 : Number(String(v).replace(/[^\d]/g, "")) || 0,
    })),
  };
}

/** Minimal CSV-splittring som klarar citerade fält med kommatecken i. */
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur.trim()); cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Slår ihop en importerad CSV till samma form som google-trends.js ger,
 * så att gränssnittet inte behöver veta varifrån signalen kom.
 */
export function csvToSignal(parsed) {
  if (parsed.kind === "interest-over-time") {
    const tail = parsed.rows.slice(-5, -1).map((r) => r.v);
    return {
      term: parsed.term,
      interest: tail.length ? Math.round(tail.reduce((a, b) => a + b, 0) / tail.length) : null,
      trend: parsed.rows.map((r) => ({ t: r.t, v: r.v })),
      rising: [], top: [], origin: "csv",
    };
  }
  if (parsed.kind === "rising-queries" || parsed.kind === "top-queries") {
    const key = parsed.kind === "rising-queries" ? "rising" : "top";
    return { term: parsed.term, interest: null, trend: [], rising: [], top: [], origin: "csv", [key]: parsed.rows };
  }
  return { term: parsed.term, interest: null, trend: [], rising: [], top: [], origin: "csv" };
}
