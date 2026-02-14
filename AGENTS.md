# CLAUDE/AGENTS.md

This project is a saas template built with SvelteKit, Convex, Typescript and modern web technologies.

## btca

When you need up-to-date information about technologies used in this project, use btca to query source repositories directly.

**Available resources**: svelte, sveltekit, shadcnSvelte, shadcnSvelteExtras, bitsUi, runed, formsnap, superforms, paneforge, svelteInfinite, motionSvelte, svAnimate, threlte, xyflow, cnblocks, aiElements, convex, convexSvelte, convexAgent, convexHelpers, convexResend, convexPresence, convexRag, convexStripe, convexRateLimiter, convexActionCache, convexFilesControl, convexTimeline, convexMigrations, convexAggregate, convexShardedCounter, convexGeospatial, convexWorkpool, convexWorkflow, convexRetrier, convexCrons, betterAuth, betterSvelteEmail, tailwind, vercelAi, tanstackTable, tolgee, playwright, vitest, valibot, nprogress, renovate

### Usage

```bash
btca ask -r <resource> -q "<question>"
```

Use multiple `-r` flags to query multiple resources at once:

```bash
btca ask -r svelte -r convex -q "How do I integrate Convex with SvelteKit?"
```

**Branch config:** When adding a new resource, verify the repo's default branch (`gh api repos/OWNER/REPO --jq '.default_branch'`). btca assumes `main` and fails silently on repos using `master`, `dev`, etc. Always set the `branch` field explicitly.

## Development Commands

### Core Development

- `bun run generate` - To generate the code in the `convex/_generated` directory that includes types required for a TypeScript typecheck. Run this command whenever you make changes to the convex schema.
- `bun run build` - Build for production

NEVER use `bun run dev` to start the development server, its already running in a separate terminal.

### Quality Checks & Testing

- `bun run check` - Run Svelte type checking. Run this between implementations to catch type errors early.
- `bun run test` - Run all tests (E2E + unit)
- `bun run test:e2e` - Run Playwright E2E tests. Always run this after modifying E2E tests!
- `bun run test:unit` - Run Vitest unit tests
- `bun run format` - Format code with Prettier

### Convex Backend

- `bun convex run tests:init` - Initialize test data
- `bun convex env set KEY value` - Set Convex environment variables
- `bun convex env set KEY value --prod` - Set production environment variables

### Convex Components Storage

Convex components have isolated tables and storage namespaces. App code cannot use `ctx.storage.getUrl` to access a component's stored files. Use the component's APIs (e.g., download grants or HTTP routes) to fetch files/blobs instead.

### Convex Platform Guarantees

