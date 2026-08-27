import { accessSync, constants } from 'node:fs';
import path from 'node:path';

/** Resolve a test dependency without relying on the optional `which` utility. */
export function testExecutable(name: string): string {
	const extensions =
		process.platform === 'win32'
			? (process.env.PATHEXT ?? '.COM;.EXE')
					.split(';')
					.filter((extension) => ['.COM', '.EXE'].includes(extension.toUpperCase()))
			: [''];
	for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
		if (!directory) continue;
		for (const extension of extensions) {
			const candidate = path.join(directory, `${name}${extension.toLowerCase()}`);
			try {
				accessSync(candidate, constants.X_OK);
				return candidate;
			} catch {
				// Try the next PATH entry.
			}
		}
	}
	throw new Error(`Required test executable ${JSON.stringify(name)} is not on PATH.`);
}
