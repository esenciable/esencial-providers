/** embed69 - Embed69 como scraper propio: resolución por IMDB id, sin búsqueda por nombre, flat style.
 * URLs: https://embed69.org/f/<imdbId> (película) y /f/<imdbId>-<s>x<ee> (serie, episodio a 2 dígitos).
 * Referer de socio: https://sololatino.net/. El PoW + AES-256-CBC y el filtrado de descargas viven
 * en el prelude (flatResolveEmbed69Page -> flatDeriveKey / flatDecryptLink / flatCollectEmbeds);
 * aquí solo se arma la URL y se aplican las reglas del dueño al final. */

var EMBED69_BASE = 'https://embed69.org';

/** Películas: imdbId directo si viene como ttXXXX; si no, lookup de TMDB (también para series). */
function embed69ImdbId(tmdbId, isSeries) {
  var id = String(tmdbId === null || tmdbId === undefined ? '' : tmdbId);
  if (/^tt\d+$/.test(id)) return Promise.resolve(id);
  return flatTmdbInfo(id, isSeries ? 'series' : 'movie').then(function (info) {
    return info !== null && info.imdbId ? info.imdbId : null;
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var isSeries = mediaType === 'tv' || mediaType === 'series';
  console.log('[embed69] resolving ' + tmdbId);
  if (isSeries && (season === null || season === undefined || episode === null || episode === undefined)) {
    return Promise.resolve([]);
  }
  return embed69ImdbId(tmdbId, isSeries).then(function (imdbId) {
    if (!imdbId) return [];
    var suffix = isSeries
      ? imdbId + '-' + Number(season) + 'x' + String(Number(episode)).padStart(2, '0')
      : imdbId;
    // El prelude salta la página si POW_DIFFICULTY > 4 (tope para no girar SHA-256 síncrono en TV).
    return flatResolveEmbed69Page(EMBED69_BASE + '/f/' + suffix, 'Embed69').then(function (streams) {
      return flatRankStreams(streams, flatOwnerRankOptions());
    });
  }).catch(function (error) {
    console.log('[embed69] failed: ' + (error && error.message ? error.message : error));
    return [];
  });
}

module.exports = { getStreams: getStreams };
