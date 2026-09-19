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
