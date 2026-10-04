import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseThirdPartyLicensesConfig } from './config';
import {
	moduleIdToPath,
	packageRootOf,
	resolveThirdPartyNotices,
	type ShippedInput
} from './resolve';
import { buildCatalogue, serializeCatalogueJson, serializeCatalogueText } from './serialize';

let root: string;

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'third-party-notices-'));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function write(relative: string, content: string) {
	const file = path.join(root, relative);
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, content);
	return file;
}

function installPackage(
	directory: string,
	manifest: Record<string, unknown>,
	files: Record<string, string> = {}
) {
	write(path.join(directory, 'package.json'), JSON.stringify(manifest));
	write(path.join(directory, 'index.js'), 'export {};');
	for (const [name, content] of Object.entries(files)) write(path.join(directory, name), content);
	return path.join(root, directory);
}

function resolve(shipped: ShippedInput[], config: unknown = {}) {
	return resolveThirdPartyNotices({
		root,
		config: parseThirdPartyLicensesConfig(config, root),
		shipped
	});
}

function client(file: string): ShippedInput {
	return { id: file, component: 'client' };
}

describe('module identity', () => {
	it('normalizes bundler ids to file paths and skips virtual modules', () => {
		expect(moduleIdToPath('\0/repo/node_modules/pkg/index.js?commonjs-proxy')).toBe(
			'/repo/node_modules/pkg/index.js'
		);
		expect(moduleIdToPath('/repo/src/a.worker.ts?worker&inline')).toBe('/repo/src/a.worker.ts');
		expect(moduleIdToPath('C:\\repo\\node_modules\\@scope\\pkg\\dist\\x.js?v=1')).toBe(
			'C:/repo/node_modules/@scope/pkg/dist/x.js'
		);
		expect(moduleIdToPath('/@fs/C:/repo/node_modules/pkg/x.js')).toBe(
			'C:/repo/node_modules/pkg/x.js'
		);
		expect(moduleIdToPath('\0vite/preload-helper.js')).toBeNull();
		expect(moduleIdToPath('\0rolldown/runtime.js')).toBeNull();
	});

	it('finds the package directory below the innermost node_modules', () => {
		expect(packageRootOf('C:/repo/node_modules/@scope/pkg/dist/x.js')).toBe(
			'C:/repo/node_modules/@scope/pkg'
		);
		expect(packageRootOf('/repo/node_modules/a/node_modules/b/lib/x.js')).toBe(
			'/repo/node_modules/a/node_modules/b'
		);
		expect(packageRootOf('/repo/node_modules/.bun/b@1.0.0/node_modules/b/lib/x.js')).toBe(
			'/repo/node_modules/.bun/b@1.0.0/node_modules/b'
		);
		expect(packageRootOf('/repo/src/lib/x.ts')).toBeNull();
	});
});

