import { describe, expect, it } from 'vitest';
import { parser } from 'typescript-eslint';
import rule from './require-returns-validator.js';

function lint(code: string): Array<{ messageId: string }> {
	const reports: Array<{ messageId: string }> = [];
	const ast = parser.parseForESLint(code, {});

	const context = {
		report: (opts: { messageId: string }) => reports.push(opts),
		getFilename: () => 'test.ts',
		filename: 'test.ts'
	};

	const listeners = rule.create(context) as Record<string, (n: unknown) => void>;

	function walk(node: Record<string, unknown>) {
		if (!node || typeof node !== 'object') return;
		const type = node.type as string;
		if (type && typeof listeners[type] === 'function') listeners[type](node);
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

describe('require-returns-validator', () => {
	it('flags a query without a returns validator', () => {
		const reports = lint(`
			export const f = query({
				args: {},
				handler: async () => null
			});
		`);
		expect(reports).toHaveLength(1);
		expect(reports[0].messageId).toBe('missingReturns');
	});

	it('flags internal and custom builders without returns', () => {
		const code = (builder: string) => `
			export const f = ${builder}({
				args: { id: v.string() },
				handler: async (ctx, args) => null
			});
		`;
		for (const builder of [
			'mutation',
			'action',
			'internalQuery',
			'internalMutation',
			'internalAction',
			'authedQuery',
			'authedMutation',
			'adminQuery',
			'adminMutation'
		]) {
			expect(lint(code(builder)), builder).toHaveLength(1);
		}
	});

	it('accepts a registration with a returns validator', () => {
		const reports = lint(`
			export const f = query({
				args: {},
				returns: v.null(),
				handler: async () => null
			});
		`);
		expect(reports).toHaveLength(0);
	});

	it('accepts returns: v.any() escape hatch', () => {
		const reports = lint(`
			export const f = query({
				args: {},
				// v.any(): shape owned by @convex-dev/agent
				returns: v.any(),
				handler: async (ctx, args) => listMessagesForThread(ctx, args)
			});
		`);
		expect(reports).toHaveLength(0);
	});

	it('ignores member-expression calls like ctx.db.query()', () => {
		const reports = lint(`
			const rows = await ctx.db.query('messages').take(10);
		`);
		expect(reports).toHaveLength(0);
	});

	it('ignores non-registrar calls and non-object arguments', () => {
		expect(lint(`httpAction(async (ctx, req) => new Response())`)).toHaveLength(0);
		expect(lint(`export const f = query(makeConfig())`)).toHaveLength(0);
	});

	it('skips registrations whose config is spread (validator may come from the spread)', () => {
		const reports = lint(`
			export const f = query({ ...shared, handler: async () => null });
		`);
		expect(reports).toHaveLength(0);
	});
});
