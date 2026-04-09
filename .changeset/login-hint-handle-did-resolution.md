---
'epds': patch
---

Sign in faster from third-party apps that already know who you are.

**Affects:** End users

When you sign in to a third-party AT Protocol app (anything built
on top of the Bluesky account system, for example) that already
knows your handle or DID, ePDS now jumps straight to the "enter
your sign-in code" step. Previously you would have been asked to
retype your email address first, even though the app you were
using had already identified you — that extra step is gone.

This fixes two specific situations that didn't work before: apps
that identified you by handle or DID rather than email, and apps
that sent the identifier over a back channel rather than in the
sign-in URL.
