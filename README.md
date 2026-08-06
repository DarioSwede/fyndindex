# Fyndindex

Överblick över vad som rör sig på den svenska andrahandsmarknaden — Tradera,
Myrorna, auktionshusen och Google-sökningarna bakom dem — på ett kort per
kategori.

Samma teknikval som Packlista: vanilla JS, inget byggsteg, statisk hosting
på GitHub Pages, Supabase för inloggning. Skillnaden är att Fyndindex också
har en insamlare som körs separat och skriver en JSON-fil som webbappen läser.

```
insamlare (node)  ──►  data/snapshot-latest.json  ──►  webbappen (statisk)
                                  │
                                  └──►  Supabase (valfritt: historik + Mina annonser)
```

---

## Kom igång

```bash
node collector/run.js --no-trends
```

Första körningen tar några minuter — insamlaren väntar med flit mellan varje
träff mot en sajt. Den skriver `data/snapshot-latest.json`.

Sedan, för att titta på resultatet:

```bash
python3 -m http.server 8000
```

och öppna <http://localhost:8000>. En vanlig `file://`-öppning fungerar
**inte**, eftersom appen använder ES-moduler och `fetch`.

Vill du ha med sökintresset från Google Trends, kör utan `--no-trends`. Räkna
med att en del kategorier blir strypta — se avsnittet längre ned.

### Fler växlar

```bash
node collector/run.js --sources=tradera          # bara en källa
node collector/run.js --markets=SE,US            # ta med Poshmark
node collector/run.js --deep --pages=2           # bredare och djupare sökning
node collector/run.js --check-robots             # läs om robots.txt, hämta inget
node collector/run.js --seller=3532689/myrorna   # hämta en säljares annonser
```

---

## Vad heat betyder

Ett tal 0–100 per kategori, sammanvägt av två delar:

| Del | Vikt | Varifrån |
|---|---|---|
| **Rankviktad budkvot** — andel auktioner som fått minst ett bud, där bud på högt bevakade annonser väger tyngre | 75 % | Tradera visar "Ledande bud" i stället för "Utropspris" så fort någon budat; ordningen kommer från `sortBy=HighestWishListCount` |
| **Sökintresse** | 25 % | Google Trends |

Saknas sökintresset viktas budkvoten upp till 100 %, så att en kategori som
Google strypte inte straffas för det.

**Varför rankviktad och inte bevakningsrank som egen term.** Första versionen
hade bevakningsranken som en tredje term. Det såg rimligt ut men var
värdelöst: eftersom varje annons vi samlar in kommer från en
bevakningssorterad topplista fick alla kategorier samma snittrank (~0,5). En
konstant i en viktad summa flyttar hela skalan utan att skilja något åt — och
mycket riktigt landade samtliga femton kategorier på heat 20–32, färgskalan
slog aldrig om och staplarna såg identiska ut. Samma tal används nu som *vikt*
i stället för som term, och då bär det faktisk information: *får de mest
bevakade sakerna bud?* Regressionstestet heter "heat skiljer kategorier åt i
det realistiska spannet".

**HEAT_CEILING.** Budkvoter på svensk secondhand ligger realistiskt mellan
någon enstaka procent och ~50 %. Heat sträcker ut det spannet över 0–100 så
att skillnaden mellan porslin (1 %) och parfym (21 %) syns i en stapel. Det är
en presentationsskala, inte en mätning — den råa andelen ligger kvar orörd som
`bidRate` på varje kort.

**Heat är relativt.** Det är byggt för att jämföra kategorier med varandra vid
samma tidpunkt. Δheat mellan två insamlingar dämpas dessutom av hur mycket
underlag som fanns (`momentum()` i `core/metrics.js`) — ett hopp från 20 till
60 på fem annonser är brus, samma hopp på 200 annonser är en trend.

**Bevakningssiffran finns inte.** Tradera exponerar bara sorteringsordningen,
inte antalet. Vi rapporterar därför position, aldrig ett påhittat antal.

---

## Källor

