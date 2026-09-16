import { describe, expect, it } from 'vitest';
import parser from 'svelte-eslint-parser';
import rule from './prefer-shadcn-primitives.js';

function lint(
	template: string,
	filename = 'src/lib/components/app.svelte'
): Array<{ messageId: string }> {
	const reports: Array<{ messageId: string }> = [];
	const ast = parser.parseForESLint(template, {});

	const context = {
		report: (opts: { messageId: string }) => reports.push(opts),
		getFilename: () => filename,
		filename
	};

	const listeners = rule.create(context);

	function walk(node: Record<string, unknown>, parent: Record<string, unknown> | null) {
		if (!node || typeof node !== 'object') return;
		node.parent = parent as unknown as never;
		const type = node.type as string;
		if (type && typeof listeners[type] === 'function') {
			(listeners[type] as (n: unknown) => void)(node);
		}
		for (const key of Object.keys(node)) {
			if (key === 'parent') continue;
			const val = node[key];
			if (Array.isArray(val)) val.forEach((v) => walk(v as Record<string, unknown>, node));
			else if (val && typeof val === 'object' && (val as Record<string, unknown>).type)
				walk(val as Record<string, unknown>, node);
		}
	}

	walk(ast.ast as unknown as Record<string, unknown>, null);
	return reports;
}

describe('prefer-shadcn-primitives', () => {
	it('flags a native button', () => {
		const reports = lint('<button type="button">Save</button>');
		expect(reports.map((r) => r.messageId)).toEqual(['nativeButton']);
	});

	it('allows a bits-ui child-host button with a spread', () => {
		const reports = lint(
			'{#snippet child({ props })}<button type="button" {...props}>Go</button>{/snippet}'
		);
		expect(reports).toHaveLength(0);
	});

	it('allows shadcn Button', () => {
		const reports = lint('<Button type="button">Save</Button>');
		expect(reports).toHaveLength(0);
	});

	it('flags a native dialog', () => {
		const reports = lint('<dialog>Hello</dialog>');
		expect(reports.map((r) => r.messageId)).toEqual(['nativeDialog']);
	});

	it('flags an HTML title tooltip', () => {
		const reports = lint('<span title={label}>{label}</span>');
		expect(reports.map((r) => r.messageId)).toEqual(['nativeTitle']);
	});

	it('flags title on Button', () => {
		const reports = lint('<Button title={label}>Save</Button>');
		expect(reports.map((r) => r.messageId)).toEqual(['nativeTitle']);
	});

	it('allows iframe title as the accessible name', () => {
		const reports = lint('<iframe title={name} src={url}></iframe>');
		expect(reports).toHaveLength(0);
	});

	it('allows markdown link title', () => {
		const reports = lint('<a href={href} title={token.title}>{label}</a>');
		expect(reports).toHaveLength(0);
	});

	it('allows SEOHead title as a component prop', () => {
		const reports = lint('<SEOHead title={pageTitle} />');
		expect(reports).toHaveLength(0);
	});

	it('skips shadcn ui wrappers', () => {
		const reports = lint(
			'<button type="button">Save</button>',
			'src/lib/components/ui/button/button.svelte'
		);
		expect(reports).toHaveLength(0);
	});

	it('skips the obfuscated email control', () => {
		const reports = lint(
			'<button type="button">a@b.c</button>',
			'src/lib/components/obfuscated-email.svelte'
		);
		expect(reports).toHaveLength(0);
	});
});
