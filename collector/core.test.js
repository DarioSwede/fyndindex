// Tester för den delade kärnan. Körs med Nodes inbyggda testkörare:
//
//     node --test collector/
//
// Inga beroenden, inget testramverk. Samma hållning som packlistans
// transfer.test.html: testerna ska gå att köra utan att installera något.

import { test } from "node:test";
import assert from "node:assert/strict";

import { classify, isExcluded, CATEGORIES } from "./core/taxonomy.js";
import { parseAmount, parsePriceSek, toSek, titleSimilarity, makeObservation } from "./core/normalize.js";
import { bidRate, weightedBidRate, median, heatScore, momentum, summarizeCategory } from "./core/metrics.js";
import { parseTrendsCsv, csvToSignal } from "./signals/trends-csv.js";
import { parseSearchHtml } from "./sources/tradera.js";

// ---- uteslutningar --------------------------------------------------------

test("stora saker utesluts oavsett källa", () => {
  for (const title of [
    "Volvo V70 D5 2008 besiktigad",
    "Segelbåt Maxi 77 med motor",
    "Husvagn Kabe Royal 2015",
    "Labrador valpar till salu",
    "Kyl & frys Electrolux 180 cm",
    "Piano Yamaha U1 svart",
  ]) {
    assert.equal(isExcluded(title), true, `borde uteslutas: ${title}`);
  }
});

test("vanliga secondhandprylar utesluts inte", () => {
  for (const title of [
    "Orrefors vas Nils Landberg 1950-tal",
    "Fjällräven Kånken ryggsäck",
    "Rörstrand Mon Amie serveringsfat",
    "Bildekal retro Volvo Amazon", // "bil" som del av ord ska inte träffa
  ]) {
    assert.equal(isExcluded(title), false, `borde INTE uteslutas: ${title}`);
  }
});

// ---- klassificering -------------------------------------------------------

test("varumärke i titeln avgör kategori", () => {
  assert.equal(classify("Orrefors kristallvas signerad").categoryId, "glas");
  assert.equal(classify("Rörstrand Mon Amie tallrik").categoryId, "porslin");
  assert.equal(classify("Fjällräven Abisko byxor herr").categoryId, "friluft");
  assert.equal(classify("Byredo Gypsy Water 100ml").categoryId, "parfym");
});

test("hint används bara när titeln inte räcker", () => {
  // Titeln avslöjar inget -- hinten från sökningen får styra.
  assert.equal(classify("Vas signerad NL 1957", "glas").categoryId, "glas");
  // Titeln avslöjar något -- då vinner den över hinten.
  assert.equal(classify("Fjällräven Kånken", "glas").categoryId, "friluft");
});

test("auktionshussvenska klassas utan varumärke", () => {
  // Regressionstest för Bukowskis: auktionshus beskriver saker med
  // föremålsord, aldrig med varumärke. Innan de generiska orden lades till
  // klassades 3 lotter av 100; nu 48.
  assert.equal(classify("taklampa 1950 60 tal").categoryId, "antik-design");
  assert.equal(classify("matbord sydeuropa 1900 talets senare del").categoryId, "antik-design");
  assert.equal(classify("brosch silver 1800 tal").categoryId, "smycken");
  assert.equal(classify("karaff med propp").categoryId, "glas");
});

test("varumärke slår generiskt föremålsord", () => {
  // De generiska orden väger 2, varumärken 10 -- annars hade "Iittala
  // tallrik" hamnat i porslin i stället för glas.
  assert.equal(classify("Iittala tallrik").categoryId, "glas");
  assert.equal(classify("Gustavsberg skål").categoryId, "porslin");
});

test("uteslutet slår igenom även med hint", () => {
  const result = classify("Volvo V70 kombi", "glas");
  assert.equal(result.excluded, true);
  assert.equal(result.categoryId, null);
});

// ---- priser ---------------------------------------------------------------

test("svenska prisformat tolkas", () => {
  assert.equal(parseAmount("1 823 kr"), 1823);          // vanligt mellanslag
  assert.equal(parseAmount("1 823 kr"), 1823); // non-breaking space
  assert.equal(parseAmount("1 450 kr"), 1450);      // smalt mellanslag
  assert.equal(parsePriceSek("850 kr"), 850);
  assert.equal(parsePriceSek(null), null);
});

