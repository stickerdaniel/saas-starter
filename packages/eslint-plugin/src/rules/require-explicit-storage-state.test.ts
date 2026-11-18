import { describe, expect, it } from 'vitest';
import { parser } from 'typescript-eslint';
import rule from './require-explicit-storage-state.js';

function lint(code: string): Array<{ messageId: string }> {
	const reports: Array<{ messageId: string }> = [];
	const ast = parser.parseForESLint(code, {});

	const context = {
		report: (opts: { messageId: string }) => reports.push(opts),
		getFilename: () => 'e2e/example.spec.ts',
		filename: 'e2e/example.spec.ts'
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

describe('require-explicit-storage-state', () => {
	it('flags a browser context that names no session', () => {
		const reports = lint(`
			const userContext = await browser.newContext({ baseURL: siteUrl });
		`);
		expect(reports).toHaveLength(1);
		expect(reports[0].messageId).toBe('missingStorageState');
	});

	it('flags a browser context without options', () => {
		expect(lint(`await browser.newContext();`)).toHaveLength(1);
	});

	it('flags any receiver, not only the browser fixture', () => {
		expect(lint(`await secondBrowser.newContext({ locale: 'en-US' });`)).toHaveLength(1);
	});

	it('flags options it cannot see into', () => {
		expect(lint(`await browser.newContext(options);`)).toHaveLength(1);
		expect(lint(`await browser.newContext({ ...options });`)).toHaveLength(1);
	});

	it('allows a signed-out session', () => {
		const reports = lint(`
			await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
		`);
		expect(reports).toHaveLength(0);
	});

	it('allows an auth file, a shorthand, and a spread beside the property', () => {
		expect(lint(`await browser.newContext({ storageState: 'e2e/.auth/user.json' });`)).toHaveLength(
			0
		);
		expect(lint(`await browser.newContext({ storageState });`)).toHaveLength(0);
		expect(lint(`await browser.newContext({ ...options, storageState });`)).toHaveLength(0);
	});

	it('ignores API request contexts', () => {
		expect(lint(`await request.newContext({ baseURL });`)).toHaveLength(0);
		expect(lint(`await playwright.request.newContext({ baseURL });`)).toHaveLength(0);
	});

	it('ignores computed property names', () => {
		expect(lint(`await browser['newContext']({});`)).toHaveLength(0);
		expect(lint(`await browser.newContext({ [key]: state });`)).toHaveLength(1);
	});
});
