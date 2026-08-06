// Sellpy.
//
// Läs robots.txt innan du utökar den här adaptern. Sellpy tillåter det
// mesta MEN spärrar uttryckligen sökningen:
//
//   Disallow: /store/*/*/search?*
//   Disallow: /store/*/*/search/*
//
// Att söka är alltså inte tillåtet, hur frestande det än är. Vi använder
// deras publicerade sitemap i stället, som de själva pekar ut i robots.txt.
// Det ger sämre kontroll över urvalet -- vi kan inte fråga efter "orrefors",
// bara läsa vad som råkar ligga i sitemapen och filtrera själva -- men det
// håller sig innanför det de sagt ja till.

import { fetchText } from "../core/fetch.js";
import { makeObservation } from "../core/normalize.js";

const SITEMAP = "https://d11b4fm2koijtd.cloudfront.net/SE/sitemap-index.xml";

export const id = "sellpy";
export const label = "Sellpy";
export const market = "SE";
export const enabled = true;
export const homepage = "https://www.sellpy.se/";
export const legal = {
  status: "ok",
  note: "Sökvägarna är spärrade i robots.txt och används inte. Adaptern läser bara den sitemap Sellpy själva publicerar.",
};

export async function collect({ keywords = [], limit = 150 }) {
  const wanted = keywords.map((k) => k.toLowerCase());
  const urls = await itemUrls(limit * 6);

  return urls
    .map((url) => ({ url, title: titleFromSlug(url) }))
    .filter((o) => o.title.length > 3 && (!wanted.length || wanted.some((k) => o.title.toLowerCase().includes(k))))
    .slice(0, limit)
    .map((o, i) => makeObservation({
      id: o.url.split("/").filter(Boolean).pop(),
      url: o.url,
      title: o.title,
      rank: i,
      // Sellpy är fastpris, inte auktion. Budkvoten blir därför meningslös
      // här -- hasBidding: false gör att metrics.js hoppar över dem i
      // bidRate() i stället för att räkna dem som "noll bud" och dra ned
      // hela kategorin.
      hasBidding: false,
      bids: 0,
      currency: "SEK",
    }, { source: id }))
    .filter(Boolean);
}

async function itemUrls(cap) {
  const index = await fetchText(SITEMAP, { maxAgeMs: 24 * 60 * 60 * 1000 });
  const maps = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const urls = [];
  for (const map of maps.slice(0, 4)) {
    const xml = await fetchText(map, { maxAgeMs: 12 * 60 * 60 * 1000 });
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      if (/\/item\//i.test(m[1])) urls.push(m[1]);
      if (urls.length >= cap) return urls;
    }
  }
  return urls;
}

function titleFromSlug(url) {
  const slug = url.replace(/\/$/, "").split("/").pop() || "";
  return decodeURIComponent(slug).replace(/[-_]/g, " ").replace(/\b[a-f0-9]{16,}\b/gi, "").trim();
}
