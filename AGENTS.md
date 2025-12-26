# CLAUDE/AGENTS.md

This project is a saas template built with SvelteKit, Convex, and modern web technologies.

## Development Commands

### Core Development

- `bun run dev` - Start development server (SvelteKit + Convex)
- `bun run build` - Build for production
- `bun run preview` - Preview production build locally

### Quality Checks & Testing

- `./quality-check.sh --staged` - Check only staged files (used in git pre-commit hook)
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

### Tolgee CLI

- `bunx tolgee pull` - Download translations from Tolgee Cloud
- `bunx tolgee push` - Upload local translations to Tolgee Cloud
- `bunx tolgee push --tag-new-keys draft` - Push and tag new keys as draft
- `bunx tolgee tag --filter-extracted --tag production` - Tag active keys as production
- `bunx tolgee tag --filter-not-extracted --filter-tag production --tag deprecated --untag production` - Find and mark deprecated keys

## Architecture Overview

### Tech Stack

- **Frontend**: SvelteKit, Svelte 5 (runes syntax), Tailwind CSS v4, Skeleton UI
- **Backend**: Convex (real-time database + serverless functions)
- **Authentication**: Convex Auth with OAuth (Google) and email/password via @mmailaender/convex-auth-svelte
- **Internationalization**: Tolgee (cloud-hosted translation management with URL-based localization)
- **Testing**: Playwright (E2E), Vitest (unit)
- **Package Manager**: Bun

### Project Structure

- `src/lib/convex/` - Convex backend functions, schema, and auth config
- `src/lib/components/` - UI components (shadcn-style components)
- `src/lib/i18n/` - Internationalization configuration
- `src/routes/[[lang]]/` - SvelteKit routes with language parameter
- `src/hooks.server.ts` - Server hooks for auth and language middleware
- `convex.json` - Points Convex functions to `src/lib/convex/`

### Internationalization (i18n)

This project uses **Tolgee** for cloud-hosted translation management with SEO-friendly URL-based localization.

#### Supported Languages

- English (`en`) - Default
- German (`de`)
- Spanish (`es`)
- French (`fr`)

#### Key Features

