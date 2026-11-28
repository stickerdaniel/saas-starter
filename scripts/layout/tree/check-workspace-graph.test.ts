import { describe, expect, it } from 'vitest';
import {
	bunfigProblems,
	graphProblems,
	packageProblems,
	pathProblems,
	sources,
	type Checkout,
	type Manifest,
	type Workspace
} from './check-workspace-graph.ts';

type Dependencies = Readonly<Record<string, string>>;

const workspace = (
	root: `${string}/`,
	name: string,
	dependencies: Dependencies = {},
	extra: Omit<Manifest, 'name' | 'dependencies'> = {}
): Workspace => ({ root, manifest: { name, dependencies, ...extra } });

const linked = (...names: string[]): Dependencies =>
	Object.fromEntries(names.map((name) => [name, 'workspace:*']));

const STARTER: readonly Workspace[] = [
	workspace('apps/web/', '@repo/web', linked('@repo/backend', '@repo/ui'), {
		imports: { '#lib/*': './src/lib/*' },
		devDependencies: { '@sveltejs/kit': '3.0.0', svelte: '5.59.1', ...linked('@repo/tooling') }
	}),
	workspace('packages/backend/', '@repo/backend', {
		...linked('@repo/emails', '@repo/product-config'),
		effect: '4.1.4'
	}),
	workspace('packages/emails/', '@repo/emails', linked('@repo/ui', '@repo/product-config')),
	workspace('packages/ui/', '@repo/ui', {}, { peerDependencies: { svelte: '5.59.1' } }),
	workspace('packages/product-config/', '@repo/product-config'),
	workspace('packages/tooling/', '@repo/tooling')
];

function checkout(
	workspaces: readonly Workspace[] = STARTER,
	files: Readonly<Record<string, string>> = {},
	bunfigs?: ReadonlyMap<'' | `${string}/`, unknown>
): Checkout {
	return {
		manifest: { name: 'saas-starter', workspaces: ['apps/*', 'packages/*'] },
		workspaces,
		files: Object.keys(files),
		text: (path) => files[path]!,
		bunfigs:
			bunfigs ??
			new Map([
				['' as const, { env: false }],
				...workspaces.map(({ root }) => [root, { env: false }] as const)
			])
	};
}

const replaced = (name: string, change: (current: Workspace) => Workspace) =>
	STARTER.map((current) => (current.manifest.name === name ? change(current) : current));

const withDependencies = (name: string, dependencies: Dependencies) =>
	replaced(name, (current) => ({
		...current,
		manifest: {
			...current.manifest,
			dependencies: { ...current.manifest.dependencies, ...dependencies }
		}
	}));

const problemsOf = (tree: Checkout) => graphProblems(tree).problems;

describe('rules 1 to 4: the declared graph', () => {
	it('passes the starter graph and a product workspace between the app and the backend', () => {
		const gateway = workspace('apps/voice-gateway/', 'voice-gateway', linked('@repo/backend'));
		const tree = [...withDependencies('@repo/web', linked('voice-gateway')), gateway];
		expect(problemsOf(checkout(tree))).toEqual([]);
	});

	it('fails an edge outside the allowed list, also one that the closure would reach', () => {
		expect(problemsOf(checkout(withDependencies('@repo/ui', linked('@repo/backend'))))).toEqual([
			'rule 1: @repo/ui -> @repo/backend is no allowed edge',
			'rule 3: @repo/backend -> @repo/emails closes a cycle',
			'rule 3: @repo/emails -> @repo/ui closes a cycle',
			'rule 3: @repo/ui -> @repo/backend closes a cycle'
		]);
		expect(problemsOf(checkout(withDependencies('@repo/backend', linked('@repo/ui'))))).toEqual([
			'rule 1: @repo/backend -> @repo/ui is no allowed edge'
		]);
	});

	it('keeps a development edge in devDependencies', () => {
		expect(problemsOf(checkout(withDependencies('@repo/ui', linked('@repo/tooling'))))).toEqual([
			'rule 1: @repo/ui -> @repo/tooling is for development only and sits in dependencies'
		]);
	});

	it('fails a starter workspace that reaches another through a product workspace', () => {
		const third = workspace('packages/third/', 'third', linked('@repo/ui'));
		const tree = [...withDependencies('@repo/product-config', linked('third')), third];
		expect(problemsOf(checkout(tree))).toEqual([
			'rule 2: @repo/product-config reaches @repo/ui through third'
		]);
	});

	it('fails a cycle and names both edges', () => {
		const tree = [
			...STARTER,
			workspace('packages/first/', 'first', linked('second')),
			workspace('packages/second/', 'second', linked('first'))
		];
		expect(problemsOf(checkout(tree))).toEqual([
			'rule 3: first -> second closes a cycle',
			'rule 3: second -> first closes a cycle'
		]);
	});

	it('fails a workspace dependency on an absent member or with another protocol', () => {
		const absent = STARTER.filter(({ manifest }) => manifest.name !== '@repo/ui');
		expect(problemsOf(checkout(absent))).toEqual([
			'rule 4: @repo/emails declares @repo/ui, which is no workspace of this checkout',
			'rule 4: @repo/web declares @repo/ui, which is no workspace of this checkout'
		]);
		expect(
			problemsOf(checkout(withDependencies('@repo/web', { '@repo/ui': 'workspace:^' })))
		).toEqual(['rule 4: @repo/web declares @repo/ui as workspace:^, not as workspace:*']);
	});
});

