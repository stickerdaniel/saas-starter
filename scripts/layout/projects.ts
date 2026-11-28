/**
 * The project files that the flat tree lacks: the shared compiler options, and per workspace
 * its TypeScript, Vitest and Knip projects and its Bun runtime config.
 */
import { readFileSync } from 'node:fs';
import { WORKSPACES, type StarterWorkspace } from '../../.agents/skills/upstream-sync/layout/v3.ts';
import { jsonText, writeText, type Run } from './run.ts';
import { WORKSPACE_EXPORTS_TEST } from './tree/workspace-exports-test.ts';

interface ProjectFile {
	readonly path: string;
	readonly text: string;
	/** Workspaces whose packages the file imports. */
	readonly imports?: readonly StarterWorkspace[];
}

const json = (value: unknown) => jsonText(value);

const TEST_FILES = '**/*.{test,spec}.?(c|m)[jt]s?(x)';

const testInclude = (directories: readonly string[]) =>
	`[${directories.map((directory) => `'${directory}/${TEST_FILES}'`).join(', ')}]`;

const SVELTE_PLUGIN = `svelte({ preprocess: vitePreprocess(), compilerOptions: { experimental: { async: true } } })`;

const TAILWIND_VARIANTS = `{ find: /^tailwind-variants$/, replacement: 'tailwind-variants/lite' }`;

function nodeAndJsdom(sources: readonly string[], name: string, svelte: boolean): string {
	return `${svelte ? "import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';\n" : ''}import { defineConfig } from 'vitest/config';
import { sharedTestSettings, toolingTestSettings } from '@repo/tooling/vitest-settings.ts';

export default defineConfig({
${svelte ? `\tplugins: [${SVELTE_PLUGIN}],\n\tresolve: { alias: [${TAILWIND_VARIANTS}] },\n` : ''}\ttest: {
		...sharedTestSettings,
		projects: [
			{
				extends: true,
				test: {
					...toolingTestSettings,
					include: ${testInclude(['scripts'])}
				}
			},
			{
				extends: true,
				test: {
					name: '${name}',
					environment: 'jsdom',
					include: ${testInclude(sources)}
				}
			}
		]
	}
});
`;
}

const NODE_PROJECT = (settings: string) => `import { defineConfig } from 'vitest/config';
import { sharedTestSettings, toolingTestSettings } from '${settings}';

export default defineConfig({
	test: { ...sharedTestSettings, ...toolingTestSettings, exclude: sharedTestSettings.exclude }
});
`;

const UI_PROJECT = `import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
import { sharedTestSettings } from '@repo/tooling/vitest-settings.ts';

export default defineConfig({
	plugins: [${SVELTE_PLUGIN}],
	resolve: { alias: [${TAILWIND_VARIANTS}] },
	test: {
		...sharedTestSettings,
		name: 'ui',
		environment: 'jsdom',
		include: ${testInclude(['src'])}
	}
});
`;

const BASE = '../../tsconfig.base.json';

const KNIP_SCHEMA = 'https://unpkg.com/knip@6/schema.json';

