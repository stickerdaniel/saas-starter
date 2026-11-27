interface PathSet {
	readonly includes: (path: string) => boolean;
	readonly removedScripts: readonly string[];
	readonly replacedScripts: Readonly<Record<string, string>>;
	readonly devDependencies: readonly string[];
}

const confectDeclaration = /^src\/lib\/confect\/.+\.spec\.ts$/;
const suiteFile = /\.(?:test|spec)\.[^/]+$|\.fixtures\.ts$/;
const suiteDirectory = /(?:^|\/)(?:__fixtures__|__tests__|__snapshots__|test-fixtures)\//;
const suiteRoots = ['e2e/', '.github/actions/e2e-run/', 'packages/create-saas-starter/test/'];
const suiteFiles = new Set([
	'.github/workflows/e2e-preview-cf.yml',
	'.github/workflows/e2e-preview-vercel.yml',
	'.github/workflows/reduced-export.yml',
	'.github/workflows/supersede-preview-e2e.yml',
	'.github/workflows/template-setup-windows.yml',
	'.github/workflows/windows-process-lifecycle.yml',
	'packages/eslint-plugin/src/rules/effect-rule-harness.ts',
	'playwright.config.ts',
	'scripts/check-reduced-export.ts',
	'scripts/e2e-ci.ts',
	'scripts/test-executable.ts',
	'src/lib/analytics/testing/sdk-harness.ts',
	'src/lib/components/ui/loading-bar/loading-bar-motion.ts',
	'src/lib/components/ui/loading-bar/loading-bar-test-fixture.svelte',
	'src/lib/uploads/consumers.ts',
	'src/lib/uploads/model-capabilities.ts'
]);
const browserFixtureHarnesses = new Set([
	'src/lib/components/tables/test-fixtures/TableScrollHarness.svelte',
	'src/lib/components/test-fixtures/StreamdownOverlayHarness.svelte'
]);

export const pathSets = {
	tests: {
		includes: (path) =>
			!confectDeclaration.test(path) &&
			!browserFixtureHarnesses.has(path) &&
			(suiteFiles.has(path) ||
				suiteRoots.some((root) => path.startsWith(root)) ||
				suiteFile.test(path) ||
				suiteDirectory.test(path)),
		removedScripts: [
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

export function inPathSets(path: string, names: Iterable<PathSetName>): boolean {
	for (const name of names) if (pathSets[name].includes(path)) return true;
	return false;
}
