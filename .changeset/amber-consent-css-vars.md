---
'ePDS': patch
---

Demo amber/ocean themes now colour the OAuth consent page correctly.

**Affects:** End users of the trusted demo

**End users:** The consent screen shown after signing in via the trusted demo now uses the demo's own warm indigo / amber palette throughout — the Authorize and Deny-access buttons, the "Authorize" header strip, and the surrounding surface all match the theme instead of falling back to the default @atproto/oauth-provider dark-mode look.

The previous CSS targeted auth-service's hand-rolled login markup (`.btn-primary`, `.container`, `.field`), which does not exist on the consent page — that page is built from `@atproto/oauth-provider-ui`, which is a Tailwind-utility bundle whose colours are driven by CSS custom properties (`--branding-color-primary` and friends). The demo theme now overrides those variables at `:root`, so a single declaration recolours every `bg-primary` / `text-primary` / `border-primary` utility on the consent page at once, and additionally paints the card surface and body background to match.
