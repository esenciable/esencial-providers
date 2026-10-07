/** seriesmetro - SeriesMetro (www3.seriesmetro.net, trembed iframes + admin-ajax), flat style. */
var SMX_BASE = 'https://www3.seriesmetro.net';

function smxSlugCandidates(info) {
  var out = [];
  var titles = [info.title, info.originalTitle];
  for (var i = 0; i < titles.length; i++) {
    if (!titles[i]) continue;
    var slug = flatSlug(titles[i]);
    if (slug && out.indexOf(slug) === -1) out.push(slug);
  }
  return out.slice(0, 4);
}

function smxYearOnPage(html) {
  var match = html.match(/<span class="year[^"]*fa-calendar[^"]*">(\d{4})<\/span>/);
  return match ? parseInt(match[1], 10) : null;
}

function smxAccepted(html, info, isEpisode) {
  var found = smxYearOnPage(html);
  if (found === null) return !info.year;
  if (!info.year) return true;
  if (isEpisode) return found >= info.year - 1; // la fecha del episodio puede ser posterior al estreno
  return Math.abs(found - info.year) <= 1;
}

function smxLangOf(label) {
  var text = String(label || '').toLowerCase();
  if (/\b(sub|subs|vose|subtitulado|subtitulada)\b/.test(text)) return 'Subtitulado';
  if (/\b(lat|latino|latam)\b/.test(text)) return 'Latino';
  if (/\b(cast|castellano|esp)\b/.test(text)) return 'Castellano';
  return null;
}

function smxOptions(html) {
  var labels = {};
  var match;
  var reLabel = /href="#options-(\d+)"[\s\S]*?<span class="server">([\s\S]*?)<\/span>/g;
  while ((match = reLabel.exec(html)) !== null) {
    labels[match[1]] = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  var out = [];
  var reRow = /<div id="options-(\d+)"[\s\S]*?<iframe[^>]*?(?:data-src|src)="([^"]*trembed=[^"]*)"/g;
  while ((match = reRow.exec(html)) !== null) {
    var url = match[2].replace(/&#0?38;|&amp;/g, '&');
    if (url.indexOf(SMX_BASE + '/') === 0 && labels[match[1]] !== undefined) {
      out.push({ url: url, label: labels[match[1]] });
    }
  }
  return out;
}

function smxSplitLabel(label) {
  var i = label.lastIndexOf('-');
  if (i < 0) return { server: '', lang: label };
  return { server: label.slice(0, i).trim(), lang: label.slice(i + 1).trim() };
}

function smxEmbedRows(html) {
  var options = smxOptions(html).slice(0, 8);
  var promises = options.map(function (option) {
    return flatGet(option.url, { Referer: SMX_BASE + '/', 'User-Agent': FLAT_UA }).then(function (page) {
      if (page === null) return null;
      var match = page.match(/<iframe[^>]*\bsrc=["'](https?:\/\/[^"']+)["']/i);
      if (!match) return null;
      var parts = smxSplitLabel(option.label);
      if (smxLangOf(parts.lang) === null) return null;
      return { url: match[1], server: parts.server, lang: smxLangOf(parts.lang) };
    }).catch(function () { return null; });
  });
  return Promise.all(promises).then(function (rows) {
    return rows.filter(function (row) { return row !== null; });
  });
}

function smxMoviePage(slug, info) {
  return flatHtml(SMX_BASE + '/pelicula/' + slug + '/', { Referer: SMX_BASE + '/' }).then(function (html) {
    if (html === null || html.indexOf('trembed=') === -1 || !smxAccepted(html, info, false)) return null;
    return html;
  });
}

function smxEpisodePage(slug, info, season, episode) {
  var serieUrl = SMX_BASE + '/serie/' + slug + '/';
  return flatHtml(serieUrl, { Referer: SMX_BASE + '/' }).then(function (html) {
    if (html === null) return null;
    var post = (html.match(/data-post="(\d+)"/) || [])[1];
    if (!post) return null;
    var body = 'action=action_select_season&season=' + encodeURIComponent(String(season)) + '&post=' + encodeURIComponent(post);
    return fetch(SMX_BASE + '/wp-admin/admin-ajax.php', {
      method: 'POST',
      headers: { 'User-Agent': FLAT_UA, Referer: serieUrl, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body,
    }).then(function (response) {
      return response.ok ? response.text() : null;
    }).then(function (list) {
      if (list === null) return null;
      var wantSeason = Number(season);
      var wantEpisode = Number(episode);
      var href = null;
      var match;
      var re = /href="([^"]+\/capitulo\/[^"]+)"/g;
      while ((match = re.exec(list)) !== null) {
        var numbers = match[1].match(/temporada-(\d+)-capitulo-(\d+)/i);
        if (!numbers || Number(numbers[1]) !== wantSeason) continue;
        if (Number(numbers[2]) === wantEpisode) { href = match[1]; break; }
      }
      if (!href) return null;
      if (href.indexOf('http') !== 0) href = SMX_BASE + (href.charAt(0) === '/' ? '' : '/') + href;
      return flatHtml(href, { Referer: serieUrl }).then(function (epHtml) {
        if (epHtml === null || epHtml.indexOf('trembed=') === -1 || !smxAccepted(epHtml, info, true)) return null;
        return epHtml;
      });
    });
  });
}

function smxFirstPage(isSeries, info, season, episode) {
  var candidates = smxSlugCandidates(info);
  var index = 0;
  function attempt() {
    if (index >= candidates.length) return Promise.resolve(null);
    var slug = candidates[index++];
    var probe = isSeries
      ? smxEpisodePage(slug, info, season, episode)
      : smxMoviePage(slug, info);
    return probe.then(function (html) {
      if (html !== null) return html;
      return attempt();
    });
  }
  return attempt();
}

function getStreams(tmdbId, mediaType, season, episode) {
  var isSeries = mediaType === 'tv' || mediaType === 'series';
  var id = String(tmdbId === null || tmdbId === undefined ? '' : tmdbId);
  console.log('[seriesmetro] resolving ' + id);
  if (isSeries && (season === null || season === undefined || episode === null || episode === undefined)) return Promise.resolve([]);
  return flatTmdbInfo(id, isSeries ? 'series' : 'movie').then(function (info) {
    if (info === null) return [];
    return smxFirstPage(isSeries, info, season, episode).then(function (html) {
      if (html === null) return [];
      return smxEmbedRows(html).then(function (rows) {
        var promises = rows.map(function (row) {
          return flatResolveEmbed(row.url).then(function (resolved) {
            if (resolved === null) return null;
            var quality = resolved.quality === 'Unknown' ? 'HD' : resolved.quality;
            return {
              name: 'SeriesMetro - ' + quality,
              title: row.lang + ' - ' + (row.server || flatServerLabel(row.url)) + ' ' + quality,
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
    console.log('[seriesmetro] failed: ' + (error && error.message ? error.message : error));
    return [];
  });
}

module.exports = { getStreams: getStreams };
