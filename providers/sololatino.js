/**
 * sololatino - SoloLatino (sololatino.net): the catalog frontend of the embed69
 * backend. Availability gate on the site's own /buscar matching, then resolution
 * via the shared PoW+AES embed69 pipeline. Movies + series (temporada/episodio scheme).
 * Port of the server's src/sites/sololatino.ts.
 */

const { fetchText, fetchJson } = require('../lib/http.js');
const { resolveEmbed, DESKTOP_UA } = require('../lib/resolvers.js');
const { deriveAesKey, collectEmbedTasks } = require('../lib/pow.js');

const BASE_URL = 'https://sololatino.net';
const EMBED69_BASE = 'https://embed69.org';
const SEARCH_HEADERS = { Referer: BASE_URL + '/', 'Accept-Language': 'es-MX,es;q=0.9' };
const TMDB_KEY = '439c478a771f35c05022f9feabcca01c';

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

function norm(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function tmdbFind(id, type) {
  const base = type === 'movie' ? 'movie' : 'tv';
  let tmdbId = null;
  if (id.indexOf('tmdb:') === 0) tmdbId = id.split(':')[1];
  else if (/^tt\d+$/.test(id)) {
    const found = await fetchJson('https://api.themoviedb.org/3/find/' + encodeURIComponent(id) + '?external_source=imdb_id&api_key=' + TMDB_KEY);
    const list = found !== null ? found[base === 'movie' ? 'movie_results' : 'tv_results'] : null;
    const first = Array.isArray(list) && typeof list[0] === 'object' ? list[0] : null;
    tmdbId = first !== null ? String(first.id) : null;
  }
  if (tmdbId === null || tmdbId === '') return null;
  const detail = await fetchJson('https://api.themoviedb.org/3/' + base + '/' + tmdbId + '?language=es-MX&api_key=' + TMDB_KEY);
  if (detail === null) return null;
  const title = stringValue(detail[base === 'movie' ? 'title' : 'name']);
  const originalTitle = stringValue(detail[base === 'movie' ? 'original_title' : 'original_name']);
  if (title === '' && originalTitle === '') return null;
  const imdbRaw = detail.external_ids !== undefined ? detail.external_ids.imdb_id : detail.imdb_id;
  const imdbId = stringValue(imdbRaw);
  return {
    title: title || originalTitle,
    originalTitle: originalTitle || title,
    imdbId: imdbId === '' ? null : imdbId,
  };
}

function parseCards(html) {
  const cleaned = html.replace(/\n|\r|\t|\s{2}|&nbsp;/g, '');
  const cards = [];
  const re = /<div class="card">([\s\S]*?)<\/div><\/div><\/a>/gi;
  let match;
  while ((match = re.exec(cleaned)) !== null) {
    const href = (match[1].match(/href="(.*?)"/) || [])[1];
    const alt = (match[1].match(/alt="(.*?)"/) || [])[1];
    if (href === undefined || alt === undefined) continue;
    if (href.indexOf('guia-solo-latino') !== -1) continue;
    cards.push({ href, title: alt });
  }
  return cards;
}

function bestSiteMatch(html, searchTitle, kind) {
  const wantSeries = kind === 'series';
  let best = null;
  for (const card of parseCards(html)) {
    const isSeries = card.href.indexOf('/serie/') !== -1;
    if (wantSeries !== isSeries) continue;
    const na = norm(card.title);
    const ns = norm(searchTitle);
    let score = -1;
    if (na === ns) score = 100;
    else if (ns.length >= 6 && Math.abs(na.length - ns.length) < 8 && (na.indexOf(ns) !== -1 || ns.indexOf(na) !== -1)) score = 40;
    if (best === null || score > best.score) best = { href: card.href, score };
  }
  return best !== null && best.score >= 30 ? best.href : null;
}

function findEpisodeUrl(seriesHtml, season, episode) {
  const cleaned = seriesHtml.replace(/\n|\r|\t|\s{2}|&nbsp;/g, '');
  const scheme = (cleaned.match(new RegExp('href="([^"]*/temporada-' + season + '/episodio-' + episode + ')"', 'i')) || [])[1];
  return scheme !== undefined ? scheme : null;
}

function extractPageImdb(html) {
  return (html.match(/imdb\.com\/title\/(tt\d+)/) || [])[1] || null;
}

async function getStreams(tmdbId, mediaType, season, episode) {
  const type = mediaType === 'tv' || mediaType === 'series' ? 'series' : 'movie';
  const id = String(tmdbId == null ? '' : tmdbId);
  const fetcher = fetch;
  try {
    const info = await tmdbFind(id, type);
    if (info === null) return [];
    // Availability gate: the title must be listed on sololatino.net.
    let pageUrl = null;
    let pageHtml = null;
    for (const candidate of [info.title, info.originalTitle]) {
      const html = await fetchText(BASE_URL + '/buscar?q=' + encodeURIComponent(candidate).replace(/%20/g, '+'), { headers: SEARCH_HEADERS, fetcher });
      if (html === null) continue;
      pageUrl = bestSiteMatch(html, candidate, type);
      if (pageUrl !== null) break;
    }
    if (pageUrl === null) return [];
    pageHtml = await fetchText(pageUrl, { headers: SEARCH_HEADERS, fetcher });
    let imdbId = info.imdbId;
    if (imdbId === null && pageHtml !== null) imdbId = extractPageImdb(pageHtml);
    if (imdbId === null) return [];
    if (type === 'series' && pageHtml !== null && season !== null && season !== undefined && episode !== null && episode !== undefined) {
      if (findEpisodeUrl(pageHtml, season, episode) === null) return [];
    }
    // embed69 backend resolution: /f/{imdb} or /f/{imdb}-{S}xEE
    const suffix = type === 'series' && season !== null && season !== undefined && episode !== null && episode !== undefined
      ? imdbId + '-' + season + 'x' + String(episode).padStart(2, '0')
      : imdbId;
    const page = await fetchText(EMBED69_BASE + '/f/' + suffix, { headers: { Referer: 'https://sololatino.net/' }, fetcher });
    if (page === null) return [];
    const payload = (page.match(/let\s+dataLink\s*=\s*((\[[\s\S]*?\])|(\{[\s\S]*?\}))\s*;/) || [])[1];
    if (payload === undefined) return [];
    const aesKey = deriveAesKey(page);
    const raw = JSON.parse(payload.replace(/\\\//g, '/'));
    const items = Array.isArray(raw) ? raw : Object.keys(raw).map(key => raw[key]);
    const tasks = collectEmbedTasks(items, aesKey);
    const settled = await Promise.all(tasks.map(task => resolveOne(task, fetcher)));
    // Direct media only, like the sources' own provider: no embed pages to the player.
    return settled.filter(stream => stream !== null && /\.m3u8|\.mp4|\/hls/.test(stream.url));
  } catch (error) {
    console.log('[sololatino] resolve failed: ' + (error && error.message ? error.message : error));
    return [];
  }
}

async function resolveOne(task, fetcher) {
  const resolved = await resolveEmbed(task.url, fetcher).catch(() => null);
  if (resolved === null) return null;
  const quality = resolved.quality === 'Unknown' ? 'HD' : resolved.quality;
  return {
    name: 'SoloLatino - ' + quality,
    title: task.lang + ' - ' + task.server + ' ' + quality,
    url: resolved.url,
    quality,
    headers: Object.assign({ 'User-Agent': DESKTOP_UA }, resolved.headers || {}),
  };
}

module.exports = { getStreams };
