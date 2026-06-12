import { describe, expect, it } from 'vitest';
import parser from 'svelte-eslint-parser';
import rule from './require-motion-guard-transition.js';

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

describe('require-motion-guard-transition', () => {
	it('flags fly without params', () => {
		const reports = lint('<div in:fly></div>');
		expect(reports).toHaveLength(1);
		expect(reports[0].messageId).toBe('unguardedMovementTransition');
	});

	it('flags fly with all-literal params', () => {
		const reports = lint('<div transition:fly={{ y: 10, duration: 200 }}></div>');
		expect(reports).toHaveLength(1);
	});

	it('flags slide with all-literal params', () => {
		const reports = lint('<div out:slide={{ duration: 150 }}></div>');
		expect(reports).toHaveLength(1);
	});

	it('flags negative number literals as plain literals', () => {
		const reports = lint('<div in:fly={{ x: -20, duration: 200 }}></div>');
		expect(reports).toHaveLength(1);
	});

	it('flags an empty params object', () => {
		const reports = lint('<div in:fly={{}}></div>');
		expect(reports).toHaveLength(1);
	});

	it('allows a prefersReducedMotion-gated duration (field-error style)', () => {
		const reports = lint(
			'<div transition:slide={{ duration: prefersReducedMotion.current ? 0 : 200 }}></div>'
		);
		expect(reports).toHaveLength(0);
	});

	it('allows gated offsets and durations (sliding-header style)', () => {
		const reports = lint(
			'<div in:fly={{ x: noMotion ? 0 : 20, duration: skipTransition ? 0 : 200, easing: backOut }}></div>'
		);
		expect(reports).toHaveLength(0);
	});

	it('allows a gated offset next to a literal duration (ConversationScrollButton style)', () => {
		const reports = lint(
			'<div in:fly={{ duration: 300, y: prefersReducedMotion.current ? 0 : 10, easing: backOut }}></div>'
		);
		expect(reports).toHaveLength(0);
	});

	it('allows fade with literal params (opacity-only is WCAG-acceptable)', () => {
		expect(lint('<div in:fade={{ duration: 150 }}></div>')).toHaveLength(0);
		expect(lint('<div transition:fade></div>')).toHaveLength(0);
	});

	it('allows spread params (guard may come from the spread)', () => {
		const reports = lint('<div in:fly={{ ...flyParams }}></div>');
		expect(reports).toHaveLength(0);
	});

	it('allows identifier params (guard may live upstream)', () => {
		const reports = lint('<div in:fly={flyParams}></div>');
		expect(reports).toHaveLength(0);
	});

	it('checks in:, out: and transition: directives alike', () => {
		const reports = lint(
			'<div in:fly={{ y: 10 }} out:fly={{ y: 10 }} transition:slide={{ duration: 100 }}></div>'
		);
		expect(reports).toHaveLength(3);
	});
});
