/**
 * hackstore - HackStore (hackstore2.com) via its native JSON API.
 * Flow: TMDB title/year -> slug -> /single -> /player -> embed resolution.
 * Port of the server's src/sites/hackstore.ts (verified 2026-09).
 */

const { fetchJson } = require('../lib/http.js');
const { buildSlug } = require('../lib/titles.js');
const { resolveEmbed, serverLabelFor, DESKTOP_UA } = require('../lib/resolvers.js');

const API_BASE = 'https://hackstore2.com';
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
  return {
    title: title || originalTitle,
    originalTitle: originalTitle || title,
    year: date === '' ? null : date.slice(0, 4),
  };
}

async function findPostId(slug, postType, pick, fetcher) {
  const response = await fetchJson(API_BASE + '/api/rest/single?post_name=' + encodeURIComponent(slug) + '&post_type=' + postType, {
    headers: { Accept: 'application/json', Referer: API_BASE + '/', Origin: API_BASE },
    fetcher,
  });
  if (response === null || response.data === undefined) return null;
  const container = pick(response.data);
  if (typeof container !== 'object' || container === null) return null;
  const id = container._id;
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  return String(id);
}

async function getStreams(tmdbId, mediaType, season, episode) {
  const type = mediaType === 'tv' || mediaType === 'series' ? 'series' : 'movie';
  const id = String(tmdbId == null ? '' : tmdbId);
  try {
    const info = await tmdbFind(id, type);
    if (info === null) return [];
    const slug = type === 'movie'
      ? buildSlug(info.title, info.year)
      : buildSlug(info.title) + '-temporada-' + season + '-episodio-' + episode;
    const postId = type === 'movie'
      ? await findPostId(slug, 'movies', data => data, fetch)
      : await findPostId(slug, 'episodes', data => data.episode, fetch);
    if (postId === null) return [];
    const player = await fetchJson(API_BASE + '/api/rest/player?post_id=' + encodeURIComponent(postId), {
      headers: { Accept: 'application/json', Referer: API_BASE + '/', Origin: API_BASE },
    });
    const embeds = Array.isArray(player !== null ? player.data : null) ? player.data : [];
    const settled = await Promise.all(embeds.map(embed => resolveOne(embed)));
    return settled.filter(stream => stream !== null);
  } catch (error) {
    console.log('[hackstore] resolve failed: ' + (error && error.message ? error.message : error));
    return [];
  }

  async function resolveOne(embed) {
    const url = embed.url;
    if (url === undefined || url === '') return null;
    const resolved = await resolveEmbed(url, fetch).catch(() => null);
    if (resolved === null) return null;
    const quality = resolved.quality === 'Unknown' ? 'HD' : resolved.quality;
    const lang = embed.lang || 'LAT';
    return {
      name: 'Hackstore',
      title: quality + ' · ' + lang + ' · ' + serverLabelFor(url),
      url: resolved.url,
      quality,
      headers: Object.assign({ 'User-Agent': DESKTOP_UA }, resolved.headers || {}),
    };
  }
}

module.exports = { getStreams };
