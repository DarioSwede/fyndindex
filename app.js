// Fyndindex -- frontend.
//
// Läser data/snapshot-latest.json som insamlaren skriver. Ingen backend krävs
// för att titta; Supabase används bara till inloggning och till att spara
// dina egna annonser för korsannonseringskontrollen.
//
// Kategori- och måttlogiken importeras rakt av från collectorn -- samma
// filer, ingen kopia. Därför är core/taxonomy.js och core/metrics.js skrivna
// Node-fritt. Ändrar du en kategori ändras den på båda ställena samtidigt.

import { CATEGORIES, CATEGORY_BY_ID } from "./collector/core/taxonomy.js?v=1";
import { titleFingerprint, titleSimilarity } from "./collector/core/normalize.js?v=1";
import { heatFromParts } from "./collector/core/metrics.js?v=1";
import { parseTrendsCsv, csvToSignal } from "./collector/signals/trends-csv.js?v=1";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const cfg = window.FYNDINDEX_CONFIG || {};
// Supabase är valfritt. Utan nycklar körs appen i ren läsvy -- allt utom
// inloggning och Mina annonser fungerar precis som vanligt.
const supabase = cfg.SUPABASE_URL && window.supabase
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: {
        // Fyndindex, Packlista och Tor-dash delar Supabase-projekt och kan
        // dela origin. Egen storageKey så att de inte loggar in eller ut
        // varandra -- samma skäl som står i packlista/app.js.
        storageKey: "fyndindex-auth-token",
        experimental: { passkey: true },
      },
    })
  : null;

const state = {
  snapshot: null,
  market: "SE",
  sort: "heat",
  search: "",
  session: null,
  // Trends-signaler importerade från CSV i den här fliken. Lever bara i
  // minnet med flit: en handimporterad fil är en tillfällig lagning, inte
  // något som ska smyga sig in i det sparade underlaget.
  csvSignals: {},
  myItems: null,
};

// Marknadsgrupper -- källorna deklarerar SE/EU/US, gränssnittet grupperar.
// Grupperna är kumulativa: Sverige ⊂ Norden ⊂ Europa ⊂ Allt. Det betyder att
// ett bredare val aldrig kan ta bort något, bara lägga till -- och lägger det
// inte till någon påslagen källa blir resultatet identiskt. Det är korrekt
// men såg ut som en trasig knapp, så marketSummary() nedan säger det rakt ut
// i stället för att låta dig klicka och undra.
const MARKET_GROUPS = {
  SE: ["SE"],
  NORDIC: ["SE", "NO", "DK", "FI"],
  EU: ["SE", "NO", "DK", "FI", "EU", "DE", "NL", "FR"],
  ALL: null,
};

// Flaggor gör källistan skummbar på ett sätt som "SE"/"US" i versaler inte
// gör. EU får unionsflaggan eftersom Vinted och Depop är paneuropeiska och
// inte hör hemma under ett enskilt land.
const MARKET_FLAGS = {
  SE: "🇸🇪", NO: "🇳🇴", DK: "🇩🇰", FI: "🇫🇮",
  DE: "🇩🇪", NL: "🇳🇱", FR: "🇫🇷", EU: "🇪🇺", US: "🇺🇸", GB: "🇬🇧",
};

const marketFlag = (market) => MARKET_FLAGS[market] || "🌍";

// ---------------------------------------------------------------------------
// Tema
// ---------------------------------------------------------------------------
const prefs = readPrefs();

function readPrefs() {
  try { return JSON.parse(localStorage.getItem("fyndindex-prefs") || "{}"); } catch { return {}; }
}
function writePrefs() {
  try { localStorage.setItem("fyndindex-prefs", JSON.stringify(prefs)); } catch { /* blockerad storage */ }
}
function applyTheme() {
  const light = prefs.theme === "light";
  document.documentElement.classList.toggle("theme-light", light);
  $$("#theme-toggle-guest,#theme-toggle-app").forEach((el) => { el.checked = !light; });
}
$$("#theme-toggle-guest,#theme-toggle-app").forEach((el) => {
  el.addEventListener("change", () => {
    prefs.theme = el.checked ? "dark" : "light";
    writePrefs();
    applyTheme();
  });
});
applyTheme();

// ---------------------------------------------------------------------------
// Dropdowns (samma generiska wiring som packlistans initDropdowns)
// ---------------------------------------------------------------------------
function initDropdowns() {
  for (const dropdown of $$("[data-dropdown]")) {
    const toggle = dropdown.querySelector("button");
    const panel = dropdown.querySelector("[data-dropdown-panel]");
    if (!toggle || !panel) continue;
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const open = panel.hidden;
      closeAllDropdowns();
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
    });
  }
  document.addEventListener("click", closeAllDropdowns);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeAllDropdowns(); });
}
function closeAllDropdowns() {
  for (const panel of $$("[data-dropdown-panel]")) panel.hidden = true;
  for (const button of $$("[data-dropdown] button")) button.setAttribute("aria-expanded", "false");
}
initDropdowns();

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
async function loadSnapshot() {
  return loadJson("data/snapshot-latest.json");
}

