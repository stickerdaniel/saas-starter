/**
 * The version 3 layout: where each path of the flat tree lands in the workspace tree, and which
 * workspace owns it.
 *
 * A rule whose `from` ends in `/` moves a directory with every path below it; any other rule
 * moves one file. The longest matching rule wins, so a file rule overrides its directory.
 * `to: null` deletes the path. A product adds rules for its own roots in
 * `.upstream-sync.layout.ts` and never edits this table.
 */
import { spawnSync } from 'node:child_process';

export const WORKSPACES = {
	web: { root: 'apps/web/', name: '@repo/web', exports: '' },
	backend: { root: 'packages/backend/', name: '@repo/backend', exports: '' },
	ui: { root: 'packages/ui/', name: '@repo/ui', exports: '' },
	emails: { root: 'packages/emails/', name: '@repo/emails', exports: '' },
	'product-config': {
		root: 'packages/product-config/',
		name: '@repo/product-config',
		exports: ''
	},
	tooling: { root: 'packages/tooling/', name: '@repo/tooling', exports: 'src/' },
	'eslint-plugin': {
		root: 'packages/eslint-plugin/',
		name: 'eslint-plugin-saas-starter',
		exports: ''
	},
	'create-saas-starter': {
		root: 'packages/create-saas-starter/',
		name: 'create-saas-starter',
		exports: ''
	},
	root: { root: '', name: null, exports: '' }
} as const satisfies Record<
	string,
	{ readonly root: string; readonly name: string | null; readonly exports: string }
>;

export type StarterWorkspace = keyof typeof WORKSPACES;

/** A starter workspace, or a name a product picks for one of its own roots. */
export type Owner = StarterWorkspace | (string & {});

export interface MoveRule<O extends Owner = Owner> {
	readonly from: string;
	readonly to: string | null;
	readonly owner: O;
}

/**
 * Who may import whom. Every workspace may also reach `SHARED_EDGES`, the lint rules and the
 * repository tools, for development. No workspace may read the root, which is no package; the
 * root may read every workspace by a relative path.
 */
export const ALLOWED_EDGES = {
	'product-config': [],
	ui: [],
	emails: ['ui', 'product-config'],
	backend: ['emails', 'product-config'],
	web: ['backend', 'ui', 'emails', 'product-config'],
	tooling: [],
	'eslint-plugin': [],
	'create-saas-starter': [],
	root: [
		'web',
		'backend',
		'ui',
		'emails',
		'product-config',
		'tooling',
		'eslint-plugin',
		'create-saas-starter'
	]
} as const satisfies Record<StarterWorkspace, readonly StarterWorkspace[]>;

export const SHARED_EDGES = [
	'eslint-plugin',
	'tooling'
] as const satisfies readonly StarterWorkspace[];

type Reachable<W extends StarterWorkspace> =
	W | (typeof ALLOWED_EDGES)[W][number] | (typeof SHARED_EDGES)[number];

/** An edge the dependency rule allows from one starter workspace to another. */
export type AllowedEdge = {
	[W in StarterWorkspace]: readonly [W, Reachable<W>];
}[StarterWorkspace];

export function isStarterWorkspace(owner: Owner): owner is StarterWorkspace {
	return Object.hasOwn(WORKSPACES, owner);
}

export function isAllowedEdge(from: StarterWorkspace, to: StarterWorkspace): boolean {
	const reachable: readonly StarterWorkspace[] = [from, ...SHARED_EDGES, ...ALLOWED_EDGES[from]];
	return reachable.includes(to);
}

/** The starter workspace whose directory holds `path` in the workspace tree. */
export function workspaceAt(path: string): StarterWorkspace {
	const holders = (Object.keys(WORKSPACES) as StarterWorkspace[]).filter((workspace) =>
		path.startsWith(WORKSPACES[workspace].root)
	);
	return holders.reduce((longest, workspace) =>
		WORKSPACES[workspace].root.length > WORKSPACES[longest].root.length ? workspace : longest
	);
}

/** Why `rule` cannot stand in a table, or `undefined` when it can. */
function isRepositoryPath(path: string): boolean {
	if (path === '') return true;
	if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes('\\')) return false;
	const parts = (path.endsWith('/') ? path.slice(0, -1) : path).split('/');
	return parts.every((part) => part !== '' && part !== '.' && part !== '..');
}

