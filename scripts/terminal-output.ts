/**
 * Terminal boundary for checker subprocesses.
 *
 * A formatter-owned ANSI sequence and the same bytes copied from source are
 * indistinguishable after rendering. Children therefore run without colour, and every
 * remaining control or bidi character is written as its visible codepoint. Parent-owned
 * section colours are added outside this boundary.
 */

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { once } from 'events';
import type { Writable } from 'stream';
import { dataFor, terminalCategory } from '../eslint/control-character-policy.js';
export { sanitizeTerminalField } from '../eslint/control-character-policy.js';

export interface SanitizedCommandOptions {
	cwd?: string | URL;
	env?: NodeJS.ProcessEnv;
	stdout?: Writable;
	stderr?: Writable;
	githubActions?: boolean;
}

export interface SanitizedCommandResult {
	status: number | null;
	signal: NodeJS.Signals | null;
}

/** Child environment with every common force-colour spelling removed. */
export function colorlessEnvironment(overrides?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const env = { ...(overrides ?? process.env) };
	for (const key of Object.keys(env)) {
		if (['NO_COLOR', 'FORCE_COLOR', 'CLICOLOR_FORCE'].includes(key.toUpperCase())) {
			delete env[key];
		}
	}
	env.NO_COLOR = '1';
	return env;
}

/** Incremental UTF-8 decoder and terminal-text neutralizer for one stream. */
export class TerminalOutputDecoder {
	readonly #decoder = new TextDecoder('utf-8');
	#pendingCarriageReturn = false;

	write(bytes: Uint8Array): string {
		return this.#sanitize(this.#decoder.decode(bytes, { stream: true }), false);
	}

	end(): string {
		return this.#sanitize(this.#decoder.decode(), true);
	}

	#sanitize(text: string, final: boolean): string {
		let safe = '';
		for (let index = 0; index < text.length; index++) {
			const code = text.charCodeAt(index);
			if (this.#pendingCarriageReturn) {
				this.#pendingCarriageReturn = false;
				if (code === 0x0a) {
					safe += '\n';
					continue;
				}
				safe += 'U+000D';
			}
			if (code === 0x0d) {
				this.#pendingCarriageReturn = true;
				continue;
			}
			const kind = terminalCategory(code);
			safe += kind === null ? text[index] : dataFor(code, kind).codepoint;
		}
		if (final && this.#pendingCarriageReturn) {
			safe += 'U+000D';
			this.#pendingCarriageReturn = false;
		}
		return safe;
	}
}

/** Sanitize one complete output block while preserving its line structure. */
export function sanitizeTerminalText(text: string): string {
	const decoder = new TerminalOutputDecoder();
	return decoder.write(new TextEncoder().encode(text)) + decoder.end();
}

async function write(output: Writable, text: string): Promise<void> {
	if (text === '' || output.write(text)) return;
	await once(output, 'drain');
}

async function forward(input: NodeJS.ReadableStream, output: Writable): Promise<void> {
	const decoder = new TerminalOutputDecoder();
	for await (const chunk of input) {
		await write(output, decoder.write(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
	}
	await write(output, decoder.end());
}

/** Run one child with separate, live, sanitized stdout and stderr streams. */
export async function runSanitizedCommand(
	command: string,
	args: string[],
	options: SanitizedCommandOptions = {}
): Promise<SanitizedCommandResult> {
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;
	const onActions = options.githubActions ?? process.env.GITHUB_ACTIONS === 'true';
	const commandToken = onActions ? `terminal-output-${randomUUID()}` : null;
	// The Actions runner consumes stdout and stderr through separate queues, so a
	// marker on one descriptor can race untrusted output on the other. Serialize both
	// streams onto stdout while workflow commands are suspended. Local runs retain
	// their original descriptors.
	const childStderr = onActions ? stdout : stderr;
	if (commandToken) await write(stdout, `\n::stop-commands::${commandToken}\n`);

	try {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: colorlessEnvironment(options.env),
			stdio: ['inherit', 'pipe', 'pipe']
		});
		const result = new Promise<SanitizedCommandResult>((resolve, reject) => {
			child.once('error', reject);
			child.once('close', (status, signal) => resolve({ status, signal }));
		});

		const [completed] = await Promise.all([
			result,
			forward(child.stdout, stdout),
			forward(child.stderr, childStderr)
		]);
		return completed;
	} finally {
		if (commandToken) await write(stdout, `\n::${commandToken}::\n`);
	}
}