/** Dina egna annonser, skrivna av `run.js --seller=...`. Saknas normalt. */
async function loadMyItems() {
  return loadJson("data/my-items.json");
}

async function loadJson(path) {
  try {
    const response = await fetch(`${path}?t=${Date.now()}`);
    if (!response.ok) throw new Error(String(response.status));
    return await response.json();
  } catch {
    return null;
  }
}

function allSources() {
  return state.snapshot?.sources || fallbackSourceList();
}

function sourceIdsFor(marketKey) {
  const markets = MARKET_GROUPS[marketKey];
  return new Set(
    allSources()
      .filter((s) => s.enabled && s.status !== "blocked" && (!markets || markets.includes(s.market)))
      .map((s) => s.id),
  );
}

function currentSourceIds() {
  return sourceIdsFor(state.market);
}

/**
 * Vad det valda marknadsfiltret faktiskt gör just nu.
 *
 * Utan den här texten ser filtret trasigt ut: eftersom grupperna är
 * kumulativa och Tradera är enda påslagna källan ger Sverige, Norden, Europa
 * och Allt exakt samma femton kort. Inget är fel -- det finns bara inga
 * utländska källor påslagna att lägga till. Nu står det.
 */
function marketSummary() {
  const active = [...currentSourceIds()];
  const baseline = sourceIdsFor("SE");
  const added = active.filter((id) => !baseline.has(id));

  const labelFor = (id) => allSources().find((s) => s.id === id)?.label || id;

  if (!active.length) return "Inga påslagna källor för det här valet.";
  if (state.market === "SE") {
    const word = active.length === 1 ? "påslagen källa" : "påslagna källor";
    return `${active.length} ${word}: ${active.map(labelFor).join(", ")}.`;
  }
  if (!added.length) {
    // Det vanliga fallet i POC:en, och det som såg ut som en bugg.
    const off = allSources().filter((s) => s.status === "off" || s.status === "blocked");
    return `Samma resultat som Sverige — inga påslagna källor utanför Sverige ännu. ` +
      `${off.length} utländska och svenska källor är förberedda men avstängda (se listan nedan).`;
  }
  return `Lägger till ${added.map(labelFor).join(", ")} utöver de svenska källorna.`;
}

/** Kategorikorten filtrerade på marknad, sökning och sortering. */
function visibleCards() {
  const allowed = currentSourceIds();
  const query = state.search.trim().toLowerCase();

  let cards = (state.snapshot?.categories || []).map((card) => {
    const meta = CATEGORY_BY_ID[card.categoryId];
    // Marknadsfiltret räknar om utbudet från källfördelningen i stället för
    // att bara dölja kort -- annars hade "Sverige" visat ett utbudstal som
    // inkluderade Poshmark.
    const sources = (card.sources || []).filter((s) => allowed.has(s.source));
    const supply = sources.reduce((sum, s) => sum + s.supply, 0);
    const withBids = sources.reduce((sum, s) => sum + s.withBids, 0);
    // CSV-importerad trendsignal vinner över den insamlade, eftersom du
    // importerar den just när den insamlade saknas eller är fel.
    const imported = state.csvSignals[card.categoryId]?.interest;
    const searchInterest = Number.isFinite(imported) ? imported : card.searchInterest;

    // Sökintresset är en av delarna i heat, så en import måste räkna om
    // talet -- annars visar kortet en ny sökintressesiffra bredvid ett
    // heat som fortfarande bygger på den gamla.
    const heat = searchInterest === card.searchInterest
      ? card.heat
      : heatFromParts({ weightedBidRate: card.weightedBidRate, searchInterest });

    return { ...card, meta, sources, supply, withBids, searchInterest, heat };
  });

  if (query) {
    cards = cards.filter((card) => {
      const meta = card.meta;
      if (!meta) return false;
      return meta.name.toLowerCase().includes(query)
        || meta.brands.some((b) => b.toLowerCase().includes(query))
        || meta.queries.some((q) => q.toLowerCase().includes(query));
    });
  }

  const sorters = {
    heat: (a, b) => (b.heat ?? -1) - (a.heat ?? -1),
    delta: (a, b) => Math.abs(b.heatDelta ?? 0) - Math.abs(a.heatDelta ?? 0),
    supply: (a, b) => b.supply - a.supply,
    price: (a, b) => (b.priceMedian ?? -1) - (a.priceMedian ?? -1),
    name: (a, b) => (a.meta?.name || "").localeCompare(b.meta?.name || "", "sv"),
  };
  return cards.sort(sorters[state.sort] || sorters.heat);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
  const hasData = Boolean(state.snapshot);
  $("#app-header").hidden = false;
  $("#app-main").hidden = false;

  renderStats();
  renderMovers();
  renderMarketChips();
  renderCategories();
  renderMine();
  renderSources();
  renderFootnote();

  if (!hasData) renderEmptyState();
}