describe('notice resolution', () => {
	it('keeps the root license and a nested codec license on the shipped path', () => {
		const pkg = installPackage(
			'node_modules/@scope/codec',
			{ name: '@scope/codec', version: '1.5.0', license: 'Apache-2.0' },
			{
				LICENSE: 'Apache License text',
				'codec/LICENSE.codec.md': 'Codec BSD notice',
				'codec/enc/encode.js': 'export {};',
				'other/LICENSE.other': 'Not on the shipped path'
			}
		);
		const result = resolve([
			{ id: path.join(pkg, 'codec/enc/encode.js'), component: 'client-worker' }
		]);
		expect(result.errors).toEqual([]);
		expect(result.entries).toEqual([
			{
				id: 'npm:@scope/codec@1.5.0',
				kind: 'package',
				name: '@scope/codec',
				version: '1.5.0',
				license: 'Apache-2.0',
				components: ['client-worker'],
				sourceUrl: null,
				notices: [
					{ label: 'LICENSE', text: 'Apache License text' },
					{ label: 'codec/LICENSE.codec.md', text: 'Codec BSD notice' }
				]
			}
		]);
	});

	it('fails with the exact override to add when a package ships no license text', () => {
		const pkg = installPackage('node_modules/bare', {
			name: 'bare',
			version: '0.1.13',
			license: 'MIT'
		});
		const { errors, entries } = resolve([client(path.join(pkg, 'index.js'))]);
		expect(entries).toEqual([]);
		const message = errors.join('\n\n');
		expect(message).toContain('Third-party notices incomplete for 1 package.');
		expect(message).toContain('bare@0.1.13 [client]');
		expect(message).toContain('third-party-notices/bare-0.1.13.txt');
		expect(message).toContain(
			'"name": "bare", "version": "0.1.13", "sourceUrl": "<URL of the license text at that release>", "noticeFiles": ["third-party-notices/bare-0.1.13.txt"]'
		);
	});

	it('does not accept a supplemental NOTICE or nested license as the primary text', () => {
		const pkg = installPackage(
			'node_modules/partial',
			{ name: 'partial', version: '2.0.0', license: 'Apache-2.0' },
			{
				NOTICE: 'Attribution only',
				'codec/LICENSE.codec.md': 'Codec notice',
				'codec/index.js': 'export {};'
			}
		);
		const { errors } = resolve([client(path.join(pkg, 'codec/index.js'))]);
		expect(errors.join('\n')).toContain('partial@2.0.0 [client]\n  Missing: license text');
	});

	it('keeps vendor notices next to reviewed override text', () => {
		const pkg = installPackage(
			'node_modules/noticed',
			{ name: 'noticed', version: '1.0.0', license: 'Apache-2.0' },
			{ 'NOTICE.md': 'Vendor attribution' }
		);
		write('third-party-notices/noticed-1.0.0.txt', 'Upstream license text\r\n');
		const result = resolve([client(path.join(pkg, 'index.js'))], {
			packageOverrides: [
				{
					name: 'noticed',
					version: '1.0.0',
					sourceUrl: 'https://example.com/noticed/v1.0.0/LICENSE',
					noticeFiles: ['third-party-notices/noticed-1.0.0.txt']
				}
			]
		});
		expect(result.errors).toEqual([]);
		expect(result.entries[0]).toMatchObject({
			sourceUrl: 'https://example.com/noticed/v1.0.0/LICENSE',
			notices: [
				{ label: 'NOTICE.md', text: 'Vendor attribution' },
				{ label: 'noticed-1.0.0.txt', text: 'Upstream license text' }
			]
		});
	});

	it('applies a declaration-only override and keeps the vendor license', () => {
		const pkg = installPackage(
			'node_modules/undeclared',
			{ name: 'undeclared', version: '0.10.6' },
			{ LICENSE: 'MIT License\n\nCopyright (c) 2024 Vendor' }
		);
		const shipped = [client(path.join(pkg, 'index.js'))];
		expect(resolve(shipped).errors.join('\n')).toContain('Missing: license declaration');
		const result = resolve(shipped, {
			packageOverrides: [
				{
					name: 'undeclared',
					version: '0.10.6',
					sourceUrl: 'https://example.com/undeclared/v0.10.6/LICENSE',
					license: 'MIT'
				}
			]
		});
		expect(result.errors).toEqual([]);
		expect(result.entries[0]).toMatchObject({
			license: 'MIT',
			notices: [{ label: 'LICENSE', text: 'MIT License\n\nCopyright (c) 2024 Vendor' }]
		});
	});

	it('applies overrides only to the exact version and reports stale ones', () => {
		const pkg = installPackage('node_modules/drifted', {
			name: 'drifted',
			version: '1.0.1',
			license: 'MIT'
		});
		write('third-party-notices/drifted-1.0.0.txt', 'Old license text');
		const result = resolve([client(path.join(pkg, 'index.js'))], {
			packageOverrides: [
				{
					name: 'drifted',
					version: '1.0.0',
					sourceUrl: 'https://example.com/drifted/v1.0.0/LICENSE',
					noticeFiles: ['third-party-notices/drifted-1.0.0.txt']
				}
			]
		});
		expect(result.errors.join('\n')).toContain('drifted@1.0.1 [client]');
		expect(result.warnings).toEqual([
			'Override for drifted@1.0.0 in third-party-licenses.config.json matched no shipped package. Remove it if that package or version no longer ships.'
		]);
	});

	it('preserves a license expression verbatim', () => {
		const pkg = installPackage(
			'node_modules/dual',
			{ name: 'dual', version: '1.0.0', license: '(MIT OR CC0-1.0)' },
			{ 'LICENSE-MIT': 'MIT text' }
		);
		expect(resolve([client(path.join(pkg, 'index.js'))]).entries[0]?.license).toBe(
			'(MIT OR CC0-1.0)'
		);
	});

	it('merges symlinked and duplicate installs of one version into one row', () => {
		const pkg = installPackage(
			'node_modules/shared',
			{ name: 'shared', version: '3.0.0', license: 'MIT' },
			{ LICENSE: 'Shared license' }
		);
		const copy = installPackage(
			'node_modules/host/node_modules/shared',
			{ name: 'shared', version: '3.0.0', license: 'MIT' },
			{ LICENSE: 'Shared license' }
		);
		mkdirSync(path.join(root, 'node_modules/linked/node_modules'), { recursive: true });
		symlinkSync(pkg, path.join(root, 'node_modules/linked/node_modules/shared'), 'dir');
		const result = resolve([
			client(path.join(pkg, 'index.js')),
			{
				id: path.join(root, 'node_modules/linked/node_modules/shared/index.js'),
				component: 'client'
			},
			{ id: path.join(copy, 'index.js'), component: 'client-worker' }
		]);
		expect(result.errors).toEqual([]);
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0]).toMatchObject({
			components: ['client', 'client-worker'],
			notices: [{ label: 'LICENSE', text: 'Shared license' }]
		});
	});

	it('reports installed copies of one version that declare different licenses', () => {
		const a = installPackage(
			'node_modules/split',
			{ name: 'split', version: '1.0.0', license: 'MIT' },
			{ LICENSE: 'x' }
		);
		const b = installPackage(
			'node_modules/host/node_modules/split',
			{ name: 'split', version: '1.0.0', license: 'ISC' },
			{ LICENSE: 'x' }
		);
		const { errors } = resolve([
			client(path.join(a, 'index.js')),
			client(path.join(b, 'index.js'))
		]);
		expect(errors.join('\n')).toContain('conflicting licenses: "MIT", "ISC"');
	});

	it('ignores first-party files and virtual helper modules', () => {
		write('src/app.ts', 'export {};');
		const result = resolve([
			client(path.join(root, 'src/app.ts')),
			client('\0vite/preload-helper.js'),
			client('\0rolldown/runtime.js')
		]);
		expect(result).toEqual({ entries: [], errors: [], warnings: [] });
	});

	it('adds configured CSS packages and custom notices', () => {
		installPackage(
			'node_modules/css-lib',
			{ name: 'css-lib', version: '1.4.0', license: 'MIT' },
			{ LICENSE: 'CSS license' }
		);
		write('static/fonts/OFL.txt', 'Font license');
		const result = resolve([], {
			extraPackages: [{ name: 'css-lib', components: ['styles'] }],
			customNotices: [
				{
					id: 'font',
					name: 'Font',
					components: ['fonts'],
					license: 'OFL-1.1',
					sourceUrl: 'https://example.com/font',
					noticeFiles: ['static/fonts/OFL.txt']
				}
			]
		});
		expect(result.errors).toEqual([]);
		expect(
			result.entries.map(({ id, components, notices }) => ({ id, components, notices }))
		).toEqual([
			{
				id: 'npm:css-lib@1.4.0',
				components: ['styles'],
				notices: [{ label: 'LICENSE', text: 'CSS license' }]
			},
			{
				id: 'custom:font',
				components: ['fonts'],
				notices: [{ label: 'OFL.txt', text: 'Font license' }]
			}
		]);
	});
});

describe('catalogue serialization', () => {
	it('produces identical bytes regardless of input order', () => {
		const files = ['zeta', 'alpha', 'mid'].map((name) =>
			path.join(
				installPackage(
					`node_modules/${name}`,
					{ name, version: '1.0.0', license: 'MIT' },
					{ LICENSE: `${name} license` }
				),
				'index.js'
			)
		);
		const render = (order: string[]) => {
			const catalogue = buildCatalogue(resolve(order.map(client)).entries);
			return serializeCatalogueJson(catalogue) + serializeCatalogueText(catalogue);
		};
		const first = render(files);
		expect(render([...files].reverse())).toBe(first);
		const catalogue = buildCatalogue(resolve(files.map(client)).entries);
		expect(catalogue.entries.map((entry) => entry.name)).toEqual(['alpha', 'mid', 'zeta']);
		expect(first).not.toContain(root);
	});
});
