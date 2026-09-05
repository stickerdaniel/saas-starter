export const colors = {
	reset: '\x1b[0m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	red: '\x1b[31m'
};

export function stripAnsi(str: string): string {
	// eslint-disable-next-line no-control-regex -- ANSI codes intentionally use control characters
	return str.replace(/\x1b\[[0-9;]*m/g, '');
}
