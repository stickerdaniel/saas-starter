import { readFileSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
	checkEnglishText,
	formatEnglishFinding,
	normalizePolicyIdentity,
	proseKindForFile,
	type EnglishFinding
} from './english-policy/content';
import { sanitizeTerminalField } from './terminal-output';

export const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_DIAGNOSTICS = 20;
const READ_CHUNK_BYTES = 64 * 1024;
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type ReadInput = (
	fd: number,
	buffer: NodeJS.ArrayBufferView,
	offset: number,
	length: number,
	position: number | null
) => number;

function readBoundedFile(file: string): string {
	if (statSync(file).size > MAX_INPUT_BYTES) throw new Error('Input exceeds the inspection limit.');
	return readFileSync(file, 'utf8');
}

export function policyIdentityForFile(file: string, repositoryRoot = REPOSITORY_ROOT): string {
	const absolute = path.resolve(file);
	const relative = path.relative(repositoryRoot, absolute);
	if (
		relative === '' ||
		(!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
	) {
		return normalizePolicyIdentity(relative);
	}
	return normalizePolicyIdentity(path.normalize(file));
}

export function readBoundedStdin(readInput: ReadInput = readSync): string {
	const chunks: Buffer[] = [];
	let total = 0;

	while (total <= MAX_INPUT_BYTES) {
		const remaining = MAX_INPUT_BYTES + 1 - total;
		const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining));
		const bytesRead = readInput(0, chunk, 0, chunk.byteLength, null);
		if (bytesRead === 0) break;
		chunks.push(chunk.subarray(0, bytesRead));
		total += bytesRead;
	}
	if (total > MAX_INPUT_BYTES) throw new Error('Input exceeds the inspection limit.');
	return Buffer.concat(chunks, total).toString('utf8');
}

function main(): number {
	try {
		const parsed = parseArgs({
			args: Bun.argv,
			options: {
				artifact: { type: 'string', multiple: true },
				'stdin-label': { type: 'string' }
			},
			allowPositionals: true,
			strict: true
		});
		const files = [...parsed.positionals.slice(2), ...(parsed.values.artifact ?? [])];
		const stdinLabel = parsed.values['stdin-label'];
		if (files.length === 0 && stdinLabel === undefined) {
			throw new Error('No input was provided.');
		}

		const findings: EnglishFinding[] = [];
		for (const file of files) {
			const diagnosticLabel = path.normalize(file);
			const policyIdentity = policyIdentityForFile(file);
			findings.push(
				...checkEnglishText(
					diagnosticLabel,
					readBoundedFile(file),
					proseKindForFile(policyIdentity) ?? 'text'
				)
			);
		}
		if (stdinLabel !== undefined) {
			findings.push(...checkEnglishText(stdinLabel, readBoundedStdin(), 'text'));
		}

		for (const finding of findings.slice(0, MAX_DIAGNOSTICS)) {
			console.error(sanitizeTerminalField(formatEnglishFinding(finding)));
		}
		if (findings.length > MAX_DIAGNOSTICS) {
			console.error(`${findings.length - MAX_DIAGNOSTICS} additional finding(s) were omitted.`);
		}
		if (findings.length > 0) {
			console.error(`English policy failed with ${findings.length} clear finding(s).`);
			return 1;
		}
		console.log(
			`English policy passed for ${files.length + (stdinLabel === undefined ? 0 : 1)} input(s).`
		);
		return 0;
	} catch {
		console.error('English policy failed: input could not be read or validated.');
		return 1;
	}
}

if (import.meta.main) process.exit(main());
