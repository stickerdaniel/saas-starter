import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as v from 'valibot';
import { generatedNoticeProblems } from './generated';

const text = v.pipe(v.string(), v.trim(), v.minLength(1));
const httpUrl = v.pipe(
	v.string(),
	v.url(),
	v.regex(/^https?:\/\//i, 'sourceUrl must be an http(s) URL.')
);
const components = v.pipe(v.array(text), v.minLength(1));
const noticeFiles = v.pipe(v.array(text), v.minLength(1));

const generatedNoticeSchema = v.strictObject({
	licenseId: text,
	copyrights: v.optional(v.pipe(v.array(text), v.minLength(1))),
	preamble: v.optional(v.pipe(v.array(text), v.minLength(1)))
});
const generatedNotices = v.pipe(v.array(generatedNoticeSchema), v.minLength(1));

const packageOverrideSchema = v.pipe(
	v.strictObject({
		name: text,
		version: text,
		sourceUrl: httpUrl,
		license: v.optional(text),
		noticeFiles: v.optional(noticeFiles),
		generatedNotices: v.optional(generatedNotices),
		// Attribution files such as an upstream NOTICE. Kept in the row, but never
		// accepted as the package's license text.
		supplementalNoticeFiles: v.optional(noticeFiles)
	}),
	v.check(
		(override) => !(override.noticeFiles && override.generatedNotices),
		'Use either noticeFiles or generatedNotices in one override, not both.'
	),
	v.check(
		(override) =>
			!!(
				override.license ||
				override.noticeFiles ||
				override.generatedNotices ||
				override.supplementalNoticeFiles
			),
		'An override needs a license correction, noticeFiles, generatedNotices, or supplementalNoticeFiles.'
	)
);

const customNoticeSchema = v.pipe(
	v.strictObject({
		id: v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be lowercase kebab-case.')),
		name: text,
		components,
		license: text,
		sourceUrl: httpUrl,
		revision: v.optional(text),
		noticeFiles: v.optional(noticeFiles),
		generatedNotices: v.optional(generatedNotices)
	}),
	v.check(
		(notice) => !!notice.noticeFiles !== !!notice.generatedNotices,
		'A custom notice needs exactly one of noticeFiles or generatedNotices.'
	)
);

const configSchema = v.strictObject({
	$schema: v.optional(v.string()),
	extraPackages: v.optional(v.array(v.strictObject({ name: text, components })), []),
	packageOverrides: v.optional(v.array(packageOverrideSchema), []),
	customNotices: v.optional(v.array(customNoticeSchema), [])
});

export type GeneratedNoticeConfig = v.InferOutput<typeof generatedNoticeSchema>;
export type PackageOverride = v.InferOutput<typeof packageOverrideSchema>;
export type CustomNotice = v.InferOutput<typeof customNoticeSchema>;
export type ThirdPartyLicensesConfig = v.InferOutput<typeof configSchema>;

function duplicates(values: string[]): string[] {
	const seen = new Set<string>();
	const repeated = new Set<string>();
	for (const value of values) (seen.has(value) ? repeated : seen).add(value);
	return [...repeated];
}

function isInside(root: string, file: string): boolean {
	const relative = path.relative(root, path.resolve(root, file));
	return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Validate a parsed configuration. `root` anchors noticeFiles, which must stay
 * inside the repository. Throws one error listing every problem.
 */
export function parseThirdPartyLicensesConfig(
	input: unknown,
	root: string,
	source = 'third-party-licenses.config.json'
): ThirdPartyLicensesConfig {
	const result = v.safeParse(configSchema, input);
	if (!result.success) {
		const lines = result.issues.map((issue) => {
			const where = v.getDotPath(issue);
			return `  ${where ? `${where}: ` : ''}${issue.message}`;
		});
		throw new Error(`Invalid ${source}:\n${lines.join('\n')}`);
	}
	const config = result.output;
	const problems: string[] = [];

	for (const key of duplicates(config.packageOverrides.map((o) => `${o.name}@${o.version}`))) {
		problems.push(`Duplicate package override for ${key}.`);
	}
	for (const id of duplicates(config.customNotices.map((notice) => notice.id))) {
		problems.push(`Duplicate custom notice id "${id}".`);
	}
	for (const name of duplicates(config.extraPackages.map((entry) => entry.name))) {
		problems.push(`Duplicate extra package "${name}".`);
	}

	const evidence = [
		...config.packageOverrides.map((o) => ({ label: `${o.name}@${o.version}`, entry: o })),
		...config.customNotices.map((notice) => ({
			label: `custom notice "${notice.id}"`,
			entry: notice
		}))
	];
	for (const { label, entry } of evidence) {
		const files = [
			...(entry.noticeFiles ?? []).map((file) => ({ field: 'noticeFiles', file })),
			...('supplementalNoticeFiles' in entry ? (entry.supplementalNoticeFiles ?? []) : []).map(
				(file) => ({ field: 'supplementalNoticeFiles', file })
			)
		];
		for (const { field, file } of files) {
			if (path.isAbsolute(file) || !isInside(root, file)) {
				problems.push(`${label}: ${field} entry "${file}" must be a path inside the repository.`);
			}
		}
		for (const notice of entry.generatedNotices ?? []) {
			for (const problem of generatedNoticeProblems(notice)) problems.push(`${label}: ${problem}`);
		}
	}

	if (problems.length) {
		throw new Error(`Invalid ${source}:\n${problems.map((line) => `  ${line}`).join('\n')}`);
	}
	return config;
}

export function loadThirdPartyLicensesConfig(file: string, root: string): ThirdPartyLicensesConfig {
	let input: unknown;
	try {
		input = JSON.parse(readFileSync(file, 'utf8'));
	} catch (error) {
		throw new Error(
			`Cannot read ${path.relative(root, file) || file}: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error }
		);
	}
	return parseThirdPartyLicensesConfig(input, root, path.relative(root, file) || file);
}
