import fs from 'node:fs';
import path from 'node:path';
import { Linter } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parser } from 'typescript-eslint';
import rule from './require-svelte-module-extension.js';

let fixtures: string;
let filename: string;

beforeAll(() => {
	fixtures = fs.mkdtempSync(path.join(import.meta.dirname, 'tmp-svelte-module-extension-'));
	filename = path.join(fixtures, 'consumer.ts');
	fs.writeFileSync(path.join(fixtures, 'rune.svelte.ts'), 'export const state = {};');
	fs.writeFileSync(path.join(fixtures, 'js-rune.svelte.js'), 'export const state = {};');
	fs.writeFileSync(path.join(fixtures, 'Foo.svelte'), '<p>Fixture</p>');
	fs.writeFileSync(path.join(fixtures, 'collision.svelte'), '<p>Component fixture</p>');
	fs.writeFileSync(path.join(fixtures, 'collision.svelte.ts'), 'export const state = {};');
});

afterAll(() => {
	fs.rmSync(fixtures, { recursive: true, force: true });
});

function lint(code: string) {
	const linter = new Linter();
	return linter.verifyAndFix(
		code,
		[
			{
				files: ['**/*.ts'],
				languageOptions: { parser },
				plugins: { local: { rules: { 'require-svelte-module-extension': rule } } },
				rules: { 'local/require-svelte-module-extension': 'error' }
			}
		],
		{ filename }
	);
}

describe('require-svelte-module-extension', () => {
	it('allows an explicit .svelte.ts rune module import', () => {
		expect(lint(`import { state } from './rune.svelte.ts';`).messages).toHaveLength(0);
	});

	it('allows a real component import', () => {
		expect(lint(`import Foo from './Foo.svelte';`).messages).toHaveLength(0);
	});

	it('allows an ordinary module import', () => {
		expect(lint(`import { utility } from './utils.js';`).messages).toHaveLength(0);
	});

	it('allows an import of a real .svelte.js rune module', () => {
		expect(lint(`import { state } from './js-rune.svelte.js';`).messages).toHaveLength(0);
	});

	it('fixes the emitted .svelte.js form when only the .svelte.ts module exists', () => {
		const result = lint(`import type { State } from './rune.svelte.js';`);
		expect(result.fixed).toBe(true);
		expect(result.output).toBe(`import type { State } from './rune.svelte.ts';`);
		expect(result.messages).toHaveLength(0);
	});

	it('fixes a shortened rune module import', () => {
		const result = lint(`export { state } from './rune.svelte';`);
		expect(result.fixed).toBe(true);
		expect(result.output).toBe(`export { state } from './rune.svelte.ts';`);
		expect(result.messages).toHaveLength(0);
	});

	it('allows a .svelte.js import when neither module form exists', () => {
		expect(lint(`import { state } from './absent.svelte.js';`).messages).toHaveLength(0);
	});

	it('allows a shortened import when a same-stem component exists', () => {
		expect(lint(`import Collision from './collision.svelte';`).messages).toHaveLength(0);
	});

	it('fixes a dynamic rune module import', () => {
		const result = lint(`const module = import('./rune.svelte');`);
		expect(result.fixed).toBe(true);
		expect(result.output).toBe(`const module = import('./rune.svelte.ts');`);
	});
});
