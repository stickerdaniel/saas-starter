import { describe, expect, it } from 'vitest';
import parser from 'svelte-eslint-parser';
import rule from './no-hardcoded-modifier-keys.js';

function lint(template: string): Array<{ messageId: string }> {
	const reports: Array<{ messageId: string }> = [];
	const ast = parser.parseForESLint(template, {});

	const context = {
		report: (opts: { messageId: string }) => reports.push(opts),
		getFilename: () => 'test.svelte',
		filename: 'test.svelte'
	};

	const listeners = rule.create(context);

	function walk(node: Record<string, unknown>) {
		if (!node || typeof node !== 'object') return;
		const type = node.type as string;
		if (type && typeof listeners[type] === 'function') {
			(listeners[type] as (n: unknown) => void)(node);
		}
		for (const key of Object.keys(node)) {
			if (key === 'parent') continue;
			const val = node[key];
			if (Array.isArray(val)) val.forEach((v) => walk(v as Record<string, unknown>));
			else if (val && typeof val === 'object' && (val as Record<string, unknown>).type)
				walk(val as Record<string, unknown>);
		}
	}

	walk(ast.ast as unknown as Record<string, unknown>);
	return reports;
}

describe('no-hardcoded-modifier-keys', () => {
	it('flags ⌘ in template text', () => {
		const reports = lint('<span>⌘K</span>');
		expect(reports).toHaveLength(1);
		expect(reports[0].messageId).toBe('hardcodedModifier');
	});

	it('flags ⌃ and ⌥ in template text', () => {
		expect(lint('<span>⌃⇧1</span>')).toHaveLength(1);
		expect(lint('<span>⌥A</span>')).toHaveLength(1);
	});

	it('flags ⌘ in script string literals', () => {
		const reports = lint("<script>const shortcut = '⌘K';</script>");
		expect(reports).toHaveLength(1);
	});

	it('flags ⌘ in template literals', () => {
		const reports = lint('<script>const hint = `Press ⌘K`;</script>');
		expect(reports).toHaveLength(1);
	});

	it('flags ⌘ in attribute values', () => {
		const reports = lint('<button title="⌘K"></button>');
		expect(reports).toHaveLength(1);
	});

	it('allows helper variables in template', () => {
		const reports = lint('<span>{cmdOrCtrl}K</span>');
		expect(reports).toHaveLength(0);
	});

	it('allows ⇧ (used cross-platform on purpose)', () => {
		const reports = lint("<script>const kbd = ['⇧', '1'];</script><span>⇧1</span>");
		expect(reports).toHaveLength(0);
	});

	it('ignores comments', () => {
		const reports = lint('<script>// avoids macOS ⌘⇧3 screenshot conflict</script><!-- ⌘K -->');
		expect(reports).toHaveLength(0);
	});
});
