import path from 'node:path';
import { BASE_TABLE } from '../../../.agents/skills/upstream-sync/layout/v3';
import { FLAT_CHECK_LAYOUT, ROUTES, routesOf, type CheckLayout } from '../../static-checks';

/** A path of the flat tree and the path the move table moves it to. */
export type MovedPath = readonly [file: string, to: string];

/** File names the routes tell apart, one per kind of file a new path can be. */
export const NEW_FILE_NAMES = [
	'icon.svg',
	'probe.ts',
	'probe.js',
	'Probe.svelte',
	'notes.md',
	'notes.txt',
	'data.json',
	'de.json',
	'page.html',
	'site.webmanifest'
] as const;

function movedPath(file: string): MovedPath[] {
	const to = BASE_TABLE.place(file)?.to;
	return to ? [[file, to]] : [];
}

/** Each tracked path the move table moves, with its destination. */
export function movedTrackedPaths(tracked: readonly string[]): MovedPath[] {
	return tracked.flatMap(movedPath);
}

/**
 * A new file of each name in `NEW_FILE_NAMES` in every directory that holds a tracked path the
 * move table moves, with the destination the move table gives the new file.
 */
export function movedNewFiles(tracked: readonly string[]): MovedPath[] {
	const directories = new Set(
		movedTrackedPaths(tracked).map(([file]) => {
			const directory = path.posix.dirname(file);
			return directory === '.' ? '' : `${directory}/`;
		})
	);
	return [...directories].flatMap((directory) =>
		NEW_FILE_NAMES.flatMap((name) => movedPath(directory + name))
	);
}

/**
 * Each check, shipped-text verdict and prose kind that differs between a flat path in the flat
 * layout and its moved path in `workspaceLayout`.
 */
export function movedDifferences(
	workspaceLayout: CheckLayout,
	paths: Iterable<MovedPath>
): string[] {
	const flat = routesOf(FLAT_CHECK_LAYOUT);
	const workspace = routesOf(workspaceLayout);
	const differences: string[] = [];
	const compare = (name: string, before: boolean, after: boolean, file: string, to: string) => {
		if (before !== after)
			differences.push(`${after ? 'gains' : 'loses'} ${name}: ${file} -> ${to}`);
	};
	for (const [file, to] of paths) {
		for (const check of Object.keys(ROUTES) as Array<keyof typeof ROUTES>) {
			compare(check, flat.routes[check](file), workspace.routes[check](to), file, to);
		}
		compare('shipped text', flat.isShippedText(file), workspace.isShippedText(to), file, to);
		const kinds = [flat.proseKind(file), workspace.proseKind(to)];
		if (kinds[0] !== kinds[1])
			differences.push(`prose kind ${kinds.join(' -> ')}: ${file} -> ${to}`);
	}
	return differences;
}