export function ruleProblem(rule: MoveRule): string | undefined {
	if (rule.from === '' || !isRepositoryPath(rule.from)) {
		return `"${rule.from}" is no repository path`;
	}
	if (rule.to === null) return undefined;
	if (!isRepositoryPath(rule.to)) {
		return `${rule.from} moves to "${rule.to}", which is no repository path`;
	}
	if (rule.from.endsWith('/') !== (rule.to === '' || rule.to.endsWith('/'))) {
		return `${rule.from} moves a directory onto a file or a file onto a directory`;
	}
	const lands = workspaceAt(rule.to);
	const expected = isStarterWorkspace(rule.owner) ? rule.owner : 'root';
	return lands === expected
		? undefined
		: `${rule.from} is owned by ${rule.owner} but lands in ${lands} at ${rule.to}`;
}

type Root<W extends StarterWorkspace> = (typeof WORKSPACES)[W]['root'];

function directory<W extends StarterWorkspace>(
	owner: W,
	from: `${string}/`,
	to: `${Root<W>}${string}/`
): MoveRule<W> {
	return { from, to, owner };
}

function files<W extends StarterWorkspace>(
	owner: W,
	from: `${string}/` | '',
	to: `${Root<W>}${string}/` | Root<W>,
	names: readonly string[]
): Array<MoveRule<W>> {
	return names.map((name) => ({ from: from + name, to: to + name, owner }));
}

function file<W extends StarterWorkspace>(
	owner: W,
	from: string,
	to: `${Root<W>}${string}`
): MoveRule<W> {
	return { from, to, owner };
}

function stay<W extends StarterWorkspace>(owner: W, paths: readonly string[]): Array<MoveRule<W>> {
	return paths.map((path) => ({ from: path, to: path, owner }));
}

/** `eslint.config.js` names the same seven as `EFFECT_LEAF_MODULES`; forks copy them as one set. */
export const EFFECT_LEAF_SET = [
	'src/lib/effect/errors.ts',
	'src/lib/effect/retry.ts',
	'src/lib/effect/timeout.ts',
	'src/lib/effect/lifetime.ts',
	'src/lib/effect/scheduler.ts',
	'src/lib/effect/clock.ts',
	'src/lib/effect/testing.ts'
] as const;

const BACKEND_SHARED = [
	'effect/errors.ts',
	'effect/errors.test.ts',
	'effect/retry.ts',
	'effect/retry.test.ts',
	'effect/timeout.ts',
	'effect/timeout.test.ts',
	'effect/lifetime.ts',
	'effect/lifetime.test.ts',
	'effect/scheduler.ts',
	'effect/scheduler.test.ts',
	'effect/clock.ts',
	'effect/clock.test.ts',
	'effect/testing.ts',
	'effect/vitest.ts',
	'effect/schema.ts',
	'effect/schema.test.ts',
	'chat/core/types.ts',
	'chat/core/tool-error-redaction.ts',
	'chat/core/tool-error-redaction.test.ts',
	'chat/core/stream-materialization.ts',
	'uploads/consumers.ts',
	'uploads/model-capabilities.ts',
	'uploads/profiles.ts',
	'uploads/profiles.test.ts',
	'uploads/transfer.ts',
	'dev/features.ts',
	'dev/features.test.ts',
	'dev/notice.ts',
	'dev/notice.test.ts',
	'mcp/capabilities.ts',
	'shared/support-page-route.ts',
	'shared/support-page-route.test.ts',
	'shared/support-app-version.ts',
	'shared/support-app-version.test.ts',
	'schemas/password.ts',
	'content/authored-template.ts',
	'content/authored-template.test.ts'
];

const BACKEND_SCRIPTS = [
	'checkout-lock.ts',
	'checkout-lock.test.ts',
	'confect-codegen.ts',
	'confect-codegen.test.ts',
	'confect-dev.ts',
	'confect-dev.test.ts',
	'confect-parity.ts',
	'confect-parity.test.ts',
	'confect-row-parity.ts',
	'convex-consumer-compat.ts',
	'convex-consumer-compat.test.ts',
	'convex-goldens.ts',
	'convex-goldens.test.ts',
	'convex-surface.ts',
	'convex-surface.test.ts',
	'convex-unused-functions.ts',
	'convex-unused-functions.test.ts',
	'convex-vite-backend-exit.test.ts',
	'convex-vite-binary-download.test.ts',
	'convex-vite-env-order.test.ts',
	'convex-vite-startup-status.test.ts',
	'generate-authored-content.ts',
	'generate-authored-content.test.ts',
	'generate-convex.ts',
	'local-convex-binary.ts',
	'local-convex-env.ts',
	'test-backend-exit.ts'
];

