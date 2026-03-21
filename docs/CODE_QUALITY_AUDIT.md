# Code Quality Audit Report

**Date:** 2026-03-20
**Methodology:** 50 parallel Opus agents across 3 phases: 9 scanning agents, 21 verification agents, 20 implementation agents. All findings grounded via WebSearch against official docs.
**Scope:** Full codebase scan of SvelteKit + Convex + TypeScript SaaS starter

---

## Executive Summary

The codebase is **well above average** for a SaaS starter. Highlights:

- 100% Svelte 5 runes adoption (zero legacy patterns)
- Dual-layer auth guards (hooks + Convex function builders)
- Mature DX tooling (ESLint flat config, oxlint, Knip, Husky, varlock, Renovate)
- Proper lazy loading patterns (RiveBackground, customer support, command menu)
- Good font loading, icon tree-shaking, PostHog deferred initialization

The audit identified **45 actionable findings** across 10 domains. 21 were sent to verification agents; 20 received implementation-level review with exact minimal diffs.

---

## Verification + Implementation Summary

| Phase                   | Agents | Key Outcome                                                           |
| ----------------------- | ------ | --------------------------------------------------------------------- |
| Phase 1: Scanning       | 9      | 185 raw findings, deduplicated to 45 actionable                       |
| Phase 2: Verification   | 21     | 14 verified, 4 partially verified, 3 refuted                          |
| Phase 3: Implementation | 20     | 17 confirmed minimal fix, 2 dismissed, 1 found original fix was wrong |

---

## Status: All P0-P2 findings applied and verified (svelte-check 0 errors, 261 unit tests passing)

## Master Findings Table (Implementation-Verified)

### P0 -- Fix Now (Bugs)

| #   | ID         | Issue                                                                                                                                                                               | Minimal Fix (Verified)                                                                                                                                                        | Lines Changed       |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1   | **CVX-23** | `field: 'id'` instead of `'_id'` in `admin/support/queries.ts:224` -- silent failure for user avatar lookups in admin panel                                                         | Change to `{ field: '_id', operator: 'eq', value: userId }`                                                                                                                   | **1 line**          |
| 2   | **R-02**   | `atob()` in hooks.server.ts doesn't handle base64url JWT encoding -- admins with certain JWTs silently denied access                                                                | Replace `atob(payload)` with `Buffer.from(payload, 'base64url').toString('utf-8')` (Buffer always available server-side). No shared utility needed (different return shapes). | **1 line**          |
| 3   | **DX-02**  | `resolve: { conditions: ['browser'] }` drops Vite defaults (`module`, `development/production`) since Vite 6 breaking change. Config was cargo-culted -- no dependency requires it. | Delete the entire `resolve` block (lines 28-30 of vite.config.ts). `browser` is already in Vite defaults.                                                                     | **3 lines deleted** |

### P1 -- Fix Soon (Security/Quality)

