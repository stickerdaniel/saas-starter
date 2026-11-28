/**
 * The project files that the flat tree lacks: the shared compiler options, and per workspace
 * its TypeScript, Vitest and Knip projects and its Bun runtime config.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	FLAT_PATHS_WRITTEN_ANEW,
	WORKSPACES,
	type StarterWorkspace
} from '../../.agents/skills/upstream-sync/layout/v3.ts';
import { compareCodeUnits, jsonText, StaleInput, writeText, type Run } from './run.ts';
import { WORKSPACE_EXPORTS_TEST } from './tree/workspace-exports-test.ts';
import { WORKSPACE_VERSIONS_TEST } from './tree/workspace-versions-test.ts';

const KNOWLEDGE_SELECTOR_TEST = `import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { authoredLegalTemplates } from '../../knowledge-policy.config';

const checkout = fileURLToPath(new URL('../..', import.meta.url));

it('excludes legal templates that the checkout tracks', () => {
\tconst tracked = spawnSync('git', ['ls-files', '-z'], { cwd: checkout, encoding: 'utf8' }).stdout.split('\\0');
\texpect(tracked.filter((path) => authoredLegalTemplates(path))).not.toEqual([]);
});
`;

export interface ProjectFile {
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
const KNIP_FLAT_SETTINGS = {
	ignoreExportsUsedInFile: true,
	rules: { exports: 'warn', types: 'warn' }
} as const;

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
		path: 'tsconfig.json',
		text: json({
			extends: './tsconfig.base.json',
			compilerOptions: { types: ['node', 'bun-types'] },
			include: ['*.ts']
		})
	},
	{
		path: 'scripts/tsconfig.json',
		text: json({
			extends: '../tsconfig.base.json',
			compilerOptions: { types: ['node', 'bun-types'] },
			include: ['**/*.ts', '../apps/web/src/legal-document.d.ts']
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
			],
			ignoreDependencies: [
				'@confect/cli',
				'@confect/test',
				'@effect/platform-node-shared',
				'convex-test'
			],
			...KNIP_FLAT_SETTINGS
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
			project: ['src/**/*.{ts,svelte}'],
			...KNIP_FLAT_SETTINGS
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
			ignore: ['src/**'],
			ignoreDependencies: ['@better-svelte-email/server'],
			...KNIP_FLAT_SETTINGS
		})
	},
	{
		path: 'packages/emails/components.json',
		text: json({
			$schema: 'https://shadcn-svelte.com/schema.json',
			tailwind: { css: '../../apps/web/src/routes/layout.css' }
		})
	},
	{
		path: 'packages/product-config/tsconfig.json',
		text: json({ extends: BASE, include: ['src/**/*.ts'] })
	},
	{
		path: 'packages/product-config/knip.json',
		text: json({
			$schema: KNIP_SCHEMA,
			entry: ['src/**/*.ts'],
			project: ['src/**/*.ts'],
			...KNIP_FLAT_SETTINGS
		})
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
		text: json({
			$schema: KNIP_SCHEMA,
			entry: ['src/*.ts'],
			project: ['src/**/*.ts'],
			ignoreBinaries: ['mkfifo'],
			...KNIP_FLAT_SETTINGS
		})
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
	{
		path: 'packages/eslint-plugin/knip.json',
		text: json({ $schema: KNIP_SCHEMA, project: ['src/**/*.{js,ts}'], ...KNIP_FLAT_SETTINGS })
	},
	{
		path: 'knip.json',
		text: json({
			$schema: KNIP_SCHEMA,
			workspaces: {
				'.': {
					entry: [
						'*.{js,ts}',
						'scripts/*.ts',
						'scripts/english-policy/pr-metadata.ts',
						'scripts/knowledge-policy/policy.ts',
						'eslint/shadcn-policy.js'
					],
					project: ['*.{js,ts}', 'scripts/**/*.ts', 'eslint/**/*.{js,ts}'],
					ignore: ['scripts/__fixtures__/**']
				}
			},
			ignoreDependencies: ['@oxlint/plugins'],
			ignoreBinaries: ['scripts/static-checks.ts', 'mkfifo'],
			ignoreExportsUsedInFile: true,
			rules: { exports: 'warn', types: 'warn' }
		})
	},
	{
		path: 'eslint/workspace-aliases.js',
		text: readFileSync(new URL('./tree/workspace-aliases.js', import.meta.url), 'utf8')
	},
	{ path: 'scripts/knowledge-policy/config.test.ts', text: KNOWLEDGE_SELECTOR_TEST },
	{ path: 'scripts/workspace-versions.test.ts', text: WORKSPACE_VERSIONS_TEST },
	...Object.values(WORKSPACES)
		.filter(({ root }) => root !== '')
		.map(({ root }) => ({ path: `${root}bunfig.toml`, text: 'env = false\n' }))
];

/** Writes every project file and records the workspace packages each one imports. */
export function writeProjects(run: Run): void {
	for (const file of run.inputs.projectFiles) {
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

export function outputProblems(
	run: Pick<Run, 'checkout' | 'flatPaths' | 'table' | 'flatFile' | 'inputs'>
): string[] {
	const tracked = new Set(run.flatPaths);
	const occupants = new Map<string, string>();
	for (const path of run.flatPaths) {
		const to = run.table.place(path)?.to;
		if (to) occupants.set(to, path);
	}
	const outputs = [
		...occupants.keys(),
		...run.inputs.projectFiles.map(({ path }) => path),
		...Object.values(WORKSPACES).map(({ root }) => `${root}package.json`)
	];
	const replaced = new Set(run.inputs.replacements.map(({ from }) => from));
	const problems = new Set<string>();
	for (const path of outputs) {
		if (!tracked.has(path) && existsSync(join(run.checkout, path))) {
			problems.add(`${path} is an output of the move, and an untracked or ignored file holds it`);
		}
	}
	for (const { path, text } of run.inputs.projectFiles) {
		const moved = run.table.place(path)?.to;
		if (moved !== undefined && moved !== path && !FLAT_PATHS_WRITTEN_ANEW.includes(path)) {
			problems.add(
				`${path} is a project file at a flat path that the table moves, and FLAT_PATHS_WRITTEN_ANEW omits it`
			);
		}
		const occupant = occupants.get(path);
		if (occupant === undefined || replaced.has(occupant) || run.flatFile(occupant) === text)
			continue;
		problems.add(
			`${path} is a project file of the generator, and the tracked ${occupant} lands there with other content`
		);
	}
	return [...problems].sort(compareCodeUnits);
}

export function verifyOutputs(run: Run): void {
	const problems = outputProblems(run);
	if (problems.length) throw new StaleInput(problems.join('\n'));
}