const ROOT_SCRIPTS = [
	'AGENTS.md',
	'bun-dotenv-loader.test.ts',
	'check-english.ts',
	'check-english.test.ts',
	'check-pr-title.ts',
	'check-pr-title.test.ts',
	'check-reduced-export.ts',
	'check-regression-guard.ts',
	'check-regression-guard.test.ts',
	'convex-usage.test.ts',
	'create-saas-starter-marker-format.test.ts',
	'create-saas-starter-release-gate.test.ts',
	'create-saas-starter-workflows.test.ts',
	'create-saas-starter.integration.test.ts',
	'create-worktree.ts',
	'dependency-patches.test.ts',
	'export-profile.ts',
	'export-profile.test.ts',
	'github-expression.ts',
	'prune-worktrees.ts',
	'prune-worktrees.test.ts',
	'static-checks.ts',
	'static-checks.test.ts',
	'static-checks.compat-contract.test.ts',
	'static-checks.compat.test.ts',
	'static-checks.format-paths.test.ts',
	'static-checks.format-project.test.ts',
	'static-checks.format-scope.test.ts',
	'static-checks.format.test.ts',
	'static-checks.knip-cli.test.ts',
	'static-checks.knip-types.test.ts',
	'static-checks.knip.test.ts',
	'static-checks.processes.test.ts',
	'template-setup.ts',
	'template-setup.test.ts',
	'template-setup.integration.test.ts',
	'terminal-output.ts',
	'terminal-output.test.ts',
	'transient-source-producers.test.ts',
	'upstream-report-scope.ts',
	'upstream-report-scope.test.ts',
	'upstream-report-scope.contract.test.ts',
	'workflow-artifacts.test.ts',
	'workflow-release-downloads.test.ts'
];

const TOOLING_SCRIPTS = [
	'git-context.ts',
	'git-context.test.ts',
	'git-context.staged-files.test.ts',
	'path-sets.ts',
	'path-sets.test.ts',
	'private-checkout.test.ts',
	'required.ts',
	'test-executable.ts',
	'vitest-git-env.ts',
	'vitest-settings.ts',
	'windows-job.ts',
	'windows-job-runner.ps1'
];

const WEB_SCRIPTS = [
	'app-version.ts',
	'avatar-inline-route.contract.test.ts',
	'backend-latency.ts',
	'backend-latency.test.ts',
	'build-target.ts',
	'build.ts',
	'build.test.ts',
	'cf-deploy.ts',
	'cf-prod-deploy.ts',
	'check-autumn-config.ts',
	'check-autumn-config.test.ts',
	'check-build-output.ts',
	'check-build-output.test.ts',
	'check-bundle-budget.ts',
	'check-bundle-budget.test.ts',
	'check-docs-fixture.ts',
	'check-streamdown-overlay.ts',
	'check-table-scroll.ts',
	'convex-vite-secret-logging.test.ts',
	'css-sources.ts',
	'deploy.ts',
	'dev-cloud.ts',
	'dev-cloud.test.ts',
	'dev-convex-cloud.ts',
	'dev-convex-cloud.test.ts',
	'dev-ports.ts',
	'dev-ports.test.ts',
	'dev-test-isolation.test.ts',
	'dev-test-launch.test.ts',
	'dev-test.ts',
	'dev.ts',
	'docs-fixture.ts',
	'docs-fixture.test.ts',
	'docs-fixture.vite.config.ts',
	'e2e-backend-readiness.test.ts',
	'e2e-ci.ts',
	'e2e-ci.test.ts',
	'e2e-convex-url.test.ts',
	'e2e-signing-key.test.ts',
	'env-schema-parity.contract.test.ts',
	'env-schema-parity.test.ts',
	'fixture-browser.ts',
	'generate-desk-computer.ts',
	'generate-desk-computer.test.ts',
	'generate-logos.ts',
	'generate-logos.test.ts',
	'generate-og-image-url.ts',
	'i18n-orphan-keys.test.ts',
	'i18n-primitive-keys.test.ts',
	'i18n-used-keys.test.ts',
	'inline-styles.ts',
	'kit-generated-hmr.ts',
	'kit-generated-hmr.test.ts',
	'legal-document.ts',
	'legal-document.test.ts',
	'lighthouse-budget.ts',
	'lighthouse-budget.test.ts',
	'locale-parity.test.ts',
	'locale-register.test.ts',
	'log-safe-origin.test.ts',
	'marketing-fonts.ts',
	'marketing-fonts.test.ts',
	'model-eval.ts',
	'module-graph-plugin.ts',
	'noindex-routes.test.ts',
	'og-image-url.test.ts',
	'playwright-selection.test.ts',
	'prerender-sync.test.ts',
	'pwa-manifest.test.ts',
	'security-headers-sync.contract.test.ts',
	'source-tree.ts',
	'strip-varlock-secrets.ts',
	'strip-varlock-secrets.test.ts',
	'svelte-kit-sync-lock.ts',
	'svelte-kit-sync-lock.test.ts',
	'sync-locales.ts',
	'tailwind-source-scan.test.ts',
	'test-backend-url.ts',
	'tsconfig.json',
	'validate-node-runtime.ts',
	'validate-node-runtime.test.ts',
	'varlock-cloudflare-env.test.ts',
	'version-config.test.ts',
	'validate-convex-env.ts',
	'validate-convex-env.test.ts',
	'vitest-sequencer.ts',
	'vitest-sequencer.test.ts'
];

