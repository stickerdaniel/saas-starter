import { describe, expect, it } from 'vitest';
import { parser } from 'typescript-eslint';
import rule from './no-destructured-live-getters.js';

function lint(code: string): Array<{ messageId: string; data?: Record<string, string> }> {
	const reports: Array<{ messageId: string; data?: Record<string, string> }> = [];
	const ast = parser.parseForESLint(code, {});

	const context = {
		report: (opts: { messageId: string; data?: Record<string, string> }) => reports.push(opts),
		getFilename: () => 'src/example.svelte',
		filename: 'src/example.svelte'
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

describe('no-destructured-live-getters', () => {
	it('flags the auth state destructured from useAuth', () => {
		const reports = lint(`const { isAuthenticated, isLoading } = useAuth();`);
		expect(reports.map((report) => report.data?.name)).toEqual(['isAuthenticated', 'isLoading']);
		expect(reports[0].messageId).toBe('destructuredGetter');
	});

	it('flags the customer destructured from useCustomer, renamed or not', () => {
		expect(lint(`const { customer, openBillingPortal } = useCustomer();`)).toHaveLength(1);
		expect(lint(`const { customer: current } = useCustomer();`)).toHaveLength(1);
		expect(lint(`const { 'customer': current } = useCustomer();`)).toHaveLength(1);
	});

	it('allows plain functions and kept objects', () => {
		expect(lint(`const { openBillingPortal, checkout } = useCustomer();`)).toHaveLength(0);
		expect(lint(`const auth = useAuth(); const ok = auth.isAuthenticated;`)).toHaveLength(0);
		expect(lint(`const autumn = useCustomer(); const c = autumn.customer;`)).toHaveLength(0);
	});

	it('leaves other hooks and member calls alone', () => {
		expect(lint(`const { isAuthenticated } = useSession();`)).toHaveLength(0);
		expect(lint(`const { isAuthenticated } = auth.useAuth();`)).toHaveLength(0);
	});
});
