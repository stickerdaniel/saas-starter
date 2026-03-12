import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import rule from './require-marketing-markdown.js';

function createContext(filename: string) {
	const report = vi.fn();

	return {
		report,
		context: {
			filename,
			getFilename: () => filename,
			report
		}
	};
}

describe('require-marketing-markdown rule', () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const tempDir of tempDirs.splice(0)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it('reports when a marketing page is missing a sibling page.md.ts file', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-rule-'));
		tempDirs.push(tempDir);

		const pagePath = path.join(
			tempDir,
			'src',
			'routes',
			'[[lang]]',
			'(marketing)',
			'about',
			'+page.svelte'
		);

		fs.mkdirSync(path.dirname(pagePath), { recursive: true });
		fs.writeFileSync(pagePath, '<h1>About</h1>');

		const { context, report } = createContext(pagePath);
		const listeners = rule.create(context);
		listeners.Program?.({ type: 'Program' });

		expect(report).toHaveBeenCalledTimes(1);
		expect(report.mock.calls[0][0].messageId).toBe('missingMarkdown');
	});

	it('passes when the sibling page.md.ts file exists', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-rule-'));
		tempDirs.push(tempDir);

		const pagePath = path.join(
			tempDir,
			'src',
			'routes',
			'[[lang]]',
			'(marketing)',
			'pricing',
			'+page.svelte'
		);
		const markdownPath = path.join(path.dirname(pagePath), 'page.md.ts');

		fs.mkdirSync(path.dirname(pagePath), { recursive: true });
		fs.writeFileSync(pagePath, '<h1>Pricing</h1>');
		fs.writeFileSync(markdownPath, 'export const marketingMarkdown = {};');

		const { context, report } = createContext(pagePath);
		const listeners = rule.create(context);
		listeners.Program?.({ type: 'Program' });

		expect(report).not.toHaveBeenCalled();
	});

	it('ignores non-marketing pages', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-rule-'));
		tempDirs.push(tempDir);

		const pagePath = path.join(tempDir, 'src', 'routes', '[[lang]]', 'app', '+page.svelte');

		fs.mkdirSync(path.dirname(pagePath), { recursive: true });
		fs.writeFileSync(pagePath, '<h1>App</h1>');

		const { context, report } = createContext(pagePath);
		const listeners = rule.create(context);
		listeners.Program?.({ type: 'Program' });

		expect(report).not.toHaveBeenCalled();
	});
});