export const BASE_RULES: ReadonlyArray<MoveRule<StarterWorkspace>> = [
	...stay('root', [
		'.agents/',
		'.claude/',
		'.codex/',
		'.cursor/',
		'.github/',
		'.husky/',
		'.macroscope/',
		'.vscode/',
		'docker/',
		'docs/',
		'eslint/',
		'patches/',
		'.gitattributes',
		'.gitignore',
		'.mcp.json',
		'.npmrc',
		'.oxlintrc.json',
		'.prettierignore',
		'.prettierrc',
		'.saas-starter-scaffold.json',
		'.tolgeerc',
		'.upstream-sync.json',
		'.upstream-sync.layout.ts',
		'AGENTS.md',
		'LICENSE',
		'README.md',
		'btca.config.jsonc',
		'bun.lock',
		'bunfig.toml',
		'eslint.config.js',
		'knowledge-policy.config.test.ts',
		'knowledge-policy.config.ts',
		'opencode.jsonc',
		'package.json',
		'renovate.json',
		'skills-lock.json',
		'tsconfig.tooling.json',
		'vitest.tooling.config.ts',
		'scripts/__fixtures__/static-checks/',
		'scripts/__fixtures__/template-setup/',
		'scripts/english-policy/',
		'scripts/knowledge-policy/'
	]),
	...files('root', 'scripts/', 'scripts/', ROOT_SCRIPTS),

	directory('web', 'src/', 'apps/web/src/'),
	directory('web', 'static/', 'apps/web/static/'),
	directory('web', 'e2e/', 'apps/web/e2e/'),
	directory('web', 'third-party-notices/', 'apps/web/third-party-notices/'),
	directory('web', 'scripts/deploy/', 'apps/web/scripts/deploy/'),
	directory('web', 'scripts/desk-computer/', 'apps/web/scripts/desk-computer/'),
	directory('web', 'scripts/model-eval/', 'apps/web/scripts/model-eval/'),
	directory('web', 'scripts/process/', 'apps/web/scripts/process/'),
	directory('web', 'scripts/third-party-licenses/', 'apps/web/scripts/third-party-licenses/'),
	...files('web', '', 'apps/web/', [
		'.env.schema',
		'_headers',
		'bundle-budget.json',
		'jsrepo.json',
		'knip.config.ts',
		'lighthouse-budget.json',
		'playwright.config.ts',
		'third-party-licenses.config.json',
		'tsconfig.json',
		'vercel.json',
		'vite.config.ts',
		'wrangler.toml'
	]),
	...files('web', 'scripts/', 'apps/web/scripts/', WEB_SCRIPTS),

	directory('backend', 'src/lib/confect/', 'packages/backend/confect/'),
	directory('backend', 'src/lib/convex/', 'packages/backend/convex/'),
	directory('backend', 'src/lib/convex-components/', 'packages/backend/convex-components/'),
	directory(
		'backend',
		'scripts/__fixtures__/convex-surface/',
		'packages/backend/scripts/__fixtures__/convex-surface/'
	),
	directory(
		'backend',
		'scripts/__fixtures__/convex-surface-any/',
		'packages/backend/scripts/__fixtures__/convex-surface-any/'
	),
	directory(
		'backend',
		'scripts/__fixtures__/convex-surface-broken/',
		'packages/backend/scripts/__fixtures__/convex-surface-broken/'
	),
	...files('backend', '', 'packages/backend/', [
		'.env-convex.schema',
		'.env.convex.example',
		'autumn.config.ts',
		'convex.json'
	]),
	...files('backend', 'src/lib/', 'packages/backend/shared/', BACKEND_SHARED),
	...files('backend', 'scripts/', 'packages/backend/scripts/', BACKEND_SCRIPTS),

	directory('ui', 'src/lib/components/ui/', 'packages/ui/src/components/ui/'),
	...files('ui', 'src/lib/', 'packages/ui/src/', [
		'utils.ts',
		'utils.test.ts',
		'utils/math.ts',
		'utils/math.test.ts',
		'theme.svelte.ts',
		'theme.svelte.test.ts',
		'hooks/use-haptic.svelte.ts',
		'hooks/use-haptic.svelte.test.ts',
		'hooks/use-clipboard.svelte.ts',
		'hooks/use-clipboard.svelte.test.ts',
		'hooks/is-mobile.svelte.ts'
	]),
	...files('ui', '', 'packages/ui/', ['components.json']),

	directory('emails', 'src/lib/emails/', 'packages/emails/src/'),
	...files('emails', 'scripts/', 'packages/emails/scripts/', [
		'build-emails.ts',
		'build-emails.test.ts'
	]),

	directory('product-config', 'src/i18n/', 'packages/product-config/src/i18n/'),
	...files('product-config', 'src/lib/', 'packages/product-config/src/', [
		'config/site.ts',
		'config/legal.ts',
		'config/support.ts',
		'i18n/languages.ts',
		'i18n/static-translations.generated.ts'
	]),

	...files('tooling', 'scripts/', 'packages/tooling/src/', TOOLING_SCRIPTS),
	file(
		'tooling',
		'scripts/__fixtures__/static-checks/private-checkout.ts',
		'packages/tooling/src/private-checkout.ts'
	),

	...stay('eslint-plugin', ['packages/eslint-plugin/']),
	...stay('create-saas-starter', ['packages/create-saas-starter/']),
	{ from: 'packages/create-saas-starter/bun.lock', to: null, owner: 'create-saas-starter' }
];

