/**
 * esencial-providers - Nuvio scraper providers (Spanish/Latino catalog)
 *
 * Provider contract (Nuvio): getStreams(tmdbId, mediaType, season, episode) -> Stream[]
 *   Stream = { name, title, url, quality, headers? }
 *
 * QuickJS-safe: no Buffer, no node:crypto, no URL.searchParams mutation.
 * All network goes through fetch with explicit headers.
 */

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchText(url, options = {}) {
  const retries = options.retries === undefined ? 1 : options.retries;
  const headers = Object.assign(
    { 'User-Agent': DESKTOP_UA, Accept: HTML_ACCEPT },
    options.headers || {},
  );
  const doFetch = options.fetcher || fetch;
  let attempt = 0;
  for (;;) {
    let response;
    try {
      response = await doFetch(url, { method: 'GET', headers, redirect: 'follow' });
    } catch {
      return null;
    }
    const retryable = response.status === 429 || response.status === 408 || (response.status >= 500 && response.status < 600);
    if (retryable && attempt < retries) {
      attempt += 1;
      await sleep(Math.min(3200, 400 * Math.pow(2, attempt - 1)));
      continue;
    }
    if (!response.ok) return null;
    try {
      return await response.text();
    } catch {
      return null;
    }
  }
}

async function fetchJson(url, options = {}) {
  const body = await fetchText(url, Object.assign({}, options, { headers: Object.assign({ Accept: 'application/json' }, options.headers || {}) }));
  if (body === null) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

module.exports = { fetchText, fetchJson, sleep, DESKTOP_UA, HTML_ACCEPT };
