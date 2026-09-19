/** areshd - AresHD (search + language tabs + player.php), flat style. */
var ARES_BASE = 'https://areshd.com';
var ARES_HEADERS = { Referer: ARES_BASE + '/', 'Accept-Language': 'es-MX,es;q=0.9' };
var ARES_THRESHOLD = 45;

function aresCards(html) {
  var cards = [];
  var re = /<a class="Posters-link"[\s\S]*?href="([^"]+)"[\s\S]*?<img alt="([^"]+)"/g;
  var match;
  while ((match = re.exec(html)) !== null) {
    if (match[1].indexOf('guia-') !== -1) continue;
    cards.push({ href: match[1], title: match[2].trim() });
  }
  return cards;
}

function aresBestPage(html, info, isSeries) {
  var best = null;
  var cards = aresCards(html);
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var cardIsSeries = card.href.indexOf('/serie/') !== -1;
    if (isSeries !== cardIsSeries) continue;
    var score = flatScore(card.title, info.title, info.originalTitle, info.year);
    if (best === null || score > best.score) best = { href: card.href, score: score };
  }
  if (!best || best.score < ARES_THRESHOLD) return null;
  return best.href.indexOf('http') === 0 ? best.href : ARES_BASE + best.href;
}

function aresFindPage(info, isSeries) {
  var keywords = [info.title, info.originalTitle];
  function tryKeyword(index) {
    if (index >= keywords.length) return Promise.resolve(null);
    var keyword = keywords[index];
    if (!keyword) return tryKeyword(index + 1);
    return flatHtml(ARES_BASE + '/search/' + encodeURIComponent(keyword).replace(/%20/g, '+'), ARES_HEADERS).then(function (html) {
      if (html === null) return tryKeyword(index + 1);
      var page = aresBestPage(html, info, isSeries);
      return page !== null ? page : tryKeyword(index + 1);
    });
  }
  return tryKeyword(0);
}

function aresStreamsFromPage(pageUrl, seriesPageUrl) {
  return flatHtml(pageUrl, ARES_HEADERS).then(function (html) {
    if (html === null) return [];
    var languages = [];
    var langRe = /<li class="pres"><a class="playr">([^<]+)<\/a><\/li>/g;
    var langMatch;
    while ((langMatch = langRe.exec(html)) !== null) {
      var label = langMatch[1].toLowerCase();
      if (label.indexOf('latino') !== -1) languages.push('Latino');
      else if (label.indexOf('castellano') !== -1 || label.indexOf('español') !== -1) languages.push('Castellano');
      else if (label.indexOf('subtitulado') !== -1 || label.indexOf('vose') !== -1) languages.push('Subtitulado');
      else languages.push('Desconocido');
    }
    var tasks = [];
    var blockRe = /<ul class="TbVideoNv[^"]*"[^>]*>([\s\S]*?)<\/ul>/g;
    var blockMatch;
    var blockIndex = 0;
    while ((blockMatch = blockRe.exec(html)) !== null) {
      var lang = languages[blockIndex] || 'Desconocido';
      blockIndex++;
      var playerRe = /<li class="pres" data-tr="([^"]+)"/g;
      var playerMatch;
      while ((playerMatch = playerRe.exec(blockMatch[1])) !== null) tasks.push({ playerUrl: playerMatch[1], lang: lang });
    }
    var promises = tasks.map(function (task) {
      return flatHtml(task.playerUrl, { Referer: pageUrl }).then(function (playerHtml) {
        if (playerHtml === null) return null;
        var embedUrl = (playerHtml.match(/var\s+url\s*=\s*['"]([^'"]+)['"]/i) || [])[1];
        if (!embedUrl || !/^https?:\/\//.test(embedUrl) || embedUrl.indexOf('youtube') !== -1) return null;
        return flatResolveEmbed(embedUrl).then(function (resolved) {
          if (resolved === null) return null;
          var quality = resolved.quality === 'Unknown' ? 'HD' : resolved.quality;
          return {
            name: 'AresHD - ' + quality,
            title: task.lang + ' - ' + (resolved.serverName || 'AresHD') + ' ' + quality,
            url: resolved.url,
            quality: quality,
            headers: Object.assign({ 'User-Agent': FLAT_UA }, resolved.headers || {}),
          };
        });
      }).catch(function () { return null; });
    });
    return Promise.all(promises).then(function (list) {
      return list.filter(function (item) { return item !== null; });
    });
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var isSeries = mediaType === 'tv' || mediaType === 'series';
  var id = String(tmdbId === null || tmdbId === undefined ? '' : tmdbId);
  console.log('[areshd] resolving ' + id);
  return flatTmdbInfo(id, isSeries ? 'series' : 'movie').then(function (info) {
    if (info === null) return [];
    return aresFindPage(info, isSeries).then(function (pageUrl) {
      if (pageUrl === null) return [];
      if (!isSeries) return aresStreamsFromPage(pageUrl, pageUrl);
      var seriesName = (pageUrl.match(/\/serie\/([^/?]+)/) || [])[1];
      if (!seriesName || season === null || season === undefined || episode === null || episode === undefined) return [];
      var episodeUrl = ARES_BASE + '/episodio/' + seriesName + '-temporada-' + season + '-episodio-' + episode;
      return aresStreamsFromPage(episodeUrl, pageUrl);
    });
  }).catch(function (error) {
    console.log('[areshd] failed: ' + (error && error.message ? error.message : error));
    return [];
  });
}

module.exports = { getStreams: getStreams };
