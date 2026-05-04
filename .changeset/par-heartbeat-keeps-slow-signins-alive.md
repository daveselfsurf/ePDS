---
'ePDS': minor
---

Slow sign-ins are less likely to time out before you finish entering your code.

**Affects:** End users

**End users:** if you take a few minutes to find your sign-in code in your inbox before entering it, you will no longer be bounced to a "session expired" page when you submit it. While the sign-in code page (and the recovery-by-backup-email page) is open, the page now quietly tells the server "I'm still here" every few minutes so the OAuth flow it is part of stays alive. Closing the tab or walking away for a long stretch can still expire the flow, in which case the existing error pages still apply — but reading email at human speed should not.
