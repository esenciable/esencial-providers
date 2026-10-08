/** hackstore-plain - HackStore (API nativa de hackstore2.com), flat style.
 * Portado del standalone providers/hackstore-plain.js (el estilo probado en TV) al formato del
 * repo: prelude compartido + cuerpo plano. Así hereda flatResolveEmbed, el ranking y el filtro
 * del dueño (flatOwnerRankOptions) en lugar de duplicar parsing. */

var HACK_BASE = 'https://hackstore2.com';

function hackApiHeaders() {
  return { Accept: 'application/json', Referer: HACK_BASE + '/', Origin: HACK_BASE, 'User-Agent': FLAT_UA };
}

function getStreams(tmdbId, mediaType, season, episode) {
  var isSeries = mediaType === 'tv' || mediaType === 'series';
  var id = String(tmdbId === null || tmdbId === undefined ? '' : tmdbId);
  console.log('[hackstore-plain] resolving ' + id + ' ' + mediaType);
  return flatTmdbInfo(id, isSeries ? 'series' : 'movie')
    .then(function (info) {
      if (info === null) return [];
      var slug = isSeries
        ? flatSlug(info.title) + '-temporada-' + season + '-episodio-' + episode
        : flatSlug(info.title, info.year);
      var postType = isSeries ? 'episodes' : 'movies';
      var singleUrl = HACK_BASE + '/api/rest/single?post_name=' + encodeURIComponent(slug) + '&post_type=' + postType;
      return flatJson(singleUrl, hackApiHeaders()).then(function (single) {
        if (single === null || !single.data) return [];
        var container = isSeries ? single.data.episode : single.data;
        if (!container || container._id === undefined) return [];
        var playerUrl = HACK_BASE + '/api/rest/player?post_id=' + encodeURIComponent(String(container._id));
        return flatJson(playerUrl, hackApiHeaders()).then(function (player) {
          var embeds = player && player.data && player.data.length ? player.data : [];
          // Resolve estilo del standalone probado en TV (providers/hackstore-plain.js): Vimeos
          // contesta con Referer https://vimeos.net/ + Accept text/html y sin reintento por i
          // (el bucle de LaMovie descartaría el master cuando Vimeos responde i=0.3).
          var resolveOpts = { referer: 'https://vimeos.net/', accept: 'text/html', firstMatch: true };
          var tasks = embeds.map(function (embed) {
            return flatResolveEmbed(embed.url, resolveOpts).then(function (resolved) {
              if (resolved === null) return null;
              var quality = resolved.quality === 'Unknown' ? 'HD' : resolved.quality;
              return {
                name: 'HackStore - ' + quality,
                title: (embed.lang || 'LAT') + ' - ' + flatServerLabel(embed.url) + ' ' + quality,
                url: resolved.url,
                quality: quality,
                headers: Object.assign({ 'User-Agent': FLAT_UA }, resolved.headers || {}),
              };
            }).catch(function () { return null; });
          });
          return Promise.all(tasks).then(function (list) {
            // Reglas del dueño (idioma + servidores permitidos + limit), definidas en el prelude.
            return flatRankStreams(list.filter(function (item) { return item !== null; }), flatOwnerRankOptions());
          });
        });
      });
    })
    .catch(function (error) {
      console.log('[hackstore-plain] failed: ' + (error && error.message ? error.message : error));
      return [];
    });
}

module.exports = { getStreams: getStreams };
