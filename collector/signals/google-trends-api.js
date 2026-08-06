// Google Trends -- det OFFICIELLA API:et.
//
// Svaret på "kunde vi använda Google Trends API?": ja, och det är den här
// filen. Den är färdig så när som på en nyckel.
//
// Läget (kontrollerat 2026-08-06): API:et lanserades i juli 2025 och ligger
// fortfarande i ansökningsstyrd alfa. Det är gratis, men du kommer inte in
// utan att ansöka och bli antagen:
//
//     https://developers.google.com/search/apis/trends
//
// Google prioriterar sökande som vet vad de ska bygga och kan börja direkt.
// Beskriv Fyndindex konkret i ansökan -- kategoriindex för svensk
// andrahandsmarknad, dygnsvis hämtning, femton söktermer, geo=SE.
//
// Varför det är värt besväret jämfört med signals/google-trends.js:
//
//   - Ingen strypning. Den odokumenterade endpointen 429:ar redan vid
//     normal användning; det var därför CSV-importen behövde byggas.
//   - Konsekvent skalning. Trends-webben skalar om varje uttag mot sin egen
//     topp, så två hämtningar med olika tidsfönster går inte att jämföra.
//     API:et ger en genomgående skala över hela perioden, vilket är precis
//     vad heatDelta mellan två insamlingar behöver för att betyda något.
//   - 5 års historik med dygns-, vecko-, månads- och årsupplösning.
//   - Dussintals termer per anrop i stället för webbens tak på åtta.
//
// När du är antagen: sätt GOOGLE_TRENDS_API_KEY i miljön och byt
// `import * as trends from "./signals/google-trends.js"` mot den här filen i
// collector/run.js. Formen på det som returneras är avsiktligt identisk, så
// inget annat behöver ändras.

import { fetchText } from "../core/fetch.js";
import { CATEGORIES } from "../core/taxonomy.js";

export const id = "google-trends-api";
export const label = "Google Trends (officiellt API)";

const ENDPOINT = "https://trends.googleapis.com/v1beta/trends";

export function isConfigured() {
  return Boolean(process.env.GOOGLE_TRENDS_API_KEY);
}

/**
 * Samma signatur och returform som signals/google-trends.js collect().
 * @returns {Promise<Record<string, {interest:number|null, rising:Array}>>}
 */
export async function collect({ geo = "SE", months = 12 } = {}) {
  const key = process.env.GOOGLE_TRENDS_API_KEY;
  if (!key) {
    throw new Error(
      "GOOGLE_TRENDS_API_KEY saknas. Ansök om alfa-åtkomst på " +
      "https://developers.google.com/search/apis/trends och sätt nyckeln i miljön.",
    );
  }

  // Hela poängen med det officiella API:et: alla termer i ETT anrop, med en
  // gemensam skala. Webbversionen tvingar fram ett anrop per kategori och
  // ger varje svar sin egen normalisering.
  const terms = CATEGORIES.map((c) => c.queries[0]);
  const params = new URLSearchParams({
    key,
    region: geo,
    resolution: "WEEK",
    // API:et är i alfa och fältnamnen kan mycket väl ändras innan GA.
    // Kontrollera mot dokumentationen du får tillgång till vid antagning
    // -- det här är byggt på vad som var publikt beskrivet, inte på ett
    // svar jag kunnat köra skarpt.
    startDate: isoMonthsAgo(months),
    endDate: today(),
  });
  for (const term of terms) params.append("terms", term);

  const raw = await fetchText(`${ENDPOINT}?${params}`, {
    maxAgeMs: 20 * 60 * 60 * 1000,
    delayMs: 1000, // ingen anledning att krypa när det finns en kvot
    retries: 2,
  });
  const data = JSON.parse(raw);

  const out = {};
  CATEGORIES.forEach((category, i) => {
    const series = data.timelines?.[i]?.points || [];
    const values = series.map((p) => p.value).filter(Number.isFinite);
    // Sista punkten är en pågående vecka och dyker artificiellt -- samma
    // hantering som i den odokumenterade varianten, av samma skäl.
    const tail = values.slice(-5, -1);
    out[category.id] = {
      term: category.queries[0],
      geo,
      interest: tail.length ? Math.round(tail.reduce((a, b) => a + b, 0) / tail.length) : null,
      trend: series.map((p) => ({ t: p.date, v: p.value })),
      top: [],
      // Relaterade sökningar låg inte i den publikt beskrivna alfa-ytan.
      // Finns de när du kommer in, fyll på här -- resten av appen läser
      // redan `rising` och ritar den i detaljvyn.
      rising: [],
      origin: "api",
    };
  });
  return out;
}

const today = () => new Date().toISOString().slice(0, 10);

function isoMonthsAgo(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}
