// providers/hackstore-plain.js
var API_BASE = "https://hackstore2.com";
var TMDB_KEY = "439c478a771f35c05022f9feabcca01c";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
function str(value) {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}
function slugify(title, year) {
  var slug = String(title || "");
  try {
    slug = slug.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (e) {
  }
  slug = slug.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return year ? slug + "-" + year : slug;
}
function getJson(url, headers) {
  return fetch(url, { method: "GET", headers, redirect: "follow" }).then(function(response) {
    return response.ok ? response.text() : null;
  }).then(function(text) {
    if (text === null) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }).catch(function() {
    return null;
  });
}
function tmdbFind(id, type) {
  var isTmdb = id.indexOf("tmdb:") === 0 || /^[0-9]+$/.test(id);
  var tmdbId = id.indexOf("tmdb:") === 0 ? id.split(":")[1] : id;
  if (!isTmdb && !/^tt[0-9]+$/.test(id)) return Promise.resolve(null);
  var detailUrl;
  if (isTmdb) {
    detailUrl = "https://api.themoviedb.org/3/" + (type === "movie" ? "movie" : "tv") + "/" + encodeURIComponent(tmdbId) + "?language=es-MX&api_key=" + TMDB_KEY;
    return getJson(detailUrl).then(function(detail) {
      return shapeDetail(detail, type);
    });
  }
  var findUrl = "https://api.themoviedb.org/3/find/" + encodeURIComponent(id) + "?external_source=imdb_id&api_key=" + TMDB_KEY;
  return getJson(findUrl).then(function(found) {
    if (found === null) return null;
    var list = type === "movie" ? found.movie_results : found.tv_results;
    if (!list || !list.length) return null;
    var detailUrl2 = "https://api.themoviedb.org/3/" + (type === "movie" ? "movie" : "tv") + "/" + list[0].id + "?language=es-MX&api_key=" + TMDB_KEY;
    return getJson(detailUrl2).then(function(detail) {
      return shapeDetail(detail, type);
    });
  });
}
function shapeDetail(detail, type) {
  if (detail === null || detail === void 0) return null;
  var title = str(type === "movie" ? detail.title : detail.name);
  var original = str(type === "movie" ? detail.original_title : detail.original_name);
  if (title === "" && original === "") return null;
  var date = str(type === "movie" ? detail.release_date : detail.first_air_date);
  return { title: title || original, originalTitle: original || title, year: date === "" ? null : date.slice(0, 4) };
}
function apiHeaders() {
  return { Accept: "application/json", Referer: API_BASE + "/", Origin: API_BASE, "User-Agent": UA };
}
function resolveEmbed(embedUrl) {
  var family = null;
  if (embedUrl.indexOf("goodstream") !== -1) family = "goodstream";
  else if (embedUrl.indexOf("hlswish") !== -1 || embedUrl.indexOf("streamwish") !== -1 || embedUrl.indexOf("vibuxer") !== -1) family = "streamwish";
  else if (embedUrl.indexOf("vimeos") !== -1) family = "vimeos";
  else if (embedUrl.indexOf("voe.sx") !== -1 || embedUrl.indexOf("cloudwindow") !== -1) family = "voe";
  if (family === null) return Promise.resolve(null);
  var origin = (embedUrl.match(/^(https?:\/\/[^/]+)/) || [null, ""])[1] || "";
  var headers = { "User-Agent": UA, Referer: origin + "/", Origin: origin };
  if (family === "goodstream") {
    return fetch(embedUrl, { headers: { "User-Agent": UA, Referer: "https://goodstream.one", Origin: "https://goodstream.one" }, redirect: "follow" }).then(function(r) {
      return r.ok ? r.text() : null;
    }).then(function(html) {
      if (html === null) return null;
      var m = html.match(/file:\s*"([^"]+)"/);
      return m ? { url: m[1], quality: qualityFromUrl(m[1]), serverName: "GoodStream" } : null;
    }).catch(function() {
      return null;
    });
  }
  if (family === "vimeos") {
    return fetch(embedUrl, { headers: { "User-Agent": UA, Referer: "https://vimeos.net/", Accept: "text/html" }, redirect: "follow" }).then(function(r) {
      return r.ok ? r.text() : null;
    }).then(function(html) {
      if (html === null) return null;
      var packed = html.match(/eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\s*\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
      var source = packed ? unpackPacked(packed[1], parseInt(packed[2], 10), packed[4].split("|")) : html;
      var m = source.match(/file:"(https?:\/\/[^"]+\.m3u8[^"]*)"/) || source.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/);
      return m ? { url: m[1], quality: qualityFromUrl(m[1]), serverName: "Vimeos" } : null;
    }).catch(function() {
      return null;
    });
  }
  return fetch(embedUrl, { headers, redirect: "follow" }).then(function(r) {
    return r.ok ? r.text() : null;
  }).then(function(html) {
    if (html === null) return null;
    var m = html.match(/file\s*:\s*["']([^"']+)["']/i);
    if (m) return { url: m[1], quality: qualityFromUrl(m[1]), serverName: family === "voe" ? "VOE" : "StreamWish" };
    var packed = html.match(/eval\(function\(p,a,c,k,e,[dr]\)\{.*?\}\s*\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
    if (packed) {
      var source = unpackPacked(packed[1], parseInt(packed[2], 10), packed[4].split("|"));
      var hls = source.match(/"hls[234]"\s*:\s*"([^"]+)"/) || source.match(/["']([^"']{30,}\.m3u8[^"']*)['"]/);
      if (hls) return { url: hls[1], quality: qualityFromUrl(hls[1]), serverName: family === "voe" ? "VOE" : "StreamWish" };
    }
    var raw = html.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/i);
    return raw ? { url: raw[0], quality: qualityFromUrl(raw[0]), serverName: "StreamWish" } : null;
  }).catch(function() {
    return null;
  });
}
function unpackPacked(payload, radix, symtab) {
  var chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return payload.replace(/\b([0-9a-zA-Z]+)\b/g, function(token) {
    var value = 0;
    for (var i = 0; i < token.length; i++) {
      var pos = chars.indexOf(token[i]);
      if (pos === -1) return token;
      value = value * radix + pos;
    }
    if (!isFinite(value) || value >= symtab.length) return token;
    return symtab[value] !== "" ? symtab[value] : token;
  });
}
function qualityFromUrl(url) {
  var m = url.match(/[_\-\/](\d{3,4})p/);
  if (m) return m[1] + "p";
  if (url.indexOf("goodstream") !== -1) {
    var ladder = url.match(/_,([a-z,]+),\.urlset/);
    if (ladder) {
      var letters = ladder[1].split(",");
      if (letters.indexOf("x") !== -1) return "1080p";
      if (letters.indexOf("h") !== -1) return "720p";
    }
    return "720p";
  }
  return "HD";
}
function serverLabel(url) {
  if (url.indexOf("goodstream") !== -1) return "GoodStream";
  if (url.indexOf("hlswish") !== -1 || url.indexOf("streamwish") !== -1 || url.indexOf("vibuxer") !== -1) return "StreamWish";
  if (url.indexOf("vimeos") !== -1) return "Vimeos";
  if (url.indexOf("voe") !== -1) return "VOE";
  return "Online";
}
function getStreams(tmdbId, mediaType, season, episode) {
  var isSeries = mediaType === "tv" || mediaType === "series";
  var id = String(tmdbId === null || tmdbId === void 0 ? "" : tmdbId);
  console.log("[hackstore-plain] resolving " + id + " " + mediaType);
  return tmdbFind(id, isSeries ? "series" : "movie").then(function(info) {
    if (info === null) return [];
    var slug = isSeries ? slugify(info.title) + "-temporada-" + season + "-episodio-" + episode : slugify(info.title, info.year);
    var postType = isSeries ? "episodes" : "movies";
    var singleUrl = API_BASE + "/api/rest/single?post_name=" + encodeURIComponent(slug) + "&post_type=" + postType;
    return getJson(singleUrl, apiHeaders()).then(function(single) {
      if (single === null || !single.data) return [];
      var container = isSeries ? single.data.episode : single.data;
      if (!container || container._id === void 0) return [];
      var playerUrl = API_BASE + "/api/rest/player?post_id=" + encodeURIComponent(String(container._id));
      return getJson(playerUrl, apiHeaders()).then(function(player) {
        var embeds = player && player.data && player.data.length ? player.data : [];
        var tasks = embeds.map(function(embed) {
          return resolveEmbed(embed.url).then(function(resolved) {
            if (resolved === null) return null;
            var quality = resolved.quality === "Unknown" ? "HD" : resolved.quality;
            return {
              name: "Hackstore (plain) - " + quality,
              title: (embed.lang || "LAT") + " - " + serverLabel(embed.url) + " " + quality,
              url: resolved.url,
              quality,
              headers: { "User-Agent": UA, Referer: embed.url }
            };
          }).catch(function() {
            return null;
          });
        });
        return Promise.all(tasks).then(function(list) {
          return list.filter(function(item) {
            return item !== null;
          });
        });
      });
    });
  }).catch(function(error) {
    console.log("[hackstore-plain] failed: " + (error && error.message ? error.message : error));
    return [];
  });
}
module.exports = { getStreams };
