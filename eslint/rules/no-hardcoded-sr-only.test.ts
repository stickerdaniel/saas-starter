import { describe, expect, it } from 'vitest';
import parser from 'svelte-eslint-parser';
import rule from './no-hardcoded-sr-only.js';

function lint(template: string): { messageId: string }[] {
	const reports: { messageId: string }[] = [];
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

describe('no-hardcoded-sr-only', () => {
	it('flags hardcoded text in sr-only element', () => {
		const reports = lint('<span class="sr-only">Close</span>');
		expect(reports).toHaveLength(1);
		expect(reports[0].messageId).toBe('hardcodedSrOnly');
	});

	it('allows $t() in sr-only element', () => {
		const reports = lint('<span class="sr-only">{$t(\'aria.close\')}</span>');
		expect(reports).toHaveLength(0);
	});

	it('flags hardcoded text when sr-only is among multiple classes', () => {
		const reports = lint('<span class="mt-2 sr-only text-sm">Close</span>');
		expect(reports).toHaveLength(1);
	});

	it('ignores elements without sr-only class', () => {
		const reports = lint('<span class="hidden">Close</span>');
		expect(reports).toHaveLength(0);
	});

	it('ignores sr-only elements with only whitespace text', () => {
		const reports = lint('<span class="sr-only"> {$t(\'aria.close\')} </span>');
		expect(reports).toHaveLength(0);
	});

	it('ignores elements without class attribute', () => {
		const reports = lint('<span>Close</span>');
		expect(reports).toHaveLength(0);
	});
});
