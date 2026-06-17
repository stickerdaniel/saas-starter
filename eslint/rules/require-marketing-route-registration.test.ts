import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import rule from './require-marketing-route-registration.js';

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

function writePublicRoutes(tempDir: string, keys: string[]) {
	const publicRoutesPath = path.join(tempDir, 'src', 'lib', 'marketing', 'public-routes.ts');
	fs.mkdirSync(path.dirname(publicRoutesPath), { recursive: true });
	const entries = keys.map((key) => `\t{ key: '${key}', pathSuffix: '/${key}' }`).join(',\n');
	fs.writeFileSync(publicRoutesPath, `export const PUBLIC_MARKETING_ROUTES = [\n${entries}\n];\n`);
}

function writeMarketingPage(tempDir: string, routeSegments: string[]) {
	const pagePath = path.join(
		tempDir,
		'src',
		'routes',
		'[[lang]]',
		'(marketing)',
		...routeSegments,
		'+page.svelte'
	);
	fs.mkdirSync(path.dirname(pagePath), { recursive: true });
	fs.writeFileSync(pagePath, '<h1>Page</h1>');
	return pagePath;
}

describe('require-marketing-route-registration rule', () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const tempDir of tempDirs.splice(0)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it('reports when a marketing page is not registered in public-routes.ts', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-route-rule-'));
		tempDirs.push(tempDir);

		writePublicRoutes(tempDir, ['home', 'pricing']);
		const pagePath = writeMarketingPage(tempDir, ['about']);

		const { context, report } = createContext(pagePath);
		const listeners = rule.create(context);
		listeners.Program?.({ type: 'Program' });

		expect(report).toHaveBeenCalledTimes(1);
		expect(report.mock.calls[0][0].messageId).toBe('notRegistered');
		expect(report.mock.calls[0][0].data.routeKey).toBe('about');
	});

	it('passes when the marketing page is registered in public-routes.ts', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-route-rule-'));
		tempDirs.push(tempDir);

		writePublicRoutes(tempDir, ['home', 'about', 'pricing']);
		const pagePath = writeMarketingPage(tempDir, ['pricing']);

		const { context, report } = createContext(pagePath);
		const listeners = rule.create(context);
		listeners.Program?.({ type: 'Program' });

		expect(report).not.toHaveBeenCalled();
	});

	it('maps the root marketing page to the "home" route key', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-route-rule-'));
		tempDirs.push(tempDir);

		writePublicRoutes(tempDir, ['home']);
		const pagePath = writeMarketingPage(tempDir, []);

		const { context, report } = createContext(pagePath);
		const listeners = rule.create(context);
		listeners.Program?.({ type: 'Program' });

		expect(report).not.toHaveBeenCalled();
	});

	it('reports the root marketing page when "home" is not registered', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-route-rule-'));
		tempDirs.push(tempDir);

		writePublicRoutes(tempDir, ['about']);
		const pagePath = writeMarketingPage(tempDir, []);

		const { context, report } = createContext(pagePath);
		const listeners = rule.create(context);
		listeners.Program?.({ type: 'Program' });

		expect(report).toHaveBeenCalledTimes(1);
		expect(report.mock.calls[0][0].data.routeKey).toBe('home');
	});

	it('does not report when public-routes.ts does not exist', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-route-rule-'));
		tempDirs.push(tempDir);

		const pagePath = writeMarketingPage(tempDir, ['about']);

		const { context, report } = createContext(pagePath);
		const listeners = rule.create(context);
		listeners.Program?.({ type: 'Program' });

		expect(report).not.toHaveBeenCalled();
	});

	it('ignores non-marketing pages', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-route-rule-'));
		tempDirs.push(tempDir);

		writePublicRoutes(tempDir, ['home']);
		const pagePath = path.join(tempDir, 'src', 'routes', '[[lang]]', 'app', '+page.svelte');
		fs.mkdirSync(path.dirname(pagePath), { recursive: true });
		fs.writeFileSync(pagePath, '<h1>App</h1>');

		const { context, report } = createContext(pagePath);
		const listeners = rule.create(context);
		const listenerKeys = Object.keys(listeners);

		expect(listenerKeys).toHaveLength(0);
		expect(report).not.toHaveBeenCalled();
	});
});
