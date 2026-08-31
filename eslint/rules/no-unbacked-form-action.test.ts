import { describe, expect, it } from 'vitest';
import parser from 'svelte-eslint-parser';
import rule from './no-unbacked-form-action.js';

type Report = { messageId: string; data?: { action?: string } };

function lint(template: string): Report[] {
	const reports: Report[] = [];
	const ast = parser.parseForESLint(template, {});

	const context = {
		report: (opts: Report) => reports.push(opts),
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

describe('no-unbacked-form-action', () => {
	it('passes a JS-only form that advertises no fallback', () => {
		expect(lint('<form onsubmit={handleSubmit} novalidate></form>')).toHaveLength(0);
	});

	it('passes a named SvelteKit form action', () => {
		expect(lint('<form method="POST" action="?/login"></form>')).toHaveLength(0);
	});

	it('passes a named action on an absolute route path', () => {
		expect(lint('<form method="POST" action="/en/signin?/login"></form>')).toHaveLength(0);
	});

	it('passes an empty action targeting this route default action', () => {
		expect(lint('<form method="POST" action=""></form>')).toHaveLength(0);
	});

	it('leaves a dynamic action to the author', () => {
		expect(lint('<form method="POST" action={target}></form>')).toHaveLength(0);
		expect(lint('<form method="POST" action="/{lang}/signin?/login"></form>')).toHaveLength(0);
	});

	it('flags the auth endpoint fallback that shipped in the sign-in form', () => {
		const reports = lint(
			'<form onsubmit={handleSubmit} action="/api/auth/sign-in/email" method="POST" novalidate></form>'
		);
		expect(reports).toHaveLength(1);
		expect(reports[0].messageId).toBe('unbackedFormAction');
		expect(reports[0].data?.action).toBe('/api/auth/sign-in/email');
	});

	it('flags an API endpoint action even without a submit handler', () => {
		expect(lint('<form action="/api/auth/sign-up/email" method="POST"></form>')).toHaveLength(1);
	});

	it('ignores an action prop on a component', () => {
		expect(lint('<Dialog action="/api/auth/sign-in/email" />')).toHaveLength(0);
	});
});
