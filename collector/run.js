#!/usr/bin/env node
// Insamlaren.
//
//   node collector/run.js                       full körning, svenska källor
//   node collector/run.js --sources=tradera      bara en källa
//   node collector/run.js --markets=SE,US        ta med utländska
//   node collector/run.js --no-trends            hoppa över Google Trends
//   node collector/run.js --pages=2              fler sidor per sökning
//   node collector/run.js --check-robots         läs om robots.txt, hämta inget
//   node collector/run.js --seller=3532689/myrorna   dina egna annonser
//
// Skriver data/snapshot-latest.json och arkiverar föregående i
// data/history/. Webbappen läser exakt de filerna -- ingen databas behövs
// för att köra POC:en lokalt. Supabase kopplas på först när du vill ha
// inloggning och delad historik (se supabase/migrations/).

import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

import { CATEGORIES } from "./core/taxonomy.js";
import { summarizeCategory, topMovers } from "./core/metrics.js";
import { activeSources, SOURCE_BY_ID, sourceManifest } from "./sources/index.js";
import * as trends from "./signals/google-trends.js";
import { fetchText } from "./core/fetch.js";

const DATA = path.resolve("data");
const LATEST = path.join(DATA, "snapshot-latest.json");
const HISTORY = path.join(DATA, "history");

const args = parseArgs(process.argv.slice(2));

if (args["check-robots"]) {
  await checkRobots();
} else if (args.seller) {
  await collectOwnItems(args.seller);
} else {
  await run();
}

// ---------------------------------------------------------------------------

async function run() {
  const markets = (args.markets || "SE").split(",").map((s) => s.trim().toUpperCase());
  const only = args.sources ? args.sources.split(",").map((s) => s.trim()) : null;
  const pages = Number(args.pages || 1);

  const sources = activeSources({ markets })
    .filter((s) => !only || only.includes(s.id));

  if (!sources.length) {
    console.error("Inga aktiva källor matchade. Kör --check-robots för att se läget.");
    process.exit(1);
  }

  console.log(`Marknader: ${markets.join(", ")}`);
  console.log(`Källor: ${sources.map((s) => s.id).join(", ")}\n`);

  const previous = await readJson(LATEST);
  const observations = [];
  const sourceLog = [];

  for (const source of sources) {
    const started = Date.now();
    let collected = 0;
    let failed = 0;

    // Källor som söker per term (tradera, poshmark) får kategorins frågor.
    // Källor som läser en hel katalog (myrorna, sellpy, bukowskis,
    // auktionsverket) anropas en gång med alla nyckelord.
    if (source.collect.length && wantsPerQuery(source)) {
      for (const category of CATEGORIES) {
        for (const query of category.queries.slice(0, args.deep ? 6 : 2)) {
          try {
            // Kategorin skickas med: sökte vi på "orrefors" är träffarna
            // glas även när titeln bara säger "Vas signerad NL 1957".
            const found = await source.collect({ query, pages, categoryHint: category.id });
            observations.push(...found);
            collected += found.length;
            process.stdout.write(`  ${source.id} · ${query} → ${found.length}\n`);
          } catch (error) {
            failed += 1;
            process.stdout.write(`  ${source.id} · ${query} → FEL: ${error.message}\n`);
          }
        }
      }
    } else {
      const keywords = CATEGORIES.flatMap((c) => c.brands.concat(c.queries));
      try {
        const found = await source.collect({ keywords, pages });
        observations.push(...found);
        collected += found.length;
        process.stdout.write(`  ${source.id} → ${found.length}\n`);
      } catch (error) {
        failed += 1;
        process.stdout.write(`  ${source.id} → FEL: ${error.message}\n`);
      }
    }

    sourceLog.push({
      id: source.id, label: source.label, market: source.market,
      collected, failed, ms: Date.now() - started,
    });
  }

  // Samma annons kan komma tillbaka från flera sökord. Räknas den två
  // gånger blir utbudet uppblåst och budkvoten fel -- av med den här.
  const unique = dedupe(observations);
  console.log(`\n${observations.length} observationer, ${unique.length} unika efter dubblettrensning.`);

  let searchSignals = {};
  if (!args["no-trends"]) {
    console.log("\nHämtar sökintresse från Google Trends (långsamt med flit)…");
    try {
      searchSignals = await trends.collect({ geo: args.geo || "SE" });
      const ok = Object.values(searchSignals).filter((s) => Number.isFinite(s.interest)).length;
      console.log(`  ${ok}/${CATEGORIES.length} kategorier fick en sökintressesiffra.`);
      if (ok === 0) {
        console.log("  Alla ströps (429). Ladda ner CSV från trends.google.com och importera i appen i stället.");
      }
    } catch (error) {
      console.log(`  Google Trends misslyckades helt: ${error.message}`);
    }
  }

  const cards = CATEGORIES.map((category) => {
    const forCategory = unique.filter((o) => o.categoryId === category.id);
    const prev = previous?.categories?.find((c) => c.categoryId === category.id) || null;
    return summarizeCategory({
      categoryId: category.id,
      observations: forCategory,
      previous: prev,
      searchInterest: searchSignals[category.id]?.interest ?? null,
    });
  });

  const snapshot = {
    version: 1,
    collectedAt: new Date().toISOString(),
    markets,
    categories: cards,
    movers: topMovers(cards),
    sources: sourceManifest(),
    sourceRuns: sourceLog,
    searchSignals,
    // Ett urval av de faktiska annonserna så gränssnittet kan visa exempel
    // under varje kategori. Hela mängden vore onödigt tung att skicka.
    samples: sampleByCategory(unique, 12),
    counts: { observations: unique.length, categories: cards.filter((c) => c.supply > 0).length },
  };

  await mkdir(HISTORY, { recursive: true });
  if (previous) {
    await writeFile(
      path.join(HISTORY, `${previous.collectedAt.slice(0, 19).replace(/[:]/g, "")}.json`),
      JSON.stringify(previous),
      "utf8",
    );
  }
  await writeFile(LATEST, JSON.stringify(snapshot, null, 1), "utf8");

  console.log(`\nSkrev ${path.relative(process.cwd(), LATEST)}`);
  printTable(cards);
}

