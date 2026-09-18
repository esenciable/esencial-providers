# esencial-providers

Nuvio **providers** (scraper-based) para el catálogo Latino: HackStore y LaMovie.
Sin servidor: los streams se resuelven en el dispositivo, igual que los providers
de yoruix/nuvio-providers y Digitalito/Nuvio-lat-plugin.

## Instalación en Nuvio

1. Pusheá este repo a GitHub (el `manifest.json` en la raíz es el punto de entrada).
2. En Nuvio: **Providers → Add provider repo** y pegá la URL raw del `manifest.json`:
   `https://raw.githubusercontent.com/<usuario>/esencial-providers/main/manifest.json`
3. Probá con una película (Coco: `tt2380307`) y una serie (Breaking Bad S1E1: `tt0903747`).

## Providers incluidos

| Provider | Sitio | Método |
|---|---|---|
| HackStore | hackstore2.com | API JSON nativa: slug → `/single` → `/player` → resolución de embeds |
| LaMovie | lamovie.org | API de la SPA: `search?postType=any&q=` → `player?postId=&demo=0` (+ episodios) |

Resolución de embeds compartida (lib/resolvers.js): GoodStream, familia StreamWish
(con paso `/dl?hash=`), VOE (LUT + ROT13), Vimeos, Lacloud, DoodStream, Uqload,
VidHide, EarnVids y desempaquetador genérico P.A.C.K.E.R. Filemoon requiere
AES-CTR y queda fuera por ahora.

## Desarrollo

```bash
node test.mjs          # verifica los providers contra los sitios reales (Coco + Breaking Bad)
```

Los providers son JS directo compatible con el runtime de Nuvio (sin `Buffer`,
sin `node:crypto`, sin `URL.searchParams`). `lib/` es compartido:
`http.js` (fetch con retry), `embeds.js` (decoders/calidades/familias),
`resolvers.js` (estrategias por host), `titles.js` (slug + scoring).
