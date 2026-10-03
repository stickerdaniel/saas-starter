// @vitest-environment node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { parser } from 'typescript-eslint';
import rule from './no-networkidle-wait.js';

function lint(code: string): Array<{ messageId: string }> {
	const reports: Array<{ messageId: string }> = [];
	const ast = parser.parseForESLint(code, { comment: true });

	const context = {
		report: (opts: { messageId: string }) => reports.push(opts),
		getFilename: () => 'e2e/example.spec.ts',
		filename: 'e2e/example.spec.ts',
		// Real comments, so a rule that scans them cannot pass the comment case.
		sourceCode: { getAllComments: () => ast.ast.comments ?? [] }
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

describe('no-networkidle-wait', () => {
	it('flags a networkidle load-state wait', () => {
		const reports = lint(`await page.waitForLoadState('networkidle');`);
		expect(reports).toHaveLength(1);
		expect(reports[0].messageId).toBe('networkIdleWait');
	});

	it('flags any receiver and a plain template literal', () => {
		expect(lint(`await popup.waitForLoadState('networkidle');`)).toHaveLength(1);
		expect(lint('await page.mainFrame().waitForLoadState(`networkidle`);')).toHaveLength(1);
	});

	it.each([
		`await page.goto('/en/pricing', { waitUntil: 'networkidle' });`,
		`await page.waitForURL(/\\/app/, { timeout: 5000, waitUntil: 'networkidle' });`,
		`await page.reload({ waitUntil: 'networkidle' });`,
		`await page.goBack({ waitUntil: 'networkidle' });`,
		`await page.goForward({ 'waitUntil': 'networkidle' });`,
		`await page.waitForNavigation({ waitUntil: 'networkidle' });`,
		`await page.setContent('<main>Ready</main>', { waitUntil: 'networkidle' });`
	])('flags a navigation that waits until network idle: %s', (code) => {
		expect(lint(code)).toHaveLength(1);
	});

	it('allows other load states and navigation waits', () => {
		expect(lint(`await page.waitForLoadState('domcontentloaded');`)).toHaveLength(0);
		expect(lint(`await page.waitForLoadState();`)).toHaveLength(0);
		expect(lint(`await page.goto('/en/admin', { waitUntil: 'domcontentloaded' });`)).toHaveLength(
			0
		);
		expect(lint(`await page.reload();`)).toHaveLength(0);
	});

	it('ignores the string in comments, assertions and unrelated APIs', () => {
		const code = `
			// Do not use page.waitForLoadState('networkidle') here.
			/* await page.goto(url, { waitUntil: 'networkidle' }); */
			const state = 'networkidle';
			expect(states).toContain('networkidle');
			logger.info('networkidle', { waitUntil: 'networkidle' });
			await page.evaluate(() => window.dispatchEvent(new Event('networkidle')));
		`;
		expect(lint(code)).toHaveLength(0);
	});

	it('ignores computed access and computed option keys', () => {
		expect(lint(`await page['waitForLoadState']('networkidle');`)).toHaveLength(0);
		expect(lint(`await page.goto(url, { [key]: 'networkidle' });`)).toHaveLength(0);
	});
});

describe('no-networkidle-wait through the flat config', () => {
	const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
	const eslint = new ESLint({ cwd: repoRoot });
	const ruleId = 'local/no-networkidle-wait';
	const source = `
		import { test } from '@playwright/test';
		test('ready', async ({ page }) => {
			// page.waitForLoadState('networkidle') in a comment is fine.
			await page.goto('/en/pricing', { waitUntil: 'networkidle' });
			await page.waitForLoadState('networkidle');
			await page.setContent('<main>Ready</main>', { waitUntil: 'networkidle' });
		});
	`;

	async function ruleLines(text: string, filePath: string) {
		const [result] = await eslint.lintText(text, { filePath });
		expect(result.fatalErrorCount).toBe(0);
		return result.messages
			.filter((message) => message.ruleId === ruleId)
			.map((message) => [message.line, message.severity]);
	}

	it.each(['e2e/example.spec.ts', 'e2e/utils/readiness.ts'])(
		'reports both calls in %s as errors',
		async (filePath) => {
			expect(await ruleLines(source, filePath)).toEqual([
				[5, 2],
				[6, 2],
				[7, 2]
			]);
		},
		60_000
	);

	it('accepts an exception with an inline reason', async () => {
		const excepted = `
			// eslint-disable-next-line local/no-networkidle-wait -- asserts that no request follows the opt-out
			await page.waitForLoadState('networkidle');
		`;
		expect(await ruleLines(excepted, 'e2e/example.spec.ts')).toEqual([]);
	}, 60_000);

	it('leaves application code alone', async () => {
		expect(await ruleLines(source, 'src/lib/example.ts')).toEqual([]);
	}, 60_000);
});
