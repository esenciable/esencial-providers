/** diag-magis - measures the Magis portal from the device and reports it in the stream title.
 * Shares the injected constants and pure-JS 3DES/MD5 with the real Magis provider. */
var DIAG_HEADERS = {
  'content-type': 'application/json;charset=utf-8',
  'apk': MAGIS_APP_ID, 'apkVer': '43404', 'spkgVer': '2025-08-07 05:40:11_36_16_',
  'User-Agent': 'okhttp/3.12.12',
};
var DIAG_SAMPLE = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

function diagCall(host, path, body) {
  var wire = magisEncryptBody(JSON.stringify(body), MAGIS_3DES_KEY);
  return fetch('https://' + host + '/api/portalCore/' + path, { method: 'POST', headers: DIAG_HEADERS, body: wire })
    .then(function (response) {
      if (!response.ok) return { httpStatus: response.status };
      return response.text().then(function (text) {
        var json = null;
        try { json = JSON.parse(text); } catch (e) { return { parseError: true, sample: String(text).slice(0, 60) }; }
        return json;
      });
    })
    .then(function (json) {
      if (json && json.httpStatus) return { httpStatus: json.httpStatus };
      if (json && json.parseError) return { parseError: true, sample: json.sample };
      var code = typeof json.returnCode === 'string' ? json.returnCode : '';
      if (code !== '' && code !== '0') return { returnCode: code, message: typeof json.errorMessage === 'string' ? json.errorMessage.slice(0, 60) : '' };
      var data = typeof json.data === 'string' ? json.data : '';
      if (data === '') return { json: json };
      var plain = magisDecryptBlob(data, MAGIS_3DES_KEY);
      if (plain === null) return { decryptFailed: true };
      try { return { json: JSON.parse(plain) }; } catch (e) { return { jsonError: true }; }
    })
    .catch(function (error) {
      return { fetchError: (error && error.message ? error.message : String(error)).slice(0, 70) };
    });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var lines = [];
  var started = Date.now();
  lines.push('MAGIS_DIAG hosts=' + MAGIS_HOSTS.length + ' appId=' + (MAGIS_APP_ID ? 'ok' : 'FALTA') + ' key=' + (MAGIS_3DES_KEY ? MAGIS_3DES_KEY.length : 0) + 'hex');
  if (!MAGIS_HOSTS.length || !MAGIS_3DES_KEY) {
    lines.push('config: FALTAN CONSTANTES');
    return Promise.resolve([{ name: 'Diag Magis', title: lines.join('\n'), url: DIAG_SAMPLE, quality: '720p', headers: {} }]);
  }
  var host = MAGIS_HOSTS[0];
  var session = null;
  var t0 = Date.now();
  return diagCall(host, 'v3/snToken', { hardwareInfo: 'ranchu', model: 'sdk_gphone64_arm64', product: 'sdk_gphone64_arm64', cpu: 'arm64-v8a', loginType: '2', appLanguage: 'en', apkVersion: MAGIS_APK_VERSION, appId: MAGIS_APP_ID, sn: '', sdkVer: 36 })
    .then(function (result) {
      lines.push('snToken: ' + describe(result) + ' (' + (Date.now() - t0) + 'ms)');
      var snToken = result.json ? flatStr(result.json.snToken) : '';
      if (!snToken) return null;
      var sn = flatStr(result.json.sn).toLowerCase() || md5Hex(snToken + 'ntFT65w6itH!lHCPw7D=@qnsFC5adD28').toLowerCase();
      var t1 = Date.now();
      return diagCall(host, 'v8/active', { snToken: snToken, authVersion: '', authCode: '', preCode: '', macAddr: '02:00:00:00:00:00', reserve1: '', openNum: 4, channel: 'default', matadata: '', signdata: '', loginType: '2', appLanguage: 'en', apkVersion: MAGIS_APK_VERSION, appId: MAGIS_APP_ID, sn: sn, sdkVer: 36 })
        .then(function (active) {
          lines.push('active: ' + describe(active) + ' (' + (Date.now() - t1) + 'ms)');
          if (!active.json) return null;
          session = { userId: flatStr(active.json.userId), userToken: flatStr(active.json.userToken), sn: sn };
          lines.push('sesión: userId=' + (session.userId ? 'ok' : 'VACIO') + ' token=' + (session.userToken ? 'ok' : 'VACIO'));
          var t2 = Date.now();
          return diagCall(host, 'v3/searchByName', { portalCode: 'masnew', userId: session.userId, userToken: session.userToken, value: 'Coco', type: '0', columnId: '', filter: '', pageNum: 1, pageSize: 20, loginType: '2', appLanguage: 'en', apkVersion: MAGIS_APK_VERSION, appId: MAGIS_APP_ID, sn: sn, sdkVer: 36 })
            .then(function (search) {
              var items = search.json ? (search.json.searchItem || search.json.searchItemList || search.json.assetList || []) : [];
              var count = Array.isArray(items) ? items.length : 0;
              lines.push('search: ' + describe(search) + ' (' + (Date.now() - t2) + 'ms, items=' + count + ')');
            });
        });
    })
    .then(function () {
      lines.push('TOTAL: ' + (Date.now() - started) + 'ms');
      return [{ name: 'Diag Magis', title: lines.join('\n'), url: DIAG_SAMPLE, quality: '720p', headers: {} }];
    })
    .catch(function (error) {
      lines.push('FALLO: ' + (error && error.message ? error.message.slice(0, 70) : error));
      return [{ name: 'Diag Magis', title: lines.join('\n'), url: DIAG_SAMPLE, quality: '720p', headers: {} }];
    });
}

function describe(result) {
  if (result.fetchError) return 'fetch ERR: ' + result.fetchError;
  if (result.httpStatus) return 'http ' + result.httpStatus;
  if (result.parseError) return 'body no-JSON: ' + result.sample;
  if (result.returnCode) return 'portal ' + result.returnCode + (result.message ? ' ' + result.message : '');
  if (result.decryptFailed) return 'descifrado FALLÓ';
  if (result.jsonError) return 'json interno FALLÓ';
  return 'ok';
}

module.exports = { getStreams: getStreams };
