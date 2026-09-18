/**
 * cinemitas - Cinemitas (cinemitas.org, DooPlay). Slug-probe detail pages,
 * dooplay_player_option list, admin-ajax doo_player_ajax -> embed -> resolve.
 * Port of the server's src/sites/cinemitas.ts.
 */

const { fetchText, fetchJson } = require('../lib/http.js');
const { buildSlug } = require('../lib/titles.js');
const { resolveEmbed, serverLabelFor, DESKTOP_UA } = require('../lib/resolvers.js');

const BASE_URL = 'https://cinemitas.org';
const AJAX_URL = BASE_URL + '/wp-admin/admin-ajax.php';
const TMDB_KEY = '439c478a771f35c05022f9feabcca01c';

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

function parseOptions(html) {
  const options = [];
  const re = /<li[^>]*class=['"]dooplay_player_option['"]([^>]*)>([\s\S]*?)<\/li>/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const attrs = match[1];
    const post = (attrs.match(/data-post='([^']*)'/) || [])[1];
    const nume = (attrs.match(/data-nume='([^']*)'/) || [])[1];
    const type = (attrs.match(/data-type='([^']*)'/) || [])[1];
    if (post === undefined || nume === undefined || type === undefined || nume === 'trailer') continue;
    const label = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || 'Latino';
    options.push({ post, nume, type, label });
  }
  return options;
}

function extractEmbedUrl(ajaxBody) {
  if (ajaxBody.trim().charAt(0) === '<') {
    const src = ajaxBody.match(/src=["']([^"']+)["']/);
    return src !== null ? src[1] : null;
  }
  return /^https?:\/\//.test(ajaxBody.trim()) ? ajaxBody.trim() : null;
}

async function findPage(title, originalTitle, year, kind, fetcher) {
  const section = kind === 'movie' ? 'movies' : 'tvshows';
  const candidates = {};
  for (const candidateTitle of [title, originalTitle]) {
    if (candidateTitle === '' || candidateTitle === undefined) continue;
    candidates[buildSlug(candidateTitle)] = true;
    if (year !== null) candidates[buildSlug(candidateTitle, year)] = true;
  }
  for (const candidate of Object.keys(candidates)) {
    const url = BASE_URL + '/' + section + '/' + candidate + '/';
    const html = await fetchText(url, { headers: { 'User-Agent': DESKTOP_UA }, fetcher });
    if (html !== null && html.indexOf('dooplay_player_option') !== -1) return { url, html };
  }
  return null;
}

async function getStreams(tmdbId, mediaType, season, episode) {
  const type = mediaType === 'tv' || mediaType === 'series' ? 'series' : 'movie';
  const id = String(tmdbId == null ? '' : tmdbId);
  const fetcher = fetch;
  try {
    const info = await tmdbFind(id, type);
    if (info === null) return [];
    let page = await findPage(info.title, info.originalTitle, info.year, type, fetcher);
    if (page === null) return [];
    let html = page.html;
    if (type === 'series') {
      const seriesSlug = (page.url.match(/\/tvshows\/([^/]+)/) || [])[1];
      if (seriesSlug === undefined || season === null || season === undefined || episode === null || episode === undefined) return [];
      const episodeHtml = await fetchText(BASE_URL + '/episodes/' + seriesSlug + '-' + season + 'x' + episode + '/', { headers: { 'User-Agent': DESKTOP_UA }, fetcher });
      if (episodeHtml === null) return [];
      html = episodeHtml;
    }
    const options = parseOptions(html);
    const settled = await Promise.all(options.map(option => resolveOne(option, page.url, fetcher)));
    return settled.filter(stream => stream !== null);
  } catch (error) {
    console.log('[cinemitas] resolve failed: ' + (error && error.message ? error.message : error));
    return [];
  }
}

async function resolveOne(option, pageUrl, fetcher) {
  const body = 'action=doo_player_ajax&post=' + encodeURIComponent(option.post) + '&nume=' + encodeURIComponent(option.nume) + '&type=' + encodeURIComponent(option.type);
  let response;
  try {
    response = await fetcher(AJAX_URL, {
      method: 'POST',
      headers: { 'User-Agent': DESKTOP_UA, Referer: pageUrl, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const json = await response.json().catch(() => null);
  if (json === null || json.embed_url === undefined) return null;
  const embedUrl = extractEmbedUrl(json.embed_url);
  if (embedUrl === null || !/^https?:\/\//.test(embedUrl)) return null;
  const resolved = await resolveEmbed(embedUrl, fetcher).catch(() => null);
  if (resolved === null) return null;
  const quality = resolved.quality === 'Unknown' ? 'HD' : resolved.quality;
  return {
    name: 'Cinemitas - ' + quality,
    title: option.label + ' - ' + serverLabelFor(embedUrl) + ' ' + quality,
    url: resolved.url,
    quality,
    headers: Object.assign({ 'User-Agent': DESKTOP_UA }, resolved.headers || {}),
  };
}

module.exports = { getStreams };
