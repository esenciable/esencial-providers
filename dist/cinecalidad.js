/** cinecalidad - built flat (prelude + body), no bundler. */
/**
 * flat-prelude - shared helpers for the flat providers, in the style proven on TV:
 * no bundler, no require(), no async/await, no generators. Promise chains only.
 * build.cjs concatenates this prelude with each provider body.
 */

var FLAT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var FLAT_HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
var FLAT_TMDB_KEY = '439c478a771f35c05022f9feabcca01c';

/* ------------------------------------------------------------------ texto y títulos */

function flatStr(value) {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

function flatSlug(title, year) {
  var slug = String(title || '');
  try { slug = slug.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { /* runtime sin normalize */ }
  slug = slug.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return year ? slug + '-' + year : slug;
}

var FLAT_STOPWORDS = { las: 1, los: 1, una: 1, uno: 1, del: 1, con: 1, que: 1, por: 1, para: 1, the: 1, and: 1, for: 1, from: 1, with: 1 };

function flatNormalize(title) {
  var normalized = String(title || '').toLowerCase();
  try { normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { /* keep raw */ }
  return normalized.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function flatCoverage(candidate, reference) {
  var words = reference.split(' ').filter(function (word) {
    return (word.length > 3 || /^\d+$/.test(word)) && !FLAT_STOPWORDS[word];
  });
  if (words.length === 0) return 0;
  var tokens = candidate.split(' ');
  var matched = 0;
  for (var i = 0; i < words.length; i++) if (tokens.indexOf(words[i]) !== -1) matched++;
  return matched / words.length;
}

function flatScore(candidateTitle, tmdbTitle, originalTitle, year) {
  var normCandidate = flatNormalize(candidateTitle);
  var normTmdb = flatNormalize(tmdbTitle);
  var normOriginal = flatNormalize(originalTitle || tmdbTitle);
  var score = 0;
  if (year && normCandidate.indexOf(year) !== -1) score += 50;
  score += flatCoverage(normCandidate, normTmdb) * 30;
  score += flatCoverage(normCandidate, normOriginal) * 20;
  var sequel = normTmdb.match(/\b(\d+)\s*$/);
  if (sequel && normCandidate.split(' ').indexOf(sequel[1]) === -1) score -= 100;
  var candidateYear = (normCandidate.match(/\b(19|20)\d{2}\b/) || [])[0];
  if (year && candidateYear && candidateYear !== year) score -= 60;
  return score;
}

/* ------------------------------------------------------------------ HTTP (promesas) */

function flatGet(url, headers, retries) {
  var attempts = retries === undefined ? 1 : retries;
  var count = 0;
  function attempt() {
    return fetch(url, { method: 'GET', headers: headers || {}, redirect: 'follow' })
      .then(function (response) {
        var retryable = response.status === 429 || response.status === 408 || (response.status >= 500 && response.status < 600);
        if (retryable && count < attempts) {
          count++;
          return new Promise(function (resolve) { setTimeout(resolve, 400 * count); }).then(attempt);
        }
        return response.ok ? response.text() : null;
      })
      .catch(function () { return null; });
  }
  return attempt();
}

function flatJson(url, headers) {
  return flatGet(url, Object.assign({ Accept: 'application/json' }, headers || {}))
    .then(function (text) {
      if (text === null) return null;
      try { return JSON.parse(text); } catch (e) { return null; }
    });
}

function flatHtml(url, headers) {
  return flatGet(url, Object.assign({ 'User-Agent': FLAT_UA, Accept: FLAT_HTML_ACCEPT }, headers || {}));
}

/* ------------------------------------------------------------------ TMDB */

function flatDetail(detail, type) {
  if (!detail) return null;
  var title = flatStr(type === 'movie' ? detail.title : detail.name);
  var original = flatStr(type === 'movie' ? detail.original_title : detail.original_name);
  if (title === '' && original === '') return null;
  var date = flatStr(type === 'movie' ? detail.release_date : detail.first_air_date);
  var imdbRaw = detail.external_ids ? detail.external_ids.imdb_id : detail.imdb_id;
  var imdb = flatStr(imdbRaw);
  return {
    title: title || original,
    originalTitle: original || title,
    year: date === '' ? null : date.slice(0, 4),
    imdbId: imdb === '' ? null : imdb,
  };
}

/** info(id, 'movie'|'series') -> Promise<{title, originalTitle, year, imdbId}|null> */
function flatTmdbInfo(id, type) {
  var base = type === 'movie' ? 'movie' : 'tv';
  var suffix = '?language=es-MX&api_key=' + FLAT_TMDB_KEY + '&append_to_response=external_ids';
  if (id.indexOf('tmdb:') === 0 || /^[0-9]+$/.test(id)) {
    var tmdbId = id.indexOf('tmdb:') === 0 ? id.split(':')[1] : id;
    return flatJson('https://api.themoviedb.org/3/' + base + '/' + encodeURIComponent(tmdbId) + suffix)
      .then(function (detail) { return flatDetail(detail, type); });
  }
  if (!/^tt[0-9]+$/.test(id)) return Promise.resolve(null);
  return flatJson('https://api.themoviedb.org/3/find/' + encodeURIComponent(id) + '?external_source=imdb_id&api_key=' + FLAT_TMDB_KEY)
    .then(function (found) {
      if (!found) return null;
      var list = type === 'movie' ? found.movie_results : found.tv_results;
      if (!list || !list.length) return null;
      return flatJson('https://api.themoviedb.org/3/' + base + '/' + list[0].id + suffix)
        .then(function (detail) { return flatDetail(detail, type); });
    });
}

/* ------------------------------------------------------------------ base64 / P.A.C.K.E.R. / calidad */

var FLAT_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function flatB64ToBytes(value) {
  var clean = String(value).replace(/[^A-Za-z0-9+/]/g, '');
  var out = [];
  for (var i = 0; i < clean.length; i += 4) {
    var a = FLAT_B64.indexOf(clean[i]);
    var b = FLAT_B64.indexOf(clean[i + 1]);
    var c = i + 2 < clean.length ? FLAT_B64.indexOf(clean[i + 2]) : -1;
    var d = i + 3 < clean.length ? FLAT_B64.indexOf(clean[i + 3]) : -1;
    var n = (a << 18) | (b << 12) | ((c === -1 ? 0 : c) << 6) | (d === -1 ? 0 : d);
    out.push((n >> 16) & 255);
    if (c !== -1) out.push((n >> 8) & 255);
    if (d !== -1) out.push(n & 255);
  }
  return new Uint8Array(out);
}

function flatUnpack(payload, radix, symtab) {
  var chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return payload.replace(/\b([0-9a-zA-Z]+)\b/g, function (token) {
    var value = 0;
    for (var i = 0; i < token.length; i++) {
      var pos = chars.indexOf(token[i]);
      if (pos === -1) return token;
      value = value * radix + pos;
    }
    if (!isFinite(value) || value >= symtab.length) return token;
    return symtab[value] !== '' ? symtab[value] : token;
  });
}

function flatUnpackHtml(html) {
  var match = html.match(/eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\s*\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
  if (!match) return null;
  return flatUnpack(match[1], parseInt(match[2], 10), match[4].split('|'));
}

var FLAT_QUALITY_MAPS = {
  vimeos: { h: '720p', n: '480p' },
  goodstream: { x: '1080p', h: '720p', n: '480p', l: '360p' },
  vidhide: { n: '720p', l: '480p' },
  streamwish: { x: '1080p', h: '1080p', n: '720p', l: '480p' },
  voe: { n: '720p', l: '360p' },
};

function flatQualityFromUrl(url) {
  if (!url) return 'Unknown';
  var map = null;
  if (url.indexOf('vimeos') !== -1) map = FLAT_QUALITY_MAPS.vimeos;
  else if (url.indexOf('goodstream') !== -1) map = FLAT_QUALITY_MAPS.goodstream;
  else if (url.indexOf('cloudwindow-route') !== -1) map = FLAT_QUALITY_MAPS.voe;
  else if (url.indexOf('dramiyos') !== -1 || url.indexOf('minochinos') !== -1 || url.indexOf('vidhide') !== -1 || url.indexOf('dintezuvio') !== -1 || url.indexOf('acek-cdn') !== -1) map = FLAT_QUALITY_MAPS.vidhide;
  else if (url.indexOf('premilkyway') !== -1 || url.indexOf('hlswish') !== -1 || url.indexOf('vibuxer') !== -1 || url.indexOf('streamwish') !== -1 || url.indexOf('centaurus') !== -1) map = FLAT_QUALITY_MAPS.streamwish;
  if (map) {
    var ladder = url.match(/_,([a-z,]+),\.urlset/);
    if (ladder) {
      var letters = ladder[1].split(',').filter(Boolean);
      var order = ['x', 'o', 'h', 'n', 'l'];
      for (var i = 0; i < order.length; i++) {
        if (letters.indexOf(order[i]) !== -1 && map[order[i]] !== undefined) return map[order[i]];
      }
    }
  }
  var explicit = url.match(/[_\-\/](\d{3,4})p/);
  return explicit ? explicit[1] + 'p' : 'Unknown';
}

var FLAT_FAMILIES = [
  ['voe', ['voe.sx', 'voe-sx', 'voex.sx', 'marissashare', 'cloudwindow']],
  ['streamwish', ['hlswish', 'streamwish', 'hglink', 'audinifer', 'embedwish', 'awish', 'dwish', 'strwish', 'filelions', 'wishembed', 'wishfast', 'hanerix', 'vibuxer']],
  ['vidhide', ['vidhide', 'minochinos', 'dintezuvio', 'acek-cdn', 'vedonm', 'vidhidepro', 'masukestin', 'dramiyos']],
  ['uqload', ['uqload']],
  ['zilla', ['zilla-networks']],
  ['streamtape', ['streamtape']],
  ['mp4upload', ['mp4upload']],
  ['goodstream', ['goodstream', 'gs.one']],
  ['vimeos', ['vimeos']],
  ['lacloud', ['lacloud.live']],
  ['doodstream', ['dood', 'd0000d', 'ds2video', 'ds2play', 'dsvplay']],
  ['packer', ['earnvids.com', 'earnl.one', 'vidnova.online', 'streamfort.online']],
];

function flatFamily(url) {
  var lower = String(url).toLowerCase();
  for (var i = 0; i < FLAT_FAMILIES.length; i++) {
    var hosts = FLAT_FAMILIES[i][1];
    for (var j = 0; j < hosts.length; j++) if (lower.indexOf(hosts[j]) !== -1) return FLAT_FAMILIES[i][0];
  }
  return null;
}

function flatServerLabel(url) {
  var family = flatFamily(url);
  if (family === 'streamwish') return 'StreamWish';
  if (family === 'voe') return 'VOE';
  if (family === 'goodstream') return 'GoodStream';
  if (family === 'vimeos') return 'Vimeos';
  if (family === 'vidhide') return 'VidHide';
  if (family === 'uqload') return 'Uqload';
  if (family === 'zilla') return 'Zilla';
  if (family === 'streamtape') return 'Streamtape';
  if (family === 'mp4upload') return 'MP4Upload';
  if (family === 'doodstream') return 'DoodStream';
  if (family === 'lacloud') return 'Lacloud';
  if (family === 'packer') return 'EarnVids';
  return 'Online';
}

function flatAbsolute(href, base) {
  if (href.indexOf('http') === 0) return href;
  var origin = (base.match(/^(https?:\/\/[^/]+)/) || [null, ''])[1] || '';
  return href.charAt(0) === '/' ? origin + href : origin + '/' + href;
}

/* ------------------------------------------------------------------ resolvers (promesas) */

function flatProbeQuality(url, headers) {
  return fetch(url, { headers: headers, redirect: 'follow' })
    .then(function (response) { return response.ok ? response.text() : null; })
    .then(function (text) {
      if (text === null) return flatQualityFromUrl(url);
      var best = 0;
      var re = /RESOLUTION=\d+x(\d+)/gi;
      var match;
      while ((match = re.exec(text)) !== null) {
        var height = parseInt(match[1], 10);
        if (height > best) best = height;
      }
      if (best === 0) return flatQualityFromUrl(url);
      if (best >= 2160) return '4K';
      if (best >= 1080) return '1080p';
      if (best >= 720) return '720p';
      if (best >= 480) return '480p';
      return '360p';
    })
    .catch(function () { return flatQualityFromUrl(url); });
}

function flatResolveGoodstream(embedUrl) {
  return flatHtml(embedUrl, { Referer: 'https://goodstream.one', Origin: 'https://goodstream.one' })
    .then(function (html) {
      if (html === null) return null;
      var match = html.match(/file:\s*"([^"]+)"/);
      if (!match) return null;
      return { url: match[1], quality: flatQualityFromUrl(match[1]), serverName: 'GoodStream', headers: { Referer: embedUrl, Origin: 'https://goodstream.one', 'User-Agent': FLAT_UA } };
    });
}

function flatResolveStreamWish(embedUrl) {
  var url = embedUrl.replace('hglink.to', 'vibuxer.com');
  var origin = (url.match(/^(https?:\/\/[^/]+)/) || [null, 'https://hlswish.com'])[1] || 'https://hlswish.com';
  return flatHtml(url, { Referer: 'https://embed69.org/', Origin: 'https://embed69.org' })
    .then(function (html) {
      if (html === null) return null;
      var file = html.match(/file\s*:\s*["']([^"']+)["']/i);
      if (file) {
        var target = flatAbsolute(file[1], origin);
        return { url: target, quality: flatQualityFromUrl(target), serverName: 'StreamWish', headers: { 'User-Agent': FLAT_UA, Referer: origin + '/' } };
      }
      var unpacked = flatUnpackHtml(html);
      if (unpacked) {
        var hls = unpacked.match(/\{[^{}]*"hls[234]"\s*:\s*"([^"]+)"[^{}]*\}/);
        var fromHls = hls ? hls[1] : (unpacked.match(/["']([^"']{30,}\.m3u8[^"']*)['"]/) || [])[1];
        if (fromHls) {
          var absoluteTarget = flatAbsolute(fromHls, origin);
          return { url: absoluteTarget, quality: flatQualityFromUrl(absoluteTarget), serverName: 'StreamWish', headers: { 'User-Agent': FLAT_UA, Referer: origin + '/' } };
        }
      }
      var fileCode = (url.match(/\/e\/([\w-]+)/) || [])[1];
      var pageHash = (html.match(/[0-9a-f]{32}/i) || [])[0];
      var dlThen = function (dl) {
        var fromDl = dl ? (dl.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/i) || [])[0] : undefined;
        if (fromDl) return { url: fromDl, quality: flatQualityFromUrl(fromDl), serverName: 'StreamWish', headers: { 'User-Agent': FLAT_UA, Referer: origin + '/' } };
        var raw = (html.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/i) || [])[0];
        return raw ? { url: raw, quality: flatQualityFromUrl(raw), serverName: 'StreamWish', headers: { 'User-Agent': FLAT_UA, Referer: origin + '/' } } : null;
      };
      if (fileCode && pageHash) {
        return flatGet(origin + '/dl?op=view&file_code=' + encodeURIComponent(fileCode) + '&hash=' + pageHash + '&embed=1&referer=&adb=1&hls4=1',
          { 'User-Agent': FLAT_UA, Referer: url, 'X-Requested-With': 'XMLHttpRequest' }).then(dlThen);
      }
      return dlThen(null);
    });
}

function flatResolveVoe(embedUrl) {
  return flatHtml(embedUrl, { Referer: embedUrl }).then(function (html) {
    if (html === null) return null;
    var fields = [];
    var re = /(?:mp4|hls)['"]\s*:\s*['"]([^'"]+)['"]/gi;
    var match;
    while ((match = re.exec(html)) !== null) fields.push(match[1]);
    // ROT13 + noise blob (application/json script)
    var rot13 = html.match(/<script type="application\/json">([\s\S]*?)<\/script>/);
    if (rot13) {
      var decoded = flatVoeRot13(rot13[1].trim());
      var source = decoded ? (decoded.source || decoded.direct_access_url) : null;
      if (source) return { url: source, quality: flatQualityFromUrl(source), serverName: 'VOE', headers: { Referer: embedUrl, 'User-Agent': FLAT_UA } };
    }
    for (var i = 0; i < fields.length; i++) {
      var value = fields[i];
      if (value === '') continue;
      var target = value.indexOf('aHR0') === 0 ? flatBytesToUtf8(flatB64ToBytes(value)) : value;
      return { url: target, quality: flatQualityFromUrl(target), serverName: 'VOE', headers: { Referer: embedUrl, 'User-Agent': FLAT_UA } };
    }
    return null;
  });
}

function flatVoeRot13(encoded) {
  try {
    var decoded = encoded.replace(/[a-zA-Z]/g, function (character) {
      var code = character.charCodeAt(0);
      var limit = character <= 'Z' ? 90 : 122;
      var shifted = code + 13;
      return String.fromCharCode(limit >= shifted ? shifted : shifted - 26);
    });
    var noise = ['@$', '^^', '~@', '%?', '*~', '!!', '#&'];
    for (var i = 0; i < noise.length; i++) decoded = decoded.split(noise[i]).join('');
    var first = flatBytesToUtf8(flatB64ToBytes(decoded));
    var shiftedText = '';
    for (var j = 0; j < first.length; j++) shiftedText += String.fromCharCode(first.charCodeAt(j) - 3);
    var second = flatBytesToUtf8(flatB64ToBytes(shiftedText.split('').reverse().join('')));
    return JSON.parse(second);
  } catch (e) {
    return null;
  }
}

function flatResolveVimeos(embedUrl) {
  var origin = (embedUrl.match(/^(https?:\/\/[^/]+)/) || [null, 'https://vimeos.net'])[1] || 'https://vimeos.net';
  function attempt(round) {
    if (round > 3) return Promise.resolve(null);
    return flatHtml(embedUrl, { Referer: 'https://lamovie.org/', 'Accept-Language': 'es-MX,es;q=0.9' }).then(function (html) {
      if (html === null) return null;
      var packed = html.match(/eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\s*\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
      var source = packed ? flatUnpack(packed[1], parseInt(packed[2], 10), packed[4].split('|')) : html;
      var master = (source.match(/file:"(https?:\/\/[^"]+\.m3u8[^"]*)"/) || [])[1] || (source.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/) || [])[1];
      if (!master) return null;
      var iParam = (master.match(/[?&]i=([^&]*)/) || ['', ''])[1];
      if (iParam === '0.0') {
        return { url: master, quality: flatQualityFromUrl(master), serverName: 'Vimeos', headers: { 'User-Agent': FLAT_UA, Referer: origin + '/', Origin: origin } };
      }
      return attempt(round + 1);
    });
  }
  return attempt(1);
}

function flatResolveVidhide(embedUrl) {
  var host = embedUrl.split('/')[2];
  return flatHtml(embedUrl, { Referer: 'https://' + host + '/' }).then(function (html) {
    if (html === null) return null;
    var target = (html.match(/"hls[24]"\s*:\s*"([^"]+)"/) || [])[1] || (html.match(/file\s*:\s*["']([^"']+)["']/i) || [])[1];
    if (!target) {
      var unpacked = flatUnpackHtml(html);
      target = unpacked ? (unpacked.match(/"hls[24]"\s*:\s*"([^"]+)"/) || [])[1] : null;
    }
    if (!target) return null;
    if (target.indexOf('http') !== 0) target = 'https://' + host + target;
    if (target.indexOf('referer=') === -1) target += (target.indexOf('?') === -1 ? '?' : '&') + 'referer=embed69.org';
    var headers = { Referer: embedUrl.split('?')[0], Origin: 'https://' + host, 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': FLAT_UA };
    return { url: target, quality: flatQualityFromUrl(target), serverName: 'VidHide', headers: headers };
  });
}

function flatResolveUqload(embedUrl) {
  return flatHtml(embedUrl, { Referer: 'https://uqload.com/' }).then(function (html) {
    if (html === null) return null;
    var sources = (html.match(/sources\s*[=:]\s*\[([^\]]+)\]/) || [])[1];
    if (!sources) {
      var unpacked = flatUnpackHtml(html);
      sources = unpacked ? (unpacked.match(/sources\s*[=:]\s*\[([^\]]+)\]/) || [])[1] : null;
    }
    if (!sources) return null;
    var url = (sources.match(/https?:\/\/[^\s"'<>]+/) || [])[0];
    if (!url) return null;
    return { url: url, quality: flatQualityFromUrl(url), serverName: 'Uqload', headers: { Referer: 'https://uqload.com/', 'User-Agent': FLAT_UA } };
  });
}

function flatResolveZilla(embedUrl) {
  var idMatch = embedUrl.match(/\/play\/([a-fA-F0-9]{32})/) || embedUrl.match(/\/([a-fA-F0-9]{32})/);
  var target = idMatch ? 'https://player.zilla-networks.com/m3u8/' + idMatch[1] : embedUrl.replace('/play/', '/m3u8/');
  var headers = { 'User-Agent': FLAT_UA, Referer: 'https://player.zilla-networks.com/', Origin: 'https://player.zilla-networks.com' };
  return flatProbeQuality(target, headers).then(function (quality) {
    return { url: target, quality: quality, serverName: 'Zilla', headers: headers };
  });
}

function flatResolveStreamtape(embedUrl) {
  var target = embedUrl.replace('/v/', '/e/');
  return flatHtml(target, { Referer: target }).then(function (html) {
    if (html === null) return null;
    var match = html.match(/document\.getElementById\(['"](?:robotlink|ideoolink|noroot)['"]\)\.innerHTML\s*=\s*['"]([^'"]+)['"]\s*\+\s*(?:\(['"]([^'"]+)['"]\)\.substring\((\d+)\)|['"]([^'"]+)['"])/i);
    if (!match) return null;
    var tail = match[2] !== undefined && match[3] !== undefined ? match[2].substring(parseInt(match[3], 10)) : (match[4] || '');
    var url = 'https:' + match[1] + tail;
    return { url: url, quality: flatQualityFromUrl(url), serverName: 'Streamtape', headers: { 'User-Agent': FLAT_UA, Referer: target } };
  });
}

function flatResolveMp4upload(embedUrl) {
  return flatHtml(embedUrl, { Referer: 'https://www.mp4upload.com/' }).then(function (html) {
    if (html === null) return null;
    var quality = /FHD|1080/.test(html) ? '1080p' : /HD|720/.test(html) ? '720p' : /SD|480/.test(html) ? '480p' : '1080p';
    var unpacked = flatUnpackHtml(html);
    var fromPacked = unpacked ? (unpacked.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/i) || [])[0] : null;
    var direct = fromPacked || (html.match(/https?:\/\/[a-zA-Z0-9.-]+\.mp4upload\.com(?::\d+)?\/[a-zA-Z0-9/._-]+\.mp4/i) || [])[0];
    if (!direct) return null;
    return { url: direct, quality: quality, serverName: 'MP4Upload', headers: { 'User-Agent': FLAT_UA, Referer: embedUrl } };
  });
}

/** White-label jwplayer page: unpack and pull the media URL; null when there is none. */
function flatResolveGeneric(embedUrl) {
  return flatHtml(embedUrl, { Referer: 'https://embed69.org/' }).then(function (html) {
    if (html === null) return null;
    var unpacked = flatUnpackHtml(html);
    var candidate = unpacked ? ((unpacked.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/) || [])[1] || (unpacked.match(/["']([^"']*master\.txt[^"']*)["']/) || [])[1]) : null;
    if (!candidate) candidate = (html.match(/file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i) || [])[1];
    if (!candidate) return null;
    var target = flatAbsolute(candidate, embedUrl);
    return { url: target, quality: flatQualityFromUrl(target), serverName: 'Directo', headers: { Referer: embedUrl, 'User-Agent': FLAT_UA } };
  });
}

/** resolveEmbed(embedUrl) -> Promise<{url, quality, serverName, headers}|null> */
function flatResolveEmbed(embedUrl) {
  var family = flatFamily(embedUrl);
  if (family === 'goodstream') return flatResolveGoodstream(embedUrl).catch(function () { return null; });
  if (family === 'streamwish') return flatResolveStreamWish(embedUrl).catch(function () { return null; });
  if (family === 'voe') return flatResolveVoe(embedUrl).catch(function () { return null; });
  if (family === 'vimeos') return flatResolveVimeos(embedUrl).catch(function () { return null; });
  if (family === 'vidhide') return flatResolveVidhide(embedUrl).catch(function () { return null; });
  if (family === 'uqload') return flatResolveUqload(embedUrl).catch(function () { return null; });
  if (family === 'zilla') return flatResolveZilla(embedUrl).catch(function () { return null; });
  if (family === 'streamtape') return flatResolveStreamtape(embedUrl).catch(function () { return null; });
  if (family === 'mp4upload') return flatResolveMp4upload(embedUrl).catch(function () { return null; });
  if (family === 'doodstream' || family === 'packer' || family === 'lacloud') return flatResolveGeneric(embedUrl).catch(function () { return null; });
  return flatResolveGeneric(embedUrl).catch(function () { return null; });
}

/* ------------------------------------------------------------------ PoW + AES (embed69 family) */

var FLAT_SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function flatUtf8Bytes(value) {
  var out = [];
  for (var i = 0; i < value.length; i++) {
    var code = value.charCodeAt(i);
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      var next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
        out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
      else out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
    else out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return new Uint8Array(out);
}

function flatBytesToUtf8(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var byte = bytes[i];
    if (byte < 0x80) out += String.fromCharCode(byte);
    else if (byte >= 0xc0 && byte < 0xe0) { out += String.fromCharCode(((byte & 0x1f) << 6) | (bytes[i + 1] & 0x3f)); i++; }
    else if (byte >= 0xe0 && byte < 0xf0) { out += String.fromCharCode(((byte & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)); i += 2; }
    else {
      var code = ((byte & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      var offset = code - 0x10000;
      out += String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
      i += 3;
    }
  }
  return out;
}

function flatRotr(value, bits) {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

function flatSha256(input) {
  var message = typeof input === 'string' ? flatUtf8Bytes(input) : input;
  var bitLength = message.length * 8;
  var size = (((message.length + 8) >> 6) + 1) << 6;
  var padded = new Uint8Array(size);
  padded.set(message);
  padded[message.length] = 0x80;
  var view = new DataView(padded.buffer);
  view.setUint32(size - 4, bitLength >>> 0, false);
  view.setUint32(size - 8, Math.floor(bitLength / 0x100000000), false);
  var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var w = new Uint32Array(64);
  for (var offset = 0; offset < size; offset += 64) {
    for (var i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (var k = 16; k < 64; k++) {
      var s0 = (flatRotr(w[k - 15], 7) ^ flatRotr(w[k - 15], 18) ^ (w[k - 15] >>> 3)) >>> 0;
      var s1 = (flatRotr(w[k - 2], 17) ^ flatRotr(w[k - 2], 19) ^ (w[k - 2] >>> 10)) >>> 0;
      w[k] = (w[k - 16] + s0 + w[k - 7] + s1) >>> 0;
    }
    var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (var r = 0; r < 64; r++) {
      var S1 = (flatRotr(e, 6) ^ flatRotr(e, 11) ^ flatRotr(e, 25)) >>> 0;
      var ch = ((e & f) ^ (~e & g)) >>> 0;
      var temp1 = (hh + S1 + ch + FLAT_SHA256_K[r] + w[r]) >>> 0;
      var S0 = (flatRotr(a, 2) ^ flatRotr(a, 13) ^ flatRotr(a, 22)) >>> 0;
      var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      var temp2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  var out = new Uint8Array(32);
  var outView = new DataView(out.buffer);
  for (var j = 0; j < 8; j++) outView.setUint32(j * 4, h[j], false);
  return out;
}

function flatHex(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return out;
}

var FLAT_SBOX = (function () {
  var box = new Uint8Array(256);
  var p = 1, q = 1;
  do {
    p = (p ^ ((p << 1) & 0xff) ^ ((p & 0x80) ? 0x1b : 0)) & 0xff;
    q ^= (q << 1) & 0xff; q ^= (q << 2) & 0xff; q ^= (q << 4) & 0xff; q &= 0xff;
    if (q & 0x80) q ^= 0x09;
    box[p] = (q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4)) ^ 0x63) & 0xff;
  } while (p !== 1);
  box[0] = 0x63;
  return box;
})();

var FLAT_INV_SBOX = (function () {
  var box = new Uint8Array(256);
  for (var i = 0; i < 256; i++) box[FLAT_SBOX[i]] = i;
  return box;
})();

var FLAT_RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d];

function flatXtime(value) {
  return ((value << 1) ^ ((value & 0x80) ? 0x1b : 0)) & 0xff;
}

function flatMul(a, b) {
  var result = 0, left = a, right = b;
  while (right > 0) {
    if (right & 1) result ^= left;
    left = flatXtime(left);
    right >>= 1;
  }
  return result & 0xff;
}

function flatExpandKey(key) {
  var words = new Uint32Array(60);
  var view = new DataView(key.buffer, key.byteOffset, key.byteLength);
  for (var i = 0; i < 8; i++) words[i] = view.getUint32(i * 4, false);
  for (var j = 8; j < 60; j++) {
    var temp = words[j - 1];
    if (j % 8 === 0) {
      temp = ((temp << 8) | (temp >>> 24)) >>> 0;
      temp = (((FLAT_SBOX[(temp >>> 24) & 0xff] << 24) | (FLAT_SBOX[(temp >>> 16) & 0xff] << 16) | (FLAT_SBOX[(temp >>> 8) & 0xff] << 8) | FLAT_SBOX[temp & 0xff]) >>> 0) ^ (FLAT_RCON[(j / 8) - 1] << 24);
    }
    else if (j % 8 === 4) {
      temp = ((FLAT_SBOX[(temp >>> 24) & 0xff] << 24) | (FLAT_SBOX[(temp >>> 16) & 0xff] << 16) | (FLAT_SBOX[(temp >>> 8) & 0xff] << 8) | FLAT_SBOX[temp & 0xff]) >>> 0;
    }
    words[j] = (words[j - 8] ^ temp) >>> 0;
  }
  return words;
}

function flatAddRoundKey(state, words, round) {
  var view = new DataView(state.buffer, state.byteOffset, 16);
  for (var c = 0; c < 4; c++) {
    view.setUint32(c * 4, (view.getUint32(c * 4, false) ^ (words[round * 4 + c] >>> 0)) >>> 0, false);
  }
}

function flatSubBytes(state, box) {
  for (var i = 0; i < 16; i++) state[i] = box[state[i]];
}

function flatShiftRows(state) {
  var copy = state.slice();
  for (var row = 0; row < 4; row++) for (var col = 0; col < 4; col++) state[col * 4 + row] = copy[((col + row) % 4) * 4 + row];
}

function flatInvShiftRows(state) {
  var copy = state.slice();
  for (var row = 0; row < 4; row++) for (var col = 0; col < 4; col++) state[((col + row) % 4) * 4 + row] = copy[col * 4 + row];
}

function flatMixColumns(state) {
  for (var c = 0; c < 4; c++) {
    var a0 = state[c * 4], a1 = state[c * 4 + 1], a2 = state[c * 4 + 2], a3 = state[c * 4 + 3];
    state[c * 4] = flatXtime(a0) ^ (flatXtime(a1) ^ a1) ^ a2 ^ a3;
    state[c * 4 + 1] = a0 ^ flatXtime(a1) ^ (flatXtime(a2) ^ a2) ^ a3;
    state[c * 4 + 2] = a0 ^ a1 ^ flatXtime(a2) ^ (flatXtime(a3) ^ a3);
    state[c * 4 + 3] = (flatXtime(a0) ^ a0) ^ a1 ^ a2 ^ flatXtime(a3);
  }
}

function flatInvMixColumns(state) {
  for (var c = 0; c < 4; c++) {
    var a0 = state[c * 4], a1 = state[c * 4 + 1], a2 = state[c * 4 + 2], a3 = state[c * 4 + 3];
    state[c * 4] = flatMul(a0, 14) ^ flatMul(a1, 11) ^ flatMul(a2, 13) ^ flatMul(a3, 9);
    state[c * 4 + 1] = flatMul(a0, 9) ^ flatMul(a1, 14) ^ flatMul(a2, 11) ^ flatMul(a3, 13);
    state[c * 4 + 2] = flatMul(a0, 13) ^ flatMul(a1, 9) ^ flatMul(a2, 14) ^ flatMul(a3, 11);
    state[c * 4 + 3] = flatMul(a0, 11) ^ flatMul(a1, 13) ^ flatMul(a2, 9) ^ flatMul(a3, 14);
  }
}

function flatEncryptBlock(block, words) {
  var state = block.slice();
  flatAddRoundKey(state, words, 0);
  for (var round = 1; round < 14; round++) {
    flatSubBytes(state, FLAT_SBOX); flatShiftRows(state); flatMixColumns(state); flatAddRoundKey(state, words, round);
  }
  flatSubBytes(state, FLAT_SBOX); flatShiftRows(state); flatAddRoundKey(state, words, 14);
  return state;
}

function flatDecryptBlock(block, words) {
  var state = block.slice();
  flatAddRoundKey(state, words, 14);
  for (var round = 13; round > 0; round--) {
    flatInvShiftRows(state); flatSubBytes(state, FLAT_INV_SBOX); flatAddRoundKey(state, words, round); flatInvMixColumns(state);
  }
  flatInvShiftRows(state); flatSubBytes(state, FLAT_INV_SBOX); flatAddRoundKey(state, words, 0);
  return state;
}

function flatAesCbcDecrypt(ciphertext, key, iv) {
  try {
    if (!ciphertext.length || ciphertext.length % 16 !== 0 || key.length !== 32) return null;
    var words = flatExpandKey(key);
    var out = new Uint8Array(ciphertext.length);
    var previous = iv;
    for (var offset = 0; offset < ciphertext.length; offset += 16) {
      var block = ciphertext.subarray(offset, offset + 16);
      var plain = flatDecryptBlock(block, words);
      for (var i = 0; i < 16; i++) out[offset + i] = plain[i] ^ previous[i];
      previous = block;
    }
    var pad = out[out.length - 1];
    if (pad < 1 || pad > 16) return null;
    for (var j = out.length - pad; j < out.length; j++) if (out[j] !== pad) return null;
    return flatBytesToUtf8(out.subarray(0, out.length - pad));
  } catch (e) {
    return null;
  }
}

function flatAesCtrDecrypt(ciphertext, key, iv12, start) {
  try {
    if (!ciphertext.length || key.length !== 32) return null;
    var words = flatExpandKey(key);
    var out = new Uint8Array(ciphertext.length);
    var counter = (start === undefined ? 2 : start) >>> 0;
    for (var offset = 0; offset < ciphertext.length; offset += 16) {
      var block = new Uint8Array(16);
      block.set(iv12.subarray(0, 12));
      new DataView(block.buffer).setUint32(12, counter, false);
      var keystream = flatEncryptBlock(block, words);
      var length = Math.min(16, ciphertext.length - offset);
      for (var i = 0; i < length; i++) out[offset + i] = ciphertext[offset + i] ^ keystream[i];
      counter = (counter + 1) >>> 0;
    }
    return flatBytesToUtf8(out);
  } catch (e) {
    return null;
  }
}

/** PoW: SHA256(challenge+nonce) with `difficulty` leading zeros; key = SHA256(challenge+nonce+salt). */
function flatDeriveKey(html, maxNonce) {
  var challenge = (html.match(/POW_CHALLENGE\s*=\s*['"]([^'"]+)['"]/) || [])[1];
  var difficulty = (html.match(/POW_DIFFICULTY\s*=\s*(\d+)/) || [])[1];
  var salt = (html.match(/POW_SALT\s*=\s*['"]([^'"]+)['"]/) || [])[1];
  if (challenge === undefined || difficulty === undefined || salt === undefined) return null;
  var prefix = '';
  for (var i = 0; i < parseInt(difficulty, 10); i++) prefix += '0';
  var budget = maxNonce || 500000;
  for (var nonce = 0; nonce <= budget; nonce++) {
    if (flatHex(flatSha256(challenge + String(nonce))).indexOf(prefix) === 0) {
      return flatSha256(challenge + String(nonce) + salt);
    }
  }
  return null;
}

function flatDecryptToken(token, keyBytes) {
  try {
    if (!token || !keyBytes) return null;
    if (token.indexOf('http') === 0) return token;
    var raw = flatB64ToBytes(token);
    if (raw.length <= 16) return null;
    var plain = flatAesCbcDecrypt(raw.subarray(16), keyBytes, raw.subarray(0, 16));
    return plain !== null && /^https?:\/\//i.test(plain) ? plain : null;
  } catch (e) {
    return null;
  }
}

function flatDecryptLink(token, key) {
  if (token.indexOf('http') !== -1) return token;
  if (key) {
    var decrypted = flatDecryptToken(token, key);
    if (decrypted) return decrypted;
  }
  var parts = token.split('.');
  if (parts.length === 3) {
    try {
      var payload = flatBytesToUtf8(flatB64ToBytes(parts[1]));
      var parsed = JSON.parse(payload);
      return typeof parsed.link === 'string' ? parsed.link : null;
    } catch (e) { return null; }
  }
  return null;
}

/** Embeds of an embed69-family page: language filter, token decrypt, download/dedupe filter. */
function flatCollectEmbeds(items, key) {
  var labels = { LAT: 'Latino', ESP: 'Castellano', SUB: 'Subtitulado' };
  var tasks = [];
  var seen = {};
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var language = String(item && item.video_language ? item.video_language : '').toUpperCase();
    if (labels[language] === undefined) continue;
    var embeds = item && item.sortedEmbeds ? item.sortedEmbeds : [];
    for (var j = 0; j < embeds.length; j++) {
      var embed = embeds[j];
      if (!embed || !embed.link) continue;
      var link = flatDecryptLink(embed.link, key);
      if (link === null || !/^https?:\/\//i.test(link)) continue;
      var lower = link.toLowerCase();
      var server = String(embed.servername || '').toLowerCase();
      var isDownload = server.indexOf('download') !== -1 || server.indexOf('direct') !== -1 || server.indexOf('descarga') !== -1
        || lower.indexOf('/d/') !== -1 || lower.indexOf('/download/') !== -1 || lower.indexOf('/get/') !== -1
        || lower.indexOf('mediafire.com') !== -1 || lower.indexOf('mega.nz') !== -1 || lower.indexOf('gdrive') !== -1;
      if (isDownload || seen[link]) continue;
      seen[link] = true;
      tasks.push({ url: link, hint: server, lang: labels[language], server: embed.servername || 'Servidor' });
    }
  }
  return tasks;
}

/** Full embed69-family page -> streams. pageUrl already built by the provider. */
function flatResolveEmbed69Page(pageUrl, brand) {
  return flatHtml(pageUrl, { Referer: 'https://sololatino.net/' }).then(function (html) {
    if (html === null) return [];
    var payload = (html.match(/let\s+dataLink\s*=\s*((\[[\s\S]*?\])|(\{[\s\S]*?\}))\s*;/) || [])[1];
    if (!payload) return [];
    var key = flatDeriveKey(html);
    var raw;
    try { raw = JSON.parse(payload.replace(/\\\//g, '/')); } catch (e) { return []; }
    var items = Array.isArray(raw) ? raw : Object.keys(raw).map(function (k) { return raw[k]; });
    var tasks = flatCollectEmbeds(items, key);
    var promises = tasks.map(function (task) {
      return flatResolveEmbed(task.url).then(function (resolved) {
        if (resolved === null) return null;
        var quality = resolved.quality === 'Unknown' ? 'HD' : resolved.quality;
        return {
          name: brand + ' - ' + quality,
          title: task.lang + ' - ' + task.server + ' ' + quality,
          url: resolved.url,
          quality: quality,
          headers: Object.assign({ 'User-Agent': FLAT_UA }, resolved.headers || {}),
        };
      }).catch(function () { return null; });
    });
    return Promise.all(promises).then(function (list) {
      return list.filter(function (item) { return item !== null; });
    });
  });
}

/** cinecalidad - CineCalidad (movies only, DooPlay with data-option), flat style. */
var CC_BASE = 'https://www.cinecalidad.am';

function ccOptions(html) {
  var options = [];
  var seen = {};
  var re = /<li[^>]*data-option=["']([^"']+)["'][^>]*>([\s\S]*?)<\/li>/g;
  var match;
  while ((match = re.exec(html)) !== null) {
    var url = match[1];
    if (seen[url] || !/^https?:\/\//.test(url)) continue;
    seen[url] = true;
    var text = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    options.push({ url: url, label: text === '' ? 'Online' : text });
  }
  return options;
}

function ccFindPage(info) {
  var slugs = [];
  var candidates = [info.title, info.originalTitle];
  for (var i = 0; i < candidates.length; i++) {
    var slug = flatSlug(candidates[i]);
    if (slug && slugs.indexOf(slug) === -1) slugs.push(slug);
  }
  function trySlug(index) {
    if (index >= slugs.length) return Promise.resolve(null);
    var slug = slugs[index];
    var suffixes = ['', '-2', '-3'];
    function trySuffix(s) {
      if (s >= suffixes.length) return trySlug(index + 1);
      var url = CC_BASE + '/pelicula/' + slug + suffixes[s] + '/';
      return flatHtml(url, { Referer: CC_BASE + '/' }).then(function (html) {
        if (html === null || html.indexOf('dooplay_player_option') === -1) return trySuffix(s + 1);
        var pageTitle = ((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').toLowerCase();
        if (pageTitle.indexOf(slug.split('-')[0]) !== -1) return html;
        return trySuffix(s + 1);
      });
    }
    return trySuffix(0);
  }
  return trySlug(0);
}

function getStreams(tmdbId, mediaType) {
  if (mediaType === 'tv' || mediaType === 'series') return Promise.resolve([]);
  var id = String(tmdbId === null || tmdbId === undefined ? '' : tmdbId);
  console.log('[cinecalidad] resolving ' + id);
  return flatTmdbInfo(id, 'movie').then(function (info) {
    if (info === null) return [];
    return ccFindPage(info).then(function (html) {
      if (html === null) return [];
      var options = ccOptions(html);
      var promises = options.map(function (option) {
        return flatResolveEmbed(option.url).then(function (resolved) {
          if (resolved === null) return null;
          var quality = resolved.quality === 'Unknown' ? 'HD' : resolved.quality;
          return {
            name: 'CineCalidad - ' + quality,
            title: option.label + ' - ' + flatServerLabel(option.url) + ' ' + quality,
            url: resolved.url,
            quality: quality,
            headers: Object.assign({ 'User-Agent': FLAT_UA }, resolved.headers || {}),
          };
        }).catch(function () { return null; });
      });
      return Promise.all(promises).then(function (list) {
        return list.filter(function (item) { return item !== null; });
      });
    });
  }).catch(function (error) {
    console.log('[cinecalidad] failed: ' + (error && error.message ? error.message : error));
    return [];
  });
}

module.exports = { getStreams: getStreams };
