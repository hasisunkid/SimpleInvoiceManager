---
'@sim/ha-app': patch
---

Security hardening: the app now limits how many requests a single session, AI access key or
address can send per minute, and some input checks (logo upload, e-mail addresses, PDF file
names) were rewritten so that specially crafted input can no longer slow the app down. The
development and test tools were updated to fix reported security issues; this does not change
the installed app.
