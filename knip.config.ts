import type { KnipConfig } from 'knip';

export default {
	entry: [
		// SvelteKit file-system routing
		'src/routes/**/+{page,layout,server,error}.{svelte,ts}',
		'src/routes/**/+{page,layout}.server.ts',

		// Convex backend — all exports are entry points (consumed by Convex runtime)
		'src/lib/convex/**/*.ts',
		'!src/lib/convex/_generated/**',

		// Scripts & test infra
		'scripts/*.ts',
		// Loaded by the TypeScript compiler API, including deliberately invalid fixtures.
		'scripts/__fixtures__/convex-surface*/**/*.ts',
		'e2e/**/*.ts'
	],
	project: ['src/**/*.{ts,svelte}', 'scripts/**/*.ts', 'e2e/**/*.ts'],
	ignore: [
		'src/lib/convex/_generated/**',
		// Email templates — built by scripts/build-emails.ts, not imported directly
		'src/lib/emails/**',
		// Scaffolded UI component libraries — installed for future use
		'src/lib/components/ai-elements/**',
		'src/lib/components/prompt-kit/**',
		// shadcn UI components — installed via CLI, available for use
		'src/lib/components/ui/command/**',
		'src/lib/components/ui/FollowingPointer/**',
		'src/lib/components/ui/light-switch/**',
		'src/lib/components/ui/popover/**',
		// Knip can't trace Svelte dynamic imports ({#await import(...)})
		'src/lib/components/customer-support/**',
		'src/lib/chat/**',
		'src/lib/components/global-search/**',
		// Used by customer-support screenshot editor (ignored above)
		'src/lib/utils/snapdom-config.ts'
	],
	ignoreDependencies: [
		// Intentionally unresolved import in the convex-surface-broken negative fixture.
		'a-package-that-does-not-exist',
		// Tailwind v4 plugins — referenced via CSS @plugin, not JS imports
		'@tailwindcss/typography',
		'tw-animate-css',
		// Used via @convex-dev/resend component internally
		'resend',
		// ESLint legacy compat — referenced in eslint.config.js as string
		'@typescript-eslint/eslint-plugin',
		'@typescript-eslint/parser',
		// Loaded by vite.ssrLoadModule in scripts/build-emails.ts.
		'@better-svelte-email/server',
		// Injected into the generated worker by @varlock/vite-integration.
		'@varlock/cloudflare-integration',
		// Imported by our checked-in oxlint-plugin-convex patch.
		'@oxlint/plugins',
		// adapter-auto selects this installed adapter when VERCEL is set.
		'@sveltejs/adapter-vercel',
		// Operator CLI documented in README.md; not an application import.
		'vercel',
		// Used by autumn integration in Convex
		'atmn',
		// Sub-package of autumn-js, imported directly in Convex files
		'@useautumn/convex',
		// Re-exported by @tolgee/svelte
		'@tolgee/web'
	],
	// Windows system command used to terminate an owned child process tree.
	ignoreBinaries: ['taskkill'],
	ignoreExportsUsedInFile: true,
	rules: {
		// shadcn barrel re-exports and Valibot schema types are part of the API surface
		exports: 'warn',
		types: 'warn'
	}
} satisfies KnipConfig;
