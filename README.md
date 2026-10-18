# florinhrib.dev

Source of [florinhrib.dev](https://florinhrib.dev), my personal site. Plain HTML, CSS and a little
JavaScript: no framework, no build step, no cookies, no third-party requests.

## What is where

| Path | What |
|---|---|
| `site/index.html` | Home: intro with the pixel portrait, selected work, experience, contact |
| `site/work/` | Work index and two case studies |
| `site/cv.html` | CV, prints cleanly on A4 |
| `site/styles.css` | All styles, in cascade layers: tokens, layout, components, motion, print |
| `site/pixel-portrait.js` | The portrait effect: pixelates on hover, focus or tap, reassembles on leave |
| `site/site.js`, `site/theme.js` | Theme switch, copy email, contents highlighting, print button |
| `site/assets/` | Portrait, font subset (OFL), favicon, icons, social card |
| `site/_headers` | Security headers served by Cloudflare |
| `wrangler.jsonc` | Cloudflare Workers static assets config |

## Preview

```sh
./preview.sh    # http://127.0.0.1:4180
```

## Deploy

`npm install`, then `npx wrangler deploy` (needs a Cloudflare login; `wrangler.jsonc` binds my own domains, so change the routes if you fork it).

## Licence

All rights reserved, except the JetBrains Mono font subset, which is under the SIL Open Font Licence (`site/assets/fonts/OFL.txt`). The code is public to read; the text, portrait and personal details are mine.
