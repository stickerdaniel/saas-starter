/**
 * Who declares each dependency and each script of the flat root manifest after the move.
 *
 * Every dependency of the flat root manifest has exactly one entry. A dependency pull request
 * that merges before the move adds one line here; the generator stops on a dependency without
 * an entry and on an entry without a dependency. The version always comes from the root
 * manifest, and each holder declares it in the section the root manifest uses.
 */
import type { StarterWorkspace } from '../../.agents/skills/upstream-sync/layout/v3.ts';

export type Holder = Exclude<StarterWorkspace, 'create-saas-starter'>;

export const DEPENDENCY_OWNERS = {
	'@ai-sdk/provider': ['web', 'backend'],
	'@axe-core/playwright': ['web'],
	'@better-auth/oauth-provider': ['web', 'backend'],
	'@better-auth/passkey': ['web', 'backend'],
	'@better-svelte-email/components': ['emails'],
	'@better-svelte-email/server': ['emails'],
	'@confect/cli': ['backend'],
	'@confect/core': ['root', 'web', 'backend'],
	'@confect/server': ['web', 'backend'],
	'@confect/test': ['backend'],
	'@convex-dev/agent': ['web', 'backend'],
	'@convex-dev/better-auth': ['web', 'backend'],
	'@convex-dev/eslint-plugin': ['root'],
	'@convex-dev/rate-limiter': ['backend'],
	'@convex-dev/resend': ['backend'],
	'@effect/platform-node': ['backend'],
	'@effect/platform-node-shared': ['backend'],
	'@effect/vitest': ['backend'],
	'@eslint-community/eslint-plugin-eslint-comments': ['root'],
	'@eslint/compat': ['root'],
	'@eslint/js': ['root'],
	'@formkit/auto-animate': ['web'],
	'@gilhrpenner/convex-files-control': ['backend'],
	'@internationalized/date': ['ui'],
	'@jsquash/webp': ['web'],
	'@lucide/svelte': ['web', 'ui'],
	'@mmailaender/convex-better-auth-svelte': ['web'],
	'@openrouter/ai-sdk-provider': ['web', 'backend'],
	'@oxlint/plugins': ['root'],
	'@playwright/test': ['web'],
	'@resvg/resvg-js': ['web'],
	'@sentry/core': ['web'],
	'@sentry/sveltekit': ['web'],
	'@shadcn/lint': ['root'],
	'@stickerdaniel/convex-autumn-svelte': ['web'],
	'@svelte-put/lockscroll': ['web'],
	'@sveltejs/adapter-auto': ['web'],
	'@sveltejs/adapter-cloudflare': ['web'],
	'@sveltejs/adapter-node': ['web'],
	'@sveltejs/adapter-vercel': ['web'],
	'@sveltejs/kit': ['web'],
	'@sveltejs/package': ['web'],
	'@sveltejs/vite-devtools-svelte': ['web'],
	'@sveltejs/vite-plugin-svelte': ['web', 'ui', 'emails'],
	'@tailwindcss/oxide': ['web'],
	'@tailwindcss/typography': ['web'],
	'@tailwindcss/vite': ['web'],
	'@tanstack/svelte-table': ['ui'],
	'@tanstack/table-core': ['web', 'ui'],
	'@tolgee/cli': ['web'],
	'@tolgee/format-icu': ['web', 'ui'],
	'@tolgee/svelte': ['web', 'ui'],
	'@types/node': ['root', 'web', 'backend', 'ui', 'emails', 'product-config', 'tooling'],
	'@types/subset-font': ['web'],
	'@typescript-eslint/parser': ['root'],
	'@typescript/native': ['web'],
	'@useautumn/convex': ['backend'],
	'@varlock/cloudflare-integration': ['web'],
	'@varlock/vite-integration': ['web'],
	'@vitejs/devtools': ['web'],
	'@zumer/snapdom': ['web'],
	'@zxcvbn-ts/core': ['ui'],
	'@zxcvbn-ts/language-common': ['ui'],
	'@zxcvbn-ts/language-en': ['ui'],
	ai: ['web', 'backend'],
	atmn: ['web', 'backend'],
	'autumn-js': ['backend'],
	'better-auth': ['web', 'backend'],
	'bits-ui': ['web', 'ui'],
	'bun-types': ['root', 'web', 'backend', 'emails', 'tooling'],
	clsx: ['web', 'ui'],
	convex: ['web', 'backend'],
	'convex-helpers': ['backend'],
	'convex-svelte': ['web'],
	'convex-test': ['web', 'backend'],
	'convex-vite-plugin': ['web', 'backend'],
	'date-fns': ['web'],
	'dom-accessibility-api': ['web'],
	effect: ['root', 'web', 'backend'],
	eld: ['root'],
	entities: ['web'],
	esbuild: ['web'],
	eslint: ['root'],
	'eslint-config-prettier': ['root'],
	'eslint-plugin-saas-starter': ['root'],
	'eslint-plugin-svelte': ['root'],
	'esm-env': ['web', 'ui'],
	fontless: ['web'],
	globals: ['root'],
	husky: ['root'],
	jsdom: ['web', 'backend', 'ui', 'emails'],
	knip: ['web', 'backend', 'ui', 'emails', 'product-config', 'tooling', 'eslint-plugin'],
	konva: ['web'],
	marked: ['root', 'web'],
	miniflare: ['web'],
	'motion-sv': ['web', 'ui'],
	nanostores: ['web'],
	oxlint: ['root'],
	'oxlint-plugin-convex': ['root'],
	paneforge: ['web'],
	parse5: ['web', 'backend'],
	postcss: ['root', 'web', 'emails'],
	'posthog-js': ['web'],
	prettier: ['root', 'web', 'backend'],
	'prettier-plugin-svelte': ['root'],
	'prettier-plugin-tailwindcss': ['root'],
	'rollup-plugin-visualizer': ['web'],
	runed: ['web', 'ui'],
	'shadcn-svelte': ['web'],
	'spdx-license-list': ['web'],
	'strip-ansi': ['root'],
	'subset-font': ['web'],
	svelte: ['root', 'web', 'ui', 'emails'],
	'svelte-check': ['web', 'ui', 'emails'],
	'svelte-eslint-parser': ['root', 'eslint-plugin'],
	'svelte-infinite': ['web'],
	'svelte-konva': ['web'],
	'svelte-sonner': ['web', 'ui'],
	'svelte-streamdown': ['root', 'web'],
	'svelte-toolbelt': ['ui'],
	svix: ['backend'],
	'tailwind-merge': ['ui'],
	'tailwind-variants': ['ui', 'emails'],
	tailwindcss: ['web', 'ui', 'emails'],
	tinyglobby: ['web'],
	'tw-animate-css': ['web'],
	typescript: ['root', 'web', 'backend', 'ui', 'emails', 'product-config', 'tooling'],
	'typescript-eslint': ['root', 'eslint-plugin'],
	valibot: ['web', 'backend'],
	varlock: ['root', 'web', 'backend'],
	'vaul-svelte': ['ui'],
	vite: ['web', 'backend', 'ui', 'emails'],
	'vite-plugin-devtools-json': ['web'],
	vitest: ['root', 'web', 'backend', 'ui', 'emails', 'tooling', 'eslint-plugin'],
	'web-haptics': ['ui'],
	wrangler: ['web'],
	yaml: ['root', 'web']
} as const satisfies Record<string, readonly Holder[]>;

