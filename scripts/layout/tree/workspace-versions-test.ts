export const WORKSPACE_VERSIONS_TEST = `import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { describe, expect, it } from 'vitest';

type Pins = Readonly<Record<string, string>>;

interface Manifest {
	readonly workspaces?: readonly string[];
	readonly dependencies?: Pins;
	readonly devDependencies?: Pins;
	readonly optionalDependencies?: Pins;
	readonly peerDependencies?: Pins;
	readonly overrides?: Pins;
}

const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
const EXCEPTIONS = new Set(['knip']);

function versionProblems(manifests: ReadonlyMap<string, Manifest>): string[] {
	const pins = new Map<string, Map<string, string[]>>();
	const pin = (name: string, version: string, where: string) => {
		if (EXCEPTIONS.has(name) || version.startsWith('workspace:')) return;
		const versions = pins.get(name) ?? new Map<string, string[]>();
		versions.set(version, [...(versions.get(version) ?? []), where]);
		pins.set(name, versions);
	};
	for (const [path, manifest] of manifests) {
		for (const section of SECTIONS) {
			for (const [name, version] of Object.entries(manifest[section] ?? {})) {
				pin(name, version, \`\${path} \${section}\`);
			}
		}
		for (const [name, version] of Object.entries(manifest.overrides ?? {})) {
			pin(name, version, \`\${path} overrides\`);
		}
	}
	return [...pins]
		.filter(([, versions]) => versions.size > 1)
		.map(
			([name, versions]) =>
				\`\${name}: \${[...versions].map(([version, where]) => \`\${version} in \${where.join(', ')}\`).join('; ')}\`
		);
}

function checkoutManifests(checkout: string): Map<string, Manifest> {
	const read = (path: string): Manifest => JSON.parse(readFileSync(join(checkout, path), 'utf8'));
	const root = read('package.json');
	const directories = (root.workspaces ?? []).flatMap((pattern) =>
		pattern.endsWith('/*')
			? readdirSync(join(checkout, pattern.slice(0, -2)), { withFileTypes: true })
					.filter((entry) => entry.isDirectory())
					.map((entry) => posix.join(pattern.slice(0, -2), entry.name))
			: [pattern]
	);
	return new Map([
		['package.json', root],
		...directories
			.map((directory) => posix.join(directory, 'package.json'))
			.filter((path) => existsSync(join(checkout, path)))
			.map((path) => [path, read(path)] as const)
	]);
}

describe('workspace versions', () => {
	it('holds one exact version of each dependency across every manifest', () => {
		const checkout = spawnSync('git', ['rev-parse', '--show-toplevel'], {
			cwd: import.meta.dirname,
			encoding: 'utf8'
		}).stdout.trim();
		expect(versionProblems(checkoutManifests(checkout))).toEqual([]);
	});

	it('fails two exact pins of one package', () => {
		const manifests = new Map<string, Manifest>([
			['package.json', { devDependencies: { eslint: '10.14.0' } }],
			['apps/web/package.json', { devDependencies: { eslint: '10.13.0' } }]
		]);
		expect(versionProblems(manifests)).toEqual([
			'eslint: 10.14.0 in package.json devDependencies; 10.13.0 in apps/web/package.json devDependencies'
		]);
	});

	it('fails an override that differs from a direct dependency', () => {
		const manifests = new Map<string, Manifest>([
			['package.json', { overrides: { vite: '8.3.8' } }],
			['apps/web/package.json', { devDependencies: { vite: '8.3.9' } }]
		]);
		expect(versionProblems(manifests)).toEqual([
			'vite: 8.3.8 in package.json overrides; 8.3.9 in apps/web/package.json devDependencies'
		]);
	});

	it('passes a peer range beside an exact pin and the two Knip versions', () => {
		const manifests = new Map<string, Manifest>([
			['package.json', { devDependencies: { eslint: '10.14.0' } }],
			['packages/eslint-plugin/package.json', { peerDependencies: { eslint: '^10.14.0' } }],
			['apps/web/package.json', { devDependencies: { knip: '6.42.1' } }],
			['packages/create-saas-starter/package.json', { devDependencies: { knip: '6.46.1' } }]
		]);
		expect(versionProblems(manifests)).toEqual([]);
	});
});
`;
