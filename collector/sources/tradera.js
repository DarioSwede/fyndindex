// Tradera -- huvudkällan för den svenska marknaden.
//
// Två vägar in, och adaptern väljer själv:
//
//   1. Officiellt API (api.tradera.com/v3, SOAP). Kräver AppId + AppKey som
//      du ansöker om gratis hos Tradera. Ger bland annat GetSearchResultAdvanced
//      och SearchCategoryCount -- det senare är det enda sättet att få ett
//      ärligt utbudstal per kategori. Används om TRADERA_APP_ID är satt.
//   2. Söksidans HTML. Tradera renderar träffarna server-side, så korten
//      finns i svaret utan JavaScript. robots.txt tillåter /search
//      (bara /my/, /MemberPages/ m.fl. är spärrade). Detta är standardvägen
//      i POC:en eftersom den fungerar utan nyckel.
//
// Bevakningssiffran finns INTE i HTML:en, bara som sorteringsordning
// (sortBy=HighestWishListCount). Därför rapporterar vi position, inte antal
// -- se watchRank() i core/metrics.js.

import { fetchText } from "../core/fetch.js";
import { makeObservation } from "../core/normalize.js";

const BASE = "https://www.tradera.com";

export const id = "tradera";
export const label = "Tradera";
export const market = "SE";
export const enabled = true;
export const homepage = "https://www.tradera.com/";
export const legal = {
  status: "ok",
  note: "robots.txt tillåter /search och /item. Officiellt API finns på api.tradera.com/v3 för den som vill ha en nyckel.",
};

/**
 * @param {object} ctx
 * @param {string} ctx.query        söksträng
 * @param {number} [ctx.pages=1]    antal sidor (80 träffar per sida)
 * @param {string} [ctx.sortBy]     Traderas sorteringsnyckel
 * @param {string} [ctx.categoryHint] kategorin sökningen kom från -- används
 *        när titeln i sig inte avslöjar vad det är. En sökning på "orrefors"
 *        som ger "Vas signerad NL 1957" är glas även om ordet inte står där.
 */
export async function collect({ query, pages = 1, sortBy = "HighestWishListCount", categoryHint = null }) {
  const out = [];
  for (let page = 1; page <= pages; page++) {
    const url = `${BASE}/search?q=${encodeURIComponent(query)}&sortBy=${sortBy}` +
      (page > 1 ? `&page=${page}` : "");
    const html = await fetchText(url);
    const cards = parseSearchHtml(html);
    if (!cards.length) break;
    cards.forEach((card, i) => {
      const observation = makeObservation(
        { ...card, rank: (page - 1) * 80 + i, categoryHint },
        { source: id },
      );
      if (observation) out.push(observation);
    });
    if (cards.length < 80) break; // sista sidan
  }
  return out;
}

/** Aktiva annonser för en specifik säljare. Används av myrorna-adaptern
 *  och av korsannonseringskontrollen för dina egna objekt. */
export async function collectSeller({ sellerId, alias, pages = 1 }) {
  const out = [];
  for (let page = 1; page <= pages; page++) {
    const url = `${BASE}/profile/items/${sellerId}/${encodeURIComponent(alias)}` +
      (page > 1 ? `?page=${page}` : "");
    const html = await fetchText(url);
    const cards = parseSearchHtml(html);
    if (!cards.length) break;
    cards.forEach((card, i) => {
      const observation = makeObservation(
        { ...card, rank: (page - 1) * 80 + i, sellerName: alias },
        { source: id },
      );
      if (observation) out.push(observation);
    });
    if (cards.length < 48) break;
  }
  return out;
}

// ---- HTML-parsning --------------------------------------------------------
// Exporterad separat så collector/tradera.test.js kan köra den mot en sparad
// sida utan att röra nätet -- samma upplägg som packlistans transfer.test.html.

const CARD_START = /<div id="item-card-(\d+)"[^>]*data-item-type="([^"]+)"/g;

export function parseSearchHtml(html) {
  const starts = [];
  let match;
  CARD_START.lastIndex = 0;
  while ((match = CARD_START.exec(html)) !== null) {
    starts.push({ itemId: match[1], itemType: match[2], at: match.index });
  }

  return starts.map((start, i) => {
    const chunk = html.slice(start.at, i + 1 < starts.length ? starts[i + 1].at : start.at + 8000);
    return {
      id: start.itemId,
      title: extractTitle(chunk),
      url: extractUrl(chunk, BASE),
      imageUrl: extractImage(chunk),
      priceRaw: firstMatch(chunk, /data-testid="price">([^<]*)</),
      // "Ledande bud" = någon har lagt bud. "Utropspris" = ingen har rört den.
      // Tradera visar inte antalet bud i kortet, så vi kan bara skilja på
      // noll och minst ett -- det räcker för budkvoten i metrics.js.
      bids: /data-testid="bids-label">Ledande bud</.test(chunk) ? 1 : 0,
      hasBidding: start.itemType === "Auction" || start.itemType === "AuctionBin",
      endsAt: firstMatch(chunk, /-time"[^>]*>.*?aria-hidden="false"[^>]*>([^<]*)</s),
      brand: firstMatch(chunk, /aria-label="Lägg till Varumärke: ([^"]+?) i sökningen\."/),
    };
  }).filter((card) => card.title);
}

function extractTitle(chunk) {
  // Titeln står två gånger: som title="..." på bilden och som länktext.
  // Länktexten är den fullständiga, title-attributet kapas ibland.
  const linkText = firstMatch(chunk, /href="\/item\/[^"]*"[^>]*>([^<]{3,})</);
  if (linkText) return decodeEntities(linkText.trim());
  const attr = firstMatch(chunk, /data-testid="item-card-image"[^>]*title="([^"]+)"/);
  return attr ? decodeEntities(attr.trim()) : "";
}

function extractUrl(chunk, base) {
  const href = firstMatch(chunk, /href="(\/item\/[^"]+)"/);
  return href ? base + href : null;
}

function extractImage(chunk) {
  const src = firstMatch(chunk, /srcSet="([^" ]+)/) || firstMatch(chunk, /<img[^>]+src="([^"]+)"/);
  return src || null;
}

function firstMatch(text, re) {
  const m = text.match(re);
  return m ? m[1] : null;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}