When reviewing Convex backend code, be aware of these platform guarantees.
See [official docs](https://docs.convex.dev/scheduling/scheduled-functions) for details.

**Scheduler Guarantees:**

- Scheduling from mutations is atomic - if `ctx.scheduler.runAfter()` is called within a mutation, it's part of the transaction. Either the whole mutation succeeds (including the schedule), or it all rolls back.
- Scheduled mutations are guaranteed exactly-once execution. Convex automatically retries internal errors, and only fails on developer errors.
- Actions are different - scheduling from actions is NOT atomic, and actions execute at-most-once (no automatic retry due to potential side effects).

**Components with Built-in Durability:**

- `@convex-dev/resend`: Idempotency keys guarantee exactly-once email delivery, durable execution via workpools (default: 5 retries, 30s initial backoff). Catching errors from `resend.sendEmail()` is valid - they indicate permanent failures (invalid config), not transient network issues. See [component docs](https://www.convex.dev/components/resend).
- `@convex-dev/workpool`: Configurable retry with backoff/jitter, `onComplete` callbacks, parallelism control.

Note: Other components (`@convex-dev/better-auth`, `@convex-dev/rate-limiter`, `@convex-dev/agent`) do NOT have automatic retry for external API calls - standard error handling applies.

### Tolgee CLI

These commands use `dotenv` to load the local TOLGEE_API_KEY from `.env.local`:

- `bun run i18n:pull` - Download latest translations from Tolgee Cloud. Run this ALWAYS before making any changes to the `src/i18n/*` json translation files.
- When adding new translation keys, ALWAYS add translations for ALL languages in the `src/i18n/*` json translation files.
- `bun run i18n:push` - Upload local translations. ALWAYS run this after making any changes to the `src/i18n/*` json translation files. Otherwise, your changes wont be pushed to the cloud! Run with `-- --tag-new-keys draft` to tag new keys as e.g. 'draft'

  Use tags to organize translation keys:
  - `draft` - New keys awaiting review
  - `feature-*` - Keys for specific features (e.g., `feature-auth`, `feature-checkout`)
  - `v*.*.*` - Keys added in specific versions (e.g., `v1.5.0`)

- `bun run i18n:cleanup` - Find every key that used to be in production but is now missing from the code; mark it as deprecated and stop calling it a production key.

  Tags automatically set by the `scripts/vercel-deploy.ts` script:

- `preview` - Automatically set for preview deployment keys
- `production` - Automatically set for production deployment keys
- `deprecated` - Keys no longer in code (safe to delete after review)

## Architecture Overview

### Tech Stack

- **Frontend**: SvelteKit, Svelte 5 (runes syntax!), Tailwind CSS v4, Shadcn Svelte
- **Backend**: Convex (real-time database + serverless functions)
- **Authentication**: Better Auth Svelte Convex Component @convex-dev/better-auth-svelte. We use the local install to get full better auth feature access like passkeys, admin, etc. See <https://labs.convex.dev/better-auth/features/local-install> for authentication documentation.
- **Internationalization**: Tolgee (open source / cloud-hosted translation management with URL-based localization and in-context editing)
- **Testing**: Playwright (E2E), Vitest (unit)
- **Package Manager**: Bun. ALWAYS use bun instead of npm to run commands.

### Project Structure

- `src/lib/convex/` - Convex backend functions, schema, and auth config
- `src/lib/components/` - UI components
- `src/lib/i18n/` - Internationalization configuration
- `src/routes/[[lang]]/` - SvelteKit routes with language parameter
- `src/hooks.server.ts` - Server hooks for auth and language middleware

**Using translations in components:**

```svelte
<script lang="ts">
	import { T } from '@tolgee/svelte';
</script>

<T keyName="welcome_message" />
<T keyName="greeting" params={{ name: 'John' }} />
```

**SEO meta tags:**

```svelte
<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
</script>

<SEOHead title="About Us" description="Learn more" />
```

- Every new `+page.svelte` route must include `SEOHead`.
- For localized routes under `src/routes/[[lang]]/`, `SEOHead` title and description must use translated `meta.*` keys in all 4 locale files (`en`, `de`, `es`, `fr`).
- `meta.*.title` values must be page-title only and must NOT include the site suffix or brand name. `SEOHead` appends `| SaaS Starter` automatically (use `"Settings"`, not `"Settings - SaaS Starter"`).

### Email System

Use the @convex-dev/resend email system for production-ready email delivery. Use btca with `convexResend` resource for component docs. For svelte email docs and templates, use btca with `betterSvelteEmail` resource.

#### Email System Architecture

```text
src/lib/convex/emails/
├── resend.ts              # Resend client configuration
├── events.ts              # Webhook event handlers
├── send.ts                # Email sending mutations
├── queries.ts             # Email status queries
└── mutations.ts           # Email management (cancel, status)
```

Emails are sent via internal mutations using the Resend component.

#### Email Event Tracking

Email events are automatically stored in the `emailEvents` table:

- `email.delivered` - Successfully delivered
- `email.bounced` - Hard or soft bounce
- `email.complained` - Marked as spam
- `email.opened` - Email opened (requires tracking enabled in Resend)
- `email.clicked` - Link clicked (requires tracking enabled in Resend)

Query email events using:

```typescript
const events = await ctx.runQuery(api.emails.queries.getEmailEvents, {
	emailId: 'email-id'
});
```

### PostHog Analytics

This project uses **PostHog** for product analytics with an optional **Cloudflare Worker proxy** to bypass ad blockers while minimizing costs.

## Testing Guidelines

### E2E Playwright Tests

- Located in `e2e/` directory
- Test users are automatically created with unique emails each run (via globalSetup) and deleted after tests (via globalTeardown)
- Requires `.env.test` with: AUTH_E2E_TEST_SECRET (must match Convex backend) and PUBLIC_CONVEX_URL
- See `.env.test.example` for setup instructions

#### `data-testid` convention

- Prefer `data-testid` for all interactive controls and dynamic list/table content that E2E tests assert.
- Use stable, feature-scoped kebab-case IDs: `<feature>-<element>-<action>` (example: `admin-users-pagination-next`).
- Add test IDs on:
  - page root container
  - loading/empty states
  - filters/search/sort controls
  - pagination controls and page indicators
  - repeatable row/cell primitives needed for assertions (for example role/status badges and email cells)
- Avoid translated/user-generated strings in test IDs.
- Keep IDs deterministic and never include runtime values unless the test explicitly needs entity-specific targeting.

#### Convex table kit usage

- Use `createConvexCursorTable(...)` for table state orchestration (URL params, cursor stack, search/filter/sort/page-size resets, and next/previous prefetching).
- Use `ConvexCursorTableShell` for common chrome (search, toolbar slots, pagination controls, page indicator, rows-per-page).
- Required backend contract:
  - list query args: `cursor`, `numItems`, optional `search`, optional filters, optional `sortBy`
  - list query return: `{ items, continueCursor, isDone }`
  - count query args: same search/filter set (no cursor)
  - count query return: `number`
- Canonical URL keys for tables: `search`, `sort`, `page`, `page_size`, `cursor`, plus feature filter keys (for example `role`, `status`, `type`).
- Canonical sort serialization: `field.dir`.
- Default URL values must be omitted from links (`search=''`, `sort=''`, `page='1'`, `page_size` default, and default filter values).
- Shell testid convention:
  - search: `<prefix>-search`
  - page indicator: `<prefix>-page-indicator`
  - pagination: `<prefix>-pagination-prev` / `<prefix>-pagination-next` / `<prefix>-pagination-last` (first page button uses lg-only variant)
  - keep route-specific row/cell IDs for assertions (for example `recipient-row-*`, `admin-users-email-cell`).

### Vitest Unit Tests

## Development

<important_info>
Use Svelte 5's new syntax with TypeScript for reactivity, props, events, and content passing. Prioritize this over Svelte 4 syntax.
Key Changes:
Reactivity: $state for reactive state, $derived for computed values, $effect for side effects.
Props: Use $props() instead of export let.
Events: Use HTML attributes (e.g., onclick) instead of on:.
Content: Use {#snippet} and {@render} instead of slots.
Quick Examples:
State & Events: `<script lang="ts">let count = $state(0); </script> <button onclick={() => count += 1}>{count}</button>`
Derived: let doubled = $derived(count \* 2);
Props: <script lang="ts">let { name = 'World' } = $props(); </script> `<p>Hello, {name}!</p>`
Binding: `<script lang="ts">let { value = $bindable() } = $props(); </script> <input bind:value={value} />`
Snippets: `<div>{@render header()}</div> with <Child>{#snippet header()}<h1>Header</h1>{/snippet}</Child>`
Class Store: class Counter { count = $state(0); increment() { this.count += 1; } } export const counter = new Counter();
Notes:
Type $derived explicitly (e.g., let items: Item[] = $derived(...)) for arrays in TypeScript.
Default to new syntax for Svelte 5 benefits.
Avoid stores unless necessary for pub/sub.

Use the Svelte MCPs Get Documentation tool to get up-to-date Svelte documentation (only call this with a subagent!) and check code with the MCPs autofixer for wrong patterns. Query the svelte repo with btca for new features like remote functions.

Prop names must match the parent's passed prop name exactly.
</important_info>

### Static Checks

ALWAYS run `bun scripts/static-checks.ts --staged` after a full feature implementation.

### Real-time Features

- Use Convex's `useQuery` for reactive data
- Use Convex's `useMutation` for data modifications
- Use Convex's `useAction` for server-side actions

### Library Conventions and Key Patterns

#### Import Conventions

**CRITICAL: Avoid Barrel Imports for Performance**

Always use individual imports instead of barrel imports to enable tree-shaking and reduce bundle size:

```typescript
// ❌ BAD - Barrel import (loads entire library, ~4.5MB for Lucide)
import { ArrowUp, Camera, X } from '@lucide/svelte';

// ✅ GOOD - Individual imports (only loads what's needed, ~5KB per icon)
import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
import CameraIcon from '@lucide/svelte/icons/camera';
import XIcon from '@lucide/svelte/icons/x';
```

This applies to all icon libraries and large component libraries. Individual imports can reduce bundle size by 80-95% through proper tree-shaking.

#### UI Component Conventions

- Always use shadcn-svelte for ui components first. Use btca with `shadcnSvelte` resource.
- If a ui component doesn't exist in shadcn-svelte, check `@ieedan/shadcn-svelte-extras`. Use btca with `shadcnSvelteExtras` resource.
- For AI related components, check if ai-elements has what you need. Use btca with `aiElements` resource.
- Check cnblocks for well designed header, feature, pricing, footer and many more marketing blocks. Use btca with `cnblocks` resource.
- Only create a new component if it doesn't exist in any of the above libraries.
- When implementing a new component, follow the existing shadcn-svelte component api and patterns in `src/lib/components/ui/`
- Use Tailwind CSS classes for layout and styling in general. Do not add additional styling classes to the shadcn svelte components. They look good by default.
- Prefer reusable Tailwind utilities (defined globally with `@utility` in `src/routes/layout.css`) over component-local `<style>` blocks for shared styling patterns (for example `no-drag`).

#### Keyboard Shortcuts

Never hardcode `⌘` or `Ctrl`. Use `cmdOrCtrl` / `optionOrAlt` from `$lib/hooks/is-mac.svelte` to show the correct modifier per platform.

#### Animations

Simple animations should be implemented with plain CSS whenever possible.
Before implementing any custom animation, check if sv-animate has a prebuilt component that can be used. Use btca with `svAnimate` resource.
For custom animations, use Sveltes built in animations, or motion-svelte (Framer motion for Svelte). Use btca with `motionSvelte` resource. Before implementing any custom animation, read the `docs/animation-rules.md` file. You must follow the rules in the file when implementing your own animations!
For page transitions and state changes, use the View Transitions API. See `docs/animation-rules.md` for setup and patterns.

#### Forms

Use this decision policy before implementing any form.

**Field UI conventions (all forms):**

- `import * as Field from '$lib/components/ui/field/index.js'`
- Wrap grouped controls in `Field.Group`.
- Do not add explicit spacing/layout utility classes to `Field.Group` (for example `gap-*`, `space-y-*`, `mt-*`, `mb-*`, `px-*`, `py-*`). Keep `Field.Group` spacing implicit.
- Each control should be a `Field.Field` with label + input + optional description/error.
- Keep `Field.Error` directly under its input inside the same `Field.Field` for field-level errors.
- Form-level errors (e.g. banners) may be outside `Field.Field`.
- Prefer one primary inline error message per field.

**Remote functions decision tree:**

1. Is this a Better Auth/session-sensitive flow (`signin`, `signup`, `forgot/reset`, `changeEmail`, `changePassword`)?
   - Yes -> Use existing client-side `authClient` pattern.
   - No -> Continue.
2. Is this realtime/high-frequency/optimistic interaction (chat composers, inline table edits, streaming workflows)?
   - Yes -> Use Convex client `useMutation` / `useAction` patterns.
   - No -> Continue.
3. Is this a one-shot server mutation with clear submit lifecycle and schema validation needs?
   - Yes -> Use SvelteKit remote `form(schema, handler)` with Valibot.
   - No -> Keep local/client form handling.
4. Does it include file upload?
   - If pre-upload/presigned-upload is already part of UX, keep upload client-side and only remote-submit final metadata if needed.

**Current repo guidance:**

- Good remote-form candidates: admin/settings-style one-shot forms (e.g. add-email dialog).
- Not recommended: auth pages, account email/password settings auth mutations, community chat submit, generic UI-only/dialog wrapper forms.

For remote-form implementation workflow only, read `docs/form-instructions.md`.

#### Lists with a lot of items

---

Use `svelte-infinite` with convex-svelte pagination for huge lists to automatically load more items as the user scrolls down the list. Use btca with `svelteInfinite` and `convexSvelte` resources. Before implementing this, research this codebase to see the pattern used in the existing code.

#### Runed (collection of utilities for Svelte 5)

Before creating our own utilities, research the runed library to see if the utility you need already exists. Use btca with `runed` resource.

- For URL/query state, prefer Runed `useSearchParams` over manual `$page.url` + `goto` wiring.
- Exception: in high-frequency selection UIs where query-param writes would cause unwanted Convex refetches (for example `src/routes/[[lang]]/admin/support/+page.svelte` thread selection), manual URL handling is acceptable.
  Here is a list of the utilities available:

<resource: Watches for changes and runs asynchronous data fetching, combining reactive state management with async operations.>
<watch: Runs a callback whenever specified reactive sources change. Includes variants like watch.pre (uses $effect.pre) and watchOnce / watchOnce.pre (run only once).>
<Context: A type-safe wrapper around Svelte's Context API for sharing data between components without prop drilling.>
<Debounced: A simple wrapper over useDebounce that returns a debounced state, allowing cancellation or immediate updates.>
<FiniteStateMachine: Defines a strongly-typed finite state machine for managing states and transitions based on events. Supports actions, lifecycle methods, wildcard handlers, and debouncing.>
<PersistedState: A reactive state manager that persists and synchronizes state across browser sessions and tabs using Web Storage APIs (localStorage or sessionStorage).>
<Previous: Tracks and provides reactive access to the previous value of a getter function.>
<StateHistory: Tracks changes to a getter's value, logging them and providing undo/redo functionality.>
<activeElement: Reactively tracks and provides access to the currently focused DOM element, searching through Shadow DOM boundaries.>
<ElementRect: Reactively tracks an element's dimensions (width, height) and position (top, left, right, bottom, x, y), updating automatically.>
<ElementSize: Reactively tracks only an element's dimensions (width, height), updating automatically.>
<IsFocusWithin: Tracks whether any descendant element has focus within a specified container element.>
<IsInViewport: Tracks if an element is visible within the current viewport, using useIntersectionObserver.>
<useIntersectionObserver: Watches for intersection changes of a target element relative to an ancestor element or the viewport. Allows pausing, resuming, and stopping the observer.>
<useMutationObserver: Observes changes (like attribute modifications) in a specified DOM element. Allows stopping the observer.>
<useResizeObserver: Detects and reports changes in the size (contentRect) of an element. Allows stopping the observer.>
<useEventListener: Attaches an event listener to a target (like document or an element reference) that is automatically disposed of when the component is destroyed or the target changes.>
<IsIdle: Tracks user activity (mouse, keyboard, touch) to determine if the user is idle based on a configurable timeout. Provides the last active time.>
<onClickOutside: Detects clicks outside a specified element and executes a callback. Useful for closing modals or dropdowns. Offers controls to start/stop the listener.>
<PressedKeys: Tracks which keyboard keys are currently being pressed. Allows checking for specific keys or getting all pressed keys.>
<useGeolocation: Provides reactive access to the browser's Geolocation API, including position coordinates, timestamp, error state, and support status. Allows pausing and resuming location tracking.>
<AnimationFrames: A wrapper for requestAnimationFrame that includes FPS limiting and provides frame metrics like delta time and current FPS.>
<useDebounce: Creates a debounced version of a callback function, delaying execution until after a specified period of inactivity. Allows forcing immediate execution or cancellation.>
<IsMounted: A simple class that returns the mounted state (true or false) of the Svelte component it's instantiated in.>

#### PaneForge

Components that make it easy to create resizable panes in your Svelte apps. Use btca with `paneforge` resource.

#### Threlte

Build interactive 3D apps for the web. Use btca with `threlte` resource. <https://threlte.xyz/>

#### Svelte Flow

A customizable Svelte component for building node-based editors and interactive diagrams by the creators of React Flow. Use btca with `xyflow` resource. <https://svelteflow.dev/>

### Vercel

- `vercel` - Deploy to Vercel
- `vercel --prod` - Deploy to production
- `vercel env ls` - List environment variables
- `printf "value" | vercel env add KEY environment` - Add environment variable (using printf avoids trailing newlines added when using heredoc)
- `vercel env rm KEY environment` - Remove environment variable
- `vercel logs` - View deployment logs
- `vercel domains` - Manage custom domains

## Plan Mode

- Make the plan extremely concise. Sacrifice grammar for the sake of concision.
- At the end of each plan, give me a list of unresolved questions to answer, if any, using the question tool.

## esbuild/Vite Error: The service was stopped

`bun i -f` should fix the issue.

## Lighthouse

### 1. Generate report

`npx lighthouse URL --only-categories=accessibility --output=json --chrome-flags="--headless=new" 2>/dev/null > /tmp/lh.json`

### 2. Query score + failing elements

`cat /tmp/lh.json | jq '{score: (.categories.accessibility.score*100|floor), failures: [.audits|to_entries[]|select(.value.score==0 and .value.scoreDisplayMode=="binary")|{id:.key,elements:[.value.details.items[]?|{selector:.node.selector,snippet:.node.snippet}]}]}'`

Swap accessibility for performance, seo, best-practices as needed.
