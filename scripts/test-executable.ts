import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';

/** Resolve a test dependency without relying on the optional `which` utility. */
export function testExecutable(
	name: string,
	cwd = process.cwd(),
	env: NodeJS.ProcessEnv = process.env
): string {
	const extensions =
		process.platform === 'win32'
			? (env.PATHEXT ?? '.COM;.EXE')
					.split(';')
					.filter((extension) => ['.COM', '.EXE'].includes(extension.toUpperCase()))
			: [''];
	for (const directory of (env.PATH ?? '').split(path.delimiter)) {
		for (const extension of extensions) {
			const candidate = path.resolve(cwd, directory || '.', `${name}${extension.toLowerCase()}`);
			try {
				if (!statSync(candidate).isFile()) continue;
				accessSync(candidate, constants.X_OK);
				return candidate;
			} catch {
				// Try the next PATH entry.
			}
		}
	}
	throw new Error(`Required test executable ${JSON.stringify(name)} is not on PATH.`);
}
