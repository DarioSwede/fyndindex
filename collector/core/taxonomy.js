// Kategorier, uteslutningar och varumärkeslistor.
//
// Den här filen laddas BÅDE av Node-collectorn och direkt av webbläsaren
// (app.js importerar den), så den får inte innehålla något Node-specifikt --
// ingen `require`, inga `node:`-imports, inget `process`. Samma trick som
// packlista/transfer.js använder för att dela kod mellan appen och testerna.

// ---- Uteslutna kategorier -------------------------------------------------
// Stora/tunga saker som inte lämpar sig för Tradera/Sellpy/Vinted-flödet.
// De filtreras bort på två ställen: källadaptrarna hoppar över hela
// kategorigrenar där det går, och classify() nedan slänger allt som matchar
// EXCLUDE_PATTERNS oavsett vilken källa det kom från (bältet OCH hängslena,
// eftersom flera källor saknar användbar kategoriinformation).
export const EXCLUDED_TOPICS = [
  "Fordon", "Båtar", "Husvagn & husbil", "Bostad & tomt",
  "Djur", "Entreprenadmaskiner", "Jordbruk",
];

const EXCLUDE_PATTERNS = [
  // Bilmodeller: egen regel utan avslutande \b. "Volvo V70 D5" slutar inte
  // på en ordgräns efter siffran som \b vill ha (nästa tecken är "0"), så
  // en modellbeteckning måste få matcha mitt i ett tal.
  /\b(volvo\s*(v|xc|s)\d|saab\s*9-?\d|audi\s*a\d|bmw\s*\d{3}|vw\s*(golf|passat))/i,
  // fordon i övrigt
  /\b(bil|bilar|personbil|husbil|husvagn|släpvagn|slapvagn|lastbil|traktor|grävmaskin|gravmaskin|skogsmaskin|truck)\b/i,
  /\b(mc|motorcykel|moped|snöskoter|snoskoter|fyrhjuling|atv|vespa)\b/i,
  // båt
  /\b(båt|bat|segelbåt|segelbat|motorbåt|motorbat|roddbåt|roddbat|utombordare|jolle|kajakvagn)\b/i,
  // bostad
  /\b(lägenhet|lagenhet|villa|fritidshus|tomt|kolonilott|garageplats|förråd uthyres|attefallshus)\b/i,
  // Djur. Svensk pluralböjning gör \b opålitligt -- "valpar" slutar inte där
  // "valp" gör. Suffixgruppen täcker -ar/-er/-or/-ungar plus bestämd form.
  /\b(hund|valp|katt|kattunge|häst|hast|ponny|kanin|marsvin|papegoja)(ar|er|or|ungar|en|arna|erna)?\b/i,
  // stort vitvaror/möbeltungt som sällan fraktas
  /\b(kyl\s*&?\s*frys|kylskåp|kylskap|frysbox|tvättmaskin|tvattmaskin|torktumlare|diskmaskin|spis|köksö|kokso)\b/i,
  /\b(piano|flygel|biljardbord|jacuzzi|badtunna|pool)\b/i,
];

/** Sant om titeln beskriver något vi medvetet håller utanför indexet. */
export function isExcluded(title = "") {
  return EXCLUDE_PATTERNS.some((re) => re.test(title));
}

