/**
 * cinecalidad - CineCalidad (www.cinecalidad.am, movies only, DooPlay layout).
 * /pelicula/{slug}/ redirects to /ver-pelicula/; each server carries its embed URL
 * directly in a data-option attribute. Port of the server's cinecalidad.ts.
 */

const { fetchText, fetchJson } = require('../lib/http.js');
const { buildSlug } = require('../lib/titles.js');
const { resolveEmbed, serverLabelFor, DESKTOP_UA } = require('../lib/resolvers.js');

const BASE_URL = 'https://www.cinecalidad.am';
const TMDB_KEY = '439c478a771f35c05022f9feabcca01c';

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

async function tmdbFind(id) {
  if (id.indexOf('tmdb:') === 0) {
    const detail = await fetchJson('https://api.themoviedb.org/3/movie/' + id.split(':')[1] + '?language=es-MX&api_key=' + TMDB_KEY);
    if (detail === null) return null;
    const title = stringValue(detail.title) || stringValue(detail.original_title);
    return title === '' ? null : { title, originalTitle: stringValue(detail.original_title) || title };
  }
  const found = await fetchJson('https://api.themoviedb.org/3/find/' + encodeURIComponent(id) + '?external_source=imdb_id&api_key=' + TMDB_KEY);
  const first = found !== null && Array.isArray(found.movie_results) && found.movie_results.length > 0 ? found.movie_results[0] : null;
  if (first === null) return null;
  const title = stringValue(first.title) || stringValue(first.original_title);
  return title === '' ? null : { title, originalTitle: stringValue(first.original_title) || title };
}

/** Server list: data-option holds the embed URL; attribute order varies between builds. */
function parseOptions(html) {
  const options = [];
  const seen = {};
  const re = /<li[^>]*data-option=["']([^"']+)["'][^>]*>([\s\S]*?)<\/li>/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const url = match[1];
    if (seen[url] || !/^https?:\/\//.test(url)) continue;
    seen[url] = true;
    const text = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    options.push({ url, label: text === '' ? 'Online' : text });
  }
  return options;
}

async function findPage(title, originalTitle, fetcher) {
  const slugs = {};
  const candidates = [];
  for (const candidateTitle of [title, originalTitle]) {
    if (candidateTitle === '' || candidateTitle === undefined) continue;
    const slug = buildSlug(candidateTitle);
    if (slugs[slug]) continue;
    slugs[slug] = true;
    candidates.push(slug);
  }
  for (const slug of candidates) {
    for (const suffix of ['', '-2', '-3']) {
      const html = await fetchText(BASE_URL + '/pelicula/' + slug + suffix + '/', { headers: { Referer: BASE_URL + '/' }, fetcher });
      if (html === null || html.indexOf('dooplay_player_option') === -1) continue;
      const pageTitle = ((html.match(/<title>([^<]*)<\/title>/i) || ['', ''])[1]).toLowerCase();
      if (pageTitle.indexOf(slug.split('-')[0]) !== -1) return html;
    }
  }
  return null;
}

async function getStreams(tmdbId, mediaType) {
  if (mediaType === 'tv' || mediaType === 'series') return []; // movies-only site
  const id = String(tmdbId == null ? '' : tmdbId);
  const fetcher = fetch;
  try {
    const info = await tmdbFind(id);
    if (info === null) return [];
    const html = await findPage(info.title, info.originalTitle, fetcher);
    if (html === null) return [];
    const options = parseOptions(html);
    const settled = await Promise.all(options.map(option => resolveOne(option, fetcher)));
    return settled.filter(stream => stream !== null);
  } catch (error) {
    console.log('[cinecalidad] resolve failed: ' + (error && error.message ? error.message : error));
    return [];
  }
}

async function resolveOne(option, fetcher) {
  const resolved = await resolveEmbed(option.url, fetcher).catch(() => null);
  if (resolved === null) return null;
  const quality = resolved.quality === 'Unknown' ? 'HD' : resolved.quality;
  return {
    name: 'CineCalidad - ' + quality,
    title: option.label + ' - ' + serverLabelFor(option.url) + ' ' + quality,
    url: resolved.url,
    quality,
    headers: Object.assign({ 'User-Agent': DESKTOP_UA }, resolved.headers || {}),
  };
}

module.exports = { getStreams };
