---
type: decision
date: 2026-10-04
status: historical
snapshot: 5e199096d8e302bc502b3e630af444a214ae3b4f
supersedes: docs/decisions/2026-10-04-third-party-license-notices.md
---

# The licenses page is server-rendered from the build's catalogue

## Decision

The licenses page renders every catalogue row and its full notice texts on the server, from the catalogue that the same build collected. The page no longer fetches `third-party-licenses.json`, so it has no loading state, and the notices are readable without JavaScript. This supersedes only the delivery described in [Third-party license notices are generated from the browser bundle](./2026-10-04-third-party-license-notices.md), where the page read the public file in the browser. The public JSON and text files, their headers, the completeness guard, and the page's Markdown representation stay as that decision describes.

## Why a build handoff

SvelteKit builds the server first, imports the server route modules to analyse them, then runs the client build from inside the server build's `writeBundle` hook, and runs the adapter from the server build's `closeBundle` hook. The catalogue comes out of the client build, so it does not exist while the server is compiled or analysed. The route therefore imports `virtual:third-party-licenses/server` lazily inside its `load` function: an eager import fails the build during route analysis.

The notice plugin leaves that import external in the server build and, in the server build's `closeBundle`, writes the validated catalogue as a private package into the server output. The hook is ordered `pre`, which runs it before SvelteKit's own `closeBundle` and so before the adapter copies the server output. Without that order the build still succeeds, but the deployed copy lacks the package and the page fails at runtime; the Kit fixture test renders from the adapter's copy for that reason. `closeBundle` also runs after a failed build, so the handoff runs only once the server build has finished writing, and the original build error stays the one reported. A bare package specifier resolves the same way through adapter-node's bundler, Wrangler's bundler, and Vercel's file tracing; none of them needs a rewritten path.

Development builds nothing, so the module resolves to `null` there and the page shows that the notices are unavailable.

## Why the plugin and not an adapter wrapper

Every build already needs the notice plugin, so the handoff stays correct when a fork changes adapter selection. A wrapper applied once to the selected adapter in `svelte.config.js` is the fallback if a SvelteKit release moves adaptation out of the server build's `closeBundle`: it can read `builder.getClientDirectory()` and write into `builder.getServerDirectory()` before delegating to the wrapped adapter, preserving that adapter's other properties.

## Rejected alternatives

- Fetching the public file in the browser: a loading state on every visit, and no notices without JavaScript.
- A committed catalogue snapshot: every dependency update fails until someone regenerates it.
- Prerendering the page: marketing pages negotiate HTML and Markdown on the same URL in server hooks, and every adapter serves prerendered files before hooks run.
- Building twice to feed the server: doubles the build and lets the two passes collect different graphs.
- A plugin-written relative module next to the route chunk: the import has to be rewritten to the chunk's final location, which couples the handoff to Kit's chunk layout.
- Rewriting immutable client chunks after hashing: their file names would no longer match their content.
- `csr = false` for the page: removes hydration, and with it search and client navigation.

## Accepted cost

The page data carries the full entries so search works on the notice texts after hydration, which duplicates the notice texts in the HTML's hydration data. On the build this decision was measured on, the English page was 624 KB (77 KB gzip), its `__data.json` 215 KB (36 KB gzip), and the Wrangler-bundled Worker grew from 2.49 MB to 2.73 MB (0.76 MB to 0.79 MB gzip), far below Cloudflare's 64 MiB limit. Deduplicating the payload is a separate change if it is ever needed.

Rows are native `details` elements, so they open without JavaScript and before hydration. A row that a search filters out and back in starts closed again.
