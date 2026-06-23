import { describe, expect, it } from 'vitest';
import { parser } from 'typescript-eslint';
import rule from './require-guarded-server-convex-client.js';

function lint(code: string): Array<{ messageId: string }> {
	const reports: Array<{ messageId: string }> = [];
	const ast = parser.parseForESLint(code, {});

	const context = {
		report: (opts: { messageId: string }) => reports.push(opts),
		getFilename: () => 'src/routes/[[lang]]/app/example/+page.server.ts',
		filename: 'src/routes/[[lang]]/app/example/+page.server.ts'
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

describe('require-guarded-server-convex-client', () => {
	it('flags bare construction outside a try', () => {
		const reports = lint(`
			export const load = async (event) => {
				const client = createServerConvexHttpClient({ token: event.locals.token });
				const viewer = await client.query(api.users.viewer, {}).catch(() => null);
				return { viewer };
			};
		`);
		expect(reports).toHaveLength(1);
		expect(reports[0].messageId).toBe('unguardedConstruction');
	});

	it('allows construction inside a try block', () => {
		const reports = lint(`
			export const load = async (event) => {
				try {
					const client = createServerConvexHttpClient({ token: event.locals.token });
					const viewer = await client.query(api.users.viewer, {});
					return { viewer };
				} catch (e) {
					return { viewer: null };
				}
			};
		`);
		expect(reports).toHaveLength(0);
	});

	it('allows construction nested deeper inside a try block', () => {
		const reports = lint(`
			export const load = async (event) => {
				try {
					if (event.locals.token) {
						const client = createServerConvexHttpClient({ token: event.locals.token });
						return { viewer: await client.query(api.users.viewer, {}) };
					}
				} catch (e) {
					return { viewer: null };
				}
				return { viewer: null };
			};
		`);
		expect(reports).toHaveLength(0);
	});

	it('flags construction in a catch block (handler is not the guarded path)', () => {
		const reports = lint(`
			export const load = async (event) => {
				try {
					noop();
				} catch (e) {
					const client = createServerConvexHttpClient({ token: event.locals.token });
					return { viewer: await client.query(api.users.viewer, {}) };
				}
			};
		`);
		expect(reports).toHaveLength(1);
		expect(reports[0].messageId).toBe('unguardedConstruction');
	});

	it('flags each unguarded construction independently', () => {
		const reports = lint(`
			export const load = async () => {
				const a = createServerConvexHttpClient({});
				const b = createServerConvexHttpClient({});
				return { a, b };
			};
		`);
		expect(reports).toHaveLength(2);
	});

	it('ignores files that never construct the client', () => {
		const reports = lint(`
			export const load = async () => {
				return { ok: true };
			};
		`);
		expect(reports).toHaveLength(0);
	});

	it('ignores unrelated call expressions', () => {
		const reports = lint(`
			export const load = async () => {
				const x = someOtherFactory({});
				return { x };
			};
		`);
		expect(reports).toHaveLength(0);
	});
});
