---
'ePDS': minor
---

Refreshed sign-in page design, with new ways for apps to style it.

**Affects:** End users, Client app developers

**End users:** The sign-in page is now a white card centered on a muted grey background, with rounded inputs, pill-shaped buttons, and a "Powered by Certified" footer. The one-time code step uses six segmented input boxes (with paste, arrow, backspace, and auto-submit) instead of a single text field. The underlying sign-in flow is unchanged.

**Client app developers:** The login page now exposes its surface colors as CSS custom properties for trusted clients to override from their injected `branding.css`:

```css
:root {
  --page-bg: #YOUR_OUTER_BG; /* page bg outside the card; default #E8E8E8 */
  --card-bg: #YOUR_CARD_BG; /* card surface; default #F8F8F8 */
  --input-bg: #YOUR_INPUT_BG; /* email + OTP box backgrounds; default #ffffff */
  --input-border: #YOUR_INPUT_BORDER; /* email + OTP box borders; default #e5e5e5 */
  --card-border: #YOUR_CARD_BORDER; /* card outline; default #E5E5E5 */
  --btn-secondary-border: #YOUR_BTN_BORDER; /* social / ATProto button borders; default #e5e5e5 */
  --muted-foreground: #YOUR_MUTED_TEXT; /* terms text + "Powered by" tint; default #999 */
  --focus-border: #YOUR_FOCUS; /* defaults to your client metadata's brand_color */
}
```

The page no longer reads `background_color` from your client metadata — to control the page background, set `--page-bg` from your `branding.css` instead. Pre-existing trusted clients that relied on `background_color` for the login bg need to migrate to the CSS var; clients that only used `background_color` for other rendered pages are unaffected.

The "Recover with backup email" link on the OTP step is shown by default. To suppress it (e.g. for a client that doesn't surface backup-email recovery), set `:root { --recovery-link-display: none; }` in your `branding.css`. The recovery flow at `/auth/recover` is reachable via direct navigation regardless — only the entry point on the login page is hidden.
