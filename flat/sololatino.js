/** sololatino - catalog gate on sololatino.net + embed69 PoW resolution, flat style. */
var SOLO_BASE = 'https://sololatino.net';
var SOLO_HEADERS = { Referer: SOLO_BASE + '/', 'Accept-Language': 'es-MX,es;q=0.9' };
var EMBED69_BASE = 'https://embed69.org';

function soloNorm(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function soloCards(html) {
  var cleaned = html.replace(/\n|\r|\t|\s{2}|&nbsp;/g, '');
  var cards = [];
  var re = /<div class="card">([\s\S]*?)<\/div><\/div><\/a>/gi;
  var match;
  while ((match = re.exec(cleaned)) !== null) {
    var href = (match[1].match(/href="(.*?)"/) || [])[1];
    var alt = (match[1].match(/alt="(.*?)"/) || [])[1];
    if (href === undefined || alt === undefined) continue;
    if (href.indexOf('guia-solo-latino') !== -1) continue;
    cards.push({ href: href, title: alt });
  }
  return cards;
}

function soloBestMatch(html, searchTitle, isSeries) {
  var best = null;
  var cards = soloCards(html);
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var cardIsSeries = card.href.indexOf('/serie/') !== -1;
    if (isSeries !== cardIsSeries) continue;
    var na = soloNorm(card.title);
    var ns = soloNorm(searchTitle);
    var score = -1;
    if (na === ns) score = 100;
    else if (ns.length >= 6 && Math.abs(na.length - ns.length) < 8 && (na.indexOf(ns) !== -1 || ns.indexOf(na) !== -1)) score = 40;
    if (best === null || score > best.score) best = { href: card.href, score: score };
  }
  return best && best.score >= 30 ? best.href : null;
}

function soloFindPage(info, isSeries) {
  var candidates = [info.title, info.originalTitle];
  function tryCandidate(index) {
    if (index >= candidates.length) return Promise.resolve(null);
    var candidate = candidates[index];
    if (!candidate) return tryCandidate(index + 1);
    return flatHtml(SOLO_BASE + '/buscar?q=' + encodeURIComponent(candidate).replace(/%20/g, '+'), SOLO_HEADERS).then(function (html) {
      if (html === null) return tryCandidate(index + 1);
      var page = soloBestMatch(html, candidate, isSeries);
      return page !== null ? { url: page } : tryCandidate(index + 1);
    });
  }
  return tryCandidate(0);
}

function soloHasEpisode(html, season, episode) {
  var cleaned = html.replace(/\n|\r|\t|\s{2}|&nbsp;/g, '');
  return cleaned.indexOf('/temporada-' + season + '/episodio-' + episode) !== -1;
}

function getStreams(tmdbId, mediaType, season, episode) {
  var isSeries = mediaType === 'tv' || mediaType === 'series';
  var id = String(tmdbId === null || tmdbId === undefined ? '' : tmdbId);
  console.log('[sololatino] resolving ' + id);
  return flatTmdbInfo(id, isSeries ? 'series' : 'movie').then(function (info) {
    if (info === null) return [];
    return soloFindPage(info, isSeries).then(function (page) {
      if (page === null) return [];
      return flatHtml(page.url, SOLO_HEADERS).then(function (pageHtml) {
        var imdbId = info.imdbId;
        if (!imdbId && pageHtml !== null) {
          imdbId = (pageHtml.match(/imdb\.com\/title\/(tt\d+)/) || [])[1] || null;
        }
        if (!imdbId) return [];
        if (isSeries && pageHtml !== null) {
          if (season === null || season === undefined || episode === null || episode === undefined) return [];
          if (!soloHasEpisode(pageHtml, season, episode)) return [];
        }
        var suffix = isSeries
          ? imdbId + '-' + season + 'x' + String(episode).padStart(2, '0')
          : imdbId;
        return flatResolveEmbed69Page(EMBED69_BASE + '/f/' + suffix, 'SoloLatino').then(function (streams) {
          return streams.filter(function (stream) { return /\.m3u8|\.mp4|\/hls/.test(stream.url); });
        });
      });
    });
  }).catch(function (error) {
    console.log('[sololatino] failed: ' + (error && error.message ? error.message : error));
    return [];
  });
}

module.exports = { getStreams: getStreams };
