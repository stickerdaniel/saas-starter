import { describe, expect, it } from 'vitest';
import parser from 'svelte-eslint-parser';
import rule from './no-hardcoded-aria-label.js';

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

describe('no-hardcoded-aria-label', () => {
	it('flags hardcoded aria-label string', () => {
		const reports = lint('<button aria-label="Close"></button>');
		expect(reports).toHaveLength(1);
		expect(reports[0].messageId).toBe('hardcodedAriaLabel');
	});

	it('allows $t() in aria-label', () => {
		const reports = lint("<button aria-label={$t('aria.close')}></button>");
		expect(reports).toHaveLength(0);
	});

	it('flags mixed literal and expression in aria-label', () => {
		// aria-label="Delete {name}" is actually expressed as aria-label="Delete {name}" in Svelte
		const reports = lint('<button aria-label="Delete {name}"></button>');
		expect(reports).toHaveLength(1);
	});

	it('ignores non-aria-label attributes', () => {
		const reports = lint('<button title="Close"></button>');
		expect(reports).toHaveLength(0);
	});

	it('ignores aria-label on elements without value', () => {
		// Unusual but shouldn't crash
		const reports = lint('<button aria-label></button>');
		expect(reports).toHaveLength(0);
	});

	it("flags string literal inside expression: aria-label={'Close'}", () => {
		const reports = lint("<button aria-label={'Close'}></button>");
		expect(reports).toHaveLength(1);
		expect(reports[0].messageId).toBe('hardcodedAriaLabel');
	});

	it('allows variable expressions (may come from $t() upstream)', () => {
		const reports = lint('<button aria-label={label}></button>');
		expect(reports).toHaveLength(0);
	});
});
