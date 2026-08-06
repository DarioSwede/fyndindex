// Plick -- svensk secondhand-app, tyngdpunkt kläder och ungt mode.
//
// Avstängd i utgångsläget, men INTE av juridiska skäl: plick.se har en tom
// robots.txt, alltså inga spärrar alls. Det är rent tekniskt.
//
// Sökningen ligger på /produkter?query=... och svarar 200, men träffarna
// renderas i en Turbo-frame (Hotwire) och finns därför inte i det första
// HTML-svaret -- jag verifierade det: 147 kB svar, noll produktlänkar.
// Att komma åt dem kräver antingen deras turbo-stream-endpoint (som jag
// inte hittat en stabil form på) eller en headless browser, och en
// headless browser i en POC är ett beroende som kostar mer än den ger.
//
// Slå på den genom att fylla i parseProducts() nedan när du hittat rätt
// endpoint -- resten av adaptern är färdig.

import { fetchText } from "../core/fetch.js";
import { makeObservation } from "../core/normalize.js";

const BASE = "https://plick.se";

export const id = "plick";
export const label = "Plick";
export const market = "SE";
export const enabled = false;
export const homepage = "https://plick.se/";
export const legal = {
  status: "ok",
  note: "Tom robots.txt -- inga spärrar. Avstängd av tekniska skäl: träffarna laddas i en Turbo-frame och syns inte i första HTML-svaret.",
};

export async function collect({ query }) {
  const html = await fetchText(`${BASE}/produkter?query=${encodeURIComponent(query)}`, {
    headers: {
      // Turbo-frame-svaret är det som faktiskt innehåller korten. Utan de
      // här två huvudena får man skalet.
      accept: "text/vnd.turbo-stream.html, text/html, application/xhtml+xml",
      "turbo-frame": "listing_index",
    },
  });
  return parseProducts(html).map((p, i) =>
    makeObservation({ ...p, rank: i }, { source: id })).filter(Boolean);
}

export function parseProducts(html) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/href="\/produkter\/([^"/]+)"/g)) {
    const slug = m[1];
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({
      id: slug.split("-").pop(),
      url: `${BASE}/produkter/${slug}`,
      // Plicks slug är "titel-med-bindestreck-KORTID". Sista biten är ett
      // id och ska inte hamna i titeln.
      title: slug.replace(/-[A-Za-z0-9]{20,}$/, "").replace(/-/g, " ").trim(),
      hasBidding: false,
      bids: 0,
      currency: "SEK",
    });
  }
  return out;
}
