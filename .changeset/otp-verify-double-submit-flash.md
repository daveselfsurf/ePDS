---
'ePDS': patch
---

Sign-in no longer flashes a confusing "Invalid OTP" error on its way to logging you in, and entering a wrong code no longer spams the server until you get rate-limited.

**Affects:** End users, Client app developers

**End users:** the sign-in code form sometimes briefly showed a red "Invalid OTP" message even though the code was correct and you ended up signed in — that no longer happens. When the code really was wrong, the digits stayed in their boxes and starting to retype would auto-submit the still-mostly-wrong code on every keystroke, sometimes spamming the server until you got rate-limited; the boxes now clear on an invalid code and focus jumps back to the first one. The "Invalid OTP" and "Code resent" banners are also now centred inside their coloured container.

**Client app developers:** the sign-in page's flash-message container now uses a stable `flash-msg` base class with `error` / `success` modifier classes, so custom client CSS can restyle either variant cleanly via `.flash-msg`, `.flash-msg.error`, and `.flash-msg.success`.
