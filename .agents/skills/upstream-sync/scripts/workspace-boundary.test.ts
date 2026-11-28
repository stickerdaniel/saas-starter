import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BASE_TABLE, type EdgePair } from '../layout/v3';
import {
	compareEdges,
	forbiddenEdges,
	forbiddenPairs,
	readImportEdges,
	selectRatchet,
	trackedPaths
} from './apply-layout';

const CHECKOUT = resolve(import.meta.dirname, '../../../..');

const KNOWN_EDGES: readonly EdgePair[] = [];

const pairs = (edges: ReadonlyArray<{ from: string; target: string }>) => [
	...new Set(edges.map(({ from, target }) => `${from} -> ${target}`))
];

const ratchet = await selectRatchet(CHECKOUT);

describe('the workspace boundary', () => {
	it('holds on this checkout except for the known edges', (context) => {
		const known = ratchet.knownEdges === 'starter' ? KNOWN_EDGES : ratchet.knownEdges;
		if ('skip' in known) return context.skip(known.skip);
		expect(ratchet.refusals).toEqual([]);
		const found = forbiddenPairs(ratchet.table, readImportEdges(CHECKOUT, trackedPaths(CHECKOUT)));
		const { added, gone } = compareEdges(found, known);
		expect(added, 'new forbidden edges').toEqual([]);
		expect(gone, 'known edges that are gone').toEqual([]);
	}, 60_000);
});

describe('forbiddenEdges', () => {
	const fixtures: string[] = [];
	afterEach(() => {
		for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
	});

	function tree(files: Record<string, string>): { root: string; paths: string[] } {
		const root = mkdtempSync(join(tmpdir(), 'workspace-boundary-'));
		fixtures.push(root);
		for (const [path, content] of Object.entries(files)) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), content);
		}
		return { root, paths: Object.keys(files) };
	}

	it('reads imports, mocks, Kit modules, install paths and path reads of tests and harnesses', () => {
		const { root, paths } = tree({
			'package.json': JSON.stringify({ imports: { '#lib/*': './src/lib/*' } }),
			'src/routes/+page.ts': '',
			'src/routes/layout.css': '',
			'src/lib/components/ui/x/Harness.svelte':
				'<script lang="ts">\n\timport { load } from \'../../../../routes/+page\';\n</script>\n',
			'src/lib/components/ui/x/kit.ts': "import { goto } from '$app/navigation';\n",
			'src/lib/components/ui/x/svelte.test.ts':
				"vi.importActual('../../../../../node_modules/svelte/src/index-client.js');\n",
			'src/lib/components/ui/x/read.test.ts':
				"readFileSync(join(import.meta.dirname, '../../../../routes/layout.css'));\n",
			'src/lib/components/ui/x/rule.test.ts':
				'const code = "import a from \'#lib/components/app.svelte\';";\n',
			'src/lib/chat/svelte.test.ts':
				"vi.importActual('../../../node_modules/svelte/src/index-client.js');\n",
			'src/lib/emails/mail.ts': "import { goto } from '#lib/components/ui/x/kit';\n"
		});
		expect(pairs(forbiddenEdges(BASE_TABLE, readImportEdges(root, paths))).sort()).toEqual([
			'src/lib/components/ui/x/Harness.svelte -> src/routes/+page.ts',
			'src/lib/components/ui/x/kit.ts -> $app/navigation',
			'src/lib/components/ui/x/read.test.ts -> src/routes/layout.css',
			'src/lib/components/ui/x/svelte.test.ts -> node_modules/svelte/src/index-client.js'
		]);
	});

	it('lets every workspace read the repository tools and none read the root', () => {
		const { root, paths } = tree({
			'package.json': '{}',
			'scripts/git-context.ts': '',
			'scripts/static-checks.ts': "import { gitContext } from './git-context';\n",
			'scripts/dev.ts':
				"import { gitContext } from './git-context';\nimport { run } from './static-checks';\n",
			'scripts/template-setup.ts': "import { gitContext } from './git-context';\n",
			'packages/create-saas-starter/test/setup.test.ts':
				"readFileSync(join(import.meta.dirname, '../../../scripts/template-setup.ts'));\n"
		});
		expect(pairs(forbiddenEdges(BASE_TABLE, readImportEdges(root, paths))).sort()).toEqual([
			'packages/create-saas-starter/test/setup.test.ts -> scripts/template-setup.ts',
			'scripts/dev.ts -> scripts/static-checks.ts'
		]);
	});
});
