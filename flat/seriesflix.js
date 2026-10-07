/** seriesflix - SeriesFlix (seriesflixhd.casa, data-url base64 + iframe unwrap), flat style. */
var SFL_BASE = 'https://seriesflixhd.casa';

function sflDecodeB64(value) {
  try { return flatBytesToUtf8(flatB64ToBytes(value)); } catch (e) { return ''; }
}

function sflUnwrap(url) {
  var match = /^https?:\/\/[^/]+\/iframe\/?\?url=([^&]+)/i.exec(url);
  if (!match) return url;
  try {
    var inner = decodeURIComponent(match[1]);
    return /^https?:\/\//i.test(inner) ? inner : url;
  } catch (e) { return url; }
}

function sflRows(html) {
  var out = [];
  var blocks = html.split('<div class="drpdn">').slice(1);
  for (var b = 0; b < blocks.length; b++) {
    var block = blocks[b];
    var langMatch = block.match(/<span>([A-ZÁÉÍÓÚÑ ]+)<span>Idioma<\/span>/);
    if (!langMatch) continue;
    var lang = langMatch[1].trim();
    var match;
    var re = /data-url="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g;
    while ((match = re.exec(block)) !== null) {
      var url = sflUnwrap(sflDecodeB64(match[1]));
      if (!/^https?:\/\//i.test(url)) continue;
      var info = ((match[2].match(/<span>[^<]*<span>([^<]*)<\/span><\/span>/) || [])[1] || '').split('\u2022');
      out.push({ url: url, lang: lang, quality: (info[0] || '').trim(), server: (info[1] || '').trim() });
    }
  }
  return out;
}

function sflLangOf(label) {
  var text = String(label || '').toLowerCase();
  if (/\b(sub|subs|vose|subtitulado|subtitulada)\b/.test(text)) return 'Subtitulado';
  if (/\b(lat|latino|latam)\b/.test(text)) return 'Latino';
  if (/\b(cast|castellano|esp)\b/.test(text)) return 'Castellano';
  return null;
}

function sflSlugCandidates(info) {
  var out = [];
  var titles = [info.title, info.originalTitle];
  for (var i = 0; i < titles.length; i++) {
    if (!titles[i]) continue;
    var slug = flatSlug(titles[i]);
    if (slug && out.indexOf(slug) === -1) out.push(slug);
  }
  return out.slice(0, 4);
}

/** Año de la página: en episodios puede ser posterior al estreno de la serie. */
function sflPageYearOk(html, info) {
  var match = html.match(/<span class="Date">(\d{4})<\/span>/);
  if (match === null) return !info.year;
  if (!info.year) return true;
  return parseInt(match[1], 10) >= info.year - 1;
}

function sflFirstPage(pathBuilder, info) {
  var candidates = sflSlugCandidates(info);
  var index = 0;
  function attempt() {
    if (index >= candidates.length) return Promise.resolve(null);
    var slug = candidates[index++];
    return flatHtml(pathBuilder(slug), { Referer: SFL_BASE + '/' }).then(function (html) {
      if (html === null || !sflPageYearOk(html, info)) return attempt();
      return html;
    });
  }
  return attempt();
}

function sflCollectStream(rows) {
  var seen = {};
  var tasks = [];
  for (var i = 0; i < rows.length && tasks.length < 8; i++) {
    var row = rows[i];
    if (sflLangOf(row.lang) === null || seen[row.url]) continue;
    seen[row.url] = true;
    tasks.push(row);
  }
  return tasks;
}

/** nupload: el .m3u8 se arma con una lista de números ofuscados + sesión, y redirige al CDN. */
function sflResolveNupload(embedUrl) {
  return flatHtml(embedUrl, { Referer: 'https://nupload.my/' }).then(function (html) {
    if (html === null) return null;
    var loopMatch = html.match(/var\s+([A-Za-z_$][\w$]*)\s*=\s*""\s*;\s*([A-Za-z_$][\w$]*)\.forEach/);
    if (!loopMatch) return null;
    var arrayMatch = html.match(new RegExp(loopMatch[2] + '\\s*=\\s*\\[([^\\]]*)\\]'));
    if (!arrayMatch) return null;
    var values = arrayMatch[1].match(/"[^"]*"/g);
    if (!values || !values.length) return null;
    var prefix = '';
    for (var i = 0; i < values.length; i++) {
      var chunk = flatBytesToUtf8(flatB64ToBytes(values[i].slice(1, -1)));
      var digits = chunk.replace(/\D/g, '');
      if (digits === '') return null;
      prefix += String.fromCharCode(parseInt(digits, 10) - 4495353);
    }
    if (!/^https?:\/\//.test(prefix)) return null;
    var session = (html.match(/sesz\s*=\s*"([^"]+)"/) || [])[1] || '';
    var target = session ? prefix + '?s=' + session : prefix;
    return fetch(target, { headers: { Referer: 'https://nupload.my/', 'User-Agent': FLAT_UA }, redirect: 'follow' })
      .then(function (response) {
        if (!response.ok) return null;
        return response.url && response.url.indexOf('http') === 0 ? response.url : target;
      }).catch(function () { return null; });
  }).catch(function () { return null; });
}

/** voe.sx (y similares) responde con un redirect JS hacia un espejo; se sigue una vez. */
function sflResolveWithRedirectHop(embedUrl, resolver) {
  return resolver(embedUrl).then(function (resolved) {
    if (resolved !== null) return resolved;
    return flatHtml(embedUrl, { Referer: 'https://seriesflixhd.casa/' }).then(function (html) {
      if (html === null) return null;
      var target = (html.match(/window\.location\.href\s*=\s*'(https?:\/\/[^']+)'/) || [])[1];
      if (!target) return null;
      return resolver(target);
    });
  });
}

function sflResolveOne(task) {
  var url = task.url;
  if (url.indexOf('nupload.') !== -1) {
    return sflResolveNupload(url).then(function (target) {
      if (target === null) return null;
      var quality = flatQualityFromUrl(target);
      return { url: target, quality: quality, serverName: 'Nupload', headers: { Referer: 'https://nupload.my/', 'User-Agent': FLAT_UA } };
    });
  }
  var family = flatFamily(url);
  var resolver = family === 'voe' ? flatResolveVoe : flatResolveEmbed;
  return sflResolveWithRedirectHop(url, resolver);
}

function getStreams(tmdbId, mediaType, season, episode) {
  var isSeries = mediaType === 'tv' || mediaType === 'series';
  var id = String(tmdbId === null || tmdbId === undefined ? '' : tmdbId);
  console.log('[seriesflix] resolving ' + id);
  if (isSeries && (season === null || season === undefined || episode === null || episode === undefined)) return Promise.resolve([]);
  return flatTmdbInfo(id, isSeries ? 'series' : 'movie').then(function (info) {
    if (info === null) return [];
    var pathBuilder = isSeries
      ? function (slug) { return SFL_BASE + '/episodio/' + slug + '-' + Number(season) + 'x' + Number(episode); }
      : function (slug) { return SFL_BASE + '/pelicula/' + slug + '/'; };
    return sflFirstPage(pathBuilder, info).then(function (html) {
      if (html === null) return [];
      var tasks = sflCollectStream(sflRows(html));
      var promises = tasks.map(function (task) {
        return sflResolveOne(task).then(function (resolved) {
          if (resolved === null) return null;
          var quality = resolved.quality === 'Unknown'
            ? (task.quality || 'HD')
            : resolved.quality;
          return {
            name: 'SeriesFlix - ' + quality,
            title: sflLangOf(task.lang) + ' - ' + (resolved.serverName || task.server || flatServerLabel(task.url)) + ' ' + quality,
            url: resolved.url,
            quality: quality,
            lang: sflLangOf(task.lang),
            headers: Object.assign({ 'User-Agent': FLAT_UA }, resolved.headers || {}),
          };
        }).catch(function () { return null; });
      });
      return Promise.all(promises).then(function (list) {
        // Ranking estilo Kino Latino: idioma, calidad (4K al final), servidor fiable, cap 10 + dedupe por URL.
        return flatRankStreams(list.filter(function (item) { return item !== null; }));
      });
    });
  }).catch(function (error) {
    console.log('[seriesflix] failed: ' + (error && error.message ? error.message : error));
    return [];
  });
}

module.exports = { getStreams: getStreams };
