// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inventory, verifyInventory } from './validate-node-runtime';

describe('builder to runtime asset integrity', () => {
	it('detects missing dynamic chunks and altered fonts from the builder output', () => {
		const directory = mkdtempSync(join(tmpdir(), 'runtime-assets-'));
		try {
			mkdirSync(join(directory, 'client'));
			writeFileSync(join(directory, 'client', 'lazy.js'), 'export const value = 1;');
			writeFileSync(join(directory, 'client', 'font.woff2'), 'font bytes');
			const built = inventory(directory);
			expect(() => verifyInventory(built, inventory(directory))).not.toThrow();
			rmSync(join(directory, 'client', 'lazy.js'));
			expect(() => verifyInventory(built, inventory(directory))).toThrow('client/lazy.js');
			writeFileSync(join(directory, 'client', 'lazy.js'), 'export const value = 1;');
			writeFileSync(join(directory, 'client', 'font.woff2'), 'corrupt bytes');
			expect(() => verifyInventory(built, inventory(directory))).toThrow('client/font.woff2');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
	it('rejects absent build evidence', () => {
		expect(() => verifyInventory({}, {})).toThrow('Empty builder inventory');
	});
});
