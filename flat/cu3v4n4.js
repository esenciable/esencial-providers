/** cu3v4n4 - Cuevana3 (cuevana3k.pro, token XOR + Hyper/Filemoon/Nebula/Doodstream), flat style. */
var CU3_BASE = 'https://cuevana3k.pro';
var CU3_FALLBACK_KEY = 'a45f04ce-2394-47c3-b718-0ecd97ce51d6';
var CU3_SERVERS = {
  '1': { baseUrl: 'https://lkhjerbhye3wjkhodvh5xiczuvd.lol/v/', name: 'Hyper' },
  '2': { baseUrl: 'https://filemoon.sx/e/', name: 'Filemoon' },
  '3': { baseUrl: 'https://lkhjerbhye3wjkhodvh5xlczuvd.lol/e/', name: 'Nebula' },
  '4': { baseUrl: 'https://dood.li/e/', name: 'Doodstream' },
};

function cu3DecodeB64(value) {
  try { return flatBytesToUtf8(flatB64ToBytes(value)); } catch (e) { return ''; }
}

/** info TMDB que además conserva el id numérico (no usado: el sitio actual usa slugs). */
function cu3Info(id, type) {
  var base = type === 'movie' ? 'movie' : 'tv';
  var suffix = '?language=es-MX&api_key=' + FLAT_TMDB_KEY + '&append_to_response=external_ids';
  function detail(numericId) {
    return flatJson('https://api.themoviedb.org/3/' + base + '/' + encodeURIComponent(numericId) + suffix).then(function (detail) {
      var info = flatDetail(detail, type);
      if (info === null) return null;
      info.tmdbId = String(detail.id);
      return info;
    });
  }
  if (id.indexOf('tmdb:') === 0 || /^[0-9]+$/.test(id)) {
    return detail(id.indexOf('tmdb:') === 0 ? id.split(':')[1] : id);
  }
  if (!/^tt[0-9]+$/.test(id)) return Promise.resolve(null);
  return flatJson('https://api.themoviedb.org/3/find/' + encodeURIComponent(id) + '?external_source=imdb_id&api_key=' + FLAT_TMDB_KEY)
    .then(function (found) {
      if (!found) return null;
      var list = type === 'movie' ? found.movie_results : found.tv_results;
      if (!list || !list.length) return null;
      return detail(list[0].id);
    });
}

function cu3DynamicKey(html) {
  var match = html.match(/["']([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})["']/i);
  return match ? match[1] : CU3_FALLBACK_KEY;
}

function cu3WrapperUrl(raw) {
  var url = String(raw || '');
  if (url.indexOf('?v=') !== -1) {
    var decoded = cu3DecodeB64(url.split('?v=')[1]);
    if (/^https?:\/\//i.test(decoded)) url = decoded;
  }
  if (url.indexOf('//') === 0) url = 'https:' + url;
  return /^https?:\/\//i.test(url) ? url : null;
}

function cu3Wrappers(html) {
  var out = [];
  var seen = {};
  function push(url, lang) {
    if (url && !seen[url]) { seen[url] = true; out.push({ url: url, lang: lang }); }
  }
  var found = false;
  var match;
  var containerRe = /class="tab-video-item">([\s\S]*?)<div[^>]*class="tab-item-name"[^>]*>\s*([^<\n]+)[\s\S]*?<ul>([\s\S]*?)<\/ul>/gi;
  while ((match = containerRe.exec(html)) !== null) {
    found = true;
    var lang = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || 'Latino';
    var serverRe = /data-server="([^"]+)"/g;
    var serverMatch;
    while ((serverMatch = serverRe.exec(match[3])) !== null) {
      push(cu3WrapperUrl(serverMatch[1]), lang);
    }
  }
  if (!found || out.length === 0) {
    var allRe = /data-server="([^"]+)"/g;
    while ((match = allRe.exec(html)) !== null) {
      push(cu3WrapperUrl(match[1]), 'Español');
    }
  }
  return out;
}

function cu3DecodeToken(token, key) {
  var server = CU3_SERVERS[token.charAt(0)];
  var payload = token.slice(1);
  if (!server || payload === '') return null;
  var bytes;
  try { bytes = flatB64ToBytes(payload); } catch (e) { return null; }
  var decoded = '';
  for (var i = 0; i < bytes.length; i++) {
    decoded += String.fromCharCode(bytes[i] ^ key.charCodeAt(i % key.length));
  }
  return { server: server, path: decoded };
}

