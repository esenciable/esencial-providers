/** cinemitas - DooPlay site (slug probe + admin-ajax), flat style. */
var CINE_BASE = 'https://cinemitas.org';

function cineOptions(html) {
  var options = [];
  var re = /<li[^>]*class=['"]dooplay_player_option['"]([^>]*)>([\s\S]*?)<\/li>/g;
  var match;
  while ((match = re.exec(html)) !== null) {
    var attrs = match[1];
    var post = (attrs.match(/data-post='([^']*)'/) || [])[1];
    var nume = (attrs.match(/data-nume='([^']*)'/) || [])[1];
    var kind = (attrs.match(/data-type='([^']*)'/) || [])[1];
    if (post === undefined || nume === undefined || kind === undefined || nume === 'trailer') continue;
    var label = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || 'Latino';
    options.push({ post: post, nume: nume, type: kind, label: label });
  }
  return options;
}

function cineFindPage(info, isSeries) {
  var section = isSeries ? 'tvshows' : 'movies';
  var candidates = [];
  var titles = [info.title, info.originalTitle];
  for (var i = 0; i < titles.length; i++) {
    if (!titles[i]) continue;
    var slug = flatSlug(titles[i]);
    if (slug && candidates.indexOf(slug) === -1) candidates.push(slug);
    var slugYear = info.year ? flatSlug(titles[i], info.year) : null;
    if (slugYear && candidates.indexOf(slugYear) === -1) candidates.push(slugYear);
  }
  function tryCandidate(index) {
    if (index >= candidates.length) return Promise.resolve(null);
    var url = CINE_BASE + '/' + section + '/' + candidates[index] + '/';
    return flatHtml(url).then(function (html) {
      if (html !== null && html.indexOf('dooplay_player_option') !== -1) return { url: url, html: html };
      return tryCandidate(index + 1);
    });
  }
  return tryCandidate(0);
}

function cineResolveOption(option, pageUrl) {
  var body = 'action=doo_player_ajax&post=' + encodeURIComponent(option.post) + '&nume=' + encodeURIComponent(option.nume) + '&type=' + encodeURIComponent(option.type);
  return fetch(CINEMITAS_AJAX, {
    method: 'POST',
    headers: { 'User-Agent': FLAT_UA, Referer: pageUrl, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body,
  }).then(function (response) {
    return response.ok ? response.json() : null;
  }).then(function (json) {
    if (!json || json.embed_url === undefined) return null;
    var raw = json.embed_url.trim();
    var embedUrl = raw.charAt(0) === '<' ? (raw.match(/src=["']([^"']+)["']/) || [])[1] : raw;
    if (!embedUrl || !/^https?:\/\//.test(embedUrl)) return null;
    return flatResolveEmbed(embedUrl).then(function (resolved) {
      if (resolved === null) return null;
      var quality = resolved.quality === 'Unknown' ? 'HD' : resolved.quality;
      return {
        name: 'Cinemitas - ' + quality,
        title: option.label + ' - ' + flatServerLabel(embedUrl) + ' ' + quality,
        url: resolved.url,
        quality: quality,
        headers: Object.assign({ 'User-Agent': FLAT_UA }, resolved.headers || {}),
      };
    });
  }).catch(function () { return null; });
}

var CINEMITAS_AJAX = CINE_BASE + '/wp-admin/admin-ajax.php';

function getStreams(tmdbId, mediaType, season, episode) {
  var isSeries = mediaType === 'tv' || mediaType === 'series';
  var id = String(tmdbId === null || tmdbId === undefined ? '' : tmdbId);
  console.log('[cinemitas] resolving ' + id);
  return flatTmdbInfo(id, isSeries ? 'series' : 'movie').then(function (info) {
    if (info === null) return [];
    return cineFindPage(info, isSeries).then(function (page) {
      if (page === null) return [];
      var htmlNext = page.html;
      var pageUrl = page.url;
      var seriesSlug = (pageUrl.match(/\/tvshows\/([^/]+)/) || [])[1];
      if (isSeries) {
        if (!seriesSlug || season === null || season === undefined || episode === null || episode === undefined) return [];
        return flatHtml(CINE_BASE + '/episodes/' + seriesSlug + '-' + season + 'x' + episode + '/').then(function (episodeHtml) {
          if (episodeHtml === null) return [];
          return cineResolveOptions(episodeHtml, pageUrl);
        });
      }
      return cineResolveOptions(htmlNext, pageUrl);
    });
  }).catch(function (error) {
    console.log('[cinemitas] failed: ' + (error && error.message ? error.message : error));
    return [];
  });
}

function cineResolveOptions(html, pageUrl) {
  var options = cineOptions(html);
  var promises = options.map(function (option) { return cineResolveOption(option, pageUrl); });
  return Promise.all(promises).then(function (list) {
    return list.filter(function (item) { return item !== null; });
  });
}

module.exports = { getStreams: getStreams };
