// Stockholms Auktionsverk.
//
// auktionsverket.se är numera bara en vidarebefordran till
// stockholmsauktionsverk.com (nginx 301). Sajten är WordPress med en
// tillåtande robots.txt -- bara /wordpress/wp-admin/ är spärrad -- och den
// publicerar en sitemap.
//
// Deras fritextsökning renderas i klienten, så sökvägen ger inga träffar i
// HTML:en. Vi går i stället via sitemap.xml och plockar objektsidorna. Det
// är långsammare men stabilare: en sitemap byter sällan format, en
// sökresultatmall byter det ofta.

import { fetchText } from "../core/fetch.js";
import { makeObservation } from "../core/normalize.js";

const BASE = "https://stockholmsauktionsverk.com";

export const id = "auktionsverket";
export const label = "Stockholms Auktionsverk";
export const market = "SE";
export const enabled = true;
export const homepage = "https://www.auktionsverket.se/";
export const legal = {
  status: "verify",
  note: "robots.txt spärrar bara wp-admin och sitemap är publicerad, men de saknar uttryckliga API-villkor. Hämtas långsamt och i liten skala -- läs deras användarvillkor innan du kör det ofta.",
};

export async function collect({ keywords = [], limit = 120 }) {
  const urls = await objectUrls(limit * 4);
  const wanted = keywords.map((k) => k.toLowerCase());

  return urls
    .map((url) => ({ url, title: titleFromSlug(url) }))
    .filter((o) => o.title && (!wanted.length || wanted.some((k) => o.title.toLowerCase().includes(k))))
    .slice(0, limit)
    .map((o, i) => makeObservation({
      id: o.url.split("/").filter(Boolean).pop(),
      url: o.url,
      title: o.title,
      rank: i,
      hasBidding: true,
      bids: 0,
      currency: "SEK",
    }, { source: id }))
    .filter(Boolean);
}

async function objectUrls(cap) {
  // Sitemap-index -> undersitemaps -> objektsidor. Vi tar de senaste först,
  // eftersom det är pågående auktioner som säger något om vad som rör sig nu.
  const index = await fetchText(`${BASE}/sitemap.xml`, { maxAgeMs: 24 * 60 * 60 * 1000 });
  const maps = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const objectMaps = maps.filter((u) => /objekt|auktion|lot/i.test(u)).slice(0, 3);

  const urls = [];
  for (const map of objectMaps.length ? objectMaps : maps.slice(0, 2)) {
    const xml = await fetchText(map, { maxAgeMs: 12 * 60 * 60 * 1000 });
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      if (/\/(objekt|lot)\//i.test(m[1])) urls.push(m[1]);
      if (urls.length >= cap) return urls;
    }
  }
  return urls;
}

/** ".../objekt/1234-orrefors-vas-nils-landberg/" -> "orrefors vas nils landberg" */
function titleFromSlug(url) {
  const slug = url.replace(/\/$/, "").split("/").pop() || "";
  return slug.replace(/^\d+-/, "").replace(/-/g, " ").trim();
}