// ---------------------------------------------------------------------------
// Mina annonser -- korsannonseringskontrollen
// ---------------------------------------------------------------------------
function renderMine() {
  const section = $("#mine-section");
  // Kräver inloggning. Trendöversikten är öppen för alla, men dina egna
  // annonser är dina -- se RLS-policyn i supabase/migrations/0001.
  section.hidden = !state.session;
  if (!state.session) return;

  const body = $("#mine-body");

  if (!state.myItems?.items?.length) {
    body.replaceChildren(emptyBox(
      "Inga egna annonser hämtade",
      "Hämta dina Tradera-annonser en gång så jämförs de mot allt annat i indexet. Säljar-id och alias står i URL:en till din profil.",
      "node collector/run.js --seller=DITT_ID/ditt-alias",
    ));
    return;
  }

  // Allt utom mina egna annonser är kandidater. Vi jämför mot exempelurvalet
  // i snapshoten -- det räcker gott i en POC, och slipper skicka hela
  // observationsmängden till webbläsaren.
  const haystack = Object.values(state.snapshot?.samples || {}).flat()
    .map((s) => ({ ...s, sourceItemId: s.url || s.title }));

  const found = findCrossListings(state.myItems.items, haystack);

  const header = el("p");
  header.style.cssText = "margin:0 0 14px;color:var(--muted);font-size:13px";
  header.textContent = found.length
    ? `${found.length} av dina ${state.myItems.items.length} annonser har en trolig motsvarighet någon annanstans.`
    : `Inga av dina ${state.myItems.items.length} annonser matchar något annat i indexet just nu.`;

  const rows = found.flatMap(({ mine, matches }) => matches.map((match) => {
    const row = el("div", "match-row");
    const left = el("span");
    left.append(el("strong", null, mine.title), el("small", null, `Din annons · ${formatSek(mine.priceSek) || "–"}`));
    left.querySelector("small").style.cssText = "display:block;margin-top:3px;color:var(--muted);font-size:11px";

    // Under 0,6 är matchningen en fingervisning, inte ett konstaterande --
    // därför en dämpad pill i stället för en grön.
    const score = el("span", match.score >= 0.6 ? "score" : "score weak", `${Math.round(match.score * 100)} %`);

    const right = el("span");
    const link = document.createElement("a");
    link.href = match.item.url || "#";
    link.target = "_blank";
    link.rel = "noopener";
    link.style.cssText = "color:var(--text);text-decoration:none;font-size:13px";
    link.textContent = match.item.title;
    right.append(link, el("small", null, `${sourceLabel(match.item.source)} · ${match.item.priceSek ? formatSek(match.item.priceSek) : "pris okänt"}`));
    right.querySelector("small").style.cssText = "display:block;margin-top:3px;color:var(--muted);font-size:11px";

    row.append(left, score, right);
    return row;
  }));

  body.replaceChildren(header, ...rows);
}