export const PROJECT_FILES: readonly ProjectFile[] = [
	{
		path: 'tsconfig.base.json',
		text: json({
			compilerOptions: {
				target: 'esnext',
				module: 'esnext',
				moduleResolution: 'bundler',
				lib: ['ESNext', 'DOM', 'DOM.Iterable'],
				moduleDetection: 'force',
				verbatimModuleSyntax: true,
				isolatedModules: true,
				allowImportingTsExtensions: true,
				resolveJsonModule: true,
				allowJs: true,
				checkJs: true,
				esModuleInterop: true,
				forceConsistentCasingInFileNames: true,
				skipLibCheck: true,
				noEmit: true,
				strict: true,
				noUncheckedIndexedAccess: true
			}
		})
	},
	{
		path: 'tsconfig.scripts.json',
		text: json({
			extends: './tsconfig.base.json',
			compilerOptions: { types: ['node', 'bun-types'] },
			include: ['scripts/**/*.ts', 'apps/web/src/legal-document.d.ts']
		})
	},
	{
		path: 'packages/backend/tsconfig.json',
		text: json({
			extends: BASE,
			compilerOptions: { types: ['node', 'bun-types'] },
			include: ['shared/**/*.ts', 'scripts/**/*.ts', 'vitest.config.ts'],
			exclude: [
				'scripts/__fixtures__/convex-surface-broken/**',
				'scripts/__fixtures__/convex-surface-any/**'
			]
		})
	},
	{
		path: 'packages/backend/vitest.config.ts',
		text: nodeAndJsdom(['confect', 'convex', 'convex-components', 'shared'], 'backend', false),
		imports: ['tooling']
	},
	{
		path: 'packages/backend/knip.json',
		text: json({
			$schema: KNIP_SCHEMA,
			entry: [
				'convex/**/*.ts',
				'!convex/_generated/**',
				'convex-components/betterAuth/**/*.ts',
				'!convex-components/betterAuth/_generated/**',
				'confect/tables/*.ts',
				'confect/**/*.impl.ts',
				'confect/__goldens__/_generated/*.ts',
				'confect/convexTest.modules.ts',
				'shared/effect/*.ts',
				'scripts/*.ts'
			],
			project: ['autumn.config.ts', '{confect,convex,convex-components,shared,scripts}/**/*.ts'],
			ignore: [
				'convex/_generated/**',
				'confect/_generated/**',
				'convex-components/betterAuth/_generated/**',
				'scripts/__fixtures__/**'
			]
		})
	},
	{
		path: 'packages/ui/tsconfig.json',
		text: json({
			extends: BASE,
			compilerOptions: { types: ['vite/client'] },
			include: ['src/**/*.ts', 'src/**/*.svelte', 'vitest.config.ts']
		})
	},
	{ path: 'packages/ui/vitest.config.ts', text: UI_PROJECT, imports: ['tooling'] },
	{
		path: 'packages/ui/knip.json',
		text: json({
			$schema: KNIP_SCHEMA,
			entry: ['src/**/index.ts'],
			project: ['src/**/*.{ts,svelte}']
		})
	},
	{
		path: 'packages/emails/tsconfig.json',
		text: json({
			extends: BASE,
			compilerOptions: { types: ['node', 'bun-types', 'vite/client'] },
			include: ['src/**/*.ts', 'src/**/*.svelte', 'scripts/**/*.ts', 'vitest.config.ts']
		})
	},
	{
		path: 'packages/emails/vitest.config.ts',
		text: nodeAndJsdom(['src'], 'emails', true),
		imports: ['tooling']
	},
	{
		path: 'packages/emails/knip.json',
		text: json({
			$schema: KNIP_SCHEMA,
			entry: ['scripts/build-emails.ts', 'src/templates/**/*.svelte'],
			project: ['{src,scripts}/**/*.{ts,svelte}'],
			ignore: ['src/generated/**']
		})
	},
	{
		path: 'packages/product-config/tsconfig.json',
		text: json({ extends: BASE, include: ['src/**/*.ts'] })
	},
	{
		path: 'packages/product-config/knip.json',
		text: json({ $schema: KNIP_SCHEMA, entry: ['src/**/*.ts'], project: ['src/**/*.ts'] })
	},
	{
		path: 'packages/tooling/tsconfig.json',
		text: json({
			extends: BASE,
			compilerOptions: { types: ['node', 'bun-types'] },
			include: ['src/**/*.ts', 'vitest.config.ts']
		})
	},
	{ path: 'packages/tooling/vitest.config.ts', text: NODE_PROJECT('./src/vitest-settings.ts') },
	{
		path: 'packages/tooling/knip.json',
		text: json({ $schema: KNIP_SCHEMA, entry: ['src/*.ts'], project: ['src/**/*.ts'] })
	},
	{
		path: 'packages/eslint-plugin/vitest.config.ts',
		text: NODE_PROJECT('@repo/tooling/vitest-settings.ts'),
		imports: ['tooling']
	},
	{
		path: 'scripts/workspace-exports.ts',
		text: readFileSync(new URL('./tree/workspace-exports.ts', import.meta.url), 'utf8')
	},
	{ path: 'scripts/workspace-exports.test.ts', text: WORKSPACE_EXPORTS_TEST },
	...Object.values(WORKSPACES)
		.filter(({ root }) => root !== '')
		.map(({ root }) => ({ path: `${root}bunfig.toml`, text: 'env = false\n' }))
];

/** Writes every project file and records the workspace packages each one imports. */
export function writeProjects(run: Run): void {
	for (const file of PROJECT_FILES) {
		writeText(run, file.path, file.text);
		const owner = (Object.keys(WORKSPACES) as StarterWorkspace[]).find(
			(workspace) =>
				WORKSPACES[workspace].root !== '' && file.path.startsWith(WORKSPACES[workspace].root)
		);
		for (const target of file.imports ?? []) {
			if (!owner) throw new Error(`${file.path} imports ${target} from no workspace`);
			run.projectEdges.set(owner, (run.projectEdges.get(owner) ?? new Set()).add(target));
		}
	}
}
