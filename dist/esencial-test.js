// providers/esencial-test.js
async function getStreams(tmdbId, mediaType, season, episode) {
  return [{
    name: "Esencial Test",
    title: "Runtime OK (id=" + tmdbId + " type=" + mediaType + " s=" + season + " e=" + episode + ")",
    url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    quality: "720p",
    headers: {}
  }];
}
module.exports = { getStreams };
