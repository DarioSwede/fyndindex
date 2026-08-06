// Den gemensamma formen. Varje källa lämnar ifrån sig råa fält och får
// tillbaka en Observation som ser likadan ut oavsett om den kom från
// Traderas HTML, Sellpys JSON eller en handnedladdad CSV.
//
// Node-fri, delas med webbläsaren (app.js använder parsePriceSek och
// titleFingerprint för korsannonseringskontrollen).

import { classify } from "./taxonomy.js";

/**
 * @typedef {object} Observation
 * @property {string}  source        källans id, t.ex. "tradera"
 * @property {string}  sourceItemId  källans eget id
 * @property {string}  url
 * @property {string}  title
 * @property {string|null} brand
 * @property {string|null} categoryId
 * @property {number|null} priceSek
 * @property {string}  currency      originalvalutan, innan omräkning
 * @property {number}  bids
 * @property {boolean} hasBidding    auktion (kan få bud) vs fast pris
 * @property {number|null} rank      position i ett bevakningssorterat resultat
 * @property {string|null} imageUrl
 * @property {string|null} sellerName
 * @property {string}  collectedAt   ISO
 */

// Grova växelkurser. Med flit hårdkodade i en POC: en felaktig kurs flyttar
// medianpriset några procent, medan ett API-anrop per körning är en till sak
// som kan gå sönder. Byt mot Riksbankens SWEA-API när det blir skarpt.
export const FX_TO_SEK = {
  SEK: 1, EUR: 11.3, USD: 9.7, GBP: 13.2, DKK: 1.52, NOK: 0.95, PLN: 2.65,
};

/** "1 823 kr" / "€24,50" / "$18.00" -> tal i den valuta som anges. */
export function parseAmount(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  // Non-breaking space och smalt mellanslag används av både Tradera och Vinted.
  const cleaned = String(raw).replace(/[  \s]/g, "");
  const match = cleaned.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const n = Number(match[0].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function detectCurrency(raw, fallback = "SEK") {
  const s = String(raw || "");
  if (/kr|SEK/i.test(s)) return "SEK";
  if (/€|EUR/i.test(s)) return "EUR";
  if (/\$|USD/i.test(s)) return "USD";
  if (/£|GBP/i.test(s)) return "GBP";
  return fallback;
}

export function toSek(amount, currency) {
  if (!Number.isFinite(amount)) return null;
  const rate = FX_TO_SEK[currency];
  if (!rate) return null;
  return Math.round(amount * rate);
}

/** "1 823 kr" -> 1823. Bekvämlighetsomslag för det vanligaste fallet. */
export function parsePriceSek(raw) {
  const amount = parseAmount(raw);
  return toSek(amount, detectCurrency(raw));
}

/**
 * Bygger en Observation och kör kategoriklassificeringen.
 * Returnerar null för det som ska hållas utanför indexet (fordon, båtar,
 * djur ...) så att anroparen kan filtrera med en enkel .filter(Boolean).
 */
export function makeObservation(raw, { source, collectedAt = new Date().toISOString() }) {
  const title = String(raw.title || "").trim();
  if (!title) return null;

  const { categoryId, brand, excluded } = classify(title, raw.categoryHint || null);
  if (excluded) return null;

  const currency = raw.currency || detectCurrency(raw.priceRaw);
  const amount = parseAmount(raw.priceRaw ?? raw.price);

  return {
    source,
    sourceItemId: String(raw.id ?? raw.sourceItemId ?? ""),
    url: raw.url || null,
    title,
    brand: raw.brand || brand,
    categoryId,
    priceSek: toSek(amount, currency),
    priceOriginal: amount,
    currency,
    bids: Number.isFinite(raw.bids) ? raw.bids : 0,
    hasBidding: Boolean(raw.hasBidding),
    rank: Number.isFinite(raw.rank) ? raw.rank : null,
    imageUrl: raw.imageUrl || null,
    sellerName: raw.sellerName || null,
    endsAt: raw.endsAt || null,
    collectedAt,
  };
}

// ---- Titelmatchning för korsannonseringskontrollen -----------------------
// Används för att svara på "ligger min Orrefors-vas ute någon annanstans
// också?". Målet är att tåla att samma sak beskrivs olika på två sajter,
// inte att vara exakt.

const STOPWORDS = new Set([
  "och", "med", "för", "till", "från", "den", "det", "ett", "en", "av", "på",
  "i", "st", "cm", "mm", "ny", "nytt", "fint", "fin", "vintage", "retro",
  "sällsynt", "unik", "snygg", "the", "and", "for", "with", "new",
]);

/** Normaliserad ordmängd -- grunden för likhetsjämförelsen. */
export function titleFingerprint(title = "") {
  return new Set(
    String(title)
      .toLowerCase()
      .replace(/[^a-z0-9åäöéèü]+/gi, " ")
      .split(" ")
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/** Jaccard-likhet 0–1 mellan två titlar. */
export function titleSimilarity(a, b) {
  const setA = a instanceof Set ? a : titleFingerprint(a);
  const setB = b instanceof Set ? b : titleFingerprint(b);
  if (!setA.size || !setB.size) return 0;
  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared += 1;
  return shared / (setA.size + setB.size - shared);
}
