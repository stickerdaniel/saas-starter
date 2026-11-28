import type { KnipConfig } from 'knip';
import { existsSync } from 'node:fs';

const e2eFiles = existsSync('playwright.config.ts') ? ['e2e/**/*.ts'] : [];

export default {
	entry: [
		// SvelteKit file-system routing
		'src/routes/**/+{page,layout,server,error}.{svelte,ts}',
		'src/routes/**/+{page,layout}.server.ts',

		// Kit loads this registry by convention. Nothing imports it.
		'src/env.ts',

		// Convex backend: every export is an entry point consumed by the Convex runtime
		'src/lib/convex/**/*.ts',
		'!src/lib/convex/_generated/**',
		// The local Better Auth component: Convex deploys every module in it as well
		'src/lib/convex-components/betterAuth/**/*.ts',
		'!src/lib/convex-components/betterAuth/_generated/**',
		'src/lib/confect/tables/*.ts',
		// The Confect CLI imports every group implementation from its generated registration.
		'src/lib/confect/**/*.impl.ts',
		'src/lib/confect/__goldens__/_generated/*.ts',

		// Scripts and test infrastructure
		'eslint/shadcn-policy.js',
		'scripts/*.ts',
		'scripts/english-policy/pr-metadata.ts',
		// The move generator, which the move deletes with its inputs.
		'scripts/layout/apply.ts',
		...e2eFiles,
		'src/lib/server/test-fixtures/*.ts',
		// The unit harness that tests import: every project keeps it, with or without tests.
		'src/lib/confect/convexTest.modules.ts',
		'src/lib/effect/*.ts',
		// Loaded by the browser fixture checks through Vite's browser entry, not a static import.
		'src/lib/components/tables/test-fixtures/TableScrollHarness.svelte',
		'src/lib/components/test-fixtures/StreamdownOverlayHarness.svelte',

		// Policy DSL consumed by knowledge-policy.config.ts. Helpers a fork has not used
		// yet are its public surface, so unused exports here are not dead code.
		'scripts/knowledge-policy/policy.ts',

		// Targets of Svelte dynamic imports ({#await import(...)} in customer-support.svelte and
		// global-search-shell.svelte, await import() in lazy-customer-support.svelte), which
		// knip cannot trace. Naming the roots lets it check everything below them.
		'src/lib/components/customer-support/customer-support.svelte',
		'src/lib/components/customer-support/screenshot-editor/ScreenshotEditor.svelte',
		'src/lib/components/global-search/command-menu.svelte',

		// Chat example intended for copying and adaptation. No route imports it, so naming
		// it as an entry keeps it available while the rest of src/lib/chat stays checked.
		'src/lib/chat/examples/SimpleChat.svelte'
	],
	project: [
		'autumn.config.ts',
		'src/**/*.{ts,svelte}',
		'src/lib/security/csp.js',
		'scripts/**/*.ts',
		...e2eFiles
	],
	ignore: [
		// Checked by packages/create-saas-starter/knip.config.ts in the same lint gate.
		'packages/create-saas-starter/**',
		'src/lib/convex/_generated/**',
		'src/lib/confect/_generated/**',
		'src/lib/convex-components/betterAuth/_generated/**',
		// Email templates are loaded through vite.ssrLoadModule in scripts/build-emails.ts,
		// never imported statically.
		'src/lib/emails/**',
		// Fixture trees read from disk by scripts/convex-surface.test.ts, not imported.
		'scripts/__fixtures__/**',
		// Scaffolded UI component libraries, installed for future use.
		'src/lib/components/ai-elements/**',
		'src/lib/components/prompt-kit/**',
		// shadcn UI components installed via CLI and kept available for use.
		'src/lib/components/ui/accordion/**',
		'src/lib/components/ui/light-switch/**',
		'src/lib/components/ui/popover/**',
		'src/lib/components/ui/slider/**',
		// Template block kept as a starting point; not mounted by any route.
		'src/blocks/team/team-two.svelte'
	],
	ignoreDependencies: [
		// Tailwind v4 plugins referenced via CSS @plugin, not JS imports.
		'@tailwindcss/typography',
		'tw-animate-css',
		// Imported by src/routes/layout.css for the shimmer and scroll-fade utilities.
		'shadcn-svelte',
		// Imported only inside src/lib/emails (ignored above) and loaded through
		// vite.ssrLoadModule in scripts/build-emails.ts.
		'@better-svelte-email/server',
		// Loaded by @sveltejs/adapter-auto when deploying to Vercel; the Vercel path stays
		// alive through .github/workflows/e2e-preview-vercel.yml and vercel.json.
		'@sveltejs/adapter-vercel',
		// Dynamically loaded by Varlock's SvelteKit plugin for Cloudflare runtime injection.
		'@varlock/cloudflare-integration',
		// Required by patches/oxlint-plugin-convex@0.1.1.patch.
		'@oxlint/plugins',
		// The Confect CLI and test harness, pinned with the peers they resolve against. No module
		// imports them: scripts/confect-codegen.ts runs the CLI by path.
		'@confect/cli',
		'@confect/test',
		'@effect/platform-node-shared',
		// Tests import it; a project without them keeps it for its first Convex test.
		'convex-test'
	],
	ignoreBinaries: [
		// Windows process tree cleanup in scripts/dev-cloud.ts.
		'taskkill',
		// POSIX fixture in scripts/git-context.test.ts.
		'mkfifo',
		// scripts/terminal-output.test.ts spawns the checker itself.
		'scripts/static-checks.ts'
	],
	ignoreExportsUsedInFile: true,
	rules: {
		// shadcn barrel re-exports and Valibot schema types are part of the API surface.
		exports: 'warn',
		types: 'warn'
	}
} satisfies KnipConfig;
