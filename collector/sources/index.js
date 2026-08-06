// Källregistret.
//
// Varje källa deklarerar sitt juridiska läge, inte bara sin teknik. Det är
// med flit det första fältet du ser: vilka sajter vi FÅR hämta från är en
// hårdare begränsning än vilka vi KAN hämta från, och den skillnaden ska
// inte gömmas i en kommentar långt ned i en fil.
//
// legal.status:
//   "ok"       robots.txt tillåter det vi gör, ingen uttrycklig spärr
//   "verify"   ingen uttrycklig spärr men inte heller ett tydligt ja --
//              hämtas långsamt och i liten skala, dubbelkolla villkoren
//              innan du kör det ofta eller kommersiellt
//   "blocked"  sajten förbjuder uttryckligen automatiserad hämtning, eller
//              spärrar tekniskt. Adaptern är avstängd och körs inte.
//
// Status är kontrollerad 2026-08-06. Villkor ändras -- kör
// `node collector/run.js --check-robots` för att läsa om robots.txt.

import * as tradera from "./tradera.js";
import * as myrorna from "./myrorna.js";
import * as auktionsverket from "./auktionsverket.js";
import * as bukowskis from "./bukowskis.js";
import * as plick from "./plick.js";
import * as sellpy from "./sellpy.js";
import * as poshmark from "./poshmark.js";
import * as blocked from "./blocked.js";

export const SOURCES = [
  // ---- Sverige ----
  tradera,
  myrorna,
  auktionsverket,
  bukowskis,
  plick,
  sellpy,
  // ---- Internationellt (förberedda, avstängda tills du vill ha dem) ----
  poshmark,
  ...blocked.BLOCKED_SOURCES,
];

export const SOURCE_BY_ID = Object.fromEntries(SOURCES.map((s) => [s.id, s]));

/** Källor som faktiskt körs: påslagna och inte juridiskt spärrade. */
export function activeSources({ markets = null } = {}) {
  return SOURCES.filter((s) =>
    s.enabled &&
    s.legal.status !== "blocked" &&
    (!markets || markets.includes(s.market)));
}

/** Sammanställning för källpanelen i gränssnittet. */
export function sourceManifest() {
  return SOURCES.map((s) => ({
    id: s.id,
    label: s.label,
    market: s.market,
    enabled: Boolean(s.enabled),
    status: s.legal.status,
    note: s.legal.note,
    url: s.homepage || null,
  }));
}
