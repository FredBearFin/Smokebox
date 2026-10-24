# Previous build (before compact saves)

The four engine files of commit 7ffe92f (branch `kds/night/a5-history`), the last build before the compact saved form (fmt 2).
`test/restore-audit.test.mjs` loads them to check a downgrade: the older build must park a compact save, not destroy it.
They are kept here so that test always runs (it used to read a git branch that CI and fresh clones do not have, and skipped silently).
Never edit these files.
