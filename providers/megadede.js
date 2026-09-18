/** megadede - MegaDede (megadede.mobi): embed69-family backend under /vidurl/{imdb}[-SxEE]/. */
const { createVidurlProvider } = require('../lib/vidurl.js');
module.exports = { getStreams: createVidurlProvider({ id: 'megadede', host: 'https://megadede.mobi', brand: 'MegaDede' }) };
