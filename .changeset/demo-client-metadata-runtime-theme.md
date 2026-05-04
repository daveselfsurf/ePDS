---
'ePDS': patch
---

Demo client's published OAuth metadata now actually picks up the operator-set theme.

**Affects:** Operators

**Operators:** the demo's `/client-metadata.json` was previously prerendered at `next build` time, so its `brand_color`, `background_color`, and `branding.css` fields stayed frozen at the defaults regardless of what `EPDS_CLIENT_THEME` was set to in the running container's environment. The route is now flagged `dynamic = 'force-dynamic'`, mirroring the sibling `page.tsx`, so each request re-reads the env. The two-demo split in `docker-compose.yml` (a trusted `demo` with `EPDS_CLIENT_THEME=clay` and an untrusted `demo-untrusted` with the theme blank) now produces visually distinct metadata as intended.

No action required if you already had `EPDS_CLIENT_THEME` set on the demo service — it just begins to take effect.
