---
'ePDS': patch
---

A smoother sign-in code experience: no false error flash on a successful sign-in, no rapid-fire failures when correcting a wrong code, and tidier-looking banners.

**Affects:** End users, Client app developers

**End users:**

- A successful sign-in no longer briefly shows a red "Invalid OTP" message on its way to signing you in.
- After entering a wrong code, the boxes clear and focus jumps back to the first one, so retyping doesn't immediately resubmit the still-wrong code on every keystroke (which previously could lock you out for spamming the server).
- The red "Invalid OTP" and green "Code resent" banners are centred inside their coloured container instead of sitting in the corner of an empty wide box.

**Client app developers:** the sign-in page's flash-message container now uses a stable `flash-msg` base class with `error` / `success` modifier classes, so custom client CSS can restyle either variant cleanly via `.flash-msg`, `.flash-msg.error`, and `.flash-msg.success`.