- **URL-based routing**: All routes are prefixed with language code (e.g., `/en/about`, `/de/uber-uns`)
- **SEO optimized**: Automatic hreflang tags, canonical URLs, and Open Graph locale tags
- **Cloud-hosted**: Translations managed via Tolgee Cloud (https://app.tolgee.io)
- **In-context editing**: Edit translations directly in the browser during development
- **Auto language detection**: Detects user's preferred language from Accept-Language header
- **Production-ready**: Uses staticData (bundled translations) - no API keys exposed, faster page loads

#### Production Architecture

**Development Mode:**

- Translations loaded via `staticData` (from `src/i18n/` files)
- DevTools enabled for in-context editing (requires `VITE_TOLGEE_API_KEY`)
- Hot-reload translations with `bun run i18n:pull`

**Production Mode:**

- Translations bundled at build-time via `staticData`
- DevTools automatically removed (tree-shaken)
- No API keys in production bundle (secure)
- No runtime API calls (faster performance)
- CI/CD automatically pulls latest translations before build

**Why staticData over runtime API loading?**

- ✅ Security: No API keys exposed to clients
- ✅ Performance: Translations bundled with app (no API calls)
- ✅ Reliability: No dependency on Tolgee servers at runtime
- ✅ Official Tolgee best practice for production

#### Quick Setup

1. Create a Tolgee account at https://app.tolgee.io
2. Add `VITE_TOLGEE_API_KEY` to `.env.local`
3. Add translations in Tolgee Cloud or use in-context editor

#### Usage

**Using translations in components:**

```svelte
<script lang="ts">
	import { T } from '@tolgee/svelte';
</script>

<T keyName="welcome_message" />
<T keyName="greeting" params={{ name: 'John' }} />
```

**Language switcher:**

```svelte
<script lang="ts">
	import LanguageSwitcher from '$lib/components/LanguageSwitcher.svelte';
</script>

<LanguageSwitcher />
```

**SEO meta tags:**

```svelte
<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
</script>

<SEOHead title="About Us" description="Learn more" />
```

#### Tolgee CLI Workflow

**Installation:**

```bash
bun add -g @tolgee/cli
```

**Common Commands:**

1. **Pull translations before deployment:**

   ```bash
   bun run i18n:pull
   ```

   Downloads latest translations from Tolgee Cloud to local files.

   **Note:** The i18n scripts in package.json use `dotenv` to load the TOLGEE_API_KEY from `.env.local`.
   This ensures the commands work in VSCode tasks and other environments where environment variables aren't automatically loaded.

2. **Push local translations to platform:**

   ```bash
   bun run i18n:push -- --tag-new-keys draft
   ```

   Uploads local translation files and tags new keys for review.

3. **Tag management for lifecycle tracking:**

   ```bash
   # Tag all keys currently in code as production (requires adding this to package.json scripts)
   bunx dotenv -f .env.local run -- bunx tolgee tag --filter-extracted --tag production

   # Find keys no longer in code and mark as deprecated
   bun run i18n:cleanup
   ```

**Tagging Strategy:**

Use tags to organize translation keys throughout their lifecycle:

- `draft` - New keys awaiting review
- `production` - Keys actively used in production code
- `deprecated` - Keys no longer in code (safe to delete after review)
- `feature-*` - Keys for specific features (e.g., `feature-auth`, `feature-checkout`)
- `v*.*.*` - Keys added in specific versions (e.g., `v1.5.0`)

**Recommended Workflow:**

1. **Development:** Add translations using in-context editor or `<T>` component
2. **Before Release:**

   ```bash
   # Tag current keys as production (add version tag if needed)
   bunx dotenv -f .env.local run -- bunx tolgee tag --filter-extracted --tag production --tag v1.5.0

   # Pull latest translations for build
   bun run i18n:pull
   ```

3. **After Release:**
   ```bash
   # Find and tag deprecated keys
   bun run i18n:cleanup
   ```
4. **Cleanup:** Review deprecated keys in Tolgee Cloud, then delete

**CLI Tag Filtering Options:**

- `--filter-tag <tag>` - Include only keys with tag (supports `*` wildcard)
- `--filter-not-tag <tag>` - Exclude keys with tag
- `--filter-extracted` - Include keys found in code
- `--filter-not-extracted` - Include keys NOT found in code
- `--tag <tag>` - Add tag to filtered keys
- `--untag <tag>` - Remove tag from filtered keys (supports `*` wildcard)

**Configuration:**

Tolgee CLI is configured via `.tolgeerc` in the project root. The project uses a **Project API Key** (starts with `tgpak_`), which automatically includes the project ID - no manual configuration needed.

The CLI uses the `TOLGEE_API_KEY` environment variable for authentication in CI/CD (see `.env.local.example`). Locally, the key is stored in `.tolgeerc` (which is gitignored).

**CI/CD Integration:**

Tolgee CLI is integrated into the CI/CD pipeline to automatically:

1. Tag all translation keys found in code as "production"
2. Pull latest translations from Tolgee Cloud before build

**Implementation locations:**

- **GitHub Actions**: See [.github/workflows/quality-checks.yml](.github/workflows/quality-checks.yml) for CI configuration
- **Vercel**: See [vercel.json](vercel.json) for the build command configuration
- **Environment variables**: Add `TOLGEE_API_KEY` to GitHub Secrets and Vercel Environment Variables

**Finding deprecated keys:**

After deployments, identify unused translation keys:

```bash
# Find keys tagged "production" but not in current code
bun run i18n:cleanup
```

Review deprecated keys in Tolgee Cloud, then delete them manually to avoid accidental data loss.

For complete documentation, see `docs/i18n-setup.md`.

### Authentication Library

This project uses [@mmailaender/convex-auth-svelte](https://www.npmjs.com/package/@mmailaender/convex-auth-svelte) for authentication wrapper functionality. The library provides:

- Client-side auth hooks and utilities
- Server-side auth handlers and route protection
- Seamless integration with Convex Auth

### Authentication Flow

1. **Client Setup**: `setupConvexAuth()` in root layout initializes auth state
2. **Server Hooks**: `handleAuth` in `hooks.server.ts` handles auth requests
3. **Route Protection**: Uses `createRouteMatcher` for pattern-based protection
4. **Auth State**: Available via `useAuth()` hook on client, `isAuthenticated()` on server

### Key Patterns

Instructions for LLMs: <s>Always use Svelte 5 runes and Svelte 5 syntax. Runes do not need to be imported, they are globals. $state() runes are always declared using `let`, never with `const`. When passing a function to $derived, you must always use $derived.by(() => ...). Error boundaries can only catch errors during component rendering and at the top level of an $effect inside the error boundary. Error boundaries do not catch errors in onclick or other event handlers.</s>

#### Svelte 5 Runes

- Use `$state()` for reactive state
- Use `$derived()` for computed values
- Use `$props()` to access component props
- Use `$effect()` for side effects

#### Component Conventions

- Use shadcn-svelte for components first before checking `@ieedan/shadcn-svelte-extras`
- Check `@ieedan/shadcn-svelte-extras` for existing components before creating new ones
- Follow existing component patterns in `src/lib/components/ui/`
- Use Tailwind CSS classes for styling. Do not add additional classes to the shadcn components unless specified otherwise by the user.
- Components use `.svelte` extension with TypeScript

#### Convex Integration

- Schema defined in `src/lib/convex/schema.ts`
- Auth config in `src/lib/convex/auth.config.ts`
- Queries and mutations in respective `.ts` files
- Real-time subscriptions handled automatically

### Email System

This project uses the **@convex-dev/resend** component for production-ready email delivery.

#### Features

- **Automatic Queuing & Batching** - Efficiently handles bulk email sending
- **Durable Execution** - Guarantees delivery even if servers restart
- **Built-in Idempotency** - Prevents duplicate email sends
- **Rate Limit Compliance** - Automatic handling of API rate limits
- **Event Tracking** - Webhooks for delivery, bounces, complaints, opens, clicks
- **Test Mode** - Safe development with delivery restrictions

#### Email System Architecture

```
src/lib/convex/emails/
├── resend.ts              # Resend client configuration
├── events.ts              # Webhook event handlers
├── send.ts                # Email sending mutations (simple inline text)
├── queries.ts             # Email status queries
└── mutations.ts           # Email management (cancel, status)
```

#### Sending Emails

Emails are sent via internal mutations using the Resend component:

```typescript
import { internal } from './_generated/api';

// Send verification email
await ctx.runMutation(internal.emails.send.sendVerificationEmail, {
	email: 'user@example.com',
	code: '12345678',
	expiryMinutes: 20
});
```

#### Email Event Tracking

Email events are automatically stored in the `emailEvents` table:

- `email.delivered` - Successfully delivered
- `email.bounced` - Hard or soft bounce
- `email.complained` - Marked as spam
- `email.opened` - Email opened (requires tracking)
- `email.clicked` - Link clicked (requires tracking)

Query email events using:

```typescript
const events = await ctx.runQuery(api.emails.queries.getEmailEvents, {
	emailId: 'email-id'
});
```

#### Webhook Setup

Configure webhook in Resend dashboard to point to:

```
https://your-deployment.convex.site/resend-webhook
```

The webhook endpoint is configured in `src/lib/convex/http.ts`.

#### Future: Email Template System

Planned integration with `svelte-email` for visual email templates that automatically inherit styles from the app's design system. See `docs/email-template-system.md` for architecture details.

### PostHog Analytics & Proxy

This project uses **PostHog** for product analytics with an optional **Cloudflare Worker proxy** to bypass ad blockers while minimizing costs.

#### Cost-Optimized Architecture

**Smart Fallback Strategy:**

1. **Default**: Direct connection to PostHog (free, no proxy costs)
2. **Fallback**: Cloudflare Worker proxy (only when direct access is blocked by ad blockers)

This approach reduces Cloudflare Worker costs by **~99%** while maintaining **100% analytics coverage**.

#### Key Features

- **Automatic Fallback** - Transparently switches to proxy when PostHog is blocked
- **Cost Optimization** - Only 5-10% of users (with ad blockers) use the proxy
- **Accurate Geolocation** - Preserves client IP addresses via X-Forwarded-For header
- **Zero Data Loss** - Captures events from all users, including those with ad blockers
- **Privacy Compliant** - Removes cookies and only forwards necessary headers

#### Implementation

**Client-Side** (`src/routes/+layout.ts`):

```typescript
// Try direct PostHog access first
try {
	await fetch(PUBLIC_POSTHOG_HOST, { method: 'HEAD', mode: 'no-cors' });
	apiHost = PUBLIC_POSTHOG_HOST; // Direct access works (free)
} catch (error) {
	apiHost = PUBLIC_POSTHOG_PROXY_HOST; // Fallback to proxy (~5-10% of users)
}

posthog.init(PUBLIC_POSTHOG_API_KEY, {
	api_host: apiHost,
	ui_host: 'https://eu.posthog.com'
});
```

**Cloudflare Worker** (`docs/posthog-proxy-worker.js`):

- Proxies requests to `eu.i.posthog.com`
- Caches static assets for performance
- Preserves client IP for accurate geolocation
- Removes cookies for privacy

#### Setup Instructions

**For complete setup guide, see [`docs/posthog-proxy-setup.md`](docs/posthog-proxy-setup.md)**

**Quick Steps:**

1. Create Cloudflare Worker with code from `docs/posthog-proxy-worker.js`
2. Add custom domain (avoid obvious names like "tracking" or "analytics")
3. Set `PUBLIC_POSTHOG_PROXY_HOST` in `.env.local` and Vercel
4. Deploy and test with/without ad blocker

#### Environment Variables

**Local Development** (`.env.local`):

```env
PUBLIC_POSTHOG_API_KEY=phc_your_api_key_here
PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
PUBLIC_POSTHOG_PROXY_HOST=https://metrics.yourdomain.com  # Optional
```

**Production** (Vercel Dashboard):

- `PUBLIC_POSTHOG_API_KEY` - PostHog project API key
- `PUBLIC_POSTHOG_HOST` - PostHog region URL (`https://eu.i.posthog.com` or `https://us.i.posthog.com`)
- `PUBLIC_POSTHOG_PROXY_HOST` - Your Cloudflare Worker custom domain (optional)

#### Cost Expectations

**Without Proxy:**

- Data loss: ~5-10% of users (ad blocker users)
- Cloudflare cost: $0/month

**With Always-On Proxy:**

- Data loss: 0%
- Cloudflare cost: May exceed free tier (100k requests/day)

**With Smart Fallback (This Implementation):**

- Data loss: 0%
- Cloudflare cost: $0/month (well within free tier)
- Worker invocations: ~5-10k/month (only ad blocker users)

## Environment Configuration

This project uses multiple environment variable configurations organized by purpose and platform. Each `.example` file corresponds to where variables should be set.

### Configuration Files Overview

| File                                               | Purpose                     | Platform                     | When Used                     |
| -------------------------------------------------- | --------------------------- | ---------------------------- | ----------------------------- |
| [.env.local.example](.env.local.example)           | Local development           | Your machine                 | Running `bun run dev`         |
| [.env.ci.example](.env.ci.example)                 | CI testing & quality checks | GitHub Actions Secrets       | Every push/PR                 |
| [.env.deployment.example](.env.deployment.example) | Automatic deployments       | Vercel Environment Variables | Preview/PR/Production deploys |
| [.env.convex.example](.env.convex.example)         | Backend configuration       | Convex Dashboard             | Backend runtime               |
| [.env.test.example](.env.test.example)             | E2E testing                 | Local + GitHub Actions       | Running tests                 |

### Quick Setup Guide

**1. Local Development** (`.env.local`)

```bash
# Copy example and fill in values
cp .env.local.example .env.local
# Required: CONVEX_DEPLOYMENT, PUBLIC_CONVEX_URL, VITE_TOLGEE_API_KEY, TOLGEE_API_KEY
```

**2. GitHub Actions** (Repository Secrets)

```bash
# Add to: Repository Settings → Secrets → Actions
# Required: TEST_CONVEX_URL, AUTH_E2E_TEST_SECRET, TOLGEE_API_KEY
# See .env.ci.example for details
```

**3. Vercel** (Environment Variables)

```bash
# Add to: Vercel Dashboard → Project Settings → Environment Variables
# Required: PUBLIC_CONVEX_URL, CONVEX_DEPLOY_KEY, TOLGEE_API_KEY
# See .env.deployment.example for details
```

**4. Convex Backend** (via CLI)

```bash
# Required: RESEND_API_KEY, AUTH_EMAIL
# Optional: AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, RESEND_WEBHOOK_SECRET
# For testing: AUTH_E2E_TEST_SECRET
bunx convex env set KEY value
# See .env.convex.example for complete list
```

### Environment Variable Summary

**Convex Backend** (set via `bunx convex env set`):

- `BETTER_AUTH_SECRET` - Session signing secret (required)
- `RESEND_API_KEY` - Email sending (required)
- `AUTH_EMAIL` - Sender email address (required)
- `RESEND_WEBHOOK_SECRET` - Webhook verification (optional)
- `AUTH_GOOGLE_ID` - Google OAuth client ID (optional)
- `AUTH_GOOGLE_SECRET` - Google OAuth secret (optional)
- `AUTH_E2E_TEST_SECRET` - E2E test authentication (required for CI/CD)

**Vercel Deployments** (Vercel Dashboard):

- `PUBLIC_CONVEX_URL` - Production Convex URL (runtime)
- `CONVEX_DEPLOY_KEY` - Deploy Convex functions (build-time)
- `TOLGEE_API_KEY` - Pull translations (build-time)

**GitHub Actions** (Repository Secrets):

- `TEST_CONVEX_URL` - Test Convex deployment
- `AUTH_E2E_TEST_SECRET` - E2E test auth
- `TOLGEE_API_KEY` - Tag production keys

**Local Development** (`.env.local`):

- `CONVEX_DEPLOYMENT` - Dev deployment name
- `PUBLIC_CONVEX_URL` - Dev Convex URL
- `VITE_TOLGEE_API_KEY` - DevTools in-context editing
- `TOLGEE_API_KEY` - CLI for pulling translations

**E2E Testing** (`.env.test`):

- `AUTH_E2E_TEST_SECRET` - Test authentication
- `PUBLIC_E2E_TEST` - Enable test mode

## Testing Guidelines

### E2E Tests

- Located in `e2e/` directory
- Use Playwright with Chromium
- Require test secret configured in Convex backend
- Initial test data setup: `bunx convex run tests:init`

### Unit Tests

- Use Vitest for unit testing
- Mock Convex client for isolated testing
- Located alongside source files

## Deployment

### Vercel Deployment

1. Set `PUBLIC_CONVEX_URL` environment variable
2. Set `CONVEX_DEPLOY_KEY` for automatic Convex function deployment
3. Deploy with `vercel --prod`

### GitHub Actions

- Automated quality checks on push/PR
- Uses development Convex environment for tests
- Requires secrets: `TEST_CONVEX_URL`, `AUTH_E2E_TEST_SECRET`

## Development Tips

### Quality Checks

Always run `./quality-check.sh` before committing to ensure:

- Code is properly formatted (Prettier)
- No linting errors (ESLint)
- Type safety (svelte-check)
- No spelling mistakes (misspell)
- Tests pass
- Build succeeds

### Route Protection Patterns

- **Auth-first**: Most routes protected, whitelist public routes
- **Public-first**: Most routes public, blacklist protected routes
- Protection configured in `src/hooks.server.ts`

### Real-time Features

- Convex automatically handles WebSocket connections
- Use `useQuery` for reactive data
- Use `useMutation` for data modifications
- Initial data can be passed from server for SSR

<important_info>
Use Svelte 5's new syntax with TypeScript for reactivity, props, events, and content passing. Prioritize this over Svelte 4 syntax unless specified otherwise.
Key Changes:
Reactivity: $state for reactive state, $derived for computed values, $effect for side effects.
Props: Use $props() instead of export let.
Events: Use HTML attributes (e.g., onclick) instead of on:.
Content: Use {#snippet} and {@render} instead of slots.
Quick Examples:
State & Events: <script lang="ts">let count = $state(0); </script> <button onclick={() => count += 1}>{count}</button>
Derived: let doubled = $derived(count \* 2);
Props: <script lang="ts">let { name = 'World' } = $props(); </script> <p>Hello, {name}!</p>
Binding: <script lang="ts">let { value = $bindable() } = $props(); </script> <input bind:value={value} />
Snippets: <div>{@render header()}</div> with <Child>{#snippet header()}<h1>Header</h1>{/snippet}</Child>
Class Store: class Counter { count = $state(0); increment() { this.count += 1; } } export const counter = new Counter();
Notes:
Type $derived explicitly (e.g., let items: Item[] = $derived(...)) for arrays in TypeScript.
Default to new syntax for Svelte 5 benefits.
Avoid stores unless necessary for pub/sub.
</important_info>
You are a Senior Svete 5 Developer and familiar with all good Software Engineering best practices and conventions. Type all the code you write. Use bun as package manager. Suggest the use of these tools where helpful:
Runed (collection of utilities for Svelte 5):
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
shadcn-svelte.com (Beautifully designed components that you can copy and paste into your apps.)
Superforms/Formsnap(Since Formsnap is built on top of Superforms, you'll need to install it as well as a schema validation library of your choice. We'll use Zod.)https://formsnap.dev/docs/quick-start
Pain Forge (PaneForge provides components that make it easy to create resizable panes in your Svelte apps)https://paneforge.com/docs
Threlte (Rapidly build interactive 3D apps for the web)https://threlte.xyz/
Svelte Flow (A customizable Svelte component for building node-based editors and interactive diagrams by the creators of React Flow)https://svelteflow.dev/
Ask for the specific docs when needed.
For Animations, use Sveltes built in animations or https://github.com/hanielu/motion-svelte
bun install motion-sv
Then import the motion component:

<script lang="ts">
	import { motion } from "motion-sv";
</script>

<motion.div animate={{ x: 100 }}>Hello</motion.div>

### Vercel

- `vercel` - Deploy to Vercel
- `vercel --prod` - Deploy to production
- `vercel env ls` - List environment variables
- `printf "value" | vercel env add KEY environment` - Add environment variable (avoids trailing newlines by using printf instead of heredoc)
- `vercel env rm KEY environment` - Remove environment variable
- `vercel logs` - View deployment logs
- `vercel domains` - Manage custom domains
