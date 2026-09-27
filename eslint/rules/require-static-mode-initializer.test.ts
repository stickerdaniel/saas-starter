// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const eslint = new ESLint({ cwd: repoRoot });
const ruleId = 'local/require-static-mode-initializer';
const layoutPath = 'src/routes/+layout.svelte';
const rootLayout = readFileSync(path.join(repoRoot, layoutPath), 'utf8');
const rootMount = '<ModeWatcher disableHeadScriptInjection synchronousModeChanges />';
const imports =
	'<script lang="ts">import { ModeWatcher } from "mode-watcher"; let props = {};</script>\n';

async function ruleMessages(source: string, filePath = layoutPath) {
	const [result] = await eslint.lintText(source, { filePath });
	expect(result.fatalErrorCount).toBe(0);
	return result.messages.filter((message) => message.ruleId === ruleId);
}

describe('require-static-mode-initializer', () => {
	it('accepts the real root layout', async () => {
		expect(rootLayout).toContain(rootMount);
		expect(await ruleMessages(rootLayout)).toEqual([]);
	}, 60_000);

	it('reports the root layout mount once the prop is removed, naming the pattern', async () => {
		const source = rootLayout.replace(rootMount, '<ModeWatcher synchronousModeChanges />');
		const messages = await ruleMessages(source);
		expect(messages).toHaveLength(1);
		expect(messages[0].severity).toBe(2);
		expect(messages[0].line).toBe(
			source.slice(0, source.indexOf('<ModeWatcher')).split('\n').length
		);
		expect(messages[0].message).toContain('Pass disableHeadScriptInjection to ModeWatcher as true');
		expect(messages[0].message).toContain('src/app.html owns the theme initializer');
	}, 60_000);

	it.each([
		['the bare prop', `${imports}<ModeWatcher disableHeadScriptInjection />`],
		['a literal true', `${imports}<ModeWatcher disableHeadScriptInjection={true} />`],
		['a true after a spread', `${imports}<ModeWatcher {...props} disableHeadScriptInjection />`],
		[
			'a renamed import with the prop',
			'<script lang="ts">import { ModeWatcher as Theme } from "mode-watcher";</script>\n<Theme disableHeadScriptInjection />'
		],
		[
			'a namespace import with the prop',
			'<script lang="ts">import * as mw from "mode-watcher";</script>\n<mw.ModeWatcher disableHeadScriptInjection />'
		]
	])(
		'accepts %s',
		async (_label, source) => {
			expect(await ruleMessages(source)).toEqual([]);
		},
		60_000
	);

	it.each([
		['a missing prop', `${imports}<ModeWatcher />`],
		['a literal false', `${imports}<ModeWatcher disableHeadScriptInjection={false} />`],
		[
			'a prop named only in a comment',
			`${imports}<!-- disableHeadScriptInjection --><ModeWatcher />`
		],
		[
			'a later spread that can override it',
			`${imports}<ModeWatcher disableHeadScriptInjection {...props} />`
		],
		[
			'a shorthand whose value is not provably true',
			'<script lang="ts">import { ModeWatcher } from "mode-watcher"; let disableHeadScriptInjection = false;</script>\n<ModeWatcher {disableHeadScriptInjection} />'
		],
		[
			'a renamed import without the prop',
			'<script lang="ts">import { ModeWatcher as Theme } from "mode-watcher";</script>\n<Theme />'
		],
		[
			'a namespace import without the prop',
			'<script lang="ts">import * as mw from "mode-watcher";</script>\n<mw.ModeWatcher />'
		]
	])(
		'reports %s',
		async (_label, source) => {
			expect(await ruleMessages(source)).toHaveLength(1);
		},
		60_000
	);

	it('ignores a same-named component from another module', async () => {
		const source =
			'<script lang="ts">import ModeWatcher from "$lib/components/mode-watcher.svelte";</script>\n<ModeWatcher />';
		expect(await ruleMessages(source)).toEqual([]);
	}, 60_000);

	it('is not enabled outside the root layout', async () => {
		expect(
			await ruleMessages(`${imports}<ModeWatcher />`, 'src/routes/[[lang]]/+layout.svelte')
		).toEqual([]);
	}, 60_000);
});
