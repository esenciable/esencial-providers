/** flat-magis-core - the Magis portal client, session and VOD resolution, shared verbatim by
 * the real provider and the diagnostic (so the diagnostic can never drift from reality).
 * Constants are injected by build.cjs; crypto by lib/flat-crypto3des.js. */

var MAGIS_HEADERS = {
  // 'Content-Type' MUST keep its conventional casing: Nuvio's plugin bridge looks it up
  // case-sensitively (`headers["Content-Type"]`), and a lowercase key loses against the
  // body default, so the request goes out as application/x-www-form-urlencoded and the
  // portal answers portal200001 (`版本已停止使用`) for a perfectly encrypted body.
  'Content-Type': 'application/json;charset=utf-8',
  'apk': MAGIS_APP_ID,
  'apkVer': MAGIS_APK_VER_HEADER,
  'spkgVer': MAGIS_SPKG_VER,
  'User-Agent': 'okhttp/3.12.12',
};
var MAGIS_SERIES_TYPES = { teleplay: 1, series: 1, variety: 1 };


function magisObjects(value) {
  return Array.isArray(value) ? value.filter(function (item) { return item && typeof item === 'object'; }) : [];
}

function magisDeviceFields(sn) {
  return {
    loginType: '2', appLanguage: 'en', apkVersion: MAGIS_APK_VERSION, sysVersion: MAGIS_SPKG_VER,
    appId: MAGIS_APP_ID, hardwareInfo: 'ranchu', model: 'sdk_gphone64_arm64', product: 'sdk_gphone64_arm64',
    cpu: 'arm64-v8a', B29: '', reserve1: '', deviceToken: '', sn: sn, drmId: '', sdkVer: 36,
  };
}

/** One portal call. Walks hosts on failure; the wire body is hex(base64(3DES(json))). */
function magisCall(path, bean, session, baseFields) {
  var body = {};
  if (baseFields !== false) {
    body.portalCode = 'masnew';
    body.userId = session && session.userId ? session.userId : '';
    body.userToken = session && session.userToken ? session.userToken : '';
  }
  var beanKeys = Object.keys(bean || {});
  for (var i = 0; i < beanKeys.length; i++) body[beanKeys[i]] = bean[beanKeys[i]];
  var device = magisDeviceFields(session && session.sn ? session.sn : '');
  var deviceKeys = Object.keys(device);
  for (var j = 0; j < deviceKeys.length; j++) body[deviceKeys[j]] = device[deviceKeys[j]];

  var wire = magisEncryptBody(JSON.stringify(body), MAGIS_3DES_KEY);
  var hosts = MAGIS_HOSTS;
  var lastError = null;
  function tryHost(index) {
    if (index >= hosts.length) {
      return Promise.reject(new Error('Magis portal unavailable: ' + (lastError ? String(lastError.message || lastError) : 'unknown')));
    }
    var host = hosts[index];
    return fetch('https://' + host + '/api/portalCore/' + path, { method: 'POST', headers: MAGIS_HEADERS, body: wire })
      .then(function (response) { return response.json(); })
      .then(function (json) {
        var code = typeof json.returnCode === 'string' ? json.returnCode : '';
        if (code !== '' && code !== '0') {
          var error = new Error('Magis portal rejected request (' + code + ': path=' + path + ' host=' + host + (typeof json.errorMessage === 'string' ? ': ' + json.errorMessage : '') + ')');
          error.magisCode = code;
          throw error;
        }
        var data = typeof json.data === 'string' ? json.data : '';
        if (data === '') return json;
        var plain = magisDecryptBlob(data, MAGIS_3DES_KEY);
        if (plain === null) throw new Error('Magis blob decryption failed');
        return JSON.parse(plain);
      })
      .catch(function (error) {
        lastError = error;
        return tryHost(index + 1);
      });
  }
  return tryHost(0);
}

/** Anonymous device session: v3/snToken -> v8/active (fresh per install, nothing precomputed). */
function magisActivate() {
  return magisCall('v3/snToken', {
    hardwareInfo: 'ranchu', model: 'sdk_gphone64_arm64', product: 'sdk_gphone64_arm64', cpu: 'arm64-v8a',
  }, {}, false).then(function (tokenResponse) {
    var snToken = flatStr(tokenResponse.snToken);
    if (snToken === '') throw new Error('Magis portal returned no snToken');
    var sn = flatStr(tokenResponse.sn).toLowerCase() || md5Hex(snToken + 'ntFT65w6itH!lHCPw7D=@qnsFC5adD28').toLowerCase();
    return magisCall('v8/active', {
      snToken: snToken, authVersion: '', authCode: '', preCode: '', macAddr: '02:00:00:00:00:00',
      reserve1: '', openNum: 4, channel: 'default', matadata: '', signdata: '',
    }, { sn: sn }, false).then(function (active) {
      var userId = flatStr(active.userId);
      var userToken = flatStr(active.userToken);
      if (userId === '' || userToken === '') throw new Error('Magis activation returned no session');
      return { userId: userId, userToken: userToken };
    });
  });
}

