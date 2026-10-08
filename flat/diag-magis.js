/** diag-magis - probes HOW headers survive the device network bridge.
 * The portal rejects requests without the `apk`/`apkVer` headers (proven: portal200001),
 * and the TV seems to drop them, so this tries several transports and reports which one
 * the portal accepts. Every rung reports its verdict to logcat (tag `Plugin:<id>:diag-magis`)
 * so the ladder is readable without the UI, and a synchronous throw is a verdict, not a crash. */
var DIAG_SAMPLE = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
var DIAG_PATH = 'v3/snToken';
var DIAG_BEAN = { hardwareInfo: 'ranchu', model: 'sdk_gphone64_arm64', product: 'sdk_gphone64_arm64', cpu: 'arm64-v8a' };
/** Offline parity check: the wire this runtime produces for a FIXED plaintext must equal the
 * wire Node's implementation produces (`node lib/flat-crypto3des.js` + the real key). The plugin
 * works from Node, so a mismatch here means the device runtime breaks the pure-JS 3DES — which
 * the portal answers with portal200001 (`版本已停止使用`) because it cannot read the body.
 * Regenerate with: magisEncryptBody('magis-diag-parity-v1', MAGIS_3DES_KEY). */
var DIAG_PARITY_PLAIN = 'magis-diag-parity-v1';
var DIAG_PARITY_WIRE = '30364e4771506c76706635776949527546357554737871432b4c586a37646d43';

function diagPlainBody() {
  var body = { loginType: '2', appLanguage: 'en', apkVersion: MAGIS_APK_VERSION, sysVersion: MAGIS_SPKG_VER, appId: MAGIS_APP_ID, hardwareInfo: 'ranchu', model: 'sdk_gphone64_arm64', product: 'sdk_gphone64_arm64', cpu: 'arm64-v8a', B29: '', reserve1: '', deviceToken: '', sn: '', drmId: '', sdkVer: 36 };
  var keys = Object.keys(DIAG_BEAN);
  for (var i = 0; i < keys.length; i++) body[keys[i]] = DIAG_BEAN[keys[i]];
  return JSON.stringify(body);
}

function diagVerdict(json) {
  if (!json) return 'sin respuesta';
  var code = typeof json.returnCode === 'string' ? json.returnCode : '';
  if (code === '' || code === '0') return '✅ ACEPTADO';
  return '❌ ' + code + (json.errorMessage ? ' ' + String(json.errorMessage).slice(0, 20) : '');
}

function tryFetchA(url, wire) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json;charset=utf-8', 'apk': MAGIS_APP_ID, 'apkVer': MAGIS_APK_VER_HEADER, 'spkgVer': MAGIS_SPKG_VER, 'User-Agent': 'okhttp/3.12.12' }, body: wire })
    .then(function (r) { return r.json(); }).catch(function (e) { return { error: e.message }; });
}

function tryFetchLower(url, wire) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json;charset=utf-8', 'apk': MAGIS_APP_ID, 'apkver': MAGIS_APK_VER_HEADER, 'spkgver': MAGIS_SPKG_VER, 'user-agent': 'okhttp/3.12.12' }, body: wire })
    .then(function (r) { return r.json(); }).catch(function (e) { return { error: e.message }; });
}

function tryFetchHeadersObject(url, wire) {
  var headers = new Headers();
  headers.append('content-type', 'application/json;charset=utf-8');
  headers.append('apk', MAGIS_APP_ID);
  headers.append('apkVer', MAGIS_APK_VER_HEADER);
  headers.append('spkgVer', MAGIS_SPKG_VER);
  headers.append('User-Agent', 'okhttp/3.12.12');
  return fetch(url, { method: 'POST', headers: headers, body: wire })
    .then(function (r) { return r.json(); }).catch(function (e) { return { error: e.message }; });
}

