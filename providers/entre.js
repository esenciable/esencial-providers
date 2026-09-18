/** entre - EntrePeliculasYSeries (entrepeliculasyseries.nz): embed69-family /vidurl/ backend. */
const { createVidurlProvider } = require('../lib/vidurl.js');
module.exports = { getStreams: createVidurlProvider({ id: 'entre', host: 'https://entrepeliculasyseries.nz', brand: 'EntrePeliculas' }) };