| #   | ID          | Issue                                                                                                                                                            | Minimal Fix (Verified)                                                                                                                                                                                                                                                                                                             | Lines Changed                                                                 |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------- |
| 4   | **TW4-03**  | `ring-offset-background` used in 5 components but CSS var never defined (legacy shadcn v1 token)                                                                 | **6 surgical class replacements across 4 files**: Delete `ring-offset-background` from input.svelte (x2). Replace `focus:ring-2 focus:ring-ring focus:ring-offset-2` with `focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50` in dialog-content.svelte, sheet-content.svelte, account-settings.svelte. | **5 lines**                                                                   |
| 5   | **TW4-04**  | `text-destructive-foreground` used in 2 components but CSS var never defined                                                                                     | Replace with `text-white` (matches codebase's own button destructive variant on `bg-destructive` backgrounds) in status-badge.svelte:15 and founder-welcome-card.svelte:261                                                                                                                                                        | **2 lines**                                                                   |
| 6   | **CSS-02**  | Raw `<input type="file">` in account-settings.svelte duplicates outdated styles. `<Input>` already supports `type="file"`. Also found dead `fileInput` variable. | Replace raw input with `<Input type="file" .../>`, remove unused `let fileInput = $state<HTMLInputElement>()`                                                                                                                                                                                                                      | **2 lines changed, 1 deleted**                                                |
| 7   | **R-05**    | Email API routes (`/api/emails/preview`, `/api/emails/build`) not covered by `handleDevOnlyRoutes`                                                               | Add `isEmailsApiRoute` matcher (`/^\/api\/emails(\/                                                                                                                                                                                                                                                                                | $)/`) and add to guard condition. Catches all future `/api/emails/\*` routes. | **2 lines added** |
| 8   | **PERF-01** | zxcvbn dictionaries (1MB+) eagerly imported at module level                                                                                                      | Lazy singleton loader with `$state(dictionariesLoaded)`. Dynamic `import()` on mount, `EMPTY_RESULT` (score 0) during ~100ms load gap, automatic re-derivation via Svelte reactivity. `svelte-check` passes. Follows official zxcvbn-ts lazy loading docs.                                                                         | **~15 lines changed**                                                         |
| 9   | **F07**     | Clickable `<div>` in ChatAttachments.svelte missing keyboard accessibility                                                                                       | Keep `<div>` (can't nest `<button>` -- has child remove button). Add conditional `role={isClickable ? 'button' : undefined}`, `tabindex={isClickable ? 0 : undefined}`, `onkeydown` for Enter/Space. Remove 2 svelte-ignore comments.                                                                                              | **4 lines changed, 2 deleted**                                                |
| 10  | **T03**     | Unit tests (17 Vitest files) never run in CI                                                                                                                     | Add 8-line `unit-tests` job to existing `static-checks.yml`. Runs parallel to other jobs. `postinstall` handles SvelteKit sync.                                                                                                                                                                                                    | **8 lines added**                                                             |
| 11  | **CVX-01**  | 49 `throw new Error()` vs 13 `ConvexError`. **Critical: Convex redacts plain Error messages to "Server Error" in production!**                                   | Convert **28 user-facing** throws to `ConvexError`. Keep 17 internal/test throws as `Error`. Defer 4 auth wrapper throws (large blast radius, separate PR).                                                                                                                                                                        | **28 lines changed**                                                          |

### P2 -- Improve (Best Practices)

| #   | ID                      | Issue                                                                                                                                                        | Minimal Fix (Verified)                                                                                                                                                                                                  | Lines Changed              |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 12  | **R-01**                | Admin and app layout server files are no-ops creating data waterfalls                                                                                        | **DELETE both files**. No exports, no imports, child `parent()` calls still resolve from root layout.                                                                                                                   | **2 files deleted**        |
| 13  | **DX-05**               | 9 ESLint rules disabled globally. Investigation: **8 of 9 were redundant no-ops** (not enabled by `ts.configs.recommended`). Only `no-explicit-any` matters. | Keep `no-explicit-any: off` globally (26 legitimate usages in vendor code). Scope 8 type-checked rules to Convex only. Lint passes clean.                                                                               | **~10 lines restructured** |
| 14  | **R-11**                | No `hooks.client.ts` -- client errors silently lost                                                                                                          | 10-line file: `handleError` using existing `getPosthog()?.captureException(error)`. Handles lazy PostHog init gracefully (null = skip). Filters 404s. `console.error` in DEV only.                                      | **10 lines (new file)**    |
| 15  | **I18N-10**             | `setCustomValidity('Password is too weak')` hardcoded English                                                                                                | Add `validationMessage?: string` prop to `Password.Root` (3-file change: types.ts, password.svelte.ts, password.svelte). Default preserves backward compatibility.                                                      | **3 files, ~5 lines**      |
| 16  | **CSS-01/A11Y-01**      | Inconsistent `focus:` vs `focus-visible:` strategy                                                                                                           | **Only 2 files need changes**: dialog-content.svelte (close button `focus:` -> `focus-visible:`) and +layout.svelte (skip-to-content link, all `focus:` -> `focus-visible:`). Menu `focus:` items correctly left alone. | **2 lines**                |
| 17  | **CSS-04**              | Raw Tailwind colors for semantic statuses, no design tokens                                                                                                  | **12 lines of CSS**: Define `--success`, `--warning`, `--info` (+ foreground) in `:root`, `.dark`, `@theme inline`. oklch values matched to existing Tailwind colors. Components updated incrementally.                 | **12 lines added**         |
| 18  | **TS-02/21**            | 13 `as any` casts in StreamProcessor.ts for tool parts                                                                                                       | **Simpler than proposed**: `ToolCallPart` already exists in types.ts! Just add `toolName?`, `streamId?` fields and include it in the `MessagePart` union. No new types needed.                                          | **~5 lines**               |
| 19  | **CVX-21**              | No input length on `sendMessage` prompt. **Original fix was wrong** -- `v.string()` has no length parameter!                                                 | Runtime guard: `if (args.prompt.length > 2000) throw new Error(...)` + client `maxlength={2000}` on 2 textareas.                                                                                                        | **3 lines**                |
| 20  | **I18N-01/02/03/04/08** | Hardcoded English strings in auth forms, chat toasts, admin catch blocks, mailto                                                                             | Replace with `$t()` calls. ~17 individual string replacements.                                                                                                                                                          | **~17 lines**              |

### P3 -- When Convenient

| #   | ID            | Issue                                                                                                                                   | Minimal Fix                                                                                                 |
| --- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 21  | **T01**       | Zero component tests, dead `@testing-library/svelte` dep                                                                                | Remove dep + Knip ignore, or adopt Vitest Browser Mode                                                      |
| 22  | **TW4-01/02** | Legacy `bg-gradient-to-t` and `flex-shrink-0` classes                                                                                   | Find-and-replace: `bg-gradient-to-t` -> `bg-linear-to-t`, `flex-shrink-0` -> `shrink-0`                     |
| 23  | **TS-01**     | Only `noUncheckedIndexedAccess` is valid to add (`verbatimModuleSyntax` already active, `exactOptionalPropertyTypes` unsafe for Svelte) | Add `"noUncheckedIndexedAccess": true` to tsconfig.json                                                     |
| 24  | **DX-15/16**  | `@tolgee/cli` and `vercel` in dependencies instead of devDependencies                                                                   | Move to devDependencies                                                                                     |
| 25  | **T05**       | 19 uses of `waitForLoadState('networkidle')` -- latent risk with Convex WebSocket                                                       | Replace with `domcontentloaded` + element visibility checks                                                 |
| 26  | **SEC-04**    | Test mutations are public `mutation()`                                                                                                  | Accepted risk: dead in prod (no env var). Only DRY improvement: extract shared `requireTestSecret()` helper |

---

## Dismissed Findings (Implementation Review Overturned)

| ID                            | Original Claim                                     | Why Dismissed                                                                                                                      |
| ----------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **R-14**                      | Auth catch-all route needs try/catch               | SvelteKit already handles thrown exceptions from `+server.ts`. Handler is a pure fetch proxy. Adding try/catch would be dead code. |
| **SEC-04** (internalMutation) | Convert to `internalMutation` + HTTP action bridge | Over-engineered (~200 lines for zero security gain). Current secret guard + unset env var in prod = dead code.                     |
| **CVX-21** (original)         | Add `v.string()` length constraint                 | `v.string()` has NO length parameter in Convex's validator API. Runtime guard is the correct approach.                             |

---

## Refuted Findings (Verification Phase)

| ID          | Claim                                           | Why Refuted                                                             |
| ----------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| **SEC-01**  | No rate limiting on auth endpoints              | Better Auth has built-in rate limiting enabled by default in production |
| **R-04**    | Orphaned email route accessible without auth    | `handleDevOnlyRoutes` blocks all `/[lang]/emails/` in production        |
| **PERF-02** | All i18n files eagerly imported (high severity) | Intentional for SSR. 220KB JSON compresses to ~30-40KB.                 |
| **R-12**    | Marketing pages should prerender                | `[[lang]]` param + runtime Tolgee makes prerendering impossible         |

---

## Architecture Strengths

- **100% Svelte 5 runes**: Zero `$:`, zero `on:click`, zero `<slot>`, zero `export let`, zero `createEventDispatcher`, zero `svelte/store`
- **Proper `$bindable()` usage**: 200+ instances across UI components
- **`{#snippet}` / `{@render}` fully adopted**: 44 snippet definitions, 233 render calls
- **Dual-layer auth**: Hooks guard routes + Convex function builders verify at DB layer
- **Materialized counters**: Dashboard totals already use atomic counters in auth triggers
- **Lazy loading done right**: PostHog via `requestIdleCallback`, Rive on desktop only, customer support on interaction
- **Font optimization**: Self-hosted WOFF2, `font-display: swap`, preload for critical weights
- **Icon tree-shaking**: Per-icon imports from both `@lucide/svelte` and `@tabler/icons-svelte`
- **Security headers**: HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy all set
- **Secret scanning**: Varlock pre-commit hook scans staged files before every commit
- **Open redirect protection**: `safeRedirectPath` utility with validation
- **ESLint disable documentation**: Every suppression has an explanatory comment
- **Better Auth rate limiting**: Built-in production rate limiting on auth endpoints (verified)
- **Dev route protection**: Email preview/demo routes properly blocked in production via hooks