describe('rule 5: paths stay inside their workspace', () => {
	const pathsOf = (files: Record<string, string>, tree = STARTER) => {
		const read = checkout(tree, files);
		return pathProblems(read, sources(read)).problems;
	};

	it('fails a relative import into another workspace', () => {
		expect(
			pathsOf({ 'apps/web/src/page.ts': "import '../../../packages/backend/convex/schema.ts';" })
		).toEqual([
			'rule 5: apps/web/src/page.ts:1 names ../../../packages/backend/convex/schema.ts, which resolves to packages/backend/convex/schema.ts in @repo/backend, outside @repo/web'
		]);
	});

	it('fails an alias that resolves into another workspace and names both owners', () => {
		const tree = replaced('@repo/web', (current) => ({
			...current,
			manifest: { ...current.manifest, imports: { '#backend/*': '../../packages/backend/*' } }
		}));
		expect(
			pathsOf({ 'apps/web/src/page.ts': "import '#backend/convex/schema.ts';" }, tree)
		).toEqual([
			'rule 5: apps/web/src/page.ts:1 names #backend/convex/schema.ts, which resolves to packages/backend/convex/schema.ts in @repo/backend, outside @repo/web'
		]);
	});

	it('fails a stylesheet source path into another workspace', () => {
		expect(
			pathsOf({
				'apps/web/src/routes/layout.css': "@source '../../../../packages/backend/convex';"
			})
		).toEqual([
			'rule 5: apps/web/src/routes/layout.css:1 names ../../../../packages/backend/convex, which resolves to packages/backend/convex in @repo/backend, outside @repo/web'
		]);
	});

	it('passes reads into the own install, an own alias and the content input of the app', () => {
		expect(
			pathsOf({
				'apps/web/src/routes/layout.css': [
					"@import 'tailwindcss' source('..');",
					"@source '../../node_modules/svelte-streamdown/dist/**/*.{js,svelte}';",
					"@source not '../lib/emails';"
				].join('\n'),
				'apps/web/src/lib/chat/reactivity.test.ts': [
					"import { flushSync } from '../../../node_modules/svelte/src/index-client.js';",
					"import { types } from '#lib/chat/types.ts';"
				].join('\n'),
				'apps/web/src/lib/docs/source.server.ts':
					"const pages = import.meta.glob('../../../../../docs/**/*.md', { query: '?raw' });",
				'apps/web/src/lib/schema.ts': "const schema = new URL('./schema.json', import.meta.url);"
			})
		).toEqual([]);
	});

	it('fails a glob, a URL and a read of a path outside the workspace', () => {
		expect(
			pathsOf({
				'packages/ui/src/a.ts': [
					"const pages = import.meta.glob(['/src/**/*.svelte', '../../../docs/*.md']);",
					"const schema = new URL('../../../.env-convex.schema', import.meta.url);",
					"const runner = join(import.meta.dirname, '../../tooling/src/runner.ps1');"
				].join('\n')
			})
		).toEqual([
			'rule 5: packages/ui/src/a.ts:1 names ../../../docs/*.md, which resolves to docs in the root, outside @repo/ui',
			'rule 5: packages/ui/src/a.ts:2 names ../../../.env-convex.schema, which resolves to .env-convex.schema in the root, outside @repo/ui',
			'rule 5: packages/ui/src/a.ts:3 names ../../tooling/src/runner.ps1, which resolves to packages/tooling/src/runner.ps1 in @repo/tooling, outside @repo/ui'
		]);
	});
});

