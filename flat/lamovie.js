/** lamovie - LaMovie (lamovie.org) JSON API, flat style. */
var LAMOVIE_API = 'https://lamovie.org/wp-api/v1';
var LAMOVIE_HEADERS = { Referer: 'https://lamovie.org/', Accept: 'application/json' };
var LAMOVIE_MAX = 16;
var LAMOVIE_THRESHOLD = 45;

function lamovieSearch(keyword) {
  var query = keyword.slice(0, LAMOVIE_MAX);
  return flatJson(LAMOVIE_API + '/search?postType=any&q=' + encodeURIComponent(query) + '&postsPerPage=20', LAMOVIE_HEADERS)
    .then(function (response) {
      if (!response || !response.data || !response.data.posts) return [];
      return response.data.posts;
    });
}

function lamovieBestId(info, wantedType, season, episode) {
  var keywords = [info.title, info.originalTitle];
  function tryKeyword(index) {
    if (index >= keywords.length) return Promise.resolve(null);
    var keyword = keywords[index];
    if (!keyword) return tryKeyword(index + 1);
    return lamovieSearch(keyword).then(function (posts) {
      var best = null;
      for (var i = 0; i < posts.length; i++) {
        var post = posts[i];
        if (post.type !== wantedType) continue;
        var score = flatScore(flatStr(post.title), info.title, info.originalTitle, info.year);
        if (best === null || score > best.score) best = { id: String(post._id), score: score };
      }
      if (best && best.score >= LAMOVIE_THRESHOLD) {
        if (wantedType === 'movies') return best.id;
        return lamovieEpisodeId(best.id, season, episode);
      }
      return tryKeyword(index + 1);
    });
  }
  return tryKeyword(0);
}

function lamovieEpisodeId(showId, season, episode) {
  return flatJson(LAMOVIE_API + '/single/episodes/list?_id=' + encodeURIComponent(showId) + '&season=' + season + '&page=1&postsPerPage=50', LAMOVIE_HEADERS)
    .then(function (list) {
      var posts = list && list.data && list.data.posts ? list.data.posts : [];
      for (var i = 0; i < posts.length; i++) {
        if (Number(posts[i].season_number) === Number(season) && Number(posts[i].episode_number) === Number(episode)) {
          return String(posts[i]._id);
        }
      }
      return null;
    });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var isSeries = mediaType === 'tv' || mediaType === 'series';
  var id = String(tmdbId === null || tmdbId === undefined ? '' : tmdbId);
  console.log('[lamovie] resolving ' + id);
  return flatTmdbInfo(id, isSeries ? 'series' : 'movie').then(function (info) {
    if (info === null) return [];
    if (isSeries && (season === null || season === undefined || episode === null || episode === undefined)) return [];
    return lamovieBestId(info, isSeries ? 'tvshows' : 'movies', season, episode).then(function (postId) {
      if (postId === null) return [];
      return flatJson(LAMOVIE_API + '/player?postId=' + encodeURIComponent(postId) + '&demo=0', LAMOVIE_HEADERS).then(function (player) {
        var data = player && player.data ? player.data : {};
        var embeds = data.embeds ? data.embeds : [];
        var latino = embeds.filter(function (embed) {
          return typeof embed.url === 'string' && String(embed.lang || '').toLowerCase().indexOf('latino') !== -1;
        });
        var promises = latino.map(function (embed) {
          return flatResolveEmbed(embed.url).then(function (resolved) {
            if (resolved === null) return null;
            var quality = resolved.quality === 'Unknown' ? (embed.quality || '1080p') : resolved.quality;
            return {
              name: 'LaMovie - ' + quality,
              title: (embed.lang || 'Latino') + ' - ' + flatServerLabel(embed.url) + ' ' + quality,
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
    });
  }).catch(function (error) {
    console.log('[lamovie] failed: ' + (error && error.message ? error.message : error));
    return [];
  });
}

module.exports = { getStreams: getStreams };
