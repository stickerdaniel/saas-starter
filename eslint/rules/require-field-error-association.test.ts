import { describe, expect, it } from 'vitest';
import parser from 'svelte-eslint-parser';
import rule from './require-field-error-association.js';

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

describe('require-field-error-association', () => {
	it('passes a fully wired Input + Field.Error pair', () => {
		const reports = lint(
			`<Field.Field>
				<Input id="email" aria-invalid={x ? 'true' : undefined} aria-describedby={x ? 'email-error' : undefined} bind:value={email} />
				<Field.Error id="email-error" errors={errs} />
			</Field.Field>`
		);
		expect(reports).toHaveLength(0);
	});

	it('passes a Password.Input wired via invalid prop', () => {
		const reports = lint(
			`<Field.Field>
				<Password.Input id="password" invalid={hasError} aria-describedby={hasError ? 'password-error' : undefined} bind:value={pw} />
				<Field.Error id="password-error" errors={errs} />
			</Field.Field>`
		);
		expect(reports).toHaveLength(0);
	});

	it('flags an Input missing aria-describedby and aria-invalid', () => {
		const reports = lint(
			`<Field.Field>
				<Input id="email" bind:value={email} />
				<Field.Error id="email-error" errors={errs} />
			</Field.Field>`
		);
		expect(reports.some((r) => r.messageId === 'inputMissingAria')).toBe(true);
	});

	it('flags a Field.Error missing an id', () => {
		const reports = lint(
			`<Field.Field>
				<Input id="email" aria-invalid={x ? 'true' : undefined} aria-describedby={x ? 'email-error' : undefined} bind:value={email} />
				<Field.Error errors={errs} />
			</Field.Field>`
		);
		expect(reports.some((r) => r.messageId === 'fieldErrorMissingId')).toBe(true);
	});

	it('treats a {...field.as(...)} spread as satisfying aria-invalid', () => {
		const reports = lint(
			`<Field.Field>
				<Input {...form.fields.email.as('text')} aria-describedby={hasError ? 'email-error' : undefined} />
				<Field.Error id="email-error" errors={form.fields.email.issues()} />
			</Field.Field>`
		);
		expect(reports).toHaveLength(0);
	});

	it('excludes a form-level banner Field.Error (no input sibling)', () => {
		const reports = lint(
			`<Field.Group>
				<Field.Error errors={formError} data-testid="auth-error" />
			</Field.Group>`
		);
		expect(reports).toHaveLength(0);
	});

	it('ignores a Field.Field with no dynamic Field.Error', () => {
		const reports = lint(
			`<Field.Field>
				<Input id="name" bind:value={name} />
			</Field.Field>`
		);
		expect(reports).toHaveLength(0);
	});
});
