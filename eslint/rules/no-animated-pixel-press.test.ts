import { describe, expect, it } from 'vitest';
import parser from 'svelte-eslint-parser';
import rule from './no-animated-pixel-press.js';

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
			(listeners[type] as (candidate: unknown) => void)(node);
		}
		for (const [key, value] of Object.entries(node)) {
			if (key === 'parent') continue;
			if (Array.isArray(value)) value.forEach((child) => walk(child as Record<string, unknown>));
			else if (value && typeof value === 'object' && (value as Record<string, unknown>).type) {
				walk(value as Record<string, unknown>);
			}
		}
	}

	walk(ast.ast as unknown as Record<string, unknown>);
	return reports;
}

describe('no-animated-pixel-press', () => {
	it.each([
		'transition active:translate-y-px',
		'transition-all active:-translate-x-px',
		'transition-transform sm:active:translate-y-px',
		'transition-[color,translate] active:translate-y-px',
		'transition-[opacity,transform] active:translate-y-px',
		'transition-[var(--press-properties)] active:translate-y-px',
		'transition-(--press-properties) active:translate-y-px'
	])('flags an animated pixel press in %s', (classes) => {
		const reports = lint(`<button class="${classes}"></button>`);
		expect(reports).toHaveLength(1);
		expect(reports[0].messageId).toBe('animatedPixelPress');
	});

	it('combines static classes split across cn arguments', () => {
		const reports = lint(
			'<button class={cn("transition-transform", enabled && "active:translate-y-px")}></button>'
		);
		expect(reports).toHaveLength(1);
	});

	it('recognizes press propagation through an arbitrary group selector', () => {
		const reports = lint(
			'<span class="transition-all group-has-[[data-slot=trigger]:active]/row:translate-y-px"></span>'
		);
		expect(reports).toHaveLength(1);
	});

	it('recognizes press propagation through a group active variant', () => {
		const reports = lint('<span class="transition-all group-active/link:translate-y-px"></span>');
		expect(reports).toHaveLength(1);
	});

	it('checks class values assembled in a script object', () => {
		const reports = lint(
			'<script>const attrs = { class: cn("transition-[color,translate]", "active:translate-y-px") };</script>'
		);
		expect(reports).toHaveLength(1);
	});

	it('requires component call sites to override unknown default transitions', () => {
		expect(lint('<Widget class="active:translate-y-px" />')[0].messageId).toBe(
			'unprovenComponentPress'
		);
		expect(lint('<Sidebar.Action class="active:translate-y-px" />')[0].messageId).toBe(
			'unprovenComponentPress'
		);
	});

	it('checks the base class of a tailwind-variants definition', () => {
		const reports = lint(
			'<script>const button = tv({ base: "transition-all active:translate-y-px", variants: {} });</script>'
		);
		expect(reports).toHaveLength(1);
	});

	it('checks the base argument of a cva definition', () => {
		const reports = lint(
			'<script>const button = cva("transition-transform active:translate-y-px", {});</script>'
		);
		expect(reports).toHaveLength(1);
	});

	it.each([
		'<button class="active:translate-y-px"></button>',
		'<button class="transition-colors active:translate-y-px"></button>',
		'<button class="transition-opacity active:translate-y-px"></button>',
		'<button class="transition-[opacity] active:translate-y-px"></button>',
		'<button class="transition-[width,height,padding] active:translate-y-px"></button>',
		'<Widget class="transition-colors active:translate-y-px" />',
		'<Widget class="transition-none active:translate-y-px" />',
		'<button class="transition-transform active:scale-[0.97]"></button>',
		'<div class="transition-all translate-y-px"></div>',
		'<div class="transition-all data-active:translate-y-px"></div>'
	])('allows %s', (template) => {
		expect(lint(template)).toHaveLength(0);
	});
});
