export type Layout = 'flat' | 'workspace';

/** A workspace directory with its trailing slash; the repository root is `''`. */
export type WorkspaceRoot = '' | `${string}/`;

/** How a set reads the repository paths of one tree. */
export type Tree =
	| { readonly layout: 'flat' }
	| { readonly layout: 'workspace'; readonly workspaces: readonly WorkspaceRoot[] };

export const FLAT_TREE: Tree = { layout: 'flat' };

interface PathSet {
	readonly includes: (layout: Layout, workspace: WorkspaceRoot, relativePath: string) => boolean;
	readonly removedScripts: readonly string[];
	readonly replacedScripts: Readonly<Record<string, string>>;
	readonly devDependencies: readonly string[];
}

interface Suite {
	readonly roots?: readonly string[];
	readonly files?: readonly string[];
	readonly kept?: readonly string[];
	readonly declarations?: RegExp;
}

const suiteFile = /\.(?:test|spec)\.[^/]+$|\.fixtures\.ts$/;
const suiteDirectory = /(?:^|\/)(?:__fixtures__|__tests__|__snapshots__|test-fixtures)\//;

function suiteRule({ roots = [], files = [], kept = [], declarations }: Suite) {
	const suiteFiles = new Set(files);
	const keptFiles = new Set(kept);
	return (path: string): boolean =>
		!declarations?.test(path) &&
		!keptFiles.has(path) &&
		(suiteFiles.has(path) ||
			roots.some((root) => path.startsWith(root)) ||
			suiteFile.test(path) ||
			suiteDirectory.test(path));
}

const flatTests = suiteRule({
	roots: ['e2e/', '.github/actions/e2e-run/', 'packages/create-saas-starter/test/'],
	files: [
		'.github/workflows/e2e-preview-cf.yml',
		'.github/workflows/e2e-preview-vercel.yml',
		'.github/workflows/reduced-export.yml',
		'.github/workflows/supersede-preview-e2e.yml',
		'.github/workflows/template-setup-windows.yml',
		'.github/workflows/windows-process-lifecycle.yml',
		'packages/eslint-plugin/src/rules/effect-rule-harness.ts',
		'playwright.config.ts',
		'scripts/check-docs-fixture.ts',
		'scripts/check-reduced-export.ts',
		'scripts/docs-fixture.ts',
		'scripts/docs-fixture.vite.config.ts',
		'scripts/e2e-ci.ts',
		'scripts/test-executable.ts',
		'src/lib/analytics/testing/sdk-harness.ts',
		'src/lib/components/ui/loading-bar/loading-bar-motion.ts',
		'src/lib/components/ui/loading-bar/loading-bar-test-fixture.svelte',
		'src/lib/storage/testing/blocked-storage.ts',
		'src/lib/uploads/consumers.ts',
		'src/lib/uploads/model-capabilities.ts'
	],
	kept: [
		'src/lib/components/tables/test-fixtures/TableScrollHarness.svelte',
		'src/lib/components/test-fixtures/StreamdownOverlayHarness.svelte'
	],
	declarations: /^src\/lib\/confect\/.+\.spec\.ts$/
});

const workspaceTests = new Map<WorkspaceRoot, (path: string) => boolean>([
	[
		'',
		suiteRule({
			roots: ['.github/actions/e2e-run/'],
			files: [
				'.github/workflows/e2e-preview-cf.yml',
				'.github/workflows/e2e-preview-vercel.yml',
				'.github/workflows/reduced-export.yml',
				'.github/workflows/supersede-preview-e2e.yml',
				'.github/workflows/template-setup-windows.yml',
				'.github/workflows/windows-process-lifecycle.yml',
				'scripts/check-reduced-export.ts'
			]
		})
	],
	[
		'apps/web/',
		suiteRule({
			roots: ['e2e/'],
			files: [
				'playwright.config.ts',
				'scripts/check-docs-fixture.ts',
				'scripts/docs-fixture.ts',
				'scripts/docs-fixture.vite.config.ts',
				'scripts/e2e-ci.ts',
				'src/lib/analytics/testing/sdk-harness.ts',
				'src/lib/storage/testing/blocked-storage.ts'
			],
			kept: [
				'src/lib/components/tables/test-fixtures/TableScrollHarness.svelte',
				'src/lib/components/test-fixtures/StreamdownOverlayHarness.svelte'
			]
		})
	],
	[
		'packages/backend/',
		suiteRule({
			files: ['shared/uploads/consumers.ts', 'shared/uploads/model-capabilities.ts'],
			declarations: /^confect\/.+\.spec\.ts$/
		})
	],
	[
		'packages/ui/',
		suiteRule({
			files: [
				'src/components/ui/loading-bar/loading-bar-motion.ts',
				'src/components/ui/loading-bar/loading-bar-test-fixture.svelte'
			]
		})
	],
	[
		'packages/tooling/',
		suiteRule({ files: ['src/private-checkout.ts', 'src/test-executable.ts'] })
	],
	['packages/eslint-plugin/', suiteRule({ files: ['src/rules/effect-rule-harness.ts'] })],
	['packages/create-saas-starter/', suiteRule({ roots: ['test/'] })]
]);

const productWorkspaceTests = suiteRule({});

export const pathSets = {
	tests: {
		includes: (layout, workspace, relativePath) =>
			layout === 'flat'
				? flatTests(workspace + relativePath)
				: (workspaceTests.get(workspace) ?? productWorkspaceTests)(relativePath),
		removedScripts: [
			'check:docs-fixture',
			'check:reduced-export',
			'test:bun',
			'test:e2e',
			'test:e2e:headed',
			'test:upstream-report'
		],
		replacedScripts: {
			test: 'bun run test:unit && bun run check:table-scroll && bun run test:cli && bun run check:streamdown-overlay',
			'test:cli': 'bun run --cwd packages/create-saas-starter vitest run --passWithNoTests'
		},
		devDependencies: [
			'@axe-core/playwright',
			'@sentry/core',
			'@tailwindcss/node',
			'dom-accessibility-api',
			'miniflare',
			'strip-ansi',
			'tinyglobby'
		]
	}
} as const satisfies Record<string, PathSet>;

export type PathSetName = keyof typeof pathSets;

/** Whether `value` is a list of distinct set names, as `templateProfiles` and a marker's `omitted` hold. */
export function isPathSetNameList(value: unknown): value is PathSetName[] {
	return (
		Array.isArray(value) &&
		new Set(value).size === value.length &&
		value.every((name) => typeof name === 'string' && Object.hasOwn(pathSets, name))
	);
}

/** The workspace of `tree` whose directory holds the repository path `path`, and the path inside it. */
export function locate(tree: Tree, path: string): [WorkspaceRoot, string] {
	if (tree.layout === 'flat') return ['', path];
	const workspace = tree.workspaces.reduce<WorkspaceRoot>(
		(longest, root) => (root.length > longest.length && path.startsWith(root) ? root : longest),
		''
	);
	return [workspace, path.slice(workspace.length)];
}

export function inPathSets(tree: Tree, path: string, names: Iterable<PathSetName>): boolean {
	const [workspace, relativePath] = locate(tree, path);
	for (const name of names) {
		if (pathSets[name].includes(tree.layout, workspace, relativePath)) return true;
	}
	return false;
}
