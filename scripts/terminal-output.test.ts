import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { PassThrough, Writable } from 'stream';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
	colorlessEnvironment,
	runSanitizedCommand,
	TerminalOutputDecoder
} from './terminal-output';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ch = (code: number) => String.fromCharCode(code);
const bytes = (text: string) => new TextEncoder().encode(text);

function sanitize(chunks: Uint8Array[]): string {
	const decoder = new TerminalOutputDecoder();
	return chunks.map((chunk) => decoder.write(chunk)).join('') + decoder.end();
}

function capture(stream: PassThrough): () => string {
	const chunks: Buffer[] = [];
	stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
	return () => Buffer.concat(chunks).toString('utf8');
}

class SlowCapture extends Writable {
	readonly chunks: Buffer[] = [];
	drains = 0;

	constructor() {
		super({ highWaterMark: 1 });
		this.on('drain', () => this.drains++);
	}

	override _write(
		chunk: Buffer,
		_encoding: BufferEncoding,
		callback: (error?: Error | null) => void
	): void {
		this.chunks.push(Buffer.from(chunk));
		setTimeout(callback, 1);
	}

	text(): string {
		return Buffer.concat(this.chunks).toString('utf8');
	}
}

describe('terminal output text', () => {
	it('neutralizes every non-structural C0, DEL, C1, and bidi control', () => {
		const bidi = [
			0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069
		];
		const prohibited = [
			...Array.from({ length: 0x20 }, (_, code) => code).filter(
				(code) => code !== 0x09 && code !== 0x0a
			),
			0x7f,
			...Array.from({ length: 0x20 }, (_, offset) => 0x80 + offset),
			...bidi
		];

		for (const code of prohibited) {
			const output = sanitize([bytes(`a${ch(code)}b`)]);
			expect(output).toContain(`U+${code.toString(16).toUpperCase().padStart(4, '0')}`);
			expect(output).not.toContain(ch(code));
		}
		expect(sanitize([bytes('a\tb\nc')])).toBe('a\tb\nc');
	});

	it('normalizes CRLF across chunks and exposes a lone carriage return', () => {
		expect(sanitize([bytes('a\r'), bytes('\nb')])).toBe('a\nb');
		expect(sanitize([bytes('a\r'), bytes('b')])).toBe('aU+000Db');
		expect(sanitize([bytes('a\r')])).toBe('aU+000D');
	});

	it('reassembles split UTF-8 before classifying the character', () => {
		const encoded = bytes(`a${ch(0x202e)}b`);
		for (let split = 1; split < encoded.length; split++) {
			expect(sanitize([encoded.slice(0, split), encoded.slice(split)])).toBe('aU+202Eb');
		}
	});

	it('makes complete terminal sequences inert without deleting their payload', () => {
		const esc = ch(0x1b);
		const bel = ch(0x07);
		const output = sanitize([
			bytes(`${esc}[31mred${esc}[0m ${esc}]8;;https://example.com${bel}link${esc}]8;;${bel}`)
		]);

		expect(output).not.toContain(esc);
		expect(output).not.toContain(bel);
		expect(output).toContain('U+001B[31mredU+001B[0m');
		expect(output).toContain('https://example.com');
	});

	it('turns malformed UTF-8 into a printable replacement character', () => {
		expect(sanitize([new Uint8Array([0x61, 0xff, 0x62])])).toBe('a�b');
	});
});

