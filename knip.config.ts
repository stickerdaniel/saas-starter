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
		'e2e/**/*.ts'
	],
	project: ['src/**/*.{ts,svelte}', 'scripts/**/*.ts', 'e2e/**/*.ts'],
	ignore: [
		'src/lib/convex/_generated/**',
		// Email templates — built by scripts/build-emails.ts, not imported directly
		'src/lib/emails/**',
		// Scaffolded UI component libraries — installed for future use
		'src/blocks/**',
		'src/lib/components/ai-elements/**',
		'src/lib/components/prompt-kit/**',
		'src/lib/components/prompt-kit-blocks/**',
		// shadcn UI components — installed via CLI, available for use
		'src/lib/components/ui/chart/**',
		'src/lib/components/ui/collapsible/**',
		'src/lib/components/ui/command/**',
		'src/lib/components/ui/form/**',
		'src/lib/components/ui/FollowingPointer/**',
		'src/lib/components/ui/light-switch/**',
		'src/lib/components/ui/popover/**',
		'src/lib/components/ui/toggle-group/**',
		// Knip can't trace Svelte dynamic imports ({#await import(...)})
		'src/lib/components/customer-support/**',
		'src/lib/chat/**',
		'src/lib/components/global-search/**'
	],
	ignoreDependencies: [
		// Tailwind v4 plugins — referenced via CSS @plugin, not JS imports
		'@tailwindcss/forms',
		'@tailwindcss/typography',
		'tw-animate-css',
		// Used by chart components (scaffolded, ignored above)
		'd3-scale',
		'd3-shape',
		'layerchart',
		// Used via @convex-dev/resend component internally
		'resend',
		// ESLint legacy compat — referenced in eslint.config.js as string
		'@typescript-eslint/eslint-plugin',
		'@typescript-eslint/parser',
		// Form libraries — used in scaffolded form components (ignored above)
		'formsnap',
		'sveltekit-superforms',
		// Used by customer-support screenshot editor (dynamic import, ignored above)
		'@zumer/snapdom',
		// Used via Svelte dynamic imports or runtime-only
		'@svelte-put/lockscroll',
		'isomorphic-dompurify',
		'marked',
		'konva',
		'svelte-konva',
		// CLI tool, not a runtime dependency
		'vercel',
		// Used by autumn integration in Convex
		'autumn-js',
		'atmn',
		// Sub-package of autumn-js, imported directly in Convex files
		'@useautumn/convex',
		// Used by Better Auth internally
		'@oslojs/crypto',
		// Testing libraries — used in test files
		'@testing-library/jest-dom',
		'@testing-library/svelte',
		// Type definitions for d3 (used by chart scaffolding)
		'@types/d3-scale',
		'@types/d3-shape',
		// Re-exported by @tolgee/svelte
		'@tolgee/web'
	],
	ignoreExportsUsedInFile: true,
	rules: {
		// Existing dead code — tracked as warnings until cleanup
		files: 'warn',
		// shadcn barrel re-exports and Valibot schema types are part of the API surface
		exports: 'warn',
		types: 'warn'
	}
} satisfies KnipConfig;
