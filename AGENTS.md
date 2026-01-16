# CLAUDE/AGENTS.md

This project is a saas template built with SvelteKit, Convex, Typescript and modern web technologies.

## Development Commands

### Core Development

- `bun run dev` - Start development server (SvelteKit + Convex)
- `bun run build` - Build for production
- `bun run preview` - Preview production build locally

### Quality Checks & Testing

- `bun scripts/quality-check.ts --staged` - Check only staged files (used in git pre-commit hook)
- `bun run test` - Run all tests (E2E + unit)
- `bun run test:e2e` - Run Playwright E2E tests
- `bun run test:unit` - Run Vitest unit tests
- `bun run lint` - Run ESLint
- `bun run format` - Format code with Prettier
- `bun run check` - Run Svelte type checking

### Convex Backend

- `bunx convex dev` - Start Convex development environment
- `bunx convex run tests:init` - Initialize test data
- `bunx convex env set KEY value` - Set Convex environment variables
- `bunx convex env set KEY value --prod` - Set production environment variables

### Convex Platform Guarantees

When reviewing Convex backend code, be aware of these platform guarantees.
See [official docs](https://docs.convex.dev/scheduling/scheduled-functions) for details.

**Scheduler Guarantees:**

- Scheduling from mutations is atomic - if `ctx.scheduler.runAfter()` is called within a mutation, it's part of the transaction. Either the whole mutation succeeds (including the schedule), or it all rolls back.
- Scheduled mutations are guaranteed exactly-once execution. Convex automatically retries internal errors, and only fails on developer errors.
- Actions are different - scheduling from actions is NOT atomic, and actions execute at-most-once (no automatic retry due to potential side effects).

**Components with Built-in Durability:**

- `@convex-dev/resend`: Idempotency keys guarantee exactly-once email delivery, durable execution via workpools. See [component docs](https://www.convex.dev/components/resend).
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
- **Authentication**: Better Auth Svelte Convex Component @convex-dev/better-auth-svelte. We use the local install to get full better auth feature access like passkeys, admin, etc. See <https://labs.convex.dev/better-auth/features/local-install> for authentication documentation. Reference: `docs/references/better-auth/`
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

### Email System

Use the @convex-dev/resend email system for production-ready email delivery. For email templates, use better-svelte-email `docs/references/better-svelte-email/`.

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
- Require test secret configured in Convex backend and .env.test file and test user created once with `bun run setup:test-user`

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

Use the Svelte MCPs Get Documentation tool to get up-to-date Svelte documentation (only call this with a subagent!) and check code with the MCPs autofixer for wrong patterns.

Libraries used in this project are cloned as a submodule in the `docs/references/` folder. ALWAYS launch subagents that research the library code in `docs/references/` to understand its usage and patterns before planning the implementation of a feature that might require the use of any of the mentioned libs.
</important_info>

### Quality Checks

ALWAYS run `bun scripts/quality-check.ts` after a full feature implementation.

### Real-time Features

- Use Convex's `useQuery` for reactive data
- Use Convex's `useMutation` for data modifications
- Use Convex's `useAction` for server-side actions

### Library Conventions and Key Patterns

#### UI Component Conventions

- Always use shadcn-svelte `docs/references/shadcn-svelte/` for ui components first.
- If an ui component doesnt exist in shadcn-svelte, check `@ieedan/shadcn-svelte-extras` `docs/references/shadcn-svelte-extras/`.
- For AI related components, check if ai-elements `docs/references/ai-elements/` has what you need.
- Check cnblocks `docs/references/cnblocks/` for well designed header, feature, pricing, footer and many more marketing blocks.
- Only create a new component if it doesnt exist in any of the above libraries.
- When implementing a new component, follow the existing shadcn-svelte component api and patterns in `src/lib/components/ui/`
- Use Tailwind CSS classes for layout and styling in general. Do not add additional styling classes to the shadcn svelte components. They look good by default.

#### Animations

Simple animations should be implemented with plain CSS whenever possible.
Before implmenting any custom animation, check if sv-animate `docs/references/sv-animate/` has a prebuilt component that can be used.
For custom animations, use Sveltes built in animations, or motion-svelte `docs/references/motion-svelte/` (Framer motion for Svelte). Before implementing any custom animation, read the `docs/animation-rules.md` file.

#### Lists with a lot of items

---

Use `svelte-infinite` `docs/references/svelte-infinite/` with convex-svelte `docs/references/convex-svelte/` pagination for huge lists to automatically load more items as the user scrolls down the list. Before implementing this, research this codebase to see the pattern used in the existing code.

#### Runed (collection of utilities for Svelte 5)

Before creating our own utilities, research the runed library in `docs/references/runed/` to see if the utility you need already exists.
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

Components that make it easy to create resizable panes in your Svelte apps. Reference: `docs/references/paneforge/` - <https://paneforge.com/docs>

#### Threlte

Build interactive 3D apps for the web. Reference: `docs/references/threlte/` - <https://threlte.xyz/>

#### Svelte Flow

A customizable Svelte component for building node-based editors and interactive diagrams by the creators of React Flow. Reference: `docs/references/xyflow/` - <https://svelteflow.dev/>

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
- At the end of each plan, give me a list of unresolved questions to answer, if any.