describe('sanitized commands', () => {
	it('removes force-colour variables only from the child environment', () => {
		const parent = { ...process.env };
		const overrides = { FORCE_COLOR: '1', clicolor_force: '1', NO_COLOR: '' };
		const inheritedKey = Object.keys(process.env).find(
			(key) => !Object.keys(overrides).includes(key)
		);
		const env = colorlessEnvironment(overrides);

		expect(inheritedKey).toBeDefined();
		expect(env[inheritedKey!]).toBeUndefined();
		expect(env.NO_COLOR).toBe('1');
		expect(Object.keys(env).map((key) => key.toUpperCase())).not.toContain('FORCE_COLOR');
		expect(Object.keys(env).map((key) => key.toUpperCase())).not.toContain('CLICOLOR_FORCE');
		expect(process.env).toEqual(parent);
	});

	it('sanitizes stdout and stderr independently and preserves the exit status', async () => {
		const stdout = new PassThrough();
		const stderr = new PassThrough();
		const readStdout = capture(stdout);
		const readStderr = capture(stderr);
		const script = `
			const e = String.fromCharCode(27), b = String.fromCharCode(7);
			process.stdout.write('out' + e + ']0;title' + b);
			process.stderr.write('err' + e + '[2J');
			process.exitCode = 2;
		`;

		const result = await runSanitizedCommand(process.execPath, ['-e', script], {
			stdout,
			stderr,
			githubActions: false
		});

		expect(result.status).toBe(2);
		expect(readStdout()).toBe('outU+001B]0;titleU+0007');
		expect(readStderr()).toBe('errU+001B[2J');
	});

	it('serializes both streams between random GitHub markers in order', async () => {
		const stdout = new PassThrough();
		const stderr = new PassThrough();
		const readStdout = capture(stdout);
		const readStderr = capture(stderr);
		stdout.write('parent-prefix');
		const script = `
			process.stdout.write('diagnostic');
			process.stderr.write('::warning::source');
			process.exitCode = 2;
		`;

		const result = await runSanitizedCommand(process.execPath, ['-e', script], {
			stdout,
			stderr,
			githubActions: true
		});
		const output = readStdout();
		const token = output.match(/^::stop-commands::([^\n]+)$/m)?.[1];
		const stop = output.indexOf(`::stop-commands::${token}`);
		const diagnostic = output.indexOf('diagnostic');
		const warning = output.indexOf('::warning::source');
		const resume = output.indexOf(`::${token}::`);

		expect(result.status).toBe(2);
		expect(token).toMatch(
			/^terminal-output-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
		);
		expect(readStderr()).toBe('');
		expect(stop).toBeGreaterThan('parent-prefix'.length - 1);
		expect(diagnostic).toBeGreaterThan(stop);
		expect(warning).toBeGreaterThan(stop);
		expect(resume).toBeGreaterThan(diagnostic);
		expect(resume).toBeGreaterThan(warning);
		expect(output).toMatch(new RegExp(`^::${token}::$`, 'm'));
	});

	it('uses a fresh balanced marker pair when spawn fails', async () => {
		const outputs = await Promise.all(
			[1, 2].map(async () => {
				const stdout = new PassThrough();
				const readStdout = capture(stdout);
				await expect(
					runSanitizedCommand(`missing-terminal-output-command-${Date.now()}`, [], {
						stdout,
						stderr: new PassThrough(),
						githubActions: true
					})
				).rejects.toThrow();
				return readStdout();
			})
		);
		const tokens = outputs.map((output) => output.match(/^::stop-commands::([^\n]+)$/m)?.[1]);

		expect(tokens[0]).toBeDefined();
		expect(tokens[1]).toBeDefined();
		expect(tokens[0]).not.toBe(tokens[1]);
		for (let index = 0; index < outputs.length; index++) {
			const token = tokens[index]!;
			const stop = outputs[index].indexOf(`::stop-commands::${token}`);
			const resume = outputs[index].indexOf(`::${token}::`);
			expect(token).toMatch(
				/^terminal-output-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
			);
			expect(stop).toBeGreaterThanOrEqual(0);
			expect(resume).toBeGreaterThan(stop);
			expect(outputs[index]).toMatch(new RegExp(`^::${token}::$`, 'm'));
		}
	});

	it('drains both pipes while a child writes more than their capacity', async () => {
		const stdout = new SlowCapture();
		const stderr = new SlowCapture();
		const script = `
			process.stdout.write('a'.repeat(262144));
			process.stderr.write('b'.repeat(262144));
		`;

		const result = await runSanitizedCommand(process.execPath, ['-e', script], {
			stdout,
			stderr,
			githubActions: false
		});

		expect(result.status).toBe(0);
		expect(stdout.drains).toBeGreaterThan(0);
		expect(stderr.drains).toBeGreaterThan(0);
		expect(stdout.text()).toHaveLength(262144);
		expect(stderr.text()).toHaveLength(262144);
	}, 5_000);
});

describe('static-check boundary', () => {
	it('neutralizes a Prettier code frame built from malformed source', () => {
		const directory = mkdtempSync(path.join(ROOT, 'terminal-output-prettier-'));
		const relative = path.relative(ROOT, path.join(directory, 'fixture.ts'));
		const esc = ch(0x1b);
		const bel = ch(0x07);
		const payload = `${esc}]0;title${bel}`;
		try {
			writeFileSync(path.join(ROOT, relative), `// ${payload}\nconst value = ;\n`, 'utf8');
			const result = spawnSync('bun', ['scripts/static-checks.ts', '--scope', 'lint', relative], {
				cwd: ROOT,
				encoding: 'utf8'
			});
			const output = result.stdout + result.stderr;

			expect(result.status).toBe(2);
			expect(output).not.toContain(payload);
			expect(output).toContain('U+001B]0;titleU+0007');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}, 60_000);

	it('neutralizes a source line printed by the in-process banned-pattern check', () => {
		const directory = mkdtempSync(path.join(ROOT, 'src/terminal-output-parent-'));
		const relative = path.relative(ROOT, path.join(directory, 'fixture.ts'));
		const esc = ch(0x1b);
		const payload = `${esc}]0;title${ch(0x07)}`;
		try {
			writeFileSync(path.join(ROOT, relative), `// execSync( ${payload}\n`, 'utf8');
			const result = spawnSync('bun', ['scripts/static-checks.ts', '--scope', 'lint', relative], {
				cwd: ROOT,
				encoding: 'utf8'
			});
			const output = result.stdout + result.stderr;

			expect(result.status).toBe(1);
			expect(output).not.toContain(payload);
			expect(output).toContain('U+001B]0;titleU+0007');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}, 60_000);
});
