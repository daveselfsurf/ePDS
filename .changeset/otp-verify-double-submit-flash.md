---
'ePDS': patch
---

Sign-in no longer flashes a confusing "Invalid OTP" error on its way to logging you in, and entering a wrong code no longer triggers a flurry of failed attempts that can lock you out.

**Affects:** End users

**End users:** entering your sign-in code — by typing the last digit, pressing Enter, pasting the whole code, or letting your phone autofill it from the email — sometimes briefly showed a red "Invalid OTP" message even though the code was correct and you ended up signed in. The error no longer appears in that case; the sign-in proceeds straight through to the app. Separately, when the code really was wrong, the digits stayed in their boxes — and starting to retype would auto-submit the still-mostly-wrong code on every keystroke, sometimes spamming the server until you got rate-limited. The boxes now clear on an invalid code and focus jumps back to the first one, so you can retype the code cleanly.