| Källa | Marknad | Status | Kommentar |
|---|---|---|---|
| **Tradera** | SE | ✅ på | Söksidorna är server-renderade. robots.txt tillåter `/search` och `/item`. Officiellt SOAP-API finns på `api.tradera.com/v3` om du vill ha en nyckel. |
| **Myrorna** | SE | ✅ på | Har ingen egen webbshop — *"Alla våra webbshopsprodukter säljs via auktion på Tradera med utropspris 1 kr."* Vi läser deras Tradera-butik (säljare 3532689) i stället. Utropspriset är alltid 1 kr, så bara budkvoten är meningsfull därifrån. |
| **Bukowskis** | SE | ✅ på | robots.txt spärrar bara `/admin/`, `/cms/` och PDF. Täcker det övre prisskiktet i glas, porslin och design. |
| **Sellpy** | SE | ✅ på | robots.txt **spärrar sökningen** (`Disallow: /store/*/*/search?*`). Vi rör den inte — bara den sitemap de själva publicerar. |
| **Stockholms Auktionsverk** | SE | ⚠️ verifiera | `auktionsverket.se` vidarebefordrar till `stockholmsauktionsverk.com`. Tillåtande robots.txt och öppen sitemap, men inga uttryckliga API-villkor. Läs deras användarvillkor innan du kör det ofta. |
| **Plick** | SE | ⚪ av | Inga spärrar alls (tom robots.txt), men träffarna laddas i en Turbo-frame och syns inte i första HTML-svaret. Adaptern är färdig så när som på `parseProducts()`. |
| **Poshmark** | US | ⚪ av | Fungerar — de lägger en schema.org-`ItemList` i söksidan. Avstängd tills du bestämt hur du vill hantera USD-priser. Slå på med `--markets=SE,US`. |
| **Blocket** | SE | 🔴 avstängd | robots.txt: *"Crawling blocket.se is prohibited unless you have written permission."* Ingen teknisk spärr att ta sig runt — det är ett nej. |
| **Barnebys** | SE | 🔴 avstängd | *"Crawling Barnebys is prohibited unless you have express written permission."* Extra synd, för de aggregerar just auktionsdata för antikt och design. De har ett kommersiellt API — **det här är den källa jag skulle fråga efter först.** |
| **Vinted** | EU | 🔴 avstängd | Interna API:et svarar 401 utan sessionstoken. robots.txt tillåter crawling för sök men förbjuder uttryckligen användning för modellträning. |
| **Depop** | EU | 🔴 avstängd | 403 på allt från datacenter-IP, inklusive `/robots.txt`. |
| **ThredUp** | US | 🔴 avstängd | Bot-skydd (Imperva) svarar 403. Affiliate-flöde via Rakuten är den hållbara vägen in. |

Kör `node collector/run.js --check-robots` för att läsa om robots.txt.
**Status uppdateras inte automatiskt** — läs utfallet och ändra
`collector/sources/*.js` för hand.

### Lägga till en källa

Kopiera `collector/sources/tradera.js`, ändra `id`, `label`, `market`,
`legal` och `collect()`, och lägg till den i `collector/sources/index.js`.
Adaptern ska returnera observationer via `makeObservation()` — då blir
klassificering, prisomräkning och uteslutning av stora saker automatisk.

Flera svenska secondhandkedjor säljer också via Tradera (Erikshjälpen,
Stadsmissionen, Röda Korset). För dem räcker det att kopiera
`sources/myrorna.js` och byta säljar-id.

---

## Google Trends

Ja, det går att använda — men med tre förbehåll:

1. **Trends mäter Google-sökningar, inte Tradera-sökningar.** Ingen
   marknadsplats publicerar sina egna söksiffror. Trends är den bästa proxyn
   som finns, inte samma sak.
2. **Siffrorna är relativa** (0–100 mot sin egen topp). Du kan säga "porslin
   är hetare nu än i mars", aldrig "1 200 personer sökte".
3. **Den odokumenterade endpointen stryps hårt.** `api/explore` går igenom,
   men `widgetdata/*` svarar 429 gång på gång — även med tio sekunders paus
   emellan. Räkna med att en del kategorier blir tomma.

Därför två vägar:

- **Automatiskt:** `collector/signals/google-trends.js`, en gång per dygn,
  med lång backoff. Signalen rör sig i veckotakt ändå.
