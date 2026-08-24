export interface RegressionGuardInput {
	title: string;
	body: string;
	author: string;
}

export interface RegressionGuardResult {
	required: boolean;
	valid: boolean;
	message: string;
}

const FIX_TITLE = /^fix(?:\([^)]+\))?!?: /;
const ISSUE_CLOSURE = /^Closes #\d+$/;
const VERDICT = /^Regression guard: (?:(added|covered by) (.+)|not warranted, (.+))$/;
const PLACEHOLDERS = new Set(['name', 'one-line reason', 'reason', 'todo', 'tbd', 'fixme']);
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u;

function firstVerdictLine(body: string): string | undefined {
	const lines = body.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
	let index = lines.findIndex((line) => line.trim() !== '');
	if (index === -1) return undefined;

	if (ISSUE_CLOSURE.test(lines[index]!)) {
		index += 1;
		while (index < lines.length && lines[index]!.trim() === '') index += 1;
	}
	return lines[index];
}

export function checkRegressionGuard(input: RegressionGuardInput): RegressionGuardResult {
	if (input.author.endsWith('[bot]') || input.author.startsWith('app/')) {
		return { required: false, valid: true, message: 'Bot-authored PR; verdict not required.' };
	}
	if (!FIX_TITLE.test(input.title)) {
		return {
			required: false,
			valid: true,
			message: 'Not a conventional fix PR; verdict not required.'
		};
	}

	const line = firstVerdictLine(input.body);
	const match = line ? VERDICT.exec(line) : null;
	const payload = match ? (match[2] ?? match[3] ?? '') : '';
	const normalizedPayload = payload
		.normalize('NFKC')
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase();
	const placeholderCandidate = normalizedPayload.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
	if (
		!match ||
		payload !== payload.trim() ||
		!/[A-Za-z0-9]/.test(payload) ||
		PLACEHOLDERS.has(placeholderCandidate) ||
		INVISIBLE.test(payload)
	) {
		return {
			required: true,
			valid: false,
			message:
				'Put a plain-text `Regression guard: added <name>`, `covered by <name>`, or `not warranted, <reason>` verdict at the start of the body, immediately after an optional `Closes #N` line, and replace the placeholder.'
		};
	}

	return { required: true, valid: true, message: 'Regression guard verdict found.' };
}

if (import.meta.main) {
	const result = checkRegressionGuard({
		title: process.env.PR_TITLE ?? '',
		body: process.env.PR_BODY ?? '',
		author: process.env.PR_AUTHOR ?? ''
	});
	if (!result.valid) console.error(`::error::${result.message}`);
	else console.log(result.message);
	process.exit(result.valid ? 0 : 1);
}
