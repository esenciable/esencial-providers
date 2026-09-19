var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// providers/esencial-diag.js
var SAMPLE = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    const lines = [];
    lines.push("fetch: " + typeof fetch);
    lines.push("AbortController: " + typeof AbortController);
    lines.push("setTimeout: " + typeof setTimeout);
    lines.push("atob: " + typeof atob);
    lines.push("JSON: " + typeof JSON + " | Promise: " + typeof Promise);
    if (typeof fetch === "function") {
      try {
        const response = yield fetch("https://api.themoviedb.org/3/movie/354912?api_key=439c478a771f35c05022f9feabcca01c");
        lines.push("TMDB: http " + response.status + " ok=" + response.ok);
        try {
          const text = yield response.text();
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
        const response = yield fetch("https://hackstore2.com/api/rest/single?post_name=coco-2017&post_type=movies", {
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
  });
}
module.exports = { getStreams };
