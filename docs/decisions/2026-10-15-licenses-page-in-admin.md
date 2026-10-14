---
type: decision
date: 2026-10-15
status: historical
snapshot: 65bf8abca9592be0db1e34f978ad4cdddbc885f7
supersedes: docs/decisions/2026-10-04-license-page-server-rendering.md
---

# The licenses page lives in the admin area

## Decision

The licenses page moves from the public marketing site to `/admin/licenses`, behind the admin route guard, and its Markdown representation goes away with the public route. This supersedes only where [The licenses page is server-rendered from the build's catalogue](./2026-10-04-license-page-server-rendering.md) places the page: server rendering, the build handoff and the completeness guard stay as that decision describes. `third-party-licenses.json` and `third-party-licenses.txt` stay public at the site root, without a link from the marketing site.

## Why

Most apps built on this template keep third-party notices in an admin area rather than on the public site, so a public page and footer link were a default that each fork would remove again (owner decision, 2026-10-15). The public files keep the notices available without an account.

## Rejected alternatives

- Keeping the public page and only dropping the footer link: the page and its Markdown stay indexed through the public route registry, so it is still part of the public site.
- Removing the public files as well: the admin page reads the catalogue from the build, not from them, but they are the only route to the notices without an admin account.