function renderStats() {
  const cards = visibleCards().filter((c) => c.supply > 0);
  const hottest = cards.slice().sort((a, b) => (b.heat ?? -1) - (a.heat ?? -1))[0];
  const mover = (state.snapshot?.movers || [])
    .map((m) => ({ ...m, meta: CATEGORY_BY_ID[m.categoryId] }))[0];

  setText("#stat-hottest", hottest?.meta ? `${hottest.meta.icon} ${hottest.heat}` : "–");
  setText("#stat-hottest-sub", hottest?.meta ? hottest.meta.name : "kör insamlaren först");

  const total = cards.reduce((sum, c) => sum + c.supply, 0);
  setText("#stat-count", total ? total.toLocaleString("sv-SE") : "–");
  setText("#stat-count-sub", `${cards.length} kategorier med träffar`);

  setText("#stat-mover", mover ? `${mover.heatDelta > 0 ? "+" : ""}${mover.heatDelta}` : "–");
  setText("#stat-mover-sub", mover?.meta
    ? mover.meta.name
    : state.snapshot?.categories?.some((c) => c.heatDelta !== null)
      ? "inget har rört sig sedan sist"
      : "behöver två insamlingar");

  const at = state.snapshot?.collectedAt;
  setText("#stat-updated", at ? relativeTime(at) : "–");
  setText("#stat-updated-sub", at ? new Date(at).toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short" }) : "aldrig");

  // Hero-kortet i det utloggade läget speglar samma siffror.
  setText("#hero-heat", hottest ? String(hottest.heat) : "–");
  const bar = $("#hero-bar");
  if (bar) { bar.style.width = `${hottest?.heat || 0}%`; bar.style.background = heatColor(hottest?.heat); }
  setText("#hero-categories", String(cards.length || CATEGORIES.length));
  setText("#hero-count", total ? total.toLocaleString("sv-SE") : "–");
}

function renderMovers() {
  const section = $("#movers-section");
  const movers = (state.snapshot?.movers || []).filter((m) => CATEGORY_BY_ID[m.categoryId]);
  section.hidden = movers.length === 0;
  if (!movers.length) return;

  const host = $("#movers");
  host.replaceChildren(...movers.map((mover) => {
    const meta = CATEGORY_BY_ID[mover.categoryId];
    const node = el("div", "mover");
    node.append(
      el("span", null, [el("span", null, meta.icon), document.createTextNode(meta.name)]),
      el("b", mover.heatDelta > 0 ? "up" : "down", `${mover.heatDelta > 0 ? "+" : ""}${mover.heatDelta}`),
    );
    return node;
  }));
}

function renderCategories() {
  const grid = $("#category-grid");
  const cards = visibleCards();

  grid.replaceChildren(...cards.map((card) => {
    const meta = card.meta;
    if (!meta) return document.createComment("okänd kategori");

    const button = el("button", "category-card");
    button.type = "button";
    button.addEventListener("click", () => openDetail(card));

    // Rubrikrad: ikon + namn + heat
    const head = el("div", "cc-head");
    const title = el("div", "cc-title");
    title.append(
      el("span", "cc-icon", meta.icon),
      el("span", null, [
        el("strong", null, meta.name),
        el("small", null, card.supply ? `${card.supply} annonser` : "ingen data ännu"),
      ]),
    );
    const heat = el("div", "cc-heat");
    const heatValue = el("b", null, card.heat === null || card.heat === undefined ? "–" : String(card.heat));
    heatValue.style.color = heatColor(card.heat);
    heat.append(heatValue, deltaLabel(card.heatDelta));
    head.append(title, heat);

    // Stapel
    const bar = el("div", "heat-bar");
    const fill = el("i");
    fill.style.width = `${card.heat || 0}%`;
    fill.style.background = heatColor(card.heat);
    bar.append(fill);

    // Tre fakta
    const facts = el("div", "cc-facts");
    facts.append(
      fact("Budkvot", card.bidRate === null || card.bidRate === undefined ? "–" : `${Math.round(card.bidRate * 100)} %`),
      fact("Median", card.priceMedian ? formatSek(card.priceMedian) : "–"),
      fact("Sökintresse", Number.isFinite(card.searchInterest) ? String(card.searchInterest) : "–"),
    );

    button.append(head, bar, facts);

    if (card.sources?.length) {
      const pills = el("div", "cc-sources");
      pills.append(...card.sources.slice(0, 4).map((s) =>
        el("span", "src-pill", `${sourceLabel(s.source)} ${s.supply}`)));
      button.append(pills);
    } else {
      button.append(el("p", "cc-empty", "Kör insamlaren för att fylla den här kategorin."));
    }
    return button;
  }));

  $("#empty-state").hidden = cards.length > 0 || !state.snapshot;
  if (!cards.length && state.snapshot) {
    $("#empty-state").hidden = false;
    $("#empty-state").replaceChildren(emptyBox("Inga träffar", "Ingen kategori matchar filtret. Rensa sökrutan eller byt marknad."));
  }
}

// Text och färg per visningsläge, på ett ställe så prick, etikett och
// förklaringen ovanför listan aldrig kan säga olika saker.
const STATUS_META = {
  active:  { label: "aktiv",     hint: "påslagen och tillåten" },
  off:     { label: "avstängd",  hint: "tillåten men inte påslagen" },
  verify:  { label: "verifiera", hint: "oklara villkor" },
  blocked: { label: "spärrad",   hint: "sajten tillåter inte hämtning" },
};

function renderSources() {
  const table = $("#source-table");
  const runs = Object.fromEntries((state.snapshot?.sourceRuns || []).map((r) => [r.id, r]));

  table.replaceChildren(...allSources().map((source) => {
    // Hela raden är en länk till tjänsten. <a> och inte en klickhanterare på
    // en div, så att mittenklick, "öppna i ny flik" och tangentbord funkar
    // som på vilken länk som helst.
    const row = document.createElement("a");
    row.className = "source-row";
    row.href = source.url || "#";
    row.target = "_blank";
    row.rel = "noopener noreferrer";

    const run = runs[source.id];
    const meta = STATUS_META[source.status] || STATUS_META.off;
    const stateText = source.status === "active" && run ? `${run.collected} hämtade` : meta.label;

    const dot = el("span", `source-dot ${source.status}`);
    dot.title = meta.hint;

    const name = el("span", "source-name");
    name.append(
      el("strong", null, source.label),
      el("span", "source-go", "↗"),
    );

    const market = el("span", "market");
    market.append(
      el("span", "market-flag", marketFlag(source.market)),
      el("span", null, source.market),
    );

    // Spärrade källor har ett "unblock"-fält som säger vad som faktiskt
    // krävs. Det är mer värt än upprepningen av att de är spärrade.
    const note = el("span", "note", source.note || "");
    if (source.unblock) {
      note.append(el("em", "unblock", `Så här löser du det: ${source.unblock}`));
    }

    row.append(dot, name, market, note, el("span", `state ${source.status}`, stateText));
    return row;
  }));
}

/** Uppdaterar chipsen med hur många källor varje marknad faktiskt ger. */
function renderMarketChips() {
  for (const chip of $$(".chip[data-market]")) {
    const count = sourceIdsFor(chip.dataset.market).size;
    let badge = chip.querySelector(".chip-count");
    if (!badge) {
      badge = el("span", "chip-count");
      chip.append(badge);
    }
    badge.textContent = String(count);
    // Ett val som inte ger någon källa alls ska se dött ut, inte bara
    // bete sig dött.
    chip.classList.toggle("chip-empty", count === 0);
  }
  setText("#market-summary", marketSummary());
}

function renderFootnote() {
  const at = state.snapshot?.collectedAt;
  $("#footnote").innerHTML = at
    ? `Insamlat ${new Date(at).toLocaleString("sv-SE")}. Heat är ett relativt mått som väger budkvot, bevakningsordning och sökintresse &mdash; det är byggt för att jämföra kategorier med varandra vid samma tidpunkt, inte för att jämföras mellan olika insamlingar i absoluta tal. Sökintresse kommer från Google Trends och är alltid relativt sin egen topp (0&ndash;100).`
    : `Ingen insamling gjord ännu. K&ouml;r <code>node collector/run.js</code> i projektmappen.`;
}

function renderEmptyState() {
  $("#empty-state").hidden = false;
  $("#empty-state").replaceChildren(emptyBox(
    "Inget insamlat ännu",
    "Kör insamlaren en gång så fylls översikten. Första körningen tar några minuter eftersom den går långsamt mot varje källa med flit.",
    "node collector/run.js",
  ));
}

function emptyBox(heading, text, code) {
  const box = el("div", "empty-list");
  box.append(el("span", null, "🔍"), el("h3", null, heading));
  const p = el("p", null, text);
  if (code) { p.append(document.createElement("br"), el("code", null, code)); }
  box.append(p);
  return box;
}

// ---------------------------------------------------------------------------
// Detaljvy
// ---------------------------------------------------------------------------
function openDetail(card) {
  const meta = card.meta || CATEGORY_BY_ID[card.categoryId];
  setText("#detail-title", `${meta.icon} ${meta.name}`);
  setText("#detail-eyebrow", card.heat === null ? "Ingen data" : `Heat ${card.heat} av 100`);

  const body = $("#detail-body");
  const signal = state.csvSignals[card.categoryId] || state.snapshot?.searchSignals?.[card.categoryId];
  const samples = state.snapshot?.samples?.[card.categoryId] || [];

  const grid = el("div", "detail-grid");

  // Vänster: faktiska annonser
  const left = el("div", "panel");
  left.append(el("h3", null, "Annonser just nu"), el("p", null,
    samples.length
      ? "De högst rankade träffarna i den senaste insamlingen, i bevakningsordning."
      : "Inga annonser insamlade för den här kategorin ännu."));
  for (const item of samples) {
    const row = el("div", "listing");
    const img = document.createElement("img");
    img.src = item.imageUrl || "";
    img.alt = "";
    img.loading = "lazy";
    const middle = el("span");
    const link = document.createElement("a");
    link.href = item.url || "#";
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = item.title;
    middle.append(link, el("small", null, `${sourceLabel(item.source)}${item.bids > 0 ? " · har bud" : ""}${item.brand ? ` · ${item.brand}` : ""}`));
    row.append(img, middle, el("span", "price", item.priceSek ? formatSek(item.priceSek) : "–"));
    left.append(row);
  }

  // Höger: sökintresse + varumärken + källfördelning
  const right = el("div");

  const trendPanel = el("div", "panel");
  trendPanel.style.marginBottom = "12px";
  trendPanel.append(el("h3", null, "Sökintresse"), el("p", null,
    signal?.interest != null
      ? `Google Trends, ${signal.origin === "csv" ? "importerad CSV" : "senaste 12 månaderna"}. Skalan är relativ mot kategorins egen topp.`
      : "Ingen trendsignal hämtad. Google stryper hämtningen — importera CSV via knappen i toppen."));
  if (signal?.trend?.length) trendPanel.append(sparkline(signal.trend.map((p) => p.v)));
  if (signal?.rising?.length) {
    trendPanel.append(el("p", null, "Snabbast växande sökningar:"));
    const rising = el("div", "rising");
    rising.append(...signal.rising.slice(0, 6).map((r) => {
      const row = el("div");
      row.append(el("span", null, r.query), el("b", r.breakout ? "breakout" : null, r.label || `+${r.value}%`));
      return row;
    }));
    trendPanel.append(rising);
  }
  right.append(trendPanel);

  const sourcePanel = el("div", "panel");
  sourcePanel.append(el("h3", null, "Fördelning per källa"), el("p", null,
    "Utbud och andel med bud, källa för källa."));
  for (const s of card.sources || []) {
    const row = el("div", "listing");
    row.style.gridTemplateColumns = "minmax(0,1fr) auto";
    row.append(
      el("span", null, sourceLabel(s.source)),
      el("span", "price", `${s.supply} st · ${s.supply ? Math.round((s.withBids / s.supply) * 100) : 0} % med bud`),
    );
    sourcePanel.append(row);
  }
  const brands = el("p");
  brands.style.cssText = "margin:14px 0 0;color:var(--muted);font-size:12px;line-height:1.6";
  brands.textContent = `Varumärken som räknas hit: ${meta.brands.join(", ")}.`;
  sourcePanel.append(brands);
  right.append(sourcePanel);

  grid.append(left, right);
  body.replaceChildren(grid);
  $("#detail-modal").hidden = false;
}

/** Enkel sparkline i inline-SVG. Ingen bibliotekskod för fjorton datapunkter. */
function sparkline(values) {
  const points = values.filter(Number.isFinite);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "sparkline");
  svg.setAttribute("viewBox", "0 0 100 30");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Sökintresse över tid, ${points.length} mätpunkter`);
  if (points.length < 2) return svg;

  const max = Math.max(...points, 1);
  const path = points
    .map((v, i) => `${(i / (points.length - 1)) * 100},${30 - (v / max) * 28}`)
    .join(" ");

  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("points", path);
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "var(--green)");
  line.setAttribute("stroke-width", "1.5");
  line.setAttribute("vector-effect", "non-scaling-stroke");
  svg.append(line);
  return svg;
}

// ---------------------------------------------------------------------------
// Google Trends CSV-import
// ---------------------------------------------------------------------------
$("#open-trends-import")?.addEventListener("click", () => {
  const select = $("#trends-category");
  select.replaceChildren(...CATEGORIES.map((c) => {
    const option = document.createElement("option");
    option.value = c.id;
    option.textContent = `${c.icon} ${c.name}`;
    return option;
  }));
  $("#trends-modal").hidden = false;
});

$("#trends-apply")?.addEventListener("click", async () => {
  const message = $("#trends-message");
  const file = $("#trends-file").files?.[0];
  if (!file) { message.textContent = "Välj en CSV-fil först."; return; }

  try {
    const parsed = parseTrendsCsv(await file.text());
    const signal = csvToSignal(parsed);
    const categoryId = $("#trends-category").value;
    // Slå ihop med det som redan finns -- laddar du först "intresse över
    // tid" och sedan "stigande sökningar" ska båda överleva.
    state.csvSignals[categoryId] = { ...(state.csvSignals[categoryId] || {}), ...signal };
    message.style.color = "var(--green)";
    message.textContent = `Läste ${parsed.rows.length} rader (${parsed.kind}). Kategorin är uppdaterad.`;
    render();
  } catch (error) {
    message.style.color = "var(--warn)";
    message.textContent = `Kunde inte läsa filen: ${error.message}`;
  }
});

// ---------------------------------------------------------------------------
// Inloggning (samma flöde som packlistan: lösenord + passkey)
// ---------------------------------------------------------------------------
const loginModal = $("#login-modal");
const authMessage = $("#auth-message");

$$("#open-login,#open-login-app").forEach((button) =>
  button.addEventListener("click", () => {
    if (!supabase) {
      authMessage.textContent = "Supabase är inte konfigurerat. Fyll i config.js.";
    }
    loginModal.hidden = false;
    $("#email").focus();
  }));

$("#close-login").addEventListener("click", () => { loginModal.hidden = true; authMessage.textContent = ""; });
$("#close-detail").addEventListener("click", () => { $("#detail-modal").hidden = true; });
$("#close-trends").addEventListener("click", () => { $("#trends-modal").hidden = true; });
for (const modal of $$(".modal-backdrop")) {
  modal.addEventListener("click", (event) => { if (event.target === modal) modal.hidden = true; });
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") for (const modal of $$(".modal-backdrop")) modal.hidden = true;
});

$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;
  authMessage.textContent = "Loggar in…";
  const { error } = await supabase.auth.signInWithPassword({
    email: $("#email").value.trim(),
    password: $("#password").value,
  });
  authMessage.textContent = error ? `Kunde inte logga in: ${error.message}` : "";
});

$("#sign-up").addEventListener("click", async () => {
  if (!supabase || !$("#auth-form").reportValidity()) return;
  authMessage.textContent = "Skapar konto…";
  const { data, error } = await supabase.auth.signUp({
    email: $("#email").value.trim(),
    password: $("#password").value,
    // Måste sättas explicit. Utan den skickar Supabase tillbaka till
    // projektets Site URL, som pekar på Packlista -- vi delar projekt.
    // origin + pathname i stället för hårdkodat, så det funkar både på
    // localhost och under /fyndindex/ på github.io.
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  authMessage.textContent = error
    ? `Kunde inte skapa konto: ${error.message}`
    : data.session ? "" : "Kontot är skapat. Bekräfta adressen via mejlet du fått.";
});

$("#passkey-sign-in").addEventListener("click", async () => {
  if (!supabase) return;
  authMessage.textContent = "Väntar på din passkey…";
  window.focus();
  const { error } = await supabase.auth.signInWithPasskey();
  authMessage.textContent = error ? `Kunde inte logga in: ${passkeyErrorMessage(error)}` : "";
});

$("#register-passkey")?.addEventListener("click", async () => {
  if (!supabase) return;
  const status = $("#passkey-status");
  status.textContent = "Väntar på din passkey…";
  const { error } = await supabase.auth.registerPasskey();
  status.textContent = error ? `Kunde inte registrera: ${passkeyErrorMessage(error)}` : "Passkey registrerad ✓";
});

$("#sign-out")?.addEventListener("click", () => supabase?.auth.signOut());

function passkeyErrorMessage(error) {
  if (error?.message?.includes("RP ID") || error?.message?.includes("relying party")) {
    return "Passkey-domänen är felkonfigurerad. Försök igen efter att sidan uppdaterats.";
  }
  if (error?.code === "webauthn_credential_not_found") {
    return "Ingen passkey hittades för kontot. Logga in med e-post och registrera en passkey först.";
  }
  if (error?.name === "NotAllowedError") {
    return "Passkey-flödet avbröts. Försök igen med biometrik, PIN eller säkerhetsnyckel.";
  }
  return error?.message || "Ett okänt fel inträffade.";
}

supabase?.auth.onAuthStateChange(async (_event, session) => {
  state.session = session;
  const signedIn = Boolean(session);
  $("#signed-out").hidden = signedIn;
  $("#account-dropdown").hidden = !signedIn;
  $("#open-login-app").hidden = signedIn;
  if (signedIn) {
    loginModal.hidden = true;
    setText("#account-email", session.user.email || "Konto");
    // Egna annonser hämtas först när någon faktiskt loggat in -- ingen
    // anledning att be om filen för en besökare som bara tittar.
    if (!state.myItems) state.myItems = await loadMyItems();
  }
  render();
});

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------
for (const chip of $$(".chip[data-market]")) {
  chip.addEventListener("click", () => {
    state.market = chip.dataset.market;
    for (const other of $$(".chip[data-market]")) other.classList.toggle("active", other === chip);
    render();
  });
}
$("#filter-search").addEventListener("input", (event) => { state.search = event.target.value; renderCategories(); renderStats(); });
$("#sort-select").addEventListener("change", (event) => { state.sort = event.target.value; renderCategories(); });

// ---------------------------------------------------------------------------
// Korsannonseringskontroll -- exporterad så den kan testas fristående
// ---------------------------------------------------------------------------
/**
 * Letar efter dina egna annonser hos andra källor.
 *
 * @param {Array} myItems   dina annonser (data/my-items.json)
 * @param {Array} allItems  alla observationer från övriga källor
 * @param {number} threshold Jaccard-likhet 0–1; 0.45 träffar "Orrefors vas
 *                           Nils Landberg" mot "Nils Landberg vas Orrefors
 *                           1950-tal" utan att träffa varje annan vas.
 */
export function findCrossListings(myItems, allItems, threshold = 0.45) {
  const indexed = allItems.map((item) => ({ item, fingerprint: titleFingerprint(item.title) }));
  const results = [];

  for (const mine of myItems) {
    const fingerprint = titleFingerprint(mine.title);
    const matches = indexed
      .filter(({ item }) => item.source !== mine.source || item.sourceItemId !== mine.sourceItemId)
      .map(({ item, fingerprint: other }) => ({ item, score: titleSimilarity(fingerprint, other) }))
      .filter((m) => m.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    if (matches.length) results.push({ mine, matches });
  }
  return results.sort((a, b) => b.matches[0].score - a.matches[0].score);
}

// ---------------------------------------------------------------------------
// Småverktyg
// ---------------------------------------------------------------------------
function el(tag, className, children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (typeof children === "string") node.textContent = children;
  else if (Array.isArray(children)) node.append(...children);
  else if (children) node.append(children);
  return node;
}

function fact(key, value) {
  const box = el("div");
  box.append(el("p", "k", key), el("p", "v", value));
  return box;
}

function deltaLabel(value) {
  if (!Number.isFinite(value) || value === 0) return el("i", "flat", "oförändrat");
  return el("i", value > 0 ? "up" : "down", `${value > 0 ? "▲" : "▼"} ${Math.abs(value)}`);
}

/** Färgskala kall → brinnande. Samma trösklar som staplarna använder. */
function heatColor(heat) {
  if (!Number.isFinite(heat)) return "var(--muted)";
  if (heat >= 75) return "var(--blaze)";
  if (heat >= 55) return "var(--hot)";
  if (heat >= 35) return "var(--warm)";
  return "var(--cold)";
}

function sourceLabel(id) {
  return state.snapshot?.sources?.find((s) => s.id === id)?.label || id;
}

function formatSek(value) {
  return `${Math.round(value).toLocaleString("sv-SE")} kr`;
}

function relativeTime(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

function setText(selector, text) {
  const node = $(selector);
  if (node) node.textContent = text;
}

/** Visas innan första insamlingen, så källpanelen inte är tom vid start.
 *  Håll `status` i synk med displayStatus() i collector/sources/index.js. */
function fallbackSourceList() {
  return [
    { id: "tradera", label: "Tradera", market: "SE", enabled: true, status: "active", url: "https://www.tradera.com/", note: "Söksidorna är server-renderade och robots.txt tillåter /search." },
    { id: "myrorna", label: "Myrorna", market: "SE", enabled: true, status: "active", url: "https://www.myrorna.se/shop/", note: "Säljer allt via sin Tradera-butik — hämtas därifrån." },
    { id: "auktionsverket", label: "Stockholms Auktionsverk", market: "SE", enabled: true, status: "verify", url: "https://www.auktionsverket.se/", note: "Sitemap är öppen, men inga uttryckliga API-villkor." },
    { id: "bukowskis", label: "Bukowskis", market: "SE", enabled: true, status: "active", url: "https://www.bukowskis.com/sv", note: "robots.txt spärrar bara /admin/ och /cms/." },
    { id: "sellpy", label: "Sellpy", market: "SE", enabled: true, status: "active", url: "https://www.sellpy.se/", note: "Sökvägarna är spärrade i robots.txt — vi läser bara sitemapen." },
    { id: "plick", label: "Plick", market: "SE", enabled: false, status: "off", url: "https://plick.se/", note: "Inga spärrar, men träffarna laddas via Turbo-frame." },
    { id: "poshmark", label: "Poshmark", market: "US", enabled: false, status: "off", url: "https://poshmark.com/", note: "Fungerar, avstängd tills du vill blanda in USD-priser." },
    { id: "blocket", label: "Blocket", market: "SE", enabled: false, status: "blocked", url: "https://www.blocket.se/", note: "robots.txt förbjuder uttryckligen crawling utan skriftligt tillstånd.", unblock: "Skriftligt tillstånd från Blocket, eller deras partner-/annons-API." },
    { id: "barnebys", label: "Barnebys", market: "SE", enabled: false, status: "blocked", url: "https://www.barnebys.se/", note: "Förbjuder uttryckligen crawling.", unblock: "Barnebys har ett kommersiellt data-/API-erbjudande — den här källan hade täckt glas, porslin och design bäst av alla." },
    { id: "vinted", label: "Vinted", market: "EU", enabled: false, status: "blocked", url: "https://www.vinted.se/", note: "Interna API:et kräver sessionstoken (401).", unblock: "Fråga Vinted om partneråtkomst." },
    { id: "depop", label: "Depop", market: "EU", enabled: false, status: "blocked", url: "https://www.depop.com/", note: "403 på allt, även robots.txt.", unblock: "Officiell API-åtkomst via Etsy, eller ett affiliate-flöde." },
    { id: "thredup", label: "ThredUp", market: "US", enabled: false, status: "blocked", url: "https://www.thredup.com/", note: "Bot-skydd svarar 403.", unblock: "Affiliate-flöde via Rakuten." },
  ];
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
state.snapshot = await loadSnapshot();
if (!supabase) $("#signed-out").hidden = true; // ingen inloggning konfigurerad
render();
