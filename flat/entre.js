/** entre - EntrePeliculas (https://entrepeliculasyseries.nz), embed69-family /vidurl/ backend, flat style. */
var VIDURL_HOST = 'https://entrepeliculasyseries.nz';
var VIDURL_BRAND = 'EntrePeliculas';

function getStreams(tmdbId, mediaType, season, episode) {
  var isSeries = mediaType === 'tv' || mediaType === 'series';
  var id = String(tmdbId === null || tmdbId === undefined ? '' : tmdbId);
  console.log('[entre] resolving ' + id);
  return flatTmdbInfo(id, isSeries ? 'series' : 'movie').then(function (info) {
    if (info === null || info.imdbId === null) return [];
    var path = '/vidurl/' + info.imdbId + '/';
    if (isSeries && season !== null && season !== undefined && episode !== null && episode !== undefined) {
      path = '/vidurl/' + info.imdbId + '-' + season + 'x' + String(episode).padStart(2, '0') + '/';
    }
    return flatResolveEmbed69Page(VIDURL_HOST + path, VIDURL_BRAND).then(function (streams) {
      return streams.filter(function (stream) { return /\.m3u8|\.mp4|\/hls/.test(stream.url); });
    });
  }).catch(function (error) {
    console.log('[entre] failed: ' + (error && error.message ? error.message : error));
    return [];
  });
}

module.exports = { getStreams: getStreams };
