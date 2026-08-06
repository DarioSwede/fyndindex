// Hövlig HTTP-klient för collectorn.
//
// Tre saker den gör som en naken fetch() inte gör, och som är skillnaden
// mellan "verktyg" och "problem för sajten vi hämtar från":
//   1. Strypning per värdnamn -- aldrig fler än en begäran i taget mot samma
//      domän, med en paus mellan.
//   2. Diskcache -- en körning som du kör om direkt efter en misslyckad
//      parsning ska inte trafikera Tradera en gång till. Under utveckling
//      läser du i praktiken från disk.
//   3. Backoff på 429/5xx i stället för att hamra vidare.
//
// Node 18+ krävs (inbyggd fetch). Ingen npm-installation alls i det här
// projektet -- det är en POC, och noll beroenden betyder noll underhåll.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

// ENDAST ASCII. Ett svenskt tecken här kostade en halvtimmes felsökning:
// undici skickar header-värden rått, och Traderas Next.js-server svarar 500
// (inte 400) på ett "ö" i user-agent. Andra sajter kan svara vad som helst.
// Frestas inte att skriva "trendöversikt" här.
const UA = "FyndindexBot/0.1 (second-hand trend overview, POC; see project README)";

const lastHit = new Map();   // värdnamn -> tidsstämpel
const queues = new Map();    // värdnamn -> Promise-kedja

export const CACHE_DIR = path.resolve("data/.cache");

/** Serialiserar anrop per värdnamn och håller minst `delayMs` mellan dem. */
function throttle(host, delayMs, task) {
  const prev = queues.get(host) || Promise.resolve();
  const next = prev.then(async () => {
    const since = Date.now() - (lastHit.get(host) || 0);
    if (since < delayMs) await sleep(delayMs - since);
    lastHit.set(host, Date.now());
    return task();
  });
  // Håll kedjan levande även om ett anrop kastar, annars fastnar värdnamnet.
  queues.set(host, next.catch(() => {}));
  return next;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.delayMs=1500]   minsta paus mellan träffar på samma domän
 * @param {number} [opts.maxAgeMs]       cachens livslängd (default 6 h)
 * @param {number} [opts.retries=3]
 * @param {object} [opts.headers]
 * @param {boolean} [opts.noCache]
 * @returns {Promise<string>} svarskroppen som text
 */
export async function fetchText(url, opts = {}) {
  const {
    delayMs = 1500,
    maxAgeMs = 6 * 60 * 60 * 1000,
    retries = 3,
    headers = {},
    noCache = false,
  } = opts;

  const key = createHash("sha1").update(url).digest("hex").slice(0, 16);
  const cacheFile = path.join(CACHE_DIR, `${key}.txt`);

  if (!noCache) {
    const cached = await readCache(cacheFile, maxAgeMs);
    if (cached !== null) return cached;
  }

  const host = new URL(url).host;
  const body = await throttle(host, delayMs, async () => {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            "user-agent": UA,
            "accept-language": "sv-SE,sv;q=0.9,en;q=0.6",
            accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
            ...headers,
          },
          redirect: "follow",
        });
        if (response.status === 429 || response.status >= 500) {
          throw new HttpError(response.status, url);
        }
        if (!response.ok) throw new HttpError(response.status, url);
        return await response.text();
      } catch (error) {
        lastError = error;
        if (attempt === retries) break;
        // 2s, 6s, 18s -- långsamt nog att en tillfällig strypning hinner släppa.
        await sleep(2000 * 3 ** attempt);
      }
    }
    throw lastError;
  });

  if (!noCache) await writeCache(cacheFile, body);
  return body;
}

export async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, {
    ...opts,
    headers: { accept: "application/json", ...(opts.headers || {}) },
  });
  return JSON.parse(text);
}

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} för ${url}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

async function readCache(file, maxAgeMs) {
  try {
    const raw = await readFile(file, "utf8");
    const split = raw.indexOf("\n");
    const savedAt = Number(raw.slice(0, split));
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > maxAgeMs) return null;
    return raw.slice(split + 1);
  } catch {
    return null;
  }
}

async function writeCache(file, body) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${Date.now()}\n${body}`, "utf8");
}
