/** magis - Magis VOD (portal con sesión anónima de dispositivo), flat style.
 * Portal logic lives in lib/flat-magis-core.js (shared with the diagnostic). */

function getStreams(tmdbId, mediaType, season, episode) {
  var isSeries = mediaType === 'tv' || mediaType === 'series';
  var id = String(tmdbId === null || tmdbId === undefined ? '' : tmdbId);
  console.log('[magis] resolving ' + id);
  var state = null;
  // S4: el mint de sesión y el lookup de TMDB no se dependen -> en paralelo (ahorra ~180 ms local,
  // ~350 ms en el Mi Box). Promise.all conserva el comportamiento de error: si cualquiera falla,
  // el catch de abajo devuelve [] igual que antes.
  return Promise.all([magisActivate(), flatTmdbInfo(id, isSeries ? 'series' : 'movie')])
    .then(function (results) {
      state = results[0];
      var info = results[1];
      if (info === null) return null;
      var titles = [info.title, info.originalTitle].filter(function (value, index, list) {
        return value && list.indexOf(value) === index;
      });
      // El año de TMDB (YYYY o null) alimenta la verificación de releaseTime en la selección
      // de candidatos: un candidato de otro año no gana (regla documentada en flat-magis-core).
      var year = info.year;
      function tryTitle(index) {
        if (index >= titles.length) return Promise.resolve(null);
        return magisCall('v3/searchByName', {
          value: magisPortalQuery(titles[index]), type: '0', columnId: '', filter: '', pageNum: 1, pageSize: 10,
        }, state).then(function (search) {
          var selected = magisSelectCandidate(magisSearchItems(search), titles[index], isSeries, year);
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
