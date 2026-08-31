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

function componentFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
			componentFiles(path, out);
		} else if (entry.name.endsWith('.svelte')) {
			out.push(path);
		}
	}
	return out;
}

/**
 * Only what a component actually renders counts. Three kinds of text mention a
 * hook without applying it, and each of them let a real miss through when it was
 * counted: a CSS selector (`querySelectorAll('.t-avatar')`), a comment naming
 * the rule it pairs with, and a substring of a longer word (`t-stream` inside
 * `application/octet-stream`, `t-switch` inside `t-switch-thumb`). So: comments
 * are stripped, dotted selector forms are dropped, `.ts` files are left out
 * entirely, and the rest is compared as whole class tokens.
 */
function renderedClassTokens(source: string): string[] {
	const withoutComments = source
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/(^|[^:])\/\/.*$/gm, '$1 ');
	return withoutComments.replace(/\.[A-Za-z_-][\w-]*/g, ' ').split(/[^A-Za-z0-9-]+/);
}

const css = readFileSync(join(root, 'src/routes/layout.css'), 'utf8');
const hooks = [...new Set([...css.matchAll(/\.(t-[a-z0-9-]+)/g)].map((m) => m[1]))].sort();

const applied = new Set(
	componentFiles(join(root, 'src')).flatMap((path) =>
		renderedClassTokens(readFileSync(path, 'utf8'))
	)
);

describe('motion class hooks', () => {
	it('finds hooks to check', () => {
		expect(hooks.length).toBeGreaterThan(10);
	});

	it.each(hooks)('%s is applied by a component', (hook) => {
		expect(applied).toContain(hook);
	});
});
