# Official Kanvexa Brand Assets

The approved K + forward-arrow icon is the official Kanvexa brand mark.
Preserve its proportions, transparent background and cyan/blue/purple gradient.
Do not redraw it, recolor it with CSS, crop it, or add text inside the artwork.

- `kanvexa-logo-transparent.png`: 1024×1024 RGBA main logo, no wordmark and transparent background.
- `kanvexa-app-icon.png`: 1024×1024 PNG with a navy rounded-square background.
- `favicon.ico`: favicon with 16/32/48/64/128/256 px variants.
- `favicon-32x32.png`, `android-chrome-192x192.png`, `apple-touch-icon.png`: common platform sizes.
- `preview-light-dark.png`: shows logo on light and dark backgrounds.

These are **raster PNG/ICO design assets**. The frontend serves byte-identical
copies of the transparent logo and the supplied browser/platform icons from
`apps/frontend/public/`. Source previews and the unused 1024 px app icon are not
shipped to browsers. The main logo is a shared external image, never base64 or a
JavaScript import, so all placements can reuse the browser cache.

The stable public email asset path is `/branding/kanvexa-logo-v1.png`. Keep that
path available for previously delivered email. For future artwork revisions,
publish a new versioned filename rather than replacing an existing email asset.
See [branding integration and QA](../docs/tasks/kanvexa-branding.md).
