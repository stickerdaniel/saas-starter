# CLAUDE.md

This project is a saas template built with SvelteKit, Convex, and modern web technologies.

## Development Commands

### Core Development

- `bun run dev` - Start development server (SvelteKit + Convex)
- `bun run build` - Build for production
- `bun run preview` - Preview production build locally

### Quality Checks & Testing

- `./quality-check.sh` - Run all quality checks (format, lint, typecheck, spell check, tests, build)
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

## Architecture Overview

### Tech Stack

- **Frontend**: SvelteKit, Svelte 5 (runes syntax), Tailwind CSS v4, Skeleton UI
- **Backend**: Convex (real-time database + serverless functions)
- **Authentication**: Convex Auth with OAuth (Google) and email/password via @mmailaender/convex-auth-svelte
- **Testing**: Playwright (E2E), Vitest (unit)
- **Package Manager**: Bun

### Project Structure

- `src/lib/convex/` - Convex backend functions, schema, and auth config
- `src/lib/components/` - UI components (shadcn-style components)
- `src/routes/` - SvelteKit routes
- `src/hooks.server.ts` - Server hooks for auth middleware
- `convex.json` - Points Convex functions to `src/lib/convex/`

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

## Environment Configuration

### Required Environment Variables

- `PUBLIC_CONVEX_URL` - Convex deployment URL
- `CONVEX_DEPLOYMENT` - Deployment name
- `AUTH_GOOGLE_ID` - Google OAuth client ID (optional)
- `AUTH_GOOGLE_SECRET` - Google OAuth secret (optional)
- `AUTH_E2E_TEST_SECRET` - Secret for E2E test authentication

### Test Environment

- E2E tests require `.env.test` file
- Tests run against development Convex deployment (not production)
- CI uses `TEST_CONVEX_URL` for test environment

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
next.shadcn-svelte.com (Beautifully designed components that you can copy and paste into your apps.)
Superforms/Formsnap(Since Formsnap is built on top of Superforms, you'll need to install it as well as a schema validation library of your choice. We'll use Zod.)https://formsnap.dev/docs/quick-start
Pain Forge (PaneForge provides components that make it easy to create resizable panes in your Svelte apps)https://paneforge.com/docs
Threlte (Rapidly build interactive 3D apps for the web)https://threlte.xyz/
Svelte Flow (A customizable Svelte component for building node-based editors and interactive diagrams by the creators of React Flow)https://svelteflow.dev/
Tolgee for internationalisation (open-source localization tool).
Ask for the specific docs when needed.