export interface Placement<O extends Owner = Owner> {
	readonly to: string | null;
	readonly owner: O;
	readonly rule: MoveRule<O>;
}

export interface MoveTable<O extends Owner = Owner> {
	readonly rules: ReadonlyArray<MoveRule<O>>;
	/** Where `path` lands and who owns it, or `undefined` when no rule covers it. */
	place(path: string): Placement<O> | undefined;
}

export function createMoveTable<O extends Owner>(rules: ReadonlyArray<MoveRule<O>>): MoveTable<O> {
	const byFrom = new Map<string, MoveRule<O>>();
	for (const rule of rules) {
		const problem =
			ruleProblem(rule) ?? (byFrom.has(rule.from) ? `Two rules move ${rule.from}` : undefined);
		if (problem) throw new Error(problem);
		byFrom.set(rule.from, rule);
	}
	const place = (path: string): Placement<O> | undefined => {
		const exact = byFrom.get(path);
		if (exact) return { to: exact.to, owner: exact.owner, rule: exact };
		for (let end = path.lastIndexOf('/'); end > 0; end = path.lastIndexOf('/', end - 1)) {
			const rule = byFrom.get(path.slice(0, end + 1));
			if (rule) return { to: rule.to && rule.to + path.slice(end + 1), owner: rule.owner, rule };
		}
		return undefined;
	};
	return { rules, place };
}

export type EdgePair = readonly [from: string, to: string];

/** The default export of a product's `.upstream-sync.layout.ts`. */
export interface LayoutExtension {
	readonly rules: readonly MoveRule[];
	readonly knownEdges?: readonly EdgePair[];
}

export const BASE_TABLE = createMoveTable(BASE_RULES);

export type Layout = 'flat' | 'workspace';

/** A revision is a workspace revision when it holds `apps/web/package.json`. */
export function layoutOf(revision: string, cwd: string = process.cwd()): Layout {
	const git = (args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf-8' });
	const commit = git(['rev-parse', '--verify', '--quiet', `${revision}^{commit}`]);
	if (commit.status !== 0) throw new Error(`${revision} is not a commit in ${cwd}`);
	const listed = git([
		'ls-tree',
		'--name-only',
		commit.stdout.trim(),
		'--',
		'apps/web/package.json'
	]);
	if (listed.status !== 0) throw new Error(`git ls-tree failed: ${listed.stderr}`);
	return listed.stdout.trim() === 'apps/web/package.json' ? 'workspace' : 'flat';
}
