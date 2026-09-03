import type { KnipConfig } from 'knip';

export default {
	entry: [
		// SvelteKit file-system routing
		'src/routes/**/+{page,layout,server,error}.{svelte,ts}',
		'src/routes/**/+{page,layout}.server.ts',

		// Convex backend: every export is an entry point consumed by the Convex runtime
		'src/lib/convex/**/*.ts',
		'!src/lib/convex/_generated/**',

		// Scripts and test infrastructure
		'scripts/*.ts',
		'e2e/**/*.ts',

		// Policy DSL consumed by knowledge-policy.config.ts. Helpers a fork has not used
		// yet are its public surface, so unused exports here are not dead code.
		'scripts/knowledge-policy/policy.ts',

		// Targets of Svelte dynamic imports ({#await import(...)} in customer-support.svelte and
		// global-search-shell.svelte, await import() in lazy-customer-support.svelte), which
		// knip cannot trace. Naming the roots lets it check everything below them.
		'src/lib/components/customer-support/customer-support.svelte',
		'src/lib/components/customer-support/screenshot-editor/ScreenshotEditor.svelte',
		'src/lib/components/global-search/command-menu.svelte'
	],
	project: ['src/**/*.{ts,svelte}', 'scripts/**/*.ts', 'e2e/**/*.ts'],
	ignore: [
		'src/lib/convex/_generated/**',
		// Email templates are loaded through vite.ssrLoadModule in scripts/build-emails.ts,
		// never imported statically.
		'src/lib/emails/**',
		// Fixture trees read from disk by scripts/convex-surface.test.ts, not imported.
		'scripts/__fixtures__/**',
		// Scaffolded UI component libraries, installed for future use.
		'src/lib/components/ai-elements/**',
		'src/lib/components/prompt-kit/**',
		// shadcn UI components installed via CLI and kept available for use.
		'src/lib/components/ui/FollowingPointer/**',
		'src/lib/components/ui/light-switch/**',
		'src/lib/components/ui/popover/**',
		// Wrapped only by prompt-kit's TextShimmerLoader (ignored above), so knip cannot see
		// its importer. Guarded live by motion-a11y.test.ts.
		'src/lib/components/motion/shimmer-text.svelte',
		// Template block kept as a starting point; not mounted by any route.
		'src/blocks/team/team-two.svelte',
		// Scaffolded chat module. Its example component and unused core exports are a
		// pruning decision of their own, so knip skips the tree until that lands.
		'src/lib/chat/**'
	],
	ignoreDependencies: [
		// Tailwind v4 plugins referenced via CSS @plugin, not JS imports.
		'@tailwindcss/typography',
		'tw-animate-css',
		// Used internally by the @convex-dev/resend component.
		'resend',
		// ESLint legacy compat, referenced in eslint.config.js as strings.
		'@typescript-eslint/eslint-plugin',
		'@typescript-eslint/parser',
		// Autumn CLI invoked by the Autumn config workflow, never imported.
		'atmn',
		// Re-exported by @tolgee/svelte.
		'@tolgee/web',
		// Imported only inside src/lib/emails (ignored above) and loaded through
		// vite.ssrLoadModule in scripts/build-emails.ts.
		'@better-svelte-email/server',
		// Loaded by @sveltejs/adapter-auto when deploying to Vercel; the Vercel path stays
		// alive through .github/workflows/e2e-preview-vercel.yml and vercel.json.
		'@sveltejs/adapter-vercel',
		// Required by patches/oxlint-plugin-convex@0.1.1.patch.
		'@oxlint/plugins'
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