// ---- Kategorier -----------------------------------------------------------
// Ordningen är den ordning de visas i. `weight` är en redaktionell vikt som
// bara används för att sortera startvyn innan första insamlingen -- så fort
// det finns riktig data sorteras allt på uppmätt heat i stället.
//
// De fyra första är de du bad om explicit (glas, porslin, antik & design).
// Resten är härledda ur Traderas egen rapport "De 25 mest efterfrågade
// varumärkena" (mätperiod 2024-03-01–2025-02-28) -- se data/seed/.
export const CATEGORIES = [
  {
    id: "glas",
    name: "Glas & kristall",
    icon: "🍸",
    color: "#7fd4e8",
    weight: 100,
    queries: ["orrefors", "kosta boda", "iittala", "reijmyre", "pukeberg", "kristallglas", "vas glas"],
    brands: ["Orrefors", "Kosta Boda", "Iittala", "Reijmyre", "Pukeberg", "Skruf", "Holmegaard", "Nuutajärvi"],
  },
  {
    id: "porslin",
    name: "Porslin & keramik",
    icon: "🫖",
    color: "#f0b8c8",
    weight: 98,
    queries: ["rörstrand", "gustavsberg", "arabia", "höganäs keramik", "stig lindberg", "servis porslin"],
    brands: ["Rörstrand", "Gustavsberg", "Arabia", "Höganäs", "Upsala-Ekeby", "Royal Copenhagen", "Stig Lindberg", "Berndt Friberg"],
  },
  {
    id: "antik-design",
    name: "Antikt & design",
    icon: "🪑",
    color: "#d9b382",
    weight: 96,
    queries: ["svenskt tenn", "josef frank", "bruno mathsson", "dansk teak", "vintage lampa", "antik spegel"],
    brands: ["Svenskt Tenn", "Josef Frank", "Bruno Mathsson", "Källemo", "Artek", "Louis Poulsen", "Le Klint", "String"],
  },
  {
    id: "friluft",
    name: "Friluft & outdoor",
    icon: "🏔️",
    color: "#9ae691",
    weight: 94,
    // Traderas rapport: Fjällräven är etta totalt, hela outdoor-segmentet
    // ligger högt både på sökningar och genomförsäljningsgrad.
    queries: ["fjällräven", "peak performance", "haglöfs", "patagonia", "houdini", "klättermusen"],
    brands: ["Fjällräven", "Peak Performance", "Patagonia", "Haglöfs", "Houdini", "Klättermusen", "Astrid Wild", "Woolpower", "Didriksons"],
  },
  {
    id: "damklader",
    name: "Damkläder",
    icon: "👗",
    color: "#cf9aec",
    weight: 92,
    queries: ["arket", "totême", "rodebjer", "adoore", "gudrun sjödén", "acne studios"],
    brands: ["ARKET", "Totême", "Rodebjer", "ADOORE", "Gudrun Sjödén", "Acne Studios", "Odd Molly", "Ilouity", "By Malene Birger"],
  },
  {
    id: "herrklader",
    name: "Herrkläder",
    icon: "🧥",
    color: "#8fb6f2",
    weight: 90,
    queries: ["our legacy", "carhartt", "stone island", "barbour", "ralph lauren", "gramicci"],
    brands: ["Our Legacy", "Carhartt", "Stone Island", "Barbour", "Ralph Lauren", "Gramicci", "Levi's", "Gant", "Filippa K"],
  },
  {
    id: "barnklader",
    name: "Barnkläder & barnskor",
    icon: "🧸",
    color: "#f7c96b",
    weight: 88,
    queries: ["polarn o pyret", "mini rodini", "kuling", "didriksons barn", "reima"],
    brands: ["Polarn O. Pyret", "Mini Rodini", "Kuling", "Didriksons", "Lindex", "Reima", "Ticket to Heaven"],
  },
  {
    id: "vaskor",
    name: "Väskor & accessoarer",
    icon: "👜",
    color: "#e0a06b",
    weight: 86,
    queries: ["väska vintage", "handväska läder", "sandqvist", "longchamp", "mulberry"],
    brands: ["Sandqvist", "Longchamp", "Mulberry", "Coach", "Marimekko", "Fjällräven Kånken"],
  },
  {
    id: "skor",
    name: "Skor",
    icon: "👟",
    color: "#a8d4c8",
    weight: 84,
    queries: ["birkenstock", "dr martens", "sneakers vintage", "vagabond", "salomon"],
    brands: ["Birkenstock", "Dr. Martens", "Vagabond", "Salomon", "New Balance", "Nike", "Adidas"],
  },
  {
    id: "smycken",
    name: "Smycken & klockor",
    icon: "💍",
    color: "#f5d778",
    weight: 82,
    queries: ["silverarmband", "guldring", "efva attling", "vintage klocka", "seiko"],
    brands: ["Efva Attling", "Georg Jensen", "Seiko", "Omega", "Kalevala", "Pandora"],
  },
  {
    id: "parfym",
    name: "Parfym & skönhet",
    icon: "🧴",
    color: "#f2a0b0",
    weight: 80,
    // Ny kategori i Traderas 2025-rapport -- värd att följa just för att den
    // är ny och rör sig snabbt.
    queries: ["byredo", "chanel parfym", "tom ford parfym", "dior parfym", "ysl parfym"],
    brands: ["Byredo", "Chanel", "Dior", "Tom Ford", "YSL", "Le Labo", "Maison Margiela"],
  },
  {
    id: "hem",
    name: "Hem & inredning",
    icon: "🕯️",
    color: "#b8d99a",
    weight: 78,
    queries: ["marimekko tyg", "vintage matta", "mässing ljusstake", "linnedukar", "vägglampa vintage"],
    brands: ["Marimekko", "Almedahls", "Ikea vintage", "Höganäs", "Skultuna"],
  },
  {
    id: "elektronik-foto",
    name: "Elektronik & foto",
    icon: "📷",
    color: "#77c9ff",
    weight: 74,
    queries: ["hasselblad", "vintage kamera", "vinylspelare", "hifi förstärkare", "canon objektiv"],
    brands: ["Hasselblad", "Canon", "Nikon", "Leica", "Technics", "Marantz", "Sonab"],
  },
  {
    id: "samlarobjekt",
    name: "Leksaker & samlarobjekt",
    icon: "🎲",
    color: "#ef8f8f",
    weight: 72,
    queries: ["lego vintage", "vinyl lp", "brio tåg", "serier samlarobjekt", "frimärken"],
    brands: ["LEGO", "BRIO", "Playmobil", "Steiff", "Märklin"],
  },
  {
    id: "bocker-film-spel",
    name: "Böcker, film & spel",
    icon: "📚",
    color: "#c9b8f0",
    weight: 70,
    queries: ["förstautgåva bok", "vinyl skivor", "nintendo spel", "vhs kult", "seriealbum"],
    brands: ["Nintendo", "Sega", "Criterion", "Bonniers"],
  },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

// ---- Klassificering -------------------------------------------------------
// Nyckelordsmatchning byggd en gång vid modulladdning. Enkelt med flit: en
// POC ska vara läsbar, och en titel som "Orrefors vas Nils Landberg" blir
// rätt klassad av ett varumärkesord långt oftare än av något smartare.

const RULES = CATEGORIES.map((c) => ({
  id: c.id,
  // Varumärken väger tyngre än fritextfrågorna -- "chanel" ska bli parfym,
  // inte damkläder, när båda kan matcha.
  strong: c.brands.map(normalizeToken),
  weak: c.queries.map(normalizeToken),
}));

function normalizeToken(s) {
  return s.toLowerCase().replace(/[^a-z0-9åäöéü ]+/gi, " ").replace(/\s+/g, " ").trim();
}

/**
 * Klassificerar en annonstitel till en kategori.
 * @returns {{categoryId: string|null, brand: string|null, excluded: boolean}}
 */
export function classify(title = "", hintCategoryId = null) {
  if (isExcluded(title)) return { categoryId: null, brand: null, excluded: true };

  const hay = " " + normalizeToken(title) + " ";
  let best = null;
  let bestScore = 0;
  let brand = null;

  for (const rule of RULES) {
    let score = 0;
    for (const token of rule.strong) {
      if (token && hay.includes(" " + token + " ")) {
        score += 10;
        if (!brand) brand = token;
      } else if (token && hay.includes(token)) {
        score += 6;
        if (!brand) brand = token;
      }
    }
    for (const token of rule.weak) if (token && hay.includes(token)) score += 2;
    if (score > bestScore) { bestScore = score; best = rule.id; }
  }

  // Hinten från källan (t.ex. Traderas kategori-id) används bara när
  // titeln inte gav något -- källornas egna kategorier är för grova för
  // att lita på när vi faktiskt känner igen ett varumärke.
  if (!best && hintCategoryId && CATEGORY_BY_ID[hintCategoryId]) best = hintCategoryId;

  return { categoryId: best, brand: brand || null, excluded: false };
}

/** Kategorier i redaktionell ordning, för tomma vyer före första körningen. */
export function defaultCategoryOrder() {
  return [...CATEGORIES].sort((a, b) => b.weight - a.weight).map((c) => c.id);
}
