// Google Trends -- svaret på din fråga om det finns en sida som visar vad
// det faktiskt SÖKS på.
//
// Ja, men med tre viktiga förbehåll som formar hela den här filen:
//
//  1. Trends mäter Google-sökningar, inte Tradera- eller Blocket-sökningar.
//     Ingen av marknadsplatserna publicerar sina egna söksiffror. Trends är
//     den bästa proxyn som finns, inte samma sak.
//  2. Siffrorna är RELATIVA (0–100 mot sin egen topp), inte absoluta. Du kan
//     säga "porslin är hetare nu än i mars", aldrig "1 200 personer sökte".
//  3. Det officiella API:et (developers.google.com/search/blog/2025/07/trends-api)
//     har legat i ansökningsstyrd alfa sedan juli 2025. Fram tills du får in
//     där går vi via samma odokumenterade endpoint som trends-webben
//     använder -- och den strypa hårt. Jag fick 429 på widgetdata gång på
//     gång vid testning, även med paus emellan.
//
// Därav upplägget: hämta sällan (en gång per dygn räcker gott, signalen
// rör sig i veckotakt ändå), backa av långt vid 429, och ha alltid
// CSV-vägen som fallback -- se signals/trends-csv.js.

import { fetchText, sleep } from "../core/fetch.js";
import { CATEGORIES } from "../core/taxonomy.js";

const TRENDS = "https://trends.google.com/trends/api";

export const id = "google-trends";
export const label = "Google Trends";

/**
 * Sökintresse per kategori.
 *
 * @param {object} [opts]
 * @param {string} [opts.geo="SE"]      SE, NO, DK, DE, "" för hela världen
 * @param {string} [opts.time="today 12-m"]
 * @returns {Promise<Record<string, {interest:number|null, rising:Array}>>}
 */
export async function collect({ geo = "SE", time = "today 12-m" } = {}) {
  const out = {};
  for (const category of CATEGORIES) {
    // Kategorins mest talande sökterm, inte alla -- ett anrop per kategori
    // är 15 anrop per körning, vilket är precis vad strypningen tål.
    const term = category.queries[0];
    try {
      out[category.id] = await interestFor(term, { geo, time });
    } catch (error) {
      // En strypt kategori ska inte fälla hela körningen. Vi noterar bara
      // att signalen saknas; heatScore() viktar då om utan den.
      out[category.id] = { interest: null, rising: [], error: String(error.message || error) };
    }
    await sleep(4000);
  }
  return out;
}

/** Intresse över tid + stigande relaterade sökningar för en term. */
export async function interestFor(term, { geo = "SE", time = "today 12-m" } = {}) {
  const widgets = await explore(term, geo, time);

  const timeseries = widgets.find((w) => w.id === "TIMESERIES");
  const relatedQueries = widgets.find((w) => w.id.startsWith("RELATED_QUERIES"));

  const result = { term, geo, interest: null, trend: [], rising: [], top: [] };

  if (timeseries) {
    const data = await widgetData("multiline", timeseries);
    const points = data?.default?.timelineData || [];
    result.trend = points.map((p) => ({ t: p.formattedAxisTime, v: p.value?.[0] ?? null }));
    // "Intresse" = snittet av de senaste fyra veckorna, inte sista punkten.
    // Sista punkten är ofta en halvfärdig vecka och dyker artificiellt.
    const tail = result.trend.slice(-5, -1).map((p) => p.v).filter(Number.isFinite);
    result.interest = tail.length ? Math.round(tail.reduce((a, b) => a + b, 0) / tail.length) : null;
  }

  if (relatedQueries) {
    await sleep(3000);
    const data = await widgetData("relatedsearches", relatedQueries);
    const lists = data?.default?.rankedList || [];
    // Lista 0 = mest sökta ("top"), lista 1 = snabbast växande ("rising").
    // Rising är den intressanta för dig: det är där nästa trend syns innan
    // den blivit stor nog att märkas på Tradera.
    result.top = (lists[0]?.rankedKeyword || []).slice(0, 10)
      .map((k) => ({ query: k.query, value: k.value, label: k.formattedValue }));
    result.rising = (lists[1]?.rankedKeyword || []).slice(0, 10)
      .map((k) => ({ query: k.query, value: k.value, label: k.formattedValue }));
  }

  return result;
}

async function explore(keyword, geo, time) {
  const req = { comparisonItem: [{ keyword, geo, time }], category: 0, property: "" };
  const raw = await trendsGet(`${TRENDS}/explore`, { hl: "sv", tz: "-120", req: JSON.stringify(req) });
  return stripPrefix(raw).widgets || [];
}

async function widgetData(endpoint, widget) {
  const raw = await trendsGet(`${TRENDS}/widgetdata/${endpoint}`, {
    hl: "sv", tz: "-120",
    req: JSON.stringify(widget.request),
    token: widget.token,
  });
  return stripPrefix(raw);
}

async function trendsGet(url, params) {
  // URLSearchParams kodar mellanslag som "+". Trends-webben skickar "%20".
  // Båda är giltiga i en query-sträng, men när endpointen ändå är
  // odokumenterad finns det ingen anledning att avvika från vad den
  // bevisligen tar emot.
  const qs = new URLSearchParams(params).toString().replace(/\+/g, "%20");
  return fetchText(`${url}?${qs}`, {
    // En dygnsgammal trendsiffra är helt duglig -- veckoupplösning ändå.
    maxAgeMs: 20 * 60 * 60 * 1000,
    // Tio sekunder mellan träffar mot trends.google.com. Långsamt med flit:
    // det är billigare att vänta än att bli strypt och få noll data.
    delayMs: 10000,
    retries: 4,
    headers: { referer: "https://trends.google.com/trends/explore" },
  });
}

/** Trends-svaren inleds med ")]}'," som skydd mot JSON-hijacking. */
function stripPrefix(raw) {
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("Oväntat svar från Google Trends (ingen JSON)");
  return JSON.parse(raw.slice(start));
}
