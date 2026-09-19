// providers/esencial-diag.js
var SAMPLE = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";
async function getStreams(tmdbId, mediaType, season, episode) {
  const lines = [];
  lines.push("fetch: " + typeof fetch);
  lines.push("AbortController: " + typeof AbortController);
  lines.push("setTimeout: " + typeof setTimeout);
  lines.push("atob: " + typeof atob);
  lines.push("JSON: " + typeof JSON + " | Promise: " + typeof Promise);
  if (typeof fetch === "function") {
    try {
      const response = await fetch("https://api.themoviedb.org/3/movie/354912?api_key=439c478a771f35c05022f9feabcca01c");
      lines.push("TMDB: http " + response.status + " ok=" + response.ok);
      try {
        const text = await response.text();
        lines.push("TMDB text: " + (text ? text.slice(0, 40) : "VACIO"));
        const parsed = JSON.parse(text);
        lines.push("TMDB json: " + (parsed && parsed.title ? parsed.title : "sin title"));
      } catch (inner) {
        lines.push("TMDB parse ERR: " + (inner && inner.message ? inner.message.slice(0, 50) : inner));
      }
    } catch (error) {
      lines.push("TMDB ERR: " + (error && error.message ? error.message.slice(0, 60) : error));
    }
    try {
      const response = await fetch("https://hackstore2.com/api/rest/single?post_name=coco-2017&post_type=movies", {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }
      });
      lines.push("hackstore: http " + response.status);
    } catch (error) {
      lines.push("hackstore ERR: " + (error && error.message ? error.message.slice(0, 60) : error));
    }
  }
  return [{
    name: "Esencial Diag",
    title: lines.join("\n"),
    url: SAMPLE,
    quality: "720p",
    headers: {}
  }];
}
module.exports = { getStreams };