- **För hand:** ladda ner CSV från
  [trends.google.com](https://trends.google.com/trends/explore?geo=SE) och
  släpp den i appen via **Importera Trends**. Både "Intresse över tid" och
  "Relaterade sökningar" känns igen automatiskt.

- **Officiella API:et:** `collector/signals/google-trends-api.js` är färdig så
  när som på en nyckel. Byt import i `run.js` när du blivit antagen — samma
  returform, inget annat behöver ändras.

**Officiella API:et:** Google öppnade ett riktigt Trends-API i juli 2025. Det
ligger fortfarande i ansökningsstyrd alfa (aug 2026), är gratis, och ger
5 års data med konsekvent skalning — vilket löser förbehåll 3 helt. Ansök på
<https://developers.google.com/search/apis/trends>. De prioriterar sökande
som vet vad de ska använda det till och kan börja bygga direkt, så beskriv
det här projektet konkret.

---

## Vad som medvetet är uteslutet

Bilar, båtar, husvagnar, bostäder, djur, vitvaror, pianon — allt som inte
lämpar sig för att skickas i ett paket. Filtreringen sker på två ställen:
adaptrarna hoppar över hela kategorigrenar där det går, och `classify()` i
`core/taxonomy.js` slänger allt som matchar `EXCLUDE_PATTERNS` oavsett källa.
Bältet och hängslena, eftersom flera källor saknar användbar kategoridata.

Det är också därför Blockets pressrelease om vad som säljer bäst inte används
som seed: den är från 2020 och toppas av kylskåp, kajaker, hundar och bilar.

---

## Kategorier

Fyra är dina egna önskemål (glas, porslin, antik & design). Resten är härledda
ur Traderas rapport *"De 25 mest efterfrågade varumärkena"* (mätperiod
2024-03-01–2025-02-28) — se `data/seed/tradera-brands-2025.json`.

Notera att rapporten bara täcker kläder, skor, accessoarer och parfym. Glas,
porslin och antikt saknar publicerad referensranking — deras heat kommer helt
från den egna insamlingen plus Google Trends.

---

## Mina annonser

Hämta dina egna Tradera-annonser och se om samma sak ligger ute någon
annanstans:

```bash
node collector/run.js --seller=DITT_SÄLJARID/ditt-alias
```

Säljar-id och alias hittar du i URL:en till din profil:
`tradera.com/profile/items/**3532689**/**myrorna**`.

Matchningen är Jaccard-likhet mellan normaliserade ordmängder
(`titleSimilarity()` i `core/normalize.js`), tröskel 0,45. Det träffar
"Orrefors vas Nils Landberg" mot "Nils Landberg vas Orrefors 1950-tal" utan
att träffa varje annan vas. Tröskeln är en gissning som fungerar bra på
svenska annonstitlar, inte en sanning — justera den när du sett utfallet.

---

## Publicera

```bash
git init && git add -A && git commit -m "Fyndindex"
gh repo create fyndindex --public --source=. --push
```

Slå på GitHub Pages (Settings → Pages → Source: GitHub Actions).
`.github/workflows/pages.yml` publicerar vid varje push, och
`.github/workflows/collect.yml` kör insamlaren 05:12 UTC varje dag och
committar ny data — som i sin tur triggar en ny publicering. Ingen server,
ingen databas, ingen kostnad.

Ingen `CNAME` finns — sajten ligger på `darioswede.github.io/fyndindex/`.
Lägg till en `CNAME`-fil med ditt domännamn när du skaffar ett.

### Supabase

Behövs bara för inloggning och Mina annonser:

```bash
supabase link --project-ref ohwalxqwtxtlldalsclj
supabase db push
```

Migrationen är prefixad `fyndindex_` och rör inte Packlistas tabeller.
Sessionerna hålls isär av `storageKey: "fyndindex-auth-token"` i `app.js`,
precis som Packlista och Tor-dash gör mot varandra.

---

## Filer

```
index.html            skalet
styles.css            samma designsystem som Packlista (tokenblocket är en kopia)
app.js                rendering, filter, inloggning, CSV-import
config.js             Supabase-nycklar (publika, RLS gör jobbet)

collector/
  run.js              CLI
  core/
    taxonomy.js       kategorier, uteslutningar, klassificering   ← delas med appen
    metrics.js        heat, budkvot, momentum                     ← delas med appen
    normalize.js      gemensam observationsform, titelmatchning   ← delas med appen
    fetch.js          hövlig HTTP: strypning, diskcache, backoff
  sources/            en fil per marknadsplats
  signals/
    google-trends.js  automatisk hämtning
    trends-csv.js     CSV-import                                  ← delas med appen

data/
  snapshot-latest.json  det appen läser
  seed/                 publicerad referensdata
```

De fyra filerna märkta *delas med appen* importeras direkt av webbläsaren och
får därför inte innehålla något Node-specifikt. Samma trick som
`packlista/transfer.js`.

---

## Att vara ärlig om

- **Bevakningsantal finns inte**, bara ordning. Ingen siffra hittas på.
- **Växelkurserna är hårdkodade** i `core/normalize.js`. Byt mot Riksbankens
  SWEA-API när det blir skarpt.
- **Myrornas priser är alltid 1 kr** i utropspris och nollas därför bort ur
  prismedianen.
- **Δheat kräver två insamlingar.** Första körningen visar streck.
- **Trends-signalen är relativ per kategori** och går inte att jämföra mellan
  kategorier i absoluta tal.
