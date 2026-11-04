/**
 * PID files the started-command driver's grandchildren write with `echo $$ > file`. The
 * shell creates the file before `echo` writes to it, so an existing file can still be empty.
 */
import { readFileSync } from 'node:fs';

/** The PID in `file` once it holds a whole line naming a positive PID, else `undefined`. */
export function readPid(file: string): number | undefined {
	let text: string;
	try {
		text = readFileSync(file, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
		throw error;
	}
	if (!/^\d+\n$/.test(text)) return undefined;
	const pid = Number(text);
	return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}
