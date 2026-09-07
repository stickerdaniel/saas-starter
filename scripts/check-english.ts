import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
	checkEnglishText,
	formatEnglishFinding,
	proseKindForFile,
	type EnglishFinding
} from './english-policy/content';
import { sanitizeTerminalField } from './terminal-output';

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_DIAGNOSTICS = 20;

function readBoundedFile(file: string): string {
	if (statSync(file).size > MAX_INPUT_BYTES) throw new Error('Input exceeds the inspection limit.');
	return readFileSync(file, 'utf8');
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
			const label = path.normalize(file);
			findings.push(
				...checkEnglishText(label, readBoundedFile(file), proseKindForFile(label) ?? 'text')
			);
		}
		if (stdinLabel !== undefined) {
			const bytes = readFileSync(0);
			if (bytes.byteLength > MAX_INPUT_BYTES)
				throw new Error('Input exceeds the inspection limit.');
			findings.push(...checkEnglishText(stdinLabel, bytes.toString('utf8'), 'text'));
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
