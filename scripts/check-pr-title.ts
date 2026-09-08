export const ALLOWED_TYPES = [
	'feat',
	'fix',
	'docs',
	'style',
	'refactor',
	'test',
	'chore',
	'perf',
	'ci'
] as const;

export const MISSING_TITLE = 'PR title is missing.';
export const INVALID_PR_DATA = 'Unable to read current pull request data.';
export const UNSAFE_CHARACTER = 'PR title contains an unsafe character.';
export const INVALID_SHAPE = 'PR title must use an accepted conventional-commit shape.';
export const UNSUPPORTED_TYPE = 'PR title uses an unsupported type.';
export const INVALID_SCOPE = 'PR title has an invalid scope.';
export const INVALID_SUBJECT = 'PR title has an invalid subject.';
export const FINAL_PERIOD = 'PR title subject must not end with an ASCII period.';

export const HINT =
	'Expected: type: subject, type(scope): subject, type!: subject, or type(scope)!: subject. ' +
	`Allowed types: ${ALLOWED_TYPES.join(', ')}.`;

const TITLE = /^(?<type>[a-z]+)(?:\((?<scope>[^()]*)\))?(?<breaking>!)?: (?<subject>.*)$/u;
const BIDI_FORMATTING = new Set([
	0x061c,
	0x200e,
	0x200f,
	...range(0x202a, 0x202f),
	...range(0x2066, 0x206a)
]);
const NON_SUBSTANTIVE = /[\p{C}\p{M}\p{Z}]/u;
const INVALID_BOUNDARY = /[\p{Cf}\p{Z}]/u;

function range(start: number, end: number): number[] {
	return Array.from({ length: end - start }, (_, index) => start + index);
}

function isUnsafe(character: string): boolean {
	const codepoint = character.codePointAt(0)!;
	return (
		codepoint <= 0x001f ||
		(codepoint >= 0x007f && codepoint <= 0x009f) ||
		[0x200b, 0x2028, 0x2029, 0x2060, 0xfeff, 0xfffd].includes(codepoint) ||
		BIDI_FORMATTING.has(codepoint)
	);
}

function lastSubstantive(value: string): string | undefined {
	return Array.from(value)
		.reverse()
		.find((character) => !NON_SUBSTANTIVE.test(character));
}

function hasInvalidBoundary(value: string): boolean {
	const characters = Array.from(value);
	return (
		characters.length > 0 &&
		(INVALID_BOUNDARY.test(characters[0]!) || INVALID_BOUNDARY.test(characters.at(-1)!))
	);
}

export function validateTitle(title: string): string | undefined {
	if (Array.from(title).some(isUnsafe)) return UNSAFE_CHARACTER;

	const match = TITLE.exec(title);
	if (!match?.groups) return INVALID_SHAPE;

	if (!ALLOWED_TYPES.includes(match.groups.type as (typeof ALLOWED_TYPES)[number])) {
		return UNSUPPORTED_TYPE;
	}

	const scope = match.groups.scope;
	if (scope !== undefined && (lastSubstantive(scope) === undefined || hasInvalidBoundary(scope))) {
		return INVALID_SCOPE;
	}

	const subject = match.groups.subject!;
	const last = lastSubstantive(subject);
	if (last === undefined) return INVALID_SUBJECT;
	if (last === '.') return FINAL_PERIOD;
	if (hasInvalidBoundary(subject)) return INVALID_SUBJECT;

	return undefined;
}

async function readPullRequestTitle(path: string): Promise<string | undefined> {
	try {
		const data: unknown = JSON.parse(await Bun.file(path).text());
		if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined;
		const title = (data as Record<string, unknown>).title;
		return typeof title === 'string' && title.length > 0 ? title : undefined;
	} catch {
		return undefined;
	}
}

async function main(): Promise<number> {
	const args = process.argv.slice(2);
	let diagnostic: string | undefined;

	if (args[0] === '--pr-json' && args.length === 2) {
		const title = await readPullRequestTitle(args[1]!);
		diagnostic = title === undefined ? INVALID_PR_DATA : validateTitle(title);
	} else if (args.length === 0) {
		const title = process.env.PR_TITLE;
		diagnostic = title ? validateTitle(title) : MISSING_TITLE;
	} else {
		diagnostic = INVALID_PR_DATA;
	}

	if (diagnostic === undefined) return 0;

	console.error(`::error::${diagnostic}`);
	console.error(HINT);
	return 1;
}

if (import.meta.main) process.exit(await main());