test("valutaomräkning", () => {
  assert.equal(toSek(10, "EUR"), 113);
  assert.equal(toSek(10, "SEK"), 10);
  assert.equal(toSek(10, "XYZ"), null);
});

// ---- observationer --------------------------------------------------------

test("makeObservation returnerar null för uteslutet", () => {
  assert.equal(makeObservation({ title: "Husbil Fiat Ducato" }, { source: "t" }), null);
  assert.equal(makeObservation({ title: "" }, { source: "t" }), null);
});

test("makeObservation normaliserar hela vägen", () => {
  const o = makeObservation(
    { id: 42, title: "Kosta Boda skål Ulrica Hydman", priceRaw: "1 200 kr", bids: 3, hasBidding: true, rank: 7 },
    { source: "tradera", collectedAt: "2026-08-06T10:00:00Z" },
  );
  assert.equal(o.categoryId, "glas");
  assert.equal(o.priceSek, 1200);
  assert.equal(o.currency, "SEK");
  assert.equal(o.bids, 3);
  assert.equal(o.rank, 7);
  assert.equal(o.sourceItemId, "42");
});

// ---- mått -----------------------------------------------------------------

test("median klarar jämnt och udda antal", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test("budkvot räknar bara auktioner", () => {
  const obs = [
    { hasBidding: true, bids: 2 },
    { hasBidding: true, bids: 0 },
    { hasBidding: false, bids: 0 }, // fastpris -- ska inte räknas alls
  ];
  assert.equal(bidRate(obs), 0.5);
  assert.equal(bidRate([{ hasBidding: false, bids: 0 }]), null);
});

test("heat viktar om när sökintresse saknas", () => {
  const obs = [{ hasBidding: true, bids: 1, rank: 0 }, { hasBidding: true, bids: 1, rank: 1 }];
  const utan = heatScore({ observations: obs });
  const med = heatScore({ observations: obs, searchInterest: 100 });
  // Utan trendsignal ska heat fortfarande vara högt -- kategorin får inte
  // straffas för att Google strypte oss.
  assert.ok(utan > 90, `förväntade högt heat utan trends, fick ${utan}`);
  assert.ok(med >= utan);
});

test("heat skiljer kategorier åt i det realistiska spannet", () => {
  // Regressionstest för buggen där allt landade på 20–32 och färgskalan
  // aldrig slog om: en kategori med 20 % budkvot och en med 2 % måste
  // hamna tydligt isär, inte tolv poäng ifrån varandra.
  const build = (andelMedBud) => Array.from({ length: 100 }, (_, i) => ({
    hasBidding: true, bids: i < andelMedBud * 100 ? 1 : 0, rank: i,
  }));
  const kall = heatScore({ observations: build(0.02) });
  const het = heatScore({ observations: build(0.20) });
  assert.ok(het - kall > 25, `förväntade tydlig spridning, fick ${kall} vs ${het}`);
});

test("rankviktad budkvot väger topplaceringar tyngre", () => {
  const topBud = [{ hasBidding: true, bids: 1, rank: 0 }, { hasBidding: true, bids: 0, rank: 79 }];
  const bottenBud = [{ hasBidding: true, bids: 0, rank: 0 }, { hasBidding: true, bids: 1, rank: 79 }];
  // Samma råa budkvot (50 %), men bud på den mest bevakade säger mer.
  assert.equal(bidRate(topBud), bidRate(bottenBud));
  assert.ok(weightedBidRate(topBud) > weightedBidRate(bottenBud));
});

test("momentum dämpas av tunt underlag", () => {
  const tunt = momentum({ heatNow: 60, heatBefore: 20, sampleSize: 5 });
  const tjockt = momentum({ heatNow: 60, heatBefore: 20, sampleSize: 200 });
  assert.ok(tunt < tjockt, "fem annonser ska väga lättare än tvåhundra");
  assert.equal(tjockt, 40);
});

test("summarizeCategory ger streck i stället för nollor utan föregående", () => {
  const card = summarizeCategory({
    categoryId: "glas",
    observations: [makeObservation({ title: "Orrefors vas", priceRaw: "500 kr", hasBidding: true, bids: 1 }, { source: "tradera" })],
  });
  assert.equal(card.heatDelta, null);
  assert.equal(card.priceDelta, null);
  assert.equal(card.supply, 1);
});

// ---- titelmatchning -------------------------------------------------------

test("samma pryl olika beskriven matchar", () => {
  const score = titleSimilarity(
    "Orrefors vas Nils Landberg",
    "Nils Landberg vas Orrefors 1950-tal",
  );
  assert.ok(score >= 0.45, `förväntade träff, fick ${score}`);
});

test("olika prylar matchar inte", () => {
  const score = titleSimilarity("Orrefors vas Nils Landberg", "Fjällräven Kånken ryggsäck blå");
  assert.ok(score < 0.2, `förväntade ingen träff, fick ${score}`);
});

// ---- Google Trends CSV ----------------------------------------------------

test("intresse över tid tolkas", () => {
  const csv = [
    "Kategori: Alla kategorier",
    "Vecka,porslin: (Sverige)",
    "2026-07-05,42",
    "2026-07-12,55",
    "2026-07-19,<1",
    "2026-07-26,61",
    "2026-08-02,70",
  ].join("\n");
  const parsed = parseTrendsCsv(csv);
  assert.equal(parsed.kind, "interest-over-time");
  assert.equal(parsed.rows.length, 5);
  assert.equal(parsed.rows[2].v, 0, "'<1' ska bli 0");
  // Sista punkten hoppas över (halvfärdig vecka) -- snitt av 42,55,0,61.
  assert.equal(csvToSignal(parsed).interest, 40);
});

test("stigande sökningar och breakout tolkas", () => {
  const csv = ["STIGANDE,", "orrefors vas,Kraftig ökning", "kosta boda skål,+250%"].join("\n");
  const parsed = parseTrendsCsv(csv);
  assert.equal(parsed.kind, "rising-queries");
  assert.equal(parsed.rows[0].breakout, true);
  assert.equal(parsed.rows[1].v, 250);
});

test("skräpfil ger begripligt fel", () => {
  assert.throws(() => parseTrendsCsv("bara en rad utan struktur"), /rubrikrad/);
  assert.throws(() => parseTrendsCsv(""), /tom/i);
});

// ---- Tradera-parsern ------------------------------------------------------

test("Tradera-kort tolkas ur HTML", () => {
  const html = `
    <div id="item-card-999" data-item-loaded="false" data-item-type="Auction" class="itemCard">
      <a data-testid="item-card-image" title="Kort" href="/item/1/999/orrefors-vas"></a>
      <picture><source srcSet="https://img.tradera.net/250-square/a.jpg 1x"/></picture>
      <button aria-label="Lägg till Varumärke: Orrefors i sökningen.">Orrefors</button>
      <a href="/item/1/999/orrefors-vas">Orrefors vas signerad</a>
      <span id="item-card-999-time"><span class="sr-only">Sluttid</span><span aria-hidden="false">9 aug 19:40</span></span>
      <span data-testid="price">1 450 kr</span><span data-testid="bids-label">Ledande bud</span>
    </div>`;
  const [card] = parseSearchHtml(html);
  assert.equal(card.id, "999");
  assert.equal(card.title, "Orrefors vas signerad");
  assert.equal(card.brand, "Orrefors");
  assert.equal(card.bids, 1, "'Ledande bud' betyder minst ett bud");
  assert.equal(card.hasBidding, true);
  assert.equal(card.priceRaw, "1 450 kr");
  assert.equal(card.url, "https://www.tradera.com/item/1/999/orrefors-vas");
});

test("varje kategori har det som klassificeraren behöver", () => {
  for (const c of CATEGORIES) {
    assert.ok(c.queries.length > 0, `${c.id} saknar queries`);
    assert.ok(c.brands.length > 0, `${c.id} saknar brands`);
    assert.ok(c.icon && c.name && c.color, `${c.id} saknar presentationsfält`);
  }
});
