// Poshmark (US) -- första internationella källan, med som mall för hur de
// andra utländska ska se ut när du får åtkomst till dem.
//
// Poshmark är den enda av de utländska du nämnde som svarar normalt: Depop
// och ThredUp 403:ar från datacenter-IP och Vinted kräver sessionstoken (se
// sources/blocked.js). Poshmark renderar sina sökträffar server-side och
// lägger dessutom en schema.org-ItemList i sidan, vilket gör den ovanligt
// tacksam -- vi behöver inte gissa oss till CSS-klasser alls.
//
// Vi läser bara /search. Enskilda annonssidor hämtas aldrig.

import { fetchText } from "../core/fetch.js";
import { makeObservation } from "../core/normalize.js";

const BASE = "https://poshmark.com";

export const id = "poshmark";
export const label = "Poshmark";
export const market = "US";
// Avstängd i standardkörningen: du bad om svensk marknad först, och
// utländska priser i USD blandat med svenska i SEK gör översikten grumlig
// innan du bestämt hur du vill jämföra dem. Slå på med --markets=SE,US.
export const enabled = false;
export const homepage = "https://poshmark.com/";
export const legal = {
  status: "ok",
  note: "robots.txt tillåter /search (spärrar /listings, /users, /order m.fl. som vi inte rör). Priser är i USD och räknas om med en fast kurs -- se FX_TO_SEK i core/normalize.js.",
};

export async function collect({ query, limit = 80, categoryHint = null }) {
  const html = await fetchText(`${BASE}/search?query=${encodeURIComponent(query)}&type=listings`);
  return parseSearchHtml(html)
    .slice(0, limit)
    .map((item) => makeObservation({ ...item, categoryHint }, { source: id }))
    .filter(Boolean);
}

export function parseSearchHtml(html) {
  const out = [];
  for (const block of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    let data;
    try { data = JSON.parse(block[1]); } catch { continue; }
    if (data["@type"] !== "ItemList" || !Array.isArray(data.itemListElement)) continue;

    for (const entry of data.itemListElement) {
      if (!entry.url) continue;
      const slug = entry.url.split("/listing/")[1] || "";
      out.push({
        id: slug.split("-").pop(),
        url: entry.url,
        // Poshmarks slug är titeln med bindestreck och ett hex-id sist.
        title: slug.replace(/-[a-f0-9]{20,}$/i, "").replace(/-/g, " ").trim(),
        // position i ItemList = Poshmarks egen relevansordning, vilket är
        // närmaste motsvarighet till Traderas bevakningssortering.
        rank: (entry.position || out.length + 1) - 1,
        hasBidding: false,
        bids: 0,
        currency: "USD",
      });
    }
  }
  return out;
}
