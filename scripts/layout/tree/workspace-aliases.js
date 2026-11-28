import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readManifest = (directory) =>
	JSON.parse(readFileSync(path.join(ROOT, directory, 'package.json'), 'utf8'));

function members() {
	const { workspaces = [] } = readManifest('.');
	return workspaces
		.flatMap((pattern) =>
			pattern.endsWith('/*')
				? readdirSync(path.join(ROOT, pattern.slice(0, -2)), { withFileTypes: true })
						.filter((entry) => entry.isDirectory())
						.map((entry) => `${pattern.slice(0, -1)}${entry.name}`)
				: [pattern]
		)
		.filter((directory) => existsSync(path.join(ROOT, directory, 'package.json')));
}

export const WORKSPACE_ALIASES = members().map((directory) => {
	const manifest = readManifest(directory);
	const aliases = Object.fromEntries(
		Object.entries(manifest.imports ?? {})
			.filter(
				([key, value]) => key.endsWith('/*') && typeof value === 'string' && value.endsWith('/*')
			)
			.map(([key, value]) => [
				key.slice(0, -1),
				`${path.posix.join(directory, value.slice(0, -2))}/`
			])
	);
	const kit = ['dependencies', 'devDependencies'].some((section) =>
		Object.hasOwn(manifest[section] ?? {}, '@sveltejs/kit')
	);
	if (kit) aliases['$lib/'] = `${directory}/src/lib/`;
	return { directory: `${directory}/`, aliases };
});

const workspaceOf = (relativePath) =>
	WORKSPACE_ALIASES.find(({ directory }) => relativePath.startsWith(directory));

export function aliasesFor(relativePath) {
	return workspaceOf(relativePath)?.aliases ?? {};
}

export function workspaceFor(relativePath) {
	return workspaceOf(relativePath)?.directory ?? '';
}