function tryXhr(url, wire, withHeaders) {
  return new Promise(function (resolve) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      if (withHeaders) {
        xhr.setRequestHeader('content-type', 'application/json;charset=utf-8');
        xhr.setRequestHeader('apk', MAGIS_APP_ID);
        xhr.setRequestHeader('apkVer', MAGIS_APK_VER_HEADER);
        xhr.setRequestHeader('spkgVer', MAGIS_SPKG_VER);
        xhr.setRequestHeader('User-Agent', 'okhttp/3.12.12');
      }
      xhr.onload = function () { try { resolve(JSON.parse(xhr.responseText)); } catch (e) { resolve({ error: 'respuesta no-JSON (' + xhr.status + ')' }); } };
      xhr.onerror = function () { resolve({ error: 'xhr error' }); };
      xhr.timeout = 15000;
      xhr.ontimeout = function () { resolve({ error: 'xhr timeout' }); };
      xhr.send(wire);
    } catch (e) { resolve({ error: 'xhr no disponible: ' + e.message }); }
  });
}

function diagLog(line) {
  try { if (typeof console !== 'undefined' && console.log) console.log('[diag-magis] ' + line); } catch (e) {}
}

function getStreams(tmdbId, mediaType, season, episode) {
  var lines = ['MAGIS_LADDER hosts=' + MAGIS_HOSTS.length + ' XHR=' + (typeof XMLHttpRequest) + ' Headers=' + (typeof Headers)];
  // Rung 0, offline: is the crypto this runtime produces even the same bytes Node produces?
  try {
    var parity = magisEncryptBody(DIAG_PARITY_PLAIN, MAGIS_3DES_KEY);
    var parityLine = 'crypto parity: ' + (parity === DIAG_PARITY_WIRE
      ? '✅ coincide'
      : '❌ DIFERENTE (got ' + String(parity).slice(0, 24) + '… esperado ' + DIAG_PARITY_WIRE.slice(0, 24) + '…)');
    lines.push(parityLine);
    diagLog(parityLine);
  } catch (e) {
    var parityErr = '❌ crypto parity lanzó: ' + (e && e.message ? e.message : String(e));
    lines.push(parityErr);
    diagLog(parityErr);
  }
  var wire = magisEncryptBody(diagPlainBody(), MAGIS_3DES_KEY);
  var transports = [
    ['fetch headers obj', function (url) { return tryFetchA(url, wire); }],
    ['fetch minúsculas', function (url) { return tryFetchLower(url, wire); }],
    ['fetch Headers()', function (url) { return tryFetchHeadersObject(url, wire); }],
    ['XHR con headers', function (url) { return tryXhr(url, wire, true); }],
    ['XHR sin headers', function (url) { return tryXhr(url, wire, false); }],
  ];
  var index = 0;
  var winner = null;
  function next() {
    if (index >= transports.length || winner) {
      lines.push(winner ? 'GANADOR: ' + winner : 'NINGUNO pasó los headers');
      var report = lines.join('\n');
      for (var l = 0; l < lines.length; l++) diagLog(lines[l]);
      return Promise.resolve([{ name: 'Diag Magis', title: report, url: DIAG_SAMPLE, quality: '720p', headers: {} }]);
    }
    var entry = transports[index++];
    var started = Date.now();
    var host = MAGIS_HOSTS[0];
    var url = 'https://' + host + '/api/portalCore/' + DIAG_PATH;
    // The call MUST be wrapped: `new Headers()` throws SYNCHRONOUSLY in runtimes without the
    // constructor, and an unwrapped throw killed the whole ladder before the XHR rungs ever ran
    // (observed on device: "getStreams error: Headers is not defined").
    var attempt;
    try {
      attempt = Promise.resolve(entry[1](url));
    } catch (e) {
      attempt = Promise.resolve({ error: 'lanzó: ' + (e && e.message ? e.message : String(e)) });
    }
    return attempt.then(function (json) {
      var verdict = json && json.error ? '❌ ' + json.error : diagVerdict(json);
      var line = entry[0] + ': ' + verdict + ' (' + (Date.now() - started) + 'ms)';
      lines.push(line);
      diagLog(line);
      if (verdict.indexOf('ACEPTADO') !== -1 && winner === null) winner = entry[0];
      return next();
    });
  }
  return next();
}

module.exports = { getStreams: getStreams };
