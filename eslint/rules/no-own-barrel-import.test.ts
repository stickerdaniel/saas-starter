// @vitest-environment node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { withoutTypeInformation } from '../without-type-information';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const eslint = new ESLint({ cwd: repoRoot, overrideConfig: withoutTypeInformation });
const ruleId = 'local/no-own-barrel-import';
const component = 'src/lib/components/ui/dialog/dialog-content.svelte';

async function ownBarrelLines(script: string, filePath = component) {
	const source = filePath.endsWith('.svelte')
		? `<script lang="ts">\n${script}\n</script>\n`
		: script;
	const [result] = await eslint.lintText(source, { filePath });
	expect(result.fatalErrorCount).toBe(0);
	return result.messages
		.filter((message) => message.ruleId === ruleId)
		.map((message) => message.line);
}

describe('local/no-own-barrel-import', () => {
	it.each([
		['relative index with extension', "import * as Dialog from './index.js';"],
		['relative index without extension', "import { Overlay } from './index';"],
		['directory itself', "import { Overlay } from '.';"],
		['alias to the own index', "import { Overlay } from '#lib/components/ui/dialog/index.js';"],
		['alias to the own directory', "import { Overlay } from '#lib/components/ui/dialog';"],
		['re-export', "export { Overlay } from './index.js';"],
		['dynamic import', "void import('./index.js');"]
	])('reports %s', async (_name, script) => {
		expect(await ownBarrelLines(script)).toHaveLength(1);
	});

	it.each([
		['a sibling file', "import DialogOverlay from './dialog-overlay.svelte';"],
		['another directory barrel', "import { Button } from '#lib/components/ui/button/index.js';"],
		['a parent index', "import { thing } from '../index.js';"],
		['a type-only import', "import type { Overlay } from './index.js';"],
		['a package', "import { Dialog } from 'bits-ui';"]
	])('allows %s', async (_name, script) => {
		expect(await ownBarrelLines(script)).toEqual([]);
	});

	it('allows tests beside the barrel', async () => {
		expect(
			await ownBarrelLines(
				"import { Overlay } from './index.js';",
				'src/lib/components/ui/dialog/dialog.test.ts'
			)
		).toEqual([]);
	});
});
