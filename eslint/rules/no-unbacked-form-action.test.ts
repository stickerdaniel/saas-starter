import { describe, expect, it } from 'vitest';
import parser from 'svelte-eslint-parser';
import rule from './no-unbacked-form-action.js';

type Report = { messageId: string; data?: { action?: string; method?: string } };

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

	it('flags the auth endpoint fallback that shipped in the sign-in form', () => {
		const reports = lint(
			'<form onsubmit={handleSubmit} action="/api/auth/sign-in/email" method="POST" novalidate></form>'
		);
		expect(reports).toHaveLength(1);
		expect(reports[0].messageId).toBe('unbackedFormAction');
		expect(reports[0].data?.action).toBe('/api/auth/sign-in/email');
	});

	describe('recognizing a form action target', () => {
		it('passes a named action, bare and on a route path', () => {
			expect(lint('<form method="POST" action="?/login"></form>')).toHaveLength(0);
			expect(lint('<form method="POST" action="/en/signin?/login"></form>')).toHaveLength(0);
		});

		it('passes a named action that is not the first search key', () => {
			// SvelteKit scans every search key for a "/" prefix, so a preceding
			// ordinary parameter does not stop it finding the action.
			expect(lint('<form method="POST" action="?redirect=/app&/login"></form>')).toHaveLength(0);
		});

		it('flags an action name hidden in the fragment, which the browser drops', () => {
			expect(lint('<form method="POST" action="/api/x#?/login"></form>')).toHaveLength(1);
		});

		it('flags an action name that is only a search value', () => {
			expect(lint('<form method="POST" action="/api/x?next=?/login"></form>')).toHaveLength(1);
		});
	});

	describe('the effective submit method', () => {
		it('flags a named action on a form that defaults to GET', () => {
			const reports = lint('<form action="?/login"></form>');
			expect(reports).toHaveLength(1);
			expect(reports[0].messageId).toBe('formActionNeedsPost');
			expect(reports[0].data?.method).toBe('get');
		});

		it('flags a named action on an explicit GET form', () => {
			expect(lint('<form method="get" action="?/login"></form>')[0]?.messageId).toBe(
				'formActionNeedsPost'
			);
		});

		it('passes ordinary GET navigation', () => {
			expect(lint('<form method="GET" action="/search"></form>')).toHaveLength(0);
			expect(lint('<form action="/search"></form>')).toHaveLength(0);
		});

		it('accepts any casing of the method', () => {
			expect(lint('<form method="Post" action="?/login"></form>')).toHaveLength(0);
			expect(lint('<form method="post" action="/api/x"></form>')).toHaveLength(1);
		});

		it('leaves a computed method to the author', () => {
			expect(lint('<form method={verb} action="/api/x"></form>')).toHaveLength(0);
		});
	});

	describe('submitter overrides', () => {
		it('flags a formaction that escapes an otherwise correct form', () => {
			const reports = lint(
				'<form method="POST" action="?/login"><button formaction="/api/auth/sign-in/email">go</button></form>'
			);
			expect(reports).toHaveLength(1);
			expect(reports[0].messageId).toBe('unbackedFormAction');
			expect(reports[0].data?.action).toBe('/api/auth/sign-in/email');
		});

		it('reaches a submitter nested in wrapper elements', () => {
			expect(
				lint(
					'<form method="POST" action="?/login"><div><span><button formaction="/api/x">go</button></span></div></form>'
				)
			).toHaveLength(1);
		});

		it('passes a formaction that names another action', () => {
			expect(
				lint(
					'<form method="POST" action="?/login"><button formaction="?/logout">go</button></form>'
				)
			).toHaveLength(0);
		});

		it('judges the submitter against its own formmethod', () => {
			expect(
				lint(
					'<form method="GET" action="/search"><button formmethod="POST" formaction="?/login">go</button></form>'
				)
			).toHaveLength(0);
			expect(
				lint(
					'<form method="POST" action="?/login"><button formmethod="GET" formaction="?/logout">go</button></form>'
				)[0]?.messageId
			).toBe('formActionNeedsPost');
		});

		it('ignores a formaction outside any form, which does nothing', () => {
			expect(lint('<button formaction="/api/auth/sign-in/email">go</button>')).toHaveLength(0);
		});
	});

	describe('how the value is spelled', () => {
		it('flags a statically known action inside a mustache', () => {
			expect(lint('<form method="POST" action={"/api/auth/sign-in/email"}></form>')).toHaveLength(
				1
			);
		});

		it('leaves a genuinely dynamic action to the author', () => {
			expect(lint('<form method="POST" action={target}></form>')).toHaveLength(0);
			expect(lint('<form method="POST" action="/{lang}/signin?/login"></form>')).toHaveLength(0);
		});

		it('reads attribute names case-insensitively, as HTML does', () => {
			expect(lint('<form ACTION="/api/auth/sign-in/email" METHOD="POST"></form>')).toHaveLength(1);
		});

		it('passes an empty action targeting this route default action', () => {
			expect(lint('<form method="POST" action=""></form>')).toHaveLength(0);
		});

		it('ignores an action prop on a component', () => {
			expect(lint('<Dialog action="/api/auth/sign-in/email" method="POST" />')).toHaveLength(0);
		});
	});

	it('neutralizes control characters the parser decoded out of entities', () => {
		// A numeric entity is not a literal control character in source, so
		// no-literal-control-char never sees it, but the parser hands the rule a
		// real escape byte that would otherwise reach the terminal.
		const escape = String.fromCharCode(0x1b);
		const reports = lint('<form method="POST" action="&#27;[31m/api/x"></form>');
		expect(reports).toHaveLength(1);
		expect(reports[0].data?.action).not.toContain(escape);
		expect(reports[0].data?.action).toContain('/api/x');
	});
});