function wantsPerQuery(source) {
  return ["tradera", "poshmark", "plick"].includes(source.id);
}

function dedupe(observations) {
  const seen = new Map();
  for (const o of observations) {
    const key = `${o.source}:${o.sourceItemId || o.url || o.title}`;
    // Behåll den bästa (lägsta) rankningen -- om samma annons dök upp högt
    // på ett sökord och lågt på ett annat är den höga den sanna signalen.
    const existing = seen.get(key);
    if (!existing || (o.rank ?? 1e9) < (existing.rank ?? 1e9)) seen.set(key, o);
  }
  return [...seen.values()];
}

function sampleByCategory(observations, perCategory) {
  const out = {};
  for (const category of CATEGORIES) {
    out[category.id] = observations
      .filter((o) => o.categoryId === category.id)
      .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))
      .slice(0, perCategory)
      .map((o) => ({
        title: o.title, url: o.url, priceSek: o.priceSek, bids: o.bids,
        source: o.source, imageUrl: o.imageUrl, brand: o.brand,
      }));
  }
  return out;
}

function printTable(cards) {
  const rows = [...cards].filter((c) => c.supply > 0).sort((a, b) => (b.heat ?? -1) - (a.heat ?? -1));
  const head = ["kategori", "utbud", "heat", "budkvot", "median", "Δheat"];
  const widths = [18, 6, 5, 8, 10, 7];
  const line = (cells) => "  " + cells
    .map((cell, i) => (i === 0 ? String(cell).padEnd(widths[i]) : String(cell).padStart(widths[i])))
    .join("  ");

  console.log("\n" + line(head));
  console.log("  " + "-".repeat(widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * 2));
  for (const c of rows) {
    console.log(line([
      c.categoryId,
      c.supply,
      c.heat ?? "–",
      c.bidRate === null ? "–" : `${Math.round(c.bidRate * 100)} %`,
      // Medianen av ett jämnt antal blir x,5 -- avrundas för utskrift, men
      // ligger kvar oavrundad i snapshoten så jämförelser blir exakta.
      c.priceMedian ? `${Math.round(c.priceMedian)} kr` : "–",
      c.heatDelta === null ? "–" : (c.heatDelta > 0 ? `+${c.heatDelta}` : c.heatDelta),
    ]));
  }
}

// ---------------------------------------------------------------------------

/** Dina egna Tradera-annonser, för korsannonseringskontrollen. */
async function collectOwnItems(spec) {
  const [sellerId, alias] = spec.split("/");
  if (!sellerId || !alias) {
    console.error('Ange --seller=SÄLJARID/alias, t.ex. --seller=3532689/myrorna');
    process.exit(1);
  }
  const { collectSeller } = SOURCE_BY_ID.tradera;
  const items = await collectSeller({ sellerId, alias, pages: 3 });
  const file = path.join(DATA, "my-items.json");
  await mkdir(DATA, { recursive: true });
  await writeFile(file, JSON.stringify({
    sellerId, alias, collectedAt: new Date().toISOString(), items,
  }, null, 1), "utf8");
  console.log(`${items.length} egna annonser sparade i ${path.relative(process.cwd(), file)}`);
  console.log("Öppna appen och gå till Mina annonser för att se var samma saker ligger ute.");
}

/** Läser om robots.txt för alla källor och rapporterar. Hämtar inget annat. */
async function checkRobots() {
  console.log("Kontrollerar robots.txt för samtliga källor.\n");
  for (const source of sourceManifest()) {
    const home = source.url || `https://${source.id}.se/`;
    let verdict = "?";
    try {
      const txt = await fetchText(new URL("/robots.txt", home).href, { maxAgeMs: 0, retries: 1 });
      const prohibits = /prohibited|not allowed|inte tillåtet|written permission/i.test(txt);
      verdict = prohibits ? "FÖRBJUDER uttryckligen" : "inget uttryckligt förbud";
    } catch (error) {
      verdict = `kunde inte läsas (${error.message})`;
    }
    console.log(`  ${source.label.padEnd(24)} ${source.status.padEnd(8)} ${verdict}`);
  }
  console.log("\nStatus i registret ändras inte automatiskt -- läs utfallet och");
  console.log("uppdatera collector/sources/*.js för hand om något förändrats.");
}

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}