function magisPortalQuery(title) {
  var head = String(title).split(/[:,\u2013\u2014|]/)[0].trim();
  return head.length >= 3 ? head : String(title).trim();
}

function magisTokens(value) {
  var normalized = String(value).toLowerCase();
  try { normalized = normalized.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { /* sin normalize */ }
  var matches = normalized.match(/[a-z0-9]{3,}/g) || [];
  var set = {};
  for (var i = 0; i < matches.length; i++) set[matches[i]] = true;
  return set;
}

function magisSearchItems(response) {
  var direct = magisObjects(response.searchItem);
  if (direct.length) return direct;
  var groups = magisObjects(response.searchItemList);
  var grouped = [];
  for (var i = 0; i < groups.length; i++) grouped = grouped.concat(magisObjects(groups[i].itemList));
  if (grouped.length) return grouped;
  return magisObjects(response.assetList || response.list);
}

function magisSelectCandidate(items, title, isSeries) {
  var wanted = magisTokens(title);
  function score(item) {
    var name = flatStr(item.name) || flatStr(item.viewPoint) || flatStr(item.alias);
    var itemTokens = magisTokens(name);
    var hits = 0;
    for (var key in wanted) if (wanted[key] && itemTokens[key]) hits++;
    return hits;
  }
  var compatible = items.filter(function (item) {
    var programType = flatStr(item.programType);
    if (isSeries) return MAGIS_SERIES_TYPES[programType] === 1;
    return programType === '' || MAGIS_SERIES_TYPES[programType] !== 1;
  });
  var pool = compatible.length ? compatible : items;
  var usable = pool.filter(function (item) { return flatStr(item.contentId) !== ''; });
  usable.sort(function (a, b) { return score(b) - score(a); });
  return usable.length ? usable[0] : null;
}

function magisEpisodeId(detail, wanted) {
  var data = detail && typeof detail.assetData === 'object' && detail.assetData !== null && !Array.isArray(detail.assetData) ? detail.assetData : {};
  var episodes = magisObjects(data.simpleProgramList);
  var selected = null;
  if (wanted > 0) {
    for (var i = 0; i < episodes.length; i++) if (Number(episodes[i].seriesNumber) === wanted) { selected = episodes[i]; break; }
  }
  else selected = episodes[0] || null;
  if (!selected) return null;
  return flatStr(selected.contentId) || null;
}

function magisScoreMedia(media) {
  var codec = flatStr(media.encodeFormat).toLowerCase() === 'h264' ? 0 : 2;
  var container = flatStr(media.videoFormat).toLowerCase() === 'mp4' ? 0 : 1;
  var height = Number(media.height) || 0;
  return codec * 1000 + container * 100 - height / 1000;
}

function magisBestMedia(episode) {
  var candidates = [];
  var totals = magisObjects(episode.totalMovieList);
  for (var i = 0; i < totals.length; i++) candidates = candidates.concat(magisObjects(totals[i].movieList));
  if (!candidates.length) return null;
  var best = candidates[0];
  for (var j = 1; j < candidates.length; j++) if (magisScoreMedia(candidates[j]) < magisScoreMedia(best)) best = candidates[j];
  return best;
}

function magisIsCfl(value) {
  var parts = String(value).split('&');
  for (var i = 0; i < parts.length; i++) if (parts[i].trim() === 'sign_type=cfl') return true;
  return false;
}

/** VOD CDN: cdn_list tag=vod, url_list entry free + cfl. */
function magisVodCdn(slb) {
  var cdns = magisObjects(slb.cdn_list);
  for (var i = 0; i < cdns.length; i++) {
    if (flatStr(cdns[i].tag) !== 'vod') continue;
    var urls = magisObjects(cdns[i].url_list);
    for (var j = 0; j < urls.length; j++) {
      var auth = flatStr(urls[j].url);
      var isFree = flatStr(urls[j].tag) === 'free';
      var isCfl = magisIsCfl(auth) || flatStr(urls[j].sign_type) === 'cfl';
      if (!isFree || !isCfl) continue;
      var address = flatStr(cdns[i].main_addr).replace(/\/$/, '');
      if (address !== '') return { base: address.indexOf('http') === 0 ? address : 'https://' + address, auth: auth };
    }
  }
  return null;
}

