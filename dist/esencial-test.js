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

// providers/esencial-test.js
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    return [{
      name: "Esencial Test",
      title: "Runtime OK (id=" + tmdbId + " type=" + mediaType + " s=" + season + " e=" + episode + ")",
      url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
      quality: "720p",
      headers: {}
    }];
  });
}
module.exports = { getStreams };
