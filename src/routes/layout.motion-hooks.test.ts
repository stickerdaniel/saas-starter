import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The `t-*` block in layout.css drives every ported transition, and it drives it
 * through class hooks the components have to spell out by hand. A rule whose
 * hook nobody applies fails silently and in the worst direction: the badge's
 * closing rule targeted `.t-badge-dot`, the component never set it, and a red
 * "0" pill sat on the support launcher on every page while every check passed.
 */

const root = join(import.meta.dirname, '../..');

function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
			sourceFiles(path, out);
		} else if (/\.(svelte|ts)$/.test(entry.name)) {
			out.push(path);
		}
	}
	return out;
}

const css = readFileSync(join(root, 'src/routes/layout.css'), 'utf8');
const hooks = [...new Set([...css.matchAll(/\.(t-[a-z0-9-]+)/g)].map((m) => m[1]))].sort();

// Whole class tokens, never substrings. A plain `includes` passed for `t-stream`
// on the string `application/octet-stream`, and for `t-switch` on the unrelated
// `t-switch-thumb`, which is exactly the miss this file exists to catch.
const applied = new Set(
	sourceFiles(join(root, 'src'))
		.filter((path) => !path.endsWith('layout.motion-hooks.test.ts'))
		.flatMap((path) => readFileSync(path, 'utf8').split(/[^A-Za-z0-9-]+/))
);

describe('motion class hooks', () => {
	it('finds hooks to check', () => {
		expect(hooks.length).toBeGreaterThan(10);
	});

	it.each(hooks)('%s is applied by a component', (hook) => {
		expect(applied).toContain(hook);
	});
});