/**
 * Packages a workspace takes from its host, with the range it accepts. The workspace also
 * declares each for development at the root manifest's exact version.
 */
export const PEER_DEPENDENCIES = {
	ui: ['svelte', 'bits-ui', '@tolgee/svelte']
} as const satisfies Partial<Record<Holder, ReadonlyArray<keyof typeof DEPENDENCY_OWNERS>>>;

/**
 * The workspace each script of the flat root manifest moves to, under its present name. A
 * script body keeps its text except that a path is rewritten to the moved path relative to the
 * owner, and `bun run <script>` of a script that another workspace owns gains `--filter`.
 */
export const SCRIPT_OWNERS = {
	dev: 'web',
	'dev:frontend': 'web',
	'dev:backend:cloud': 'web',
	'dev:cloud': 'web',
	'dev:test': 'web',
	generate: 'backend',
	'confect:codegen': 'backend',
	'check:confect-parity': 'backend',
	'measure:backend': 'web',
	'generate:content': 'backend',
	'install:cli': null,
	postinstall: 'root',
	prebuild: 'web',
	build: 'web',
	postbuild: 'web',
	start: 'web',
	'generate:logos': 'web',
	'generate:desk-computer': 'web',
	'generate:og-image-url': 'web',
	'build:emails': 'emails',
	preview: 'web',
	prepare: 'root',
	package: 'web',
	check: 'web',
	'check:watch': 'web',
	'check:cli': 'create-saas-starter',
	'test:cli': 'root',
	'build:cli': 'create-saas-starter',
	'test:cli:packed': 'create-saas-starter',
	'check:convex': 'backend',
	'check:convex-compat': 'root',
	'check:english': 'root',
	'check:table-scroll': 'web',
	'check:streamdown-overlay': 'web',
	'check:docs-fixture': 'web',
	'check:reduced-export': 'root',
	'build:english-policy': 'root',
	format: 'root',
	lint: null,
	'lint:convex': null,
	knip: null,
	'static-checks': 'root',
	'static-checks:staged': 'root',
	'check:precommit': 'root',
	'test:e2e': 'web',
	'test:e2e:headed': 'web',
	test: 'root',
	'test:unit': 'web',
	'test:bun': 'backend',
	'test:upstream-report': 'root',
	'model:eval': 'web',
	'i18n:pull': 'web',
	'i18n:push': 'web',
	'i18n:cleanup': 'web',
	'i18n:sync': 'web',
	'_tolgee:pull': 'web',
	'_tolgee:push': 'web',
	'_tolgee:cleanup': 'web',
	worktree: 'root',
	'worktree:setup': 'root',
	'worktree:prune': 'root',
	setup: 'root',
	'check:skills': 'root',
	'check:scripts': 'web',
	'upstream:report': 'root',
	'upstream:sync': 'root',
	'upstream:fork-point': 'root',
	'upstream:changes': 'root'
} as const satisfies Record<string, StarterWorkspace | null>;

