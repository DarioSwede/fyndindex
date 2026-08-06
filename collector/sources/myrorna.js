// Myrorna.
//
// Du undrade hur Myrorna funkar. Svaret är att de inte har någon egen
// webbshop att hämta från -- deras egen shopsida säger det rakt ut:
//
//   "Alla våra webbshopsprodukter säljs via auktion på Tradera med
//    utropspris 1 kr."
//
// Myrorna.se/shop är alltså ett skyltfönster som länkar vidare till
// tradera.com/profile/information/3532689/myrorna. Vi hämtar därför inte
// från myrorna.se alls, utan läser deras Tradera-butik direkt. Det ger
// bättre data (bud, sluttid, bevakningsordning) och belastar en sajt
// mindre.
//
// Samma sak gäller flera andra svenska secondhandkedjor -- Erikshjälpen,
// Stadsmissionen och Röda Korset säljer också via Tradera. Lägg till dem
// genom att kopiera den här filen och byta SELLER nedan.

import { collectSeller } from "./tradera.js";

const SELLER = { id: "3532689", alias: "myrorna" };

export const id = "myrorna";
export const label = "Myrorna";
export const market = "SE";
export const enabled = true;
export const homepage = "https://www.myrorna.se/shop/";
export const legal = {
  status: "ok",
  note: "Hämtas inte från myrorna.se utan från deras Tradera-butik, som robots.txt tillåter. Utropspris är alltid 1 kr, så prisdata från Myrorna säger inget om värde -- bara budkvoten är meningsfull.",
};

export async function collect({ pages = 2 } = {}) {
  const observations = await collectSeller({ ...SELLER, pages });
  // Allt hos Myrorna startar på 1 kr. Att ta med det i prismedianen skulle
  // dra ned hela kategorin, så vi nollar priset och låter bara
  // efterfrågesignalen (bud/bevakningsordning) räknas.
  return observations.map((o) => ({
    ...o,
    source: id,
    priceSek: o.bids > 0 ? o.priceSek : null,
    sellerName: "Myrorna",
  }));
}
