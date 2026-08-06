// Bukowskis -- auktionshus, tyngdpunkt på antikt, design, konst och smycken.
//
// Viktig för dig eftersom den täcker exakt de tre kategorier du bad om
// (glas, porslin, antik & design) i det övre prisskiktet. Tradera visar vad
// folk säljer; Bukowskis visar vad samma saker faktiskt värderas till.
//
// Bukowskis har ingen fri sökväg som svarar 200 (/sv/search ger 404), men
// katalogsidorna är server-renderad HTML och robots.txt spärrar bara
// /admin/, /cms/ och PDF:er. Vi går därför via den öppna auktionens
// lot-lista och filtrerar på våra egna nyckelord i stället för att söka.

import { fetchText } from "../core/fetch.js";
import { makeObservation } from "../core/normalize.js";
import { titleFingerprint } from "../core/normalize.js";

const BASE = "https://www.bukowskis.com";

export const id = "bukowskis";
export const label = "Bukowskis";
export const market = "SE";
export const enabled = true;
export const homepage = "https://www.bukowskis.com/sv";
export const legal = {
  status: "ok",
  note: "robots.txt spärrar bara /admin/, /cms/ och PDF. Katalogsidorna är öppna och server-renderade.",
};

/**
 * @param {object} ctx
 * @param {string[]} ctx.keywords  filtrerar lot-titlarna, t.ex. kategorins brands
 * @param {string} [ctx.auctionId] specifik auktion; utan den läses den som
 *                                 länkas från startsidan just nu
 */
export async function collect({ keywords = [], auctionId = null }) {
  const auction = auctionId || (await currentAuctionId());
  if (!auction) return [];

  const html = await fetchText(`${BASE}/sv/auctions/${auction}/lots`);
  const lots = parseLots(html);

  const wanted = keywords.map((k) => k.toLowerCase());
  return lots
    .filter((lot) => !wanted.length || wanted.some((k) => lot.title.toLowerCase().includes(k)))
    .map((lot, i) => makeObservation({ ...lot, rank: i }, { source: id }))
    .filter(Boolean);
}

/** Bukowskis auktions-id (t.ex. "E1406") ändras varje omgång -- läs det
 *  från startsidan i stället för att hårdkoda en som slutar fungera. */
async function currentAuctionId() {
  const html = await fetchText(`${BASE}/sv`, { maxAgeMs: 12 * 60 * 60 * 1000 });
  const match = html.match(/\/sv\/auctions\/([A-Z]\d+)\/lots/);
  return match ? match[1] : null;
}

export function parseLots(html) {
  const out = [];
  const re = /href="(\/sv\/auctions\/[A-Z]\d+\/lots\/(\d+)-([^"]+))"/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    out.push({
      id: m[2],
      url: BASE + m[1],
      // Bukowskis slug ÄR titeln, gemener och bindestreck. Bättre än att
      // gissa vilken div titeln bor i -- den flyttar sig när de bygger om,
      // slug-formatet gör det inte.
      title: m[3].replace(/-/g, " ").trim(),
      hasBidding: true,
      bids: 0,
      priceRaw: null,
      currency: "SEK",
    });
  }
  return out;
}

export { titleFingerprint };