/**
 * Scripts the flat root manifest lacks. A root entry replaces a moved script of the same name at
 * the root; a workspace entry gives that workspace a concern of section 3.6.
 */
const lint = (directory: string) =>
	`bun run --cwd ../.. eslint:workspace ${directory} --cache-location ${directory}/.eslintcache && bun run --cwd ../.. oxlint:workspace ${directory}`;

export const NEW_SCRIPTS = {
	root: {
		postinstall:
			'bun run --filter @repo/backend codegen && bun run --filter @repo/web codegen && bun run --filter @repo/emails build:emails',
		dev: 'bun run --filter @repo/web dev',
		check:
			"bun run check:scripts && bun run check:skills && bun run --filter './apps/*' --filter './packages/*' check",
		'check:scripts': 'tsc -p scripts/tsconfig.json && tsc -p tsconfig.json',
		lint: "eslint . --cache --concurrency auto --ignore-pattern 'apps/**' --ignore-pattern 'packages/**' && oxlint --ignore-pattern 'apps/**' --ignore-pattern 'packages/**'",
		knip: 'apps/web/node_modules/.bin/knip --workspace .',
		'eslint:workspace': 'eslint --cache --concurrency auto',
		'oxlint:workspace': 'oxlint',
		validate: 'bun run static-checks && bun run test'
	},
	web: { codegen: 'bun svelte-kit sync && varlock codegen', lint: lint('apps/web'), knip: 'knip' },
	backend: {
		codegen: 'bun run generate:content && varlock codegen --path .env-convex.schema',
		check: 'bun run check:convex && tsc -p tsconfig.json --noEmit',
		lint: lint('packages/backend'),
		'lint:convex': 'bun run --cwd ../.. oxlint:workspace packages/backend',
		knip: 'knip'
	},
	ui: { check: 'svelte-check --tsconfig ./tsconfig.json', lint: lint('packages/ui'), knip: 'knip' },
	emails: {
		check: 'svelte-check --tsconfig ./tsconfig.json',
		lint: lint('packages/emails'),
		knip: 'knip'
	},
	'product-config': {
		check: 'tsc -p tsconfig.json --noEmit',
		lint: lint('packages/product-config'),
		knip: 'knip'
	},
	tooling: { check: 'tsc -p tsconfig.json --noEmit', lint: lint('packages/tooling'), knip: 'knip' },
	'eslint-plugin': { lint: lint('packages/eslint-plugin'), knip: 'knip' },
	'create-saas-starter': { check: 'tsc --noEmit', lint: lint('packages/create-saas-starter') }
} as const satisfies Partial<Record<StarterWorkspace, Readonly<Record<string, string>>>>;

export const REPLACED_ROOT_SCRIPTS = {
	postinstall:
		'bun run install:cli && bun run generate:content && bun svelte-kit sync && varlock codegen && varlock codegen --path .env-convex.schema && bun run build:emails'
} as const satisfies Partial<Record<keyof typeof NEW_SCRIPTS.root, string>>;

export interface OwnerTables {
	readonly dependencies: Readonly<Record<string, readonly Holder[]>>;
	readonly peers: Readonly<Partial<Record<Holder, readonly string[]>>>;
	readonly scripts: Readonly<Record<string, StarterWorkspace | null>>;
	readonly newScripts: Readonly<
		Partial<Record<StarterWorkspace, Readonly<Record<string, string>>>>
	>;
	readonly replacedRootScripts: Readonly<Record<string, string>>;
}

export const OWNERS: OwnerTables = {
	dependencies: DEPENDENCY_OWNERS,
	peers: PEER_DEPENDENCIES,
	scripts: SCRIPT_OWNERS,
	newScripts: NEW_SCRIPTS,
	replacedRootScripts: REPLACED_ROOT_SCRIPTS
};
