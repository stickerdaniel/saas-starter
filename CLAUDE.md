# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
