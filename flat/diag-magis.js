/** diag-magis - runs the REAL Magis flow (same core as the provider) and reports each step
 * and its duration in the stream title, so the TV screen shows exactly where it stands. */
var DIAG_SAMPLE = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

function diagDescribe(error) {
  if (!error) return 'ok';
  var message = error && error.message ? error.message : String(error);
  return message.replace('Magis portal rejected request (', 'portal ').replace(')', '').slice(0, 90);
}

function getStreams(tmdbId, mediaType, season, episode) {
  var lines = ['MAGIS_DIAG hosts=' + MAGIS_HOSTS.length + ' appId=' + (MAGIS_APP_ID ? 'ok' : 'FALTA') + ' key=' + (MAGIS_3DES_KEY ? MAGIS_3DES_KEY.length + 'hex' : 'FALTA')];
  var started = Date.now();
  if (!MAGIS_HOSTS.length || !MAGIS_3DES_KEY) lines.push('config: FALTAN CONSTANTES');
  else {
    var t0 = Date.now();
    return magisActivate()
      .then(function (state) {
        lines.push('activación: OK en ' + (Date.now() - t0) + 'ms (userId=' + (state.userId ? 'ok' : 'VACIO') + ')');
        var t1 = Date.now();
        return magisCall('v3/searchByName', {
          value: 'Coco', type: '0', columnId: '', filter: '', pageNum: 1, pageSize: 20,
        }, state).then(function (search) {
          var items = magisSearchItems(search);
          lines.push('búsqueda: OK en ' + (Date.now() - t1) + 'ms (items=' + items.length + ')');
        });
      })
      .catch(function (error) {
        lines.push('FALLÓ en ' + (Date.now() - started) + 'ms: ' + diagDescribe(error));
      })
      .then(function () {
        lines.push('TOTAL: ' + (Date.now() - started) + 'ms');
        return [{ name: 'Diag Magis', title: lines.join('\n'), url: DIAG_SAMPLE, quality: '720p', headers: {} }];
      });
  }
  return Promise.resolve([{ name: 'Diag Magis', title: lines.join('\n'), url: DIAG_SAMPLE, quality: '720p', headers: {} }]);
}

module.exports = { getStreams: getStreams };