function cu3FindStream(code) {
  var urlMatch = code.match(/https?:\/\/[^"'\s\\]+\.(?:m3u8|mp4)[^"'\s\\]*/i);
  if (urlMatch) return urlMatch[0];
  var attrMatch = code.match(/(?:file|src|url)\s*:\s*["'](https?:\/\/[^"']+)["']/i);
  return attrMatch ? attrMatch[1] : null;
}

function cu3StreamFromHtml(html) {
  var unpacked = flatUnpackHtml(html);
  if (unpacked) {
    var stream = cu3FindStream(unpacked);
    if (stream) return stream;
  }
  return cu3FindStream(html);
}

/** Escalera .urlset/master.m3u8 -> pista h/index.m3u8 (la que exponen estos CDNs). */
function cu3FixUrl(url) {
  if (url.indexOf('.urlset/master.m3u8') !== -1) {
    return url.replace(/,[a-z,]+\.urlset\/master\.m3u8/, 'h/index.m3u8');
  }
  return url;
}

function cu3ResolveWrapper(wrapper, key) {
  var token = (wrapper.url.match(/token=([^&]+)/) || [])[1];
  if (!token) return Promise.resolve(null);
  var decoded = cu3DecodeToken(token, key);
  if (decoded === null) return Promise.resolve(null);
  var iframeUrl = decoded.server.baseUrl + decoded.path;
  var origin = (iframeUrl.match(/^(https?:\/\/[^\/]+)/i) || [null, ''])[1] || '';
  return fetch(iframeUrl, {
    headers: { Referer: wrapper.url, 'User-Agent': FLAT_UA, Accept: '*/*' },
    timeoutMs: 8000,
  }).then(function (response) {
    return response.ok ? response.text() : null;
  }).then(function (html) {
    if (html === null) return null;
    var stream = cu3StreamFromHtml(html);
    if (!stream) return null;
    stream = cu3FixUrl(stream);
    var quality = flatQualityFromUrl(stream);
    return {
      url: stream,
      quality: quality === 'Unknown' ? 'HD' : quality,
      serverName: decoded.server.name,
      lang: wrapper.lang,
      headers: { Referer: iframeUrl, Origin: origin, 'User-Agent': FLAT_UA, Accept: '*/*' },
    };
  }).catch(function () { return null; });
}

function cu3PageOk(html) {
  // La 404 blanda del sitio trae su propio HTML sin servidores.
  return html !== null && html.indexOf('data-server=') !== -1;
}

function cu3SlugCandidates(info) {
  var out = [];
  var titles = [info.title, info.originalTitle];
  for (var i = 0; i < titles.length; i++) {
    if (!titles[i]) continue;
    var slug = flatSlug(titles[i]);
    if (slug && out.indexOf(slug) === -1) out.push(slug);
  }
  return out.slice(0, 4);
}

function cu3MoviePage(info) {
  var candidates = cu3SlugCandidates(info);
  var index = 0;
  function attempt() {
    if (index >= candidates.length) return Promise.resolve(null);
    var slug = candidates[index++];
    return flatHtml(CU3_BASE + '/pelicula/' + slug, { Referer: CU3_BASE + '/' }).then(function (html) {
      if (cu3PageOk(html)) return html;
      return attempt();
    });
  }
  return attempt();
}

function cu3EpisodePage(info, season, episode) {
  var candidates = cu3SlugCandidates(info);
  var wantSeason = Number(season);
  var wantEpisode = Number(episode);
  var index = 0;
  function attempt() {
    if (index >= candidates.length) return Promise.resolve(null);
    var slug = candidates[index++];
    return flatHtml(CU3_BASE + '/serie/' + slug + '/episodio-' + wantSeason + 'x' + wantEpisode, { Referer: CU3_BASE + '/' })
      .then(function (direct) {
        if (cu3PageOk(direct)) return direct;
        // Respaldo: serie -> temporada -> episodio (por si el formato directo cambia).
        return flatHtml(CU3_BASE + '/serie/' + slug, { Referer: CU3_BASE + '/' }).then(function (serieHtml) {
          if (serieHtml === null) return attempt();
          var seasonHref = null;
          var match;
          var reSeason = /href="([^"]+\/temporada-(\d+)[^"]*)"/g;
          while ((match = reSeason.exec(serieHtml)) !== null) {
            if (Number(match[2]) === wantSeason) { seasonHref = match[1]; break; }
          }
          if (!seasonHref) return attempt();
          if (seasonHref.indexOf('http') !== 0) seasonHref = CU3_BASE + (seasonHref.charAt(0) === '/' ? '' : '/') + seasonHref;
          return flatHtml(seasonHref, { Referer: CU3_BASE + '/' }).then(function (seasonHtml) {
            if (seasonHtml === null) return attempt();
            var epHref = null;
            var reEp = new RegExp('href="([^"]+\\/episodio-' + wantSeason + 'x' + wantEpisode + '[^"]*)"', 'g');
            while ((match = reEp.exec(seasonHtml)) !== null) { epHref = match[1]; break; }
            if (!epHref) return attempt();
            if (epHref.indexOf('http') !== 0) epHref = CU3_BASE + (epHref.charAt(0) === '/' ? '' : '/') + epHref;
            return flatHtml(epHref, { Referer: CU3_BASE + '/' }).then(function (epHtml) {
              return cu3PageOk(epHtml) ? epHtml : attempt();
            });
          });
        });
      });
  }
  return attempt();
}

function getStreams(tmdbId, mediaType, season, episode) {
  var isSeries = mediaType === 'tv' || mediaType === 'series';
  var id = String(tmdbId === null || tmdbId === undefined ? '' : tmdbId);
  console.log('[cu3v4n4] resolving ' + id);
  if (isSeries && (season === null || season === undefined || episode === null || episode === undefined)) return Promise.resolve([]);
  return cu3Info(id, isSeries ? 'series' : 'movie').then(function (info) {
    if (info === null) return [];
    var pagePromise = isSeries
      ? cu3EpisodePage(info, season, episode)
      : cu3MoviePage(info);
    return pagePromise.then(function (html) {
      if (html === null) return [];
      var key = cu3DynamicKey(html);
      var wrappers = cu3Wrappers(html).slice(0, 8);
      var promises = wrappers.map(function (wrapper) {
        return cu3ResolveWrapper(wrapper, key);
      });
      return Promise.all(promises).then(function (list) {
        var seen = {};
        var out = [];
        for (var i = 0; i < list.length; i++) {
          var item = list[i];
          if (item === null || seen[item.url]) continue;
          seen[item.url] = true;
          out.push({
            name: 'Cuevana3 - ' + item.quality,
            title: item.lang + ' - ' + item.serverName + ' ' + item.quality,
            url: item.url,
            quality: item.quality,
            headers: item.headers,
          });
        }
        return out;
      });
    });
  }).catch(function (error) {
    console.log('[cu3v4n4] failed: ' + (error && error.message ? error.message : error));
    return [];
  });
}

module.exports = { getStreams: getStreams };
