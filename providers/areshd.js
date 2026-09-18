/**
 * areshd - AresHD (areshd.com). Search cards -> title match -> page -> language
 * tabs + player blocks -> player.php reveals the embed (var url) -> resolve.
 * Port of the server's src/sites/areshd.ts.
 */

const { fetchText, fetchJson } = require('../lib/http.js');
const { scoreCandidate } = require('../lib/titles.js');
const { resolveEmbed, DESKTOP_UA } = require('../lib/resolvers.js');

const BASE_URL = 'https://areshd.com';
const HEADERS = { Referer: BASE_URL + '/', 'Accept-Language': 'es-MX,es;q=0.9' };
const TMDB_KEY = '439c478a771f35c05022f9feabcca01c';
const MATCH_THRESHOLD = 45;

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
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
  const date = stringValue(detail[base === 'movie' ? 'release_date' : 'first_air_date']);
  return { title: title || originalTitle, originalTitle: originalTitle || title, year: date === '' ? null : date.slice(0, 4) };
}

function parseCards(html) {
  const cards = [];
  const re = /<a class="Posters-link"[\s\S]*?href="([^"]+)"[\s\S]*?<img alt="([^"]+)"/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    if (match[1].indexOf('guia-') !== -1) continue;
    cards.push({ href: match[1], title: match[2].trim() });
  }
  return cards;
}

function bestMatch(html, title, originalTitle, year, kind) {
  let best = null;
  for (const card of parseCards(html)) {
    const isSeries = card.href.indexOf('/serie/') !== -1;
    if ((kind === 'series') !== isSeries) continue;
    const score = scoreCandidate(card.title, title, originalTitle, year);
    if (best === null || score > best.score) best = { href: card.href, score };
  }
  if (best === null || best.score < MATCH_THRESHOLD) return null;
  return best.href.indexOf('http') === 0 ? best.href : BASE_URL + best.href;
}

function parseLanguageTabs(html) {
  const langs = [];
  const re = /<li class="pres"><a class="playr">([^<]+)<\/a><\/li>/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const label = match[1].toLowerCase();
    if (label.indexOf('latino') !== -1) langs.push('Latino');
    else if (label.indexOf('castellano') !== -1 || label.indexOf('español') !== -1) langs.push('Castellano');
    else if (label.indexOf('subtitulado') !== -1 || label.indexOf('vose') !== -1) langs.push('Subtitulado');
    else langs.push('Desconocido');
  }
  return langs;
}

function parsePlayerBlocks(html) {
  const blocks = [];
  const re = /<ul class="TbVideoNv[^"]*"[^>]*>([\s\S]*?)<\/ul>/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const players = [];
    const inner = /<li class="pres" data-tr="([^"]+)"/g;
    let m;
    while ((m = inner.exec(match[1])) !== null) players.push(m[1]);
    blocks.push(players);
  }
  return blocks;
}

async function getStreams(tmdbId, mediaType, season, episode) {
  const type = mediaType === 'tv' || mediaType === 'series' ? 'series' : 'movie';
  const id = String(tmdbId == null ? '' : tmdbId);
  const fetcher = fetch;
  try {
    const info = await tmdbFind(id, type);
    if (info === null) return [];
    let pageUrl = null;
    for (const keyword of [info.title, info.originalTitle]) {
      if (keyword === '' || keyword === undefined) continue;
      const html = await fetchText(BASE_URL + '/search/' + encodeURIComponent(keyword).replace(/%20/g, '+'), { headers: HEADERS, fetcher });
      if (html === null) continue;
      pageUrl = bestMatch(html, info.title, info.originalTitle, info.year, type);
      if (pageUrl !== null) break;
    }
    if (pageUrl === null) return [];
    let targetUrl = pageUrl;
    if (type === 'series') {
      const seriesName = (pageUrl.match(/\/serie\/([^/?]+)/) || [])[1];
      if (seriesName === undefined || season === null || season === undefined || episode === null || episode === undefined) return [];
      targetUrl = BASE_URL + '/episodio/' + seriesName + '-temporada-' + season + '-episodio-' + episode;
    }
    const pageHtml = await fetchText(targetUrl, { headers: HEADERS, fetcher });
    if (pageHtml === null) return [];
    const languages = parseLanguageTabs(pageHtml);
    const blocks = parsePlayerBlocks(pageHtml);
    const tasks = [];
    blocks.forEach((players, index) => {
      const lang = languages[index] || 'Desconocido';
      for (const playerUrl of players) tasks.push({ playerUrl, lang });
    });
    const settled = await Promise.all(tasks.map(task => resolveOne(task, pageUrl, fetcher)));
    return settled.filter(stream => stream !== null);
  } catch (error) {
    console.log('[areshd] resolve failed: ' + (error && error.message ? error.message : error));
    return [];
  }
}

async function resolveOne(task, pageUrl, fetcher) {
  const playerHtml = await fetchText(task.playerUrl, { headers: Object.assign({ Referer: pageUrl }, HEADERS), fetcher });
  if (playerHtml === null) return null;
  const embedUrl = (playerHtml.match(/var\s+url\s*=\s*['"]([^'"]+)['"]/i) || [])[1];
  if (embedUrl === undefined || !/^https?:\/\//.test(embedUrl) || embedUrl.indexOf('youtube') !== -1) return null;
  const resolved = await resolveEmbed(embedUrl, fetcher).catch(() => null);
  if (resolved === null) return null;
  const quality = resolved.quality === 'Unknown' ? 'HD' : resolved.quality;
  return {
    name: 'AresHD - ' + quality,
    title: task.lang + ' - ' + (resolved.serverName || 'AresHD') + ' ' + quality,
    url: resolved.url,
    quality,
    headers: Object.assign({ 'User-Agent': DESKTOP_UA }, resolved.headers || {}),
  };
}

module.exports = { getStreams };