describe('rule 6: every package specifier is declared by its workspace', () => {
	const packagesOf = (files: Record<string, string>, tree = STARTER) =>
		packageProblems(sources(checkout(tree, files))).problems;

	it('fails a package of the root, an undeclared package, a type-only import and an unread test', () => {
		expect(
			packagesOf({
				'packages/ui/src/a.ts': "import { mode } from 'esm-env';",
				'packages/backend/convex/b.ts': "import { nothing } from 'left-pad';",
				'packages/emails/src/c.ts': "import type { Readable } from 'mdast';",
				'packages/product-config/src/d.test.ts': "import { faker } from '@faker-js/faker';"
			})
		).toEqual([
			'rule 6: packages/ui/src/a.ts:1 imports esm-env, and @repo/ui declares no esm-env',
			'rule 6: packages/backend/convex/b.ts:1 imports left-pad, and @repo/backend declares no left-pad',
			'rule 6: packages/emails/src/c.ts:1 imports mdast, and @repo/emails declares no mdast',
			'rule 6: packages/product-config/src/d.test.ts:1 imports @faker-js/faker, and @repo/product-config declares no @faker-js/faker'
		]);
	});

	it('reads the package directives of stylesheets and style blocks', () => {
		expect(
			packagesOf({
				'apps/web/src/routes/layout.css': [
					"@import 'tailwindcss' source('..');",
					"@plugin '@tailwindcss/typography';",
					"@reference 'tw-animate-css';",
					"@config './tailwind.config.ts';"
				].join('\n'),
				'apps/web/src/lib/card.svelte':
					"<div></div>\n<style>\n\t@import 'shadcn-svelte/tailwind.css';\n</style>"
			})
		).toEqual([
			'rule 6: apps/web/src/routes/layout.css:1 imports tailwindcss, and @repo/web declares no tailwindcss',
			'rule 6: apps/web/src/routes/layout.css:2 imports @tailwindcss/typography, and @repo/web declares no @tailwindcss/typography',
			'rule 6: apps/web/src/routes/layout.css:3 imports tw-animate-css, and @repo/web declares no tw-animate-css',
			'rule 6: apps/web/src/lib/card.svelte:3 imports shadcn-svelte/tailwind.css, and @repo/web declares no shadcn-svelte'
		]);
	});

	it('passes a subpath, the own name, an imports entry, Kit, Vite and builtins, and declared types', () => {
		const tree = withDependencies('@repo/web', { '@types/mdx__types': '1.0.0' });
		expect(
			packagesOf(
				{
					'apps/web/src/a.ts': [
						"import { Effect } from '@repo/backend/shared/effect/errors.ts';",
						"import { self } from '@repo/web';",
						"import { types } from '#lib/chat/types.ts';",
						"import { browser } from '$app/env';",
						"import modules from 'virtual:modules';",
						"import { readFileSync } from 'node:fs';",
						"import { $ } from 'bun:test';",
						"import type { MDXProps } from '@mdx/types';"
					].join('\n')
				},
				tree
			)
		).toEqual([]);
	});

	it('reads every file that rule 5 reads', () => {
		const tree = checkout(STARTER, {
			'apps/web/src/routes/layout.css': "@import 'tailwindcss';",
			'apps/web/src/a.ts': "import '../../../packages/backend/x.ts';",
			'packages/ui/src/b.svelte': '<p></p>'
		});
		const read = sources(tree);
		expect(packageProblems(read).files).toEqual(pathProblems(tree, read).files);
		expect(pathProblems(tree, read).files).toEqual([
			'apps/web/src/routes/layout.css',
			'apps/web/src/a.ts',
			'packages/ui/src/b.svelte'
		]);
	});
});

describe('rule 7 and the testing entries', () => {
	it('fails a workspace without a Bun config and one whose key sits under [run]', () => {
		const bunfigs = new Map<'' | `${string}/`, unknown>([
			['', { env: false }],
			...STARTER.map(({ root }) => [root, { env: false }] as const)
		]);
		bunfigs.delete('packages/ui/');
		bunfigs.set('packages/emails/', { run: { env: false } });
		expect(bunfigProblems(checkout(STARTER, {}, bunfigs))).toEqual([
			'rule 7: packages/emails/bunfig.toml holds no env = false on its root object',
			'rule 7: packages/ui/bunfig.toml is missing'
		]);
	});

	it('fails an import of a testing entry outside a suite and passes it in a test', () => {
		expect(
			problemsOf(
				checkout(STARTER, {
					'apps/web/src/a.ts':
						"import { modules } from '@repo/backend/testing/confect/modules.ts';",
					'apps/web/src/a.test.ts':
						"import { modules } from '@repo/backend/testing/confect/modules.ts';"
				})
			)
		).toEqual([
			'testing: apps/web/src/a.ts:1 imports @repo/backend/testing/confect/modules.ts outside a suite'
		]);
	});
});
