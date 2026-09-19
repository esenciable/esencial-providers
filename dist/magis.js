/** magis - built flat (prelude + body), no bundler. */
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

var MAGIS_HOSTS = ["osuhk.m3x8o50te.com","oogoy.f30c96w8.com"];
var MAGIS_APP_ID = "com.android.msandroid";
var MAGIS_APK_VERSION = "49902";
var MAGIS_3DES_KEY = "e7af1ed7de1ffddd7bd3fe37ebdffde9ef3fe1ae39edfeb8";
/**
 * flat-crypto3des - DES / 3DES-EDE3-ECB and MD5 in pure JS, for the Magis portal wire format.
 * Only loaded by the providers that need it (keeps the others small).
 * Verified against node:crypto by tools/crypto-selftest.mjs.
 */

/* ------------------------------------------------------------------ MD5 */

var MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];

var MD5_K = (function () {
  var table = [];
  for (var i = 0; i < 64; i++) table.push(Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296));
  return table;
})();

function md5Bytes(input) {
  var message = typeof input === 'string' ? flatUtf8Bytes(input) : input;
  var length = message.length;
  var padded = new Uint8Array((((length + 8) >> 6) + 1) << 6);
  padded.set(message);
  padded[length] = 0x80;
  var view = new DataView(padded.buffer);
  var bits = length * 8;
  view.setUint32(padded.length - 8, bits >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bits / 0x100000000), true);

  var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (var offset = 0; offset < padded.length; offset += 64) {
    var m = [];
    for (var i = 0; i < 16; i++) m.push(view.getUint32(offset + i * 4, true));
    var a = a0, b = b0, c = c0, d = d0;
    for (var round = 0; round < 64; round++) {
      var f, g;
      if (round < 16) { f = (b & c) | (~b & d); g = round; }
      else if (round < 32) { f = (d & b) | (~d & c); g = (5 * round + 1) % 16; }
      else if (round < 48) { f = b ^ c ^ d; g = (3 * round + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * round) % 16; }
      f = (f + a + MD5_K[round] + m[g]) >>> 0;
      a = d; d = c; c = b;
      b = (b + (((f << MD5_S[round]) | (f >>> (32 - MD5_S[round]))) >>> 0)) >>> 0;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  var out = new Uint8Array(16);
  var outView = new DataView(out.buffer);
  outView.setUint32(0, a0, true);
  outView.setUint32(4, b0, true);
  outView.setUint32(8, c0, true);
  outView.setUint32(12, d0, true);
  return out;
}

function md5Hex(value) {
  return flatHex(md5Bytes(value));
}

/* ------------------------------------------------------------------ DES (base de 3DES) */

var DES_IP = [58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7];
var DES_FP = [40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25];
var DES_E = [32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17, 16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25,
  24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1];
var DES_P = [16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10, 2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25];
var DES_PC1 = [57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36,
  63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4];
var DES_PC2 = [14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2,
  41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32];
var DES_SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
var DES_SBOXES = [
  [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
];

/** Generic bit permutation over a byte array. `table` values are 1-based source bit
 * positions; the result is ceil(table.length/8) bytes. Pure byte arithmetic: no BigInt,
 * which Hermes (the TV engine) does not support. */
function desPermuteBits(source, table) {
  var out = new Uint8Array(Math.ceil(table.length / 8));
  for (var i = 0; i < table.length; i++) {
    var bitPosition = table[i] - 1;
    var bit = (source[bitPosition >> 3] >> (7 - (bitPosition & 7))) & 1;
    if (bit) out[i >> 3] |= 1 << (7 - (i & 7));
  }
  return out;
}

/** Reads `count` bits (max 28) starting at 0-based bit `start` as a Number. */
function desReadBits(source, start, count) {
  var value = 0;
  for (var i = 0; i < count; i++) {
    var bitPosition = start + i;
    var bit = (source[bitPosition >> 3] >> (7 - (bitPosition & 7))) & 1;
    value = (value << 1) | bit;
  }
  return value;
}

/** Writes `count` bits (max 28) of `value` into a byte array at 0-based bit `start`. */
function desWriteBits(target, start, count, value) {
  for (var i = 0; i < count; i++) {
    var bit = (value >> (count - 1 - i)) & 1;
    if (bit) {
      var bitPosition = start + i;
      target[bitPosition >> 3] |= 1 << (7 - (bitPosition & 7));
    }
  }
  return target;
}

function desRotateLeft28(value, shift) {
  return ((value << shift) | (value >>> (28 - shift))) & 0x0fffffff;
}

/** DES subkeys as 6-byte arrays (48 bits each) for the given 8-byte key. */
function desSubkeys(keyBytes) {
  var pc1 = desPermuteBits(keyBytes, DES_PC1);           // 56 bits = 7 bytes
  var c = desReadBits(pc1, 0, 28);
  var d = desReadBits(pc1, 28, 28);
  var subkeys = [];
  for (var round = 0; round < 16; round++) {
    var shift = DES_SHIFTS[round];
    c = desRotateLeft28(c, shift);
    d = desRotateLeft28(d, shift);
    var cd = new Uint8Array(7);
    desWriteBits(cd, 0, 28, c);
    desWriteBits(cd, 28, 28, d);
    subkeys.push(desPermuteBits(cd, DES_PC2));           // 48 bits = 6 bytes
  }
  return subkeys;
}

/** Feistel function over a 4-byte right half and a 6-byte subkey. */
function desFeistel(right, subkey) {
  var expanded = desPermuteBits(right, DES_E);           // 48 bits
  for (var i = 0; i < 6; i++) expanded[i] ^= subkey[i];
  var substituted = new Uint8Array(4);
  for (var box = 0; box < 8; box++) {
    var chunk = desReadBits(expanded, box * 6, 6);
    var row = ((chunk & 0x20) >> 4) | (chunk & 1);
    var col = (chunk >> 1) & 0x0f;
    var value = DES_SBOXES[box][row * 16 + col];
    substituted[box >> 1] |= value << ((box & 1) === 0 ? 4 : 0);
  }
  return desPermuteBits(substituted, DES_P);             // 32 bits
}

/** One 8-byte DES block, in place. */
function desBlock(block, subkeys, decrypt) {
  var permuted = desPermuteBits(block, DES_IP);
  var left = permuted.slice(0, 4);
  var right = permuted.slice(4, 8);
  for (var round = 0; round < 16; round++) {
    var subkey = subkeys[decrypt ? 15 - round : round];
    var f = desFeistel(right, subkey);
    var next = new Uint8Array(4);
    for (var i = 0; i < 4; i++) next[i] = left[i] ^ f[i];
    left = right;
    right = next;
  }
  // Pre-output is R16 || L16, then the final permutation.
  var preoutput = new Uint8Array(8);
  preoutput.set(right, 0);
  preoutput.set(left, 4);
  var out = desPermuteBits(preoutput, DES_FP);
  for (var j = 0; j < 8; j++) block[j] = out[j];
  return block;
}

function pkcs7Pad(bytes) {
  var pad = 8 - (bytes.length % 8);
  var out = new Uint8Array(bytes.length + pad);
  out.set(bytes);
  for (var i = bytes.length; i < out.length; i++) out[i] = pad;
  return out;
}

function pkcs7Unpad(bytes) {
  if (bytes.length === 0) return null;
  var pad = bytes[bytes.length - 1];
  if (pad < 1 || pad > 8 || pad > bytes.length) return null;
  for (var i = bytes.length - pad; i < bytes.length; i++) if (bytes[i] !== pad) return null;
  return bytes.subarray(0, bytes.length - pad);
}

/** 3DES-EDE3-ECB with PKCS#7 over a 24-byte key. */
function tripleDesEcb(bytes, keyBytes, decrypt) {
  var k1 = desSubkeys(keyBytes.subarray(0, 8));
  var k2 = desSubkeys(keyBytes.subarray(8, 16));
  var k3 = desSubkeys(keyBytes.subarray(16, 24));
  // Padding applies to the PLAINTEXT: pad before encrypting, unpad after decrypting
  // (never touch the ciphertext's trailing byte - that was a bug found by the self-test).
  var data = decrypt ? bytes : pkcs7Pad(bytes);
  if (data.length === 0 || data.length % 8 !== 0) return null;
  var out = new Uint8Array(data.length);
  for (var offset = 0; offset < data.length; offset += 8) {
    var block = data.subarray(offset, offset + 8);
    var step1 = desBlock(block.slice(), decrypt ? k3 : k1, decrypt);
    var step2 = desBlock(step1, k2, !decrypt);
    var step3 = desBlock(step2, decrypt ? k1 : k3, decrypt);
    out.set(step3, offset);
  }
  return decrypt ? pkcs7Unpad(out) : out;
}

/* ------------------------------------------------------------------ base64 encode + hex helpers */

function flatHexToBytes(hex) {
  var out = new Uint8Array(hex.length / 2);
  for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function flatBytesToBase64(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i += 3) {
    var b0 = bytes[i];
    var b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    var b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += FLAT_B64[b0 >> 2];
    out += FLAT_B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? FLAT_B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? FLAT_B64[b2 & 63] : '=';
  }
  return out;
}

function flatBytesToAsciiHex(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return out;
}

function flatAsciiHexToBytes(hex) {
  var out = new Uint8Array(hex.length / 2);
  for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** Magis wire: hex(base64(3DES-EDE3-ECB/PKCS7(json))) */
function magisEncryptBody(plain, keyHex) {
  var key = flatHexToBytes(keyHex);
  var encrypted = tripleDesEcb(flatUtf8Bytes(plain), key, false);
  return flatBytesToAsciiHex(flatUtf8Bytes(flatBytesToBase64(encrypted)));
}

/** Magis wire response: hex -> ascii(base64) -> 3DES decrypt -> json string */
function magisDecryptBlob(wire, keyHex) {
  var key = flatHexToBytes(keyHex);
  var base64Ascii = flatBytesToUtf8(flatAsciiHexToBytes(wire));
  var decrypted = tripleDesEcb(flatB64ToBytes(base64Ascii), key, true);
  return decrypted === null ? null : flatBytesToUtf8(decrypted);
}

/** magis - Magis VOD (portal con sesión anónima de dispositivo), flat style.
 * Constants (hosts/appId/apkVersion/3DES key) are injected by build.cjs from the operator env.
 * Crypto: pure-JS 3DES-EDE3-ECB + MD5 (lib/flat-crypto3des.js), verified against node:crypto. */

var MAGIS_HEADERS = {
  'content-type': 'application/json;charset=utf-8',
  'apk': MAGIS_APP_ID,
  'apkVer': '43404',
  'spkgVer': '2025-08-07 05:40:11_36_16_',
  'User-Agent': 'okhttp/3.12.12',
};
var MAGIS_SERIES_TYPES = { teleplay: 1, series: 1, variety: 1 };

function magisObjects(value) {
  return Array.isArray(value) ? value.filter(function (item) { return item && typeof item === 'object'; }) : [];
}

function magisDeviceFields(sn) {
  return {
    loginType: '2', appLanguage: 'en', apkVersion: MAGIS_APK_VERSION, sysVersion: '2025-08-07 05:40:11_36_16_',
    appId: MAGIS_APP_ID, hardwareInfo: 'ranchu', model: 'sdk_gphone64_arm64', product: 'sdk_gphone64_arm64',
    cpu: 'arm64-v8a', B29: '', reserve1: '', deviceToken: '', sn: sn, drmId: '', sdkVer: 36,
  };
}

/** One portal call. Walks hosts on failure; the wire body is hex(base64(3DES(json))). */
function magisCall(path, bean, session, baseFields) {
  var body = {};
  if (baseFields !== false) {
    body.portalCode = 'masnew';
    body.userId = session && session.userId ? session.userId : '';
    body.userToken = session && session.userToken ? session.userToken : '';
  }
  var beanKeys = Object.keys(bean || {});
  for (var i = 0; i < beanKeys.length; i++) body[beanKeys[i]] = bean[beanKeys[i]];
  var device = magisDeviceFields(session && session.sn ? session.sn : '');
  var deviceKeys = Object.keys(device);
  for (var j = 0; j < deviceKeys.length; j++) body[deviceKeys[j]] = device[deviceKeys[j]];

  var wire = magisEncryptBody(JSON.stringify(body), MAGIS_3DES_KEY);
  var hosts = MAGIS_HOSTS;
  var lastError = null;
  function tryHost(index) {
    if (index >= hosts.length) {
      return Promise.reject(new Error('Magis portal unavailable: ' + (lastError ? String(lastError.message || lastError) : 'unknown')));
    }
    var host = hosts[index];
    return fetch('https://' + host + '/api/portalCore/' + path, { method: 'POST', headers: MAGIS_HEADERS, body: wire })
      .then(function (response) { return response.json(); })
      .then(function (json) {
        var code = typeof json.returnCode === 'string' ? json.returnCode : '';
        if (code !== '' && code !== '0') {
          var error = new Error('Magis portal rejected request (' + code + ': path=' + path + ' host=' + host + (typeof json.errorMessage === 'string' ? ': ' + json.errorMessage : '') + ')');
          error.magisCode = code;
          throw error;
        }
        var data = typeof json.data === 'string' ? json.data : '';
        if (data === '') return json;
        var plain = magisDecryptBlob(data, MAGIS_3DES_KEY);
        if (plain === null) throw new Error('Magis blob decryption failed');
        return JSON.parse(plain);
      })
      .catch(function (error) {
        lastError = error;
        return tryHost(index + 1);
      });
  }
  return tryHost(0);
}

/** Anonymous device session: v3/snToken -> v8/active (fresh per install, nothing precomputed). */
function magisActivate() {
  return magisCall('v3/snToken', {
    hardwareInfo: 'ranchu', model: 'sdk_gphone64_arm64', product: 'sdk_gphone64_arm64', cpu: 'arm64-v8a',
  }, {}, false).then(function (tokenResponse) {
    var snToken = flatStr(tokenResponse.snToken);
    if (snToken === '') throw new Error('Magis portal returned no snToken');
    var sn = flatStr(tokenResponse.sn).toLowerCase() || md5Hex(snToken + 'ntFT65w6itH!lHCPw7D=@qnsFC5adD28').toLowerCase();
    return magisCall('v8/active', {
      snToken: snToken, authVersion: '', authCode: '', preCode: '', macAddr: '02:00:00:00:00:00',
      reserve1: '', openNum: 4, channel: 'default', matadata: '', signdata: '',
    }, { sn: sn }, false).then(function (active) {
      var userId = flatStr(active.userId);
      var userToken = flatStr(active.userToken);
      if (userId === '' || userToken === '') throw new Error('Magis activation returned no session');
      return { userId: userId, userToken: userToken };
    });
  });
}

function magisPortalQuery(title) {
  var head = String(title).split(/[:,\u2013\u2014|]/)[0].trim();
  return head.length >= 3 ? head : String(title).trim();
}

function magisTokens(value) {
  var normalized = String(value).toLowerCase();
  try { normalized = normalized.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { /* sin normalize */ }
  var matches = normalized.match(/[a-z0-9]{3,}/g) || [];
  var set = {};
  for (var i = 0; i < matches.length; i++) set[matches[i]] = true;
  return set;
}

function magisSearchItems(response) {
  var direct = magisObjects(response.searchItem);
  if (direct.length) return direct;
  var groups = magisObjects(response.searchItemList);
  var grouped = [];
  for (var i = 0; i < groups.length; i++) grouped = grouped.concat(magisObjects(groups[i].itemList));
  if (grouped.length) return grouped;
  return magisObjects(response.assetList || response.list);
}

function magisSelectCandidate(items, title, isSeries) {
  var wanted = magisTokens(title);
  function score(item) {
    var name = flatStr(item.name) || flatStr(item.viewPoint) || flatStr(item.alias);
    var itemTokens = magisTokens(name);
    var hits = 0;
    for (var key in wanted) if (wanted[key] && itemTokens[key]) hits++;
    return hits;
  }
  var compatible = items.filter(function (item) {
    var programType = flatStr(item.programType);
    if (isSeries) return MAGIS_SERIES_TYPES[programType] === 1;
    return programType === '' || MAGIS_SERIES_TYPES[programType] !== 1;
  });
  var pool = compatible.length ? compatible : items;
  var usable = pool.filter(function (item) { return flatStr(item.contentId) !== ''; });
  usable.sort(function (a, b) { return score(b) - score(a); });
  return usable.length ? usable[0] : null;
}

function magisEpisodeId(detail, wanted) {
  var data = detail && typeof detail.assetData === 'object' && detail.assetData !== null && !Array.isArray(detail.assetData) ? detail.assetData : {};
  var episodes = magisObjects(data.simpleProgramList);
  var selected = null;
  if (wanted > 0) {
    for (var i = 0; i < episodes.length; i++) if (Number(episodes[i].seriesNumber) === wanted) { selected = episodes[i]; break; }
  }
  else selected = episodes[0] || null;
  if (!selected) return null;
  return flatStr(selected.contentId) || null;
}

function magisScoreMedia(media) {
  var codec = flatStr(media.encodeFormat).toLowerCase() === 'h264' ? 0 : 2;
  var container = flatStr(media.videoFormat).toLowerCase() === 'mp4' ? 0 : 1;
  var height = Number(media.height) || 0;
  return codec * 1000 + container * 100 - height / 1000;
}

function magisBestMedia(episode) {
  var candidates = [];
  var totals = magisObjects(episode.totalMovieList);
  for (var i = 0; i < totals.length; i++) candidates = candidates.concat(magisObjects(totals[i].movieList));
  if (!candidates.length) return null;
  var best = candidates[0];
  for (var j = 1; j < candidates.length; j++) if (magisScoreMedia(candidates[j]) < magisScoreMedia(best)) best = candidates[j];
  return best;
}

function magisIsCfl(value) {
  var parts = String(value).split('&');
  for (var i = 0; i < parts.length; i++) if (parts[i].trim() === 'sign_type=cfl') return true;
  return false;
}

/** VOD CDN: cdn_list tag=vod, url_list entry free + cfl. */
function magisVodCdn(slb) {
  var cdns = magisObjects(slb.cdn_list);
  for (var i = 0; i < cdns.length; i++) {
    if (flatStr(cdns[i].tag) !== 'vod') continue;
    var urls = magisObjects(cdns[i].url_list);
    for (var j = 0; j < urls.length; j++) {
      var auth = flatStr(urls[j].url);
      var isFree = flatStr(urls[j].tag) === 'free';
      var isCfl = magisIsCfl(auth) || flatStr(urls[j].sign_type) === 'cfl';
      if (!isFree || !isCfl) continue;
      var address = flatStr(cdns[i].main_addr).replace(/\/$/, '');
      if (address !== '') return { base: address.indexOf('http') === 0 ? address : 'https://' + address, auth: auth };
    }
  }
  return null;
}

function getStreams(tmdbId, mediaType, season, episode) {
  var isSeries = mediaType === 'tv' || mediaType === 'series';
  var id = String(tmdbId === null || tmdbId === undefined ? '' : tmdbId);
  console.log('[magis] resolving ' + id);
  var state = null;

  return magisActivate()
    .then(function (activated) {
      state = activated;
      return flatTmdbInfo(id, isSeries ? 'series' : 'movie');
    })
    .then(function (info) {
      if (info === null) return null;
      var titles = [info.title, info.originalTitle].filter(function (value, index, list) {
        return value && list.indexOf(value) === index;
      });
      function tryTitle(index) {
        if (index >= titles.length) return Promise.resolve(null);
        return magisCall('v3/searchByName', {
          value: magisPortalQuery(titles[index]), type: '0', columnId: '', filter: '', pageNum: 1, pageSize: 20,
        }, state).then(function (search) {
          var selected = magisSelectCandidate(magisSearchItems(search), titles[index], isSeries);
          if (selected) return selected;
          return tryTitle(index + 1);
        }).catch(function () { return tryTitle(index + 1); });
      }
      return tryTitle(0);
    })
    .then(function (selected) {
      if (!selected) return [];
      var contentId = flatStr(selected.contentId);
      var seriesContentId = '';
      if (isSeries) {
        seriesContentId = contentId;
        return magisCall('v4/getItemData', {
          contentId: contentId, type: '0', sortType: '0', language: 'en', macAddr: '02:00:00:00:00:00',
        }, state).then(function (detail) {
          var episodeId = magisEpisodeId(detail, Number(episode) || 0);
          if (!episodeId) return [];
          contentId = episodeId;
          return magisResolve(state, contentId, seriesContentId);
        });
      }
      return magisResolve(state, contentId, seriesContentId);
    })
    .catch(function (error) {
      console.log('[magis] failed: ' + (error && error.message ? error.message : error));
      return [];
    });
}

function magisResolve(state, contentId, seriesContentId) {
  return magisCall('v10/startPlayVOD', {
    contentId: contentId, seriesContentId: seriesContentId, startTime: 0, type: '1', columnId: 0, authType: '',
  }, state).then(function (play) {
    var episodes = magisObjects(play.episodeList);
    var media = episodes.length ? magisBestMedia(episodes[0]) : null;
    if (!media) return [];
    var license = flatStr(magisObjects(media.licenseList).length ? magisObjects(media.licenseList)[0].license : '');
    if (license === '') return [];
    return magisCall('v14/getSlbInfo', {
      hasPay: '0', userIdentity: '1', type: 'merge', appVer: MAGIS_APK_VERSION, lang: 'es', encMediaSupported: 1,
      liveCodeList: ['masnew_live'], appParams: '', reserve1: '02:00:00:00:00:00', pipFlag: '0',
    }, state).then(function (slb) {
      var cdn = magisVodCdn(slb);
      if (!cdn) return [];
      var container = flatStr(media.videoFormat).toLowerCase();
      var extension = container === 'ts' ? 'ts' : 'mp4';
      var mediaId = flatStr(media.contentId) || contentId;
      return [{
        name: 'Magis VOD',
        title: 'Magis',
        url: cdn.base + '/vod/' + mediaId + '_media.' + extension,
        quality: 'Auto',
        headers: {
          'Content-Auth': cdn.auth,
          'Content-License': license,
          'User-Agent': 'Ranger/4.9.4-17294ac0',
          'App': MAGIS_APP_ID,
          'App-Version': MAGIS_APK_VERSION,
        },
      }];
    });
  });
}

module.exports = { getStreams: getStreams };
