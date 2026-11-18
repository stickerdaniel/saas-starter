import { describe, expect, it } from 'vitest';
import { parser } from 'typescript-eslint';
import rule from './no-bare-test-skip.js';

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

describe('no-bare-test-skip', () => {
	it('flags bare test.skip() with zero arguments', () => {
		const reports = lint(`
			test('list shows rows', async ({ page }) => {
				if ((await page.locator('tr').count()) === 0) test.skip();
			});
		`);
		expect(reports).toHaveLength(1);
		expect(reports[0].messageId).toBe('bareTestSkip');
	});

	it('allows environment gating with condition and reason', () => {
		const reports = lint(`
			test.skip(!hasGoogleOAuth, 'Google OAuth is disabled in this environment');
		`);
		expect(reports).toHaveLength(0);
	});

	it('allows test.skip with a single condition argument', () => {
		const reports = lint(`test.skip(process.env.CI === undefined);`);
		expect(reports).toHaveLength(0);
	});

	it('allows declarative skips like test.skip(title, fn)', () => {
		const reports = lint(`test.skip('flaky upstream', async () => {});`);
		expect(reports).toHaveLength(0);
	});

	it('ignores skip calls on other objects', () => {
		expect(lint(`suite.skip();`)).toHaveLength(0);
		expect(lint(`this.skip();`)).toHaveLength(0);
	});

	it('ignores other test methods', () => {
		expect(lint(`test.fixme();`)).toHaveLength(0);
		expect(lint(`test.describe('group', () => {});`)).toHaveLength(0);
	});

	it('ignores computed member access', () => {
		expect(lint(`test['skip']();`)).toHaveLength(0);
	});
});
