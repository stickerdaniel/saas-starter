---
type: decision
date: 2026-10-04
status: historical
snapshot: c59003435b43d01bcd80a128d9078149cc123d53
---

# Third-party license notices are generated from the browser bundle

## Decision

The production build publishes a catalogue of the third-party software and assets it ships to browsers, with each package's license declaration and full notice texts, as `third-party-licenses.json` and `third-party-licenses.txt` at the site root. The public licenses page reads that file. The build fails when a shipped package lacks a license declaration or primary license text, and the fix is a reviewed override that points to the exact upstream release. The build plugin lives in [`scripts/third-party-licenses/`](../../scripts/third-party-licenses/), and its inputs in [`third-party-licenses.config.json`](../../third-party-licenses.config.json).

## Why the bundle, not the dependency manifest

A manifest closure lists every production dependency, including packages that only run at build time, in a command-line tool, or on the server. Those packages never reach a browser, so listing them misstates what the site distributes, and their licenses can look like obligations the site does not have. Reading the module ids of the emitted client chunks and the worker bundles that survive into that output lists what actually ships. Packages that Tailwind inlines from CSS do not appear in that graph, so the configuration names them explicitly and the build fails when an authored CSS `@import` or `@plugin` directive names a package the configuration does not cover.

## Why not Vite's built-in license output

Vite's `build.license` option skips worker bundles, ignores notice files below a package root such as a codec license next to the code it covers, and emits identifier-only rows for packages without a license file. A notice catalogue needs the texts, not the identifiers.

## Why no network and no generated copyright holders

Notice generation runs offline. A network lookup for license texts would make builds depend on a third-party service and could return a text for a different release than the one installed. License texts that a package does not ship are copied from that package's upstream repository at the matching release tag or commit and committed under [`third-party-notices/`](../../third-party-notices/). When a generic license text is rendered from the pinned SPDX license list instead, its copyright lines must be supplied from upstream evidence: the package `author` field, npm owners, a repository organization, or the current year do not identify the copyright holders.

## Out of scope

The guard checks that notices are complete. It does not decide whether a license is compatible with the product; that remains a separate, manual decision.

The catalogue covers the code the app serves. The Rive runtime package fetches its WebAssembly binaries from a public CDN at runtime; the catalogue row covers the npm package the app bundles and makes no claim about third-party components compiled into those CDN-served binaries.

SvelteKit builds a service worker without user plugins, so the build fails while a service worker entry exists rather than publishing an incomplete catalogue.

## Fork contract

A fork that ships another runtime, such as a desktop shell with a staged dependency tree, collects its own inputs after staging and pruning that tree, then reuses the resolution and serialization steps so the same completeness rules apply. Native components and other non-npm assets are declared as custom notices with their source and license evidence.
