/**
 * lamovie - LaMovie (lamovie.org) via its JSON API (the site rebuilt as a SPA; the old
 * lamovie.cc HTML scraping is dead). Flow: search q= -> score -> postId -> player embeds.
 * Port of the server's src/sites/lamovie.ts (verified 2026-09).
 */

const { fetchText, fetchJson } = require('../lib/http.js');
const { scoreCandidate } = require('../lib/titles.js');
const { resolveEmbed, serverLabelFor, DESKTOP_UA } = require('../lib/resolvers.js');

const API_BASE = 'https://lamovie.org/wp-api/v1';
const SEARCH_MAX = 16; // the site's own client truncates queries to 16 characters
const MATCH_THRESHOLD = 45;

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

async function tmdbFind(id, type) {
  const base = type === 'movie' ? 'movie' : 'tv';
  let tmdbId = null;
  if (id.indexOf('tmdb:') === 0) tmdbId = id.split(':')[1];
  else if (/^tt\d+$/.test(id)) {
    const found = await fetchJson('https://api.themoviedb.org/3/find/' + encodeURIComponent(id) + '?external_source=imdb_id&api_key=439c478a771f35c05022f9feabcca01c');
    const list = found !== null ? found[base === 'movie' ? 'movie_results' : 'tv_results'] : null;
    const first = Array.isArray(list) && typeof list[0] === 'object' ? list[0] : null;
    tmdbId = first !== null ? String(first.id) : null;
  }
  if (tmdbId === null || tmdbId === '') return null;
  const detail = await fetchJson('https://api.themoviedb.org/3/' + base + '/' + tmdbId + '?language=es-MX&api_key=439c478a771f35c05022f9feabcca01c');
  if (detail === null) return null;
  const title = stringValue(detail[base === 'movie' ? 'title' : 'name']);
  const originalTitle = stringValue(detail[base === 'movie' ? 'original_title' : 'original_name']);
  if (title === '' && originalTitle === '') return null;
  const date = stringValue(detail[base === 'movie' ? 'release_date' : 'first_air_date']);
  return { title: title || originalTitle, originalTitle: originalTitle || title, year: date === '' ? null : date.slice(0, 4) };
}

async function searchPosts(keyword, fetcher) {
  const query = keyword.slice(0, SEARCH_MAX);
  const response = await fetchJson(API_BASE + '/search?postType=any&q=' + encodeURIComponent(query) + '&postsPerPage=20', {
    headers: { Accept: 'application/json', Referer: 'https://lamovie.org/' },
    fetcher,
  });
  if (response === null || response.data === null || response.data === undefined) return [];
  return Array.isArray(response.data.posts) ? response.data.posts : [];
}

async function bestPostId(title, originalTitle, year, wantedType, fetcher) {
  for (const keyword of [title, originalTitle]) {
    if (keyword === '' || keyword === undefined) continue;
    const posts = await searchPosts(keyword, fetcher);
    let best = null;
    for (const post of posts) {
      if (post.type !== wantedType) continue;
      const score = scoreCandidate(stringValue(post.title), title, originalTitle, year);
      if (best === null || score > best.score) best = { id: String(post._id), score };
    }
    if (best !== null && best.score >= MATCH_THRESHOLD) return best.id;
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
    let postId = null;
    if (type === 'movie') {
      postId = await bestPostId(info.title, info.originalTitle, info.year, 'movies', fetcher);
    } else {
      if (season === null || season === undefined || episode === null || episode === undefined) return [];
      const showId = await bestPostId(info.title, info.originalTitle, info.year, 'tvshows', fetcher);
      if (showId === null) return [];
      const list = await fetchJson(API_BASE + '/single/episodes/list?_id=' + encodeURIComponent(showId) + '&season=' + season + '&page=1&postsPerPage=50', {
        headers: { Accept: 'application/json', Referer: 'https://lamovie.org/' },
        fetcher,
      });
      const posts = list !== null && list.data !== undefined && Array.isArray(list.data.posts) ? list.data.posts : [];
      for (const post of posts) {
        if (Number(post.season_number) === Number(season) && Number(post.episode_number) === Number(episode)) {
          postId = String(post._id);
          break;
        }
      }
    }
    if (postId === null) return [];
    const player = await fetchJson(API_BASE + '/player?postId=' + encodeURIComponent(postId) + '&demo=0', {
      headers: { Accept: 'application/json', Referer: 'https://lamovie.org/' },
      fetcher,
    });
    const data = player !== null && player.data !== undefined ? player.data : {};
    const embeds = Array.isArray(data.embeds) ? data.embeds : [];
    const latino = embeds.filter(embed => typeof embed.url === 'string' && String(embed.lang || '').toLowerCase().indexOf('latino') !== -1);
    const settled = await Promise.all(latino.map(embed => resolveOne(embed)));
    return settled.filter(stream => stream !== null);
  } catch (error) {
    console.log('[lamovie] resolve failed: ' + (error && error.message ? error.message : error));
    return [];
  }

  async function resolveOne(embed) {
    const resolved = await resolveEmbed(embed.url, fetcher).catch(() => null);
    if (resolved === null) return null;
    const quality = resolved.quality === 'Unknown' ? (embed.quality || '1080p') : resolved.quality;
    const lang = embed.lang || 'Latino';
    return {
      name: 'LaMovie - ' + quality,
      title: lang + ' - ' + serverLabelFor(embed.url) + ' ' + quality,
      url: resolved.url,
      quality,
      headers: Object.assign({ 'User-Agent': DESKTOP_UA }, resolved.headers || {}),
    };
  }
}

module.exports = { getStreams };
