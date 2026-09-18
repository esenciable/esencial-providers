/**
 * Factory for the white-label vidurl backends (megadede.mobi, entrepeliculasyseries.nz):
 * embed69-family PoW+dataLink pages under /vidurl/{imdb}[-SxEE]/ with their own branding.
 * Port of the server's src/sites/vidurl.ts.
 */

const { fetchText, fetchJson } = require('../lib/http.js');
const { resolveEmbed, DESKTOP_UA } = require('../lib/resolvers.js');
const { deriveAesKey, collectEmbedTasks } = require('../lib/pow.js');

const TMDB_KEY = '439c478a771f35c05022f9feabcca01c';

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

function createVidurlProvider(config) {
  return async function getStreams(tmdbId, mediaType, season, episode) {
    const type = mediaType === 'tv' || mediaType === 'series' ? 'series' : 'movie';
    const id = String(tmdbId == null ? '' : tmdbId);
    const fetcher = fetch;
    try {
      const info = await tmdbFind(id, type);
      if (info === null || info.imdbId === null) return [];
      const pagePath = type === 'series' && season !== null && season !== undefined && episode !== null && episode !== undefined
        ? '/vidurl/' + info.imdbId + '-' + season + 'x' + String(episode).padStart(2, '0') + '/'
        : '/vidurl/' + info.imdbId + '/';
      const html = await fetchText(config.host + pagePath, { headers: { Referer: config.host + '/' }, fetcher });
      if (html === null) return [];
      const payload = (html.match(/let\s+dataLink\s*=\s*((\[[\s\S]*?\])|(\{[\s\S]*?\}))\s*;/) || [])[1];
      if (payload === undefined) return [];
      const aesKey = deriveAesKey(html);
      const raw = JSON.parse(payload.replace(/\\\//g, '/'));
      const items = Array.isArray(raw) ? raw : Object.keys(raw).map(key => raw[key]);
      const tasks = collectEmbedTasks(items, aesKey);
      const settled = await Promise.all(tasks.map(task => resolveOne(task, fetcher)));
      return settled.filter(stream => stream !== null);
    } catch (error) {
      console.log('[' + config.id + '] resolve failed: ' + (error && error.message ? error.message : error));
      return [];
    }
  };

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
    return { title: title || originalTitle, originalTitle: originalTitle || title, imdbId: imdbId === '' ? null : imdbId };
  }

  async function resolveOne(task, fetcher) {
    const resolved = await resolveEmbed(task.url, fetcher).catch(() => null);
    if (resolved === null) return null;
    const quality = resolved.quality === 'Unknown' ? 'HD' : resolved.quality;
    return {
      name: config.brand + ' - ' + quality,
      title: task.lang + ' - ' + task.server + ' ' + quality,
      url: resolved.url,
      quality,
      headers: Object.assign({ 'User-Agent': DESKTOP_UA }, resolved.headers || {}),
    };
  }
}

module.exports = { createVidurlProvider };
