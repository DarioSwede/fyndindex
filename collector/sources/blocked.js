// Källor som är med i modellen men INTE hämtas.
//
// De ligger kvar i registret med flit. Ett tomt kort som säger "Blocket:
// avstängd, kräver skriftligt tillstånd" är mer användbart än att Blocket
// helt saknas ur gränssnittet -- då hade du undrat om jag glömt det.
//
// Var och en har en `unblock`-rad: exakt vad som krävs för att slå på den.
// Ingen av dem går att lösa genom att skriva smartare kod.

const collectRefusal = (source) => async () => {
  throw new Error(
    `Källan "${source}" är avstängd med flit. Se collector/sources/blocked.js för vad som krävs för att aktivera den.`,
  );
};

export const BLOCKED_SOURCES = [
  {
    id: "blocket",
    label: "Blocket",
    market: "SE",
    enabled: false,
    homepage: "https://www.blocket.se/",
    legal: {
      status: "blocked",
      note: "Blockets robots.txt förbjuder uttryckligen crawling: \"Crawling blocket.se is prohibited unless you have written permission.\" Ingen teknisk spärr att ta sig runt -- det är ett nej.",
      unblock: "Skriftligt tillstånd från Blocket, eller åtkomst till deras partner-/annons-API. Kontakta dem via blocket.se/om/kontakt.",
    },
    collect: collectRefusal("blocket"),
  },
  {
    id: "barnebys",
    label: "Barnebys",
    market: "SE",
    enabled: false,
    homepage: "https://www.barnebys.se/",
    legal: {
      status: "blocked",
      note: "Barnebys robots.txt inleds med \"Crawling Barnebys is prohibited unless you have express written permission\". Synd, för de aggregerar just auktionsdata för antikt och design.",
      unblock: "Barnebys har ett kommersiellt data-/API-erbjudande. Fråga dem -- det här är den källa som bäst hade täckt glas, porslin och design.",
    },
    collect: collectRefusal("barnebys"),
  },
  {
    id: "depop",
    label: "Depop",
    market: "EU",
    enabled: false,
    homepage: "https://www.depop.com/",
    legal: {
      status: "blocked",
      note: "Depop svarar 403 Forbidden på allt från datacenter-IP, till och med på /robots.txt. De blockerar aktivt.",
      unblock: "Officiell API-åtkomst via Etsy (Depops ägare) eller ett affiliate-flöde.",
    },
    collect: collectRefusal("depop"),
  },
  {
    id: "thredup",
    label: "ThredUp",
    market: "US",
    enabled: false,
    homepage: "https://www.thredup.com/",
    legal: {
      status: "blocked",
      note: "Svarar 403 via bot-skydd (Imperva) på produktlistningarna. robots.txt tillåter i sig en del, men det spelar ingen roll när svaret aldrig kommer fram.",
      unblock: "ThredUp har ett affiliate-program via Rakuten med produktflöde -- det är den lagliga och tekniskt hållbara vägen.",
    },
    collect: collectRefusal("thredup"),
  },
  {
    id: "vinted",
    label: "Vinted",
    market: "EU",
    enabled: false,
    homepage: "https://www.vinted.se/",
    legal: {
      status: "blocked",
      note: "Det interna API:et (/api/v2/catalog/items) svarar 401 utan sessionstoken. Vinteds robots.txt tillåter crawling för sök och indexering men förbjuder uttryckligen användning för modellträning och dataset.",
      unblock: "Vinted har inget publikt API. En sessionstoken går att hämta, men då kringgår du en spärr de satt med flit -- gör det inte utan tillstånd. Fråga efter partneråtkomst i stället.",
    },
    collect: collectRefusal("vinted"),
  },
];
