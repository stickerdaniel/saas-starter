import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { admitWorkers, type WorkerRecord } from './collect';
import {
	cssPackageName,
	findCssPackageInputs,
	findServiceWorkerEntry,
	uncoveredCssInputProblems
} from './inputs';

let root: string;

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'third-party-inputs-'));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function write(relative: string, content = '') {
	const file = path.join(root, relative);
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, content);
	return file;
}

describe('CSS package inputs', () => {
	it('names the package of bare specifiers only', () => {
		expect(cssPackageName('tailwindcss')).toBe('tailwindcss');
		expect(cssPackageName('tailwindcss/theme.css')).toBe('tailwindcss');
		expect(cssPackageName('@tailwindcss/typography')).toBe('@tailwindcss/typography');
		expect(cssPackageName('./local.css')).toBeNull();
		expect(cssPackageName('/abs.css')).toBeNull();
		expect(cssPackageName('https://cdn.example.com/x.css')).toBeNull();
	});

	it('reports package @import and @plugin directives not covered by extraPackages', () => {
		write(
			'src/routes/layout.css',
			[
				"@import 'tailwindcss';",
				"@source '../node_modules/svelte-streamdown/**/*';",
				"@import 'tw-animate-css';",
				"@plugin '@tailwindcss/typography';",
				"@import './local.css';",
				"@import url('https://fonts.example.com/x.css');",
				"/* @import 'commented-out'; */"
			].join('\n')
		);
		const inputs = findCssPackageInputs(root, ['src']);
		expect(inputs.map((input) => `${input.directive} ${input.packageName}`)).toEqual([
			'@import tailwindcss',
			'@import tw-animate-css',
			'@plugin @tailwindcss/typography'
		]);
		const problems = uncoveredCssInputProblems(
			inputs,
			[{ name: 'tailwindcss' }, { name: 'tw-animate-css' }],
			'third-party-licenses.config.json'
		);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("src/routes/layout.css has `@plugin '@tailwindcss/typography'`");
		expect(problems[0]).toContain(
			'add { "name": "@tailwindcss/typography", "components": ["styles"] } to extraPackages'
		);
	});
});

describe('service worker detection', () => {
	it('finds the default extensionless entry', () => {
		const file = write('src/service-worker.ts');
		expect(findServiceWorkerEntry(path.join(root, 'src/service-worker'))).toBe(file);
	});

	it('finds a directory entry with index.ts', () => {
		const file = write('src/service-worker/index.ts');
		expect(findServiceWorkerEntry(path.join(root, 'src/service-worker'))).toBe(file);
	});

	it('finds a customized entry file and reports none when absent', () => {
		const file = write('src/workers/sw.js');
		expect(findServiceWorkerEntry(path.join(root, 'src/workers/sw.js'))).toBe(file);
		expect(findServiceWorkerEntry(path.join(root, 'src/service-worker'))).toBeNull();
	});
});

describe('worker admission', () => {
	const worker = (name: string, moduleIds: string[] = []): WorkerRecord => ({
		facadeModuleId: `/app/src/${name}.js`,
		entryFileName: `_app/immutable/workers/${name}-hash.js`,
		moduleIds: [`/app/src/${name}.js`, ...moduleIds],
		assetFiles: []
	});

	it('admits emitted external workers and live inline wrappers, including nested ones', () => {
		const live = worker('live', ['/app/src/nested.js?worker&inline']);
		const nested = worker('nested');
		const inline = worker('inline');
		const shared = worker('shared');
		const dead = worker('dead');
		const admitted = admitWorkers(
			['/app/src/page.js', '/app/src/inline.js?worker&inline', '/app/src/live.js?worker'],
			new Set([live.entryFileName]),
			[nested, inline, shared, dead, live]
		);
		expect(admitted).toEqual([nested, inline, live]);
	});

	it('admits inline shared workers only through their exact wrapper', () => {
		const shared = worker('shared');
		expect(admitWorkers(['/app/src/shared.js?sharedworker&inline'], new Set(), [shared])).toEqual([
			shared
		]);
		expect(admitWorkers(['/app/src/shared.js?url'], new Set(), [shared])).toEqual([]);
	});
});
