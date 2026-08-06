// Trendmåtten. Delas mellan collectorn (som räknar fram dem vid insamling)
// och appen (som räknar om dem när du filtrerar i gränssnittet) -- därför
// samma Node-fria ES-modul som taxonomy.js.
//
// Grundtanken: en enskild annons säger nästan ingenting. Det som säger något
// är FÖRHÅLLANDET mellan efterfrågan och utbud, och hur det förhållandet
// rör sig mellan två insamlingar. Allt här nedan är olika sätt att uttrycka
// det så kort att det får plats på ett kort i gränssnittet.

/** Median utan att sortera sönder inparametern. */
export function median(values) {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/**
 * Efterfrågekvot: andelen annonser som fått minst ett bud.
 *
 * Tradera visar "Ledande bud" i stället för "Utropspris" så fort någon lagt
 * ett bud, vilket gör det här till det ärligaste demand-måttet vi kommer åt
 * utan inloggning. En kategori där 70 % av auktionerna har bud är het; en
 * där 5 % har bud är det inte, oavsett hur många annonser som ligger ute.
 */
export function bidRate(observations) {
  const auctions = observations.filter((o) => o.hasBidding);
  if (!auctions.length) return null;
  return auctions.filter((o) => o.bids > 0).length / auctions.length;
}

/**
 * Bevakningsrank: 1.0 för det som ligger överst när källan sorteras på
 * flest bevakningar, fallande därefter.
 *
 * Tradera exponerar inte bevakningssiffran per annons i HTML:en, bara
 * sorteringsordningen (sortBy=HighestWishListCount). Vi kan alltså inte
 * säga "42 bevakningar" -- men vi kan säga "den här ligger på plats 3 av
 * 80 mest bevakade". Positionen är signalen, inte ett påhittat tal.
 */
export function watchRank(observation, pageSize = 80) {
  if (!Number.isFinite(observation.rank)) return null;
  return Math.max(0, 1 - observation.rank / pageSize);
}

/**
 * Rankviktad budkvot: som bidRate(), men ett bud på en högt bevakad annons
 * väger tyngre än ett bud på en lågt bevakad.
 *
 * Varför inte bara snittet av watchRank som egen term: alla annonser vi
 * samlar in kommer från en bevakningssorterad topplista, så varje kategori
 * får i praktiken samma snittrank (~0,5). Det är en konstant, och en
 * konstant i en viktad summa flyttar bara hela skalan utan att skilja
 * kategorierna åt -- vilket var precis vad som hände: allt landade på
 * 20–32 och färgskalan blev meningslös.
 *
 * Rankviktningen använder samma tal men som VIKT i stället för som term,
 * och då bär den faktisk information: "får de mest bevakade sakerna bud?"
 */
export function weightedBidRate(observations, pageSize = 80) {
  const auctions = observations.filter((o) => o.hasBidding);
  if (!auctions.length) return null;

  let weighted = 0;
  let total = 0;
  for (const o of auctions) {
    // Utan rank får annonsen medelvikt i stället för att tappas.
    const weight = watchRank(o, pageSize) ?? 0.5;
    total += weight;
    if (o.bids > 0) weighted += weight;
  }
  return total > 0 ? weighted / total : null;
}

/**
 * Heat 0–100 för en kategori vid en given insamling.
 *
 * Två delar:
 *   - rankviktad budkvot (efterfrågan, 75 %)
 *   - sökintresse        (Google Trends, 25 %)
 *
 * Saknas sökintresset viktas budkvoten upp till 100 % i stället, så en
 * kategori som Google strypte inte straffas för det.
 *
 * SKALAN: budkvoter på svensk secondhand ligger realistiskt mellan någon
 * enstaka procent och ~50 %. HEAT_CEILING sträcker ut det spannet över
 * 0–100 så att skillnaden mellan "porslin 1 %" och "parfym 21 %" faktiskt
 * syns i ett stapeldiagram. Talet är en presentationsskala, inte en mätning
 * -- rådata ligger kvar oförvanskad i bidRate på varje kort.
 */
export const HEAT_CEILING = 0.5;

export function heatScore({ observations = [], searchInterest = null, pageSize = 80 }) {
  return heatFromParts({
    weightedBidRate: weightedBidRate(observations, pageSize),
    searchInterest,
  });
}

/**
 * Samma uträkning som heatScore(), men utifrån de färdiga delarna i stället
 * för råa observationer.
 *
 * Finns för att appen ska kunna räkna om heat när du importerar en
 * Trends-CSV. Webbläsaren har bara kategorikorten, aldrig hela
 * observationsmängden -- utan den här skulle en importerad sökintressesiffra
 * bara byta en ruta på kortet utan att påverka heat-talet den är tänkt att
 * ingå i, vilket är precis den sortens tyst inkonsekvent siffra som gör att
 * man slutar lita på ett gränssnitt.
 */
export function heatFromParts({ weightedBidRate: rate, searchInterest }) {
  const parts = [];
  if (Number.isFinite(rate)) parts.push([Math.min(1, rate / HEAT_CEILING), 0.75]);
  if (Number.isFinite(searchInterest)) parts.push([searchInterest / 100, 0.25]);

  if (!parts.length) return null;
  const weightSum = parts.reduce((sum, [, w]) => sum + w, 0);
  const score = parts.reduce((sum, [v, w]) => sum + v * w, 0) / weightSum;
  return Math.round(score * 100);
}

/**
 * Förändring mot föregående insamling, i procentenheter för heat och i
 * procent för pris/utbud. `null` när det inte finns något att jämföra med --
 * gränssnittet ritar då ett streck i stället för en påhittad nolla.
 */
export function delta(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / previous;
}

/**
 * Momentum: heat-förändring viktad mot hur mycket underlag som fanns.
 *
 * En kategori som hoppar från 20 till 60 på fem annonser är brus. Samma hopp
 * på 200 annonser är en trend. confidence dämpar de tunna fallen i stället
 * för att filtrera bort dem helt, så små kategorier fortfarande syns -- bara
 * längre ned.
 */
export function momentum({ heatNow, heatBefore, sampleSize }) {
  if (!Number.isFinite(heatNow) || !Number.isFinite(heatBefore)) return null;
  const confidence = Math.min(1, (sampleSize || 0) / 60);
  return Math.round((heatNow - heatBefore) * confidence);
}

/**
 * Slår ihop observationer till ett kategorikort.
 *
 * @param {object} input
 * @param {string} input.categoryId
 * @param {Array}  input.observations  normaliserade observationer, aktuell körning
 * @param {object} [input.previous]    samma kort från föregående snapshot
 * @param {number} [input.searchInterest] Google Trends 0–100
 */
export function summarizeCategory({ categoryId, observations, previous = null, searchInterest = null }) {
  const prices = observations.map((o) => o.priceSek).filter((v) => Number.isFinite(v) && v > 0);
  const heat = heatScore({ observations, searchInterest });
  const priceMedian = median(prices);

  const bySource = {};
  for (const o of observations) {
    bySource[o.source] = bySource[o.source] || { source: o.source, supply: 0, withBids: 0 };
    bySource[o.source].supply += 1;
    if (o.bids > 0) bySource[o.source].withBids += 1;
  }

  return {
    categoryId,
    supply: observations.length,
    heat,
    // Rå budkvot ligger kvar orörd bredvid heat -- heat är utsträckt över
    // HEAT_CEILING för läsbarhetens skull, den här är den faktiska andelen.
    bidRate: bidRate(observations),
    weightedBidRate: weightedBidRate(observations),
    priceMedian,
    priceP10: percentile(prices, 0.1),
    priceP90: percentile(prices, 0.9),
    searchInterest,
    sources: Object.values(bySource).sort((a, b) => b.supply - a.supply),
    heatDelta: previous ? momentum({ heatNow: heat, heatBefore: previous.heat, sampleSize: observations.length }) : null,
    priceDelta: previous ? delta(priceMedian, previous.priceMedian) : null,
    supplyDelta: previous ? delta(observations.length, previous.supply) : null,
  };
}

export function percentile(values, p) {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  const idx = Math.min(xs.length - 1, Math.max(0, Math.round((xs.length - 1) * p)));
  return xs[idx];
}

/**
 * Toppresande varumärken/söktermer över alla kategorier -- "vad rör sig
 * just nu", oberoende av vilken hylla det står på.
 */
export function topMovers(cards, { limit = 8 } = {}) {
  return cards
    // heatDelta === 0 är inte en rörelse, det är frånvaron av en. Kör man
    // insamlaren två gånger på samma cachade data blir alla noll, och då
    // ska "Störst förändring" vara tom -- inte lista femton kategorier som
    // alla står stilla.
    .filter((c) => Number.isFinite(c.heatDelta) && c.heatDelta !== 0 && c.supply >= 10)
    .sort((a, b) => Math.abs(b.heatDelta) - Math.abs(a.heatDelta))
    .slice(0, limit);
}
