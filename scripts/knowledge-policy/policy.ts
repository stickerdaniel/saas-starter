import path from 'node:path';
import {
	extractMarkdownLinks,
	parseFlatFrontmatter,
	resolveRelativeLink,
	type FrontmatterParseResult
} from './markdown';

export type PolicyMode = 'advisory' | 'strict';
export type FindingSeverity = 'warning' | 'error';
export type SeverityByMode = Readonly<Record<PolicyMode, FindingSeverity>>;
export type PathMatcher = (file: string) => boolean;

export const blocking: SeverityByMode = { advisory: 'warning', strict: 'error' };
export const advisoryOnly: SeverityByMode = { advisory: 'warning', strict: 'warning' };

export interface PolicyFinding {
	ruleId: string;
	severity: FindingSeverity;
	file: string;
	line?: number;
	message: string;
}

export interface PolicyRepository {
	files: readonly string[];
	readText(file: string): string;
	pathExists(file: string): boolean;
	commitExists(sha: string): boolean;
}

export interface MetadataValidationContext {
	file: string;
	field: string;
	frontmatter: FrontmatterParseResult;
	commitExists(sha: string): boolean;
}

export type MetadataValidator = (
	value: string | undefined,
	context: MetadataValidationContext
) => string | null;

export interface MetadataRequirement {
	ruleId: string;
	field: string;
	validate: MetadataValidator;
}

export interface DocumentValidationContext {
	file: string;
	text: string;
	frontmatter: FrontmatterParseResult;
	repository: PolicyRepository;
}

export interface DocumentValidationResult {
	ruleId: string;
	line?: number;
	message: string;
}

export interface DocumentClass {
	id: string;
	match: PathMatcher;
	severity: SeverityByMode;
	frontmatter?: {
		required: boolean;
		requirements: readonly MetadataRequirement[];
	};
	validate?: (context: DocumentValidationContext) => readonly DocumentValidationResult[];
}

export interface PathRule {
	ruleId: string;
	match: PathMatcher;
	severity: SeverityByMode;
	message: string | ((file: string) => string);
}

export interface TextMatch {
	line?: number;
	message: string;
}

export interface TextRule {
	ruleId: string;
	include: PathMatcher;
	exclude?: PathMatcher;
	severity: SeverityByMode;
	find(text: string, file: string): readonly TextMatch[];
}

export interface KnowledgePolicyConfig {
	mode: PolicyMode;
	repository: {
		candidates: PathMatcher;
		ignore: PathMatcher;
		runtimeFiles: PathMatcher;
	};
	documents: {
		markdown: PathMatcher;
		allowed: readonly DocumentClass[];
		requireClassification?: SeverityByMode;
		forbidden: readonly PathRule[];
	};
	links?: {
		include: PathMatcher;
		exclude?: PathMatcher;
		severity: SeverityByMode;
	};
	textRules: readonly TextRule[];
}

export interface EvaluateKnowledgePolicyInput {
	policy: KnowledgePolicyConfig;
	repository: PolicyRepository;
}

function regexMatches(regex: RegExp, value: string): boolean {
	regex.lastIndex = 0;
	return regex.test(value);
}

export function exactPaths(...paths: string[]): PathMatcher {
	const allowed = new Set(paths);
	return (file) => allowed.has(file);
}

export function underPath(directory: string): PathMatcher {
	const prefix = directory.endsWith('/') ? directory : `${directory}/`;
	return (file) => file.startsWith(prefix);
}

export function fileExtension(...extensions: string[]): PathMatcher {
	const suffixes = extensions.map((extension) =>
		extension.startsWith('.') ? extension : `.${extension}`
	);
	return (file) => suffixes.some((extension) => file.endsWith(extension));
}

export function basenameMatches(pattern: RegExp): PathMatcher {
	return (file) => regexMatches(pattern, path.posix.basename(file));
}

export function pathMatches(pattern: RegExp): PathMatcher {
	return (file) => regexMatches(pattern, file);
}

export function anyOf(...matchers: PathMatcher[]): PathMatcher {
	return (file) => matchers.some((matcher) => matcher(file));
}

export function allOf(...matchers: PathMatcher[]): PathMatcher {
	return (file) => matchers.every((matcher) => matcher(file));
}

export function not(matcher: PathMatcher): PathMatcher {
	return (file) => !matcher(file);
}

export function literalValue(expected: string): MetadataValidator {
	return (value) => (value === expected ? null : `Must equal "${expected}".`);
}

export function oneOfValues(...expected: string[]): MetadataValidator {
	return (value) =>
		value !== undefined && expected.includes(value)
			? null
			: `Must be one of: ${expected.join(', ')}.`;
}

export function nonEmptyValue(): MetadataValidator {
	return (value) => (value?.trim() ? null : 'Must be a non-empty value.');
}

export function patternValue(pattern: RegExp, description: string): MetadataValidator {
	return (value) =>
		value !== undefined && regexMatches(pattern, value) ? null : `Must ${description}.`;
}

export function isoDateValue(): MetadataValidator {
	return (value) => {
		if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Must use YYYY-MM-DD.';
		const date = new Date(`${value}T00:00:00Z`);
		return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value
			? 'Must be a real calendar date in YYYY-MM-DD form.'
			: null;
	};
}

export function gitCommitValue(options?: {
	pattern?: RegExp;
	mustExist?: boolean;
}): MetadataValidator {
	const pattern = options?.pattern ?? /^[0-9a-f]{7,40}$/;
	return (value, context) => {
		if (!value || !regexMatches(pattern, value)) {
			return 'Must be a 7 to 40 character lowercase hexadecimal commit ID.';
		}
		if (options?.mustExist && !context.commitExists(value)) {
			return `Commit ${value} is unavailable. Fetch the full Git history and retry.`;
		}
		return null;
	};
}

export function removedDocumentReferences(options: {
	ruleId: string;
	paths: readonly string[];
	include: PathMatcher;
	exclude?: PathMatcher;
	severity: SeverityByMode;
}): TextRule {
	return {
		ruleId: options.ruleId,
		include: options.include,
		exclude: options.exclude,
		severity: options.severity,
		find(text) {
			const matches: TextMatch[] = [];
			const seen = new Set<string>();
			const lines = text.replaceAll('\r\n', '\n').split('\n');
			for (const removedPath of options.paths) {
				for (let index = 0; index < lines.length; index += 1) {
					if (!lines[index]!.includes(removedPath)) continue;
					const key = `${index}:${removedPath}`;
					if (seen.has(key)) continue;
					seen.add(key);
					matches.push({
						line: index + 1,
						message: `References removed document ${removedPath}.`
					});
				}
			}
			return matches;
		}
	};
}

function severity(policy: KnowledgePolicyConfig, mapping: SeverityByMode): FindingSeverity {
	return mapping[policy.mode];
}

function finding(
	policy: KnowledgePolicyConfig,
	mapping: SeverityByMode,
	input: Omit<PolicyFinding, 'severity'>
): PolicyFinding {
	return { ...input, severity: severity(policy, mapping) };
}

function ruleIds(policy: KnowledgePolicyConfig): string[] {
	return [
		...policy.documents.forbidden.map((rule) => rule.ruleId),
		...policy.textRules.map((rule) => rule.ruleId),
		...policy.documents.allowed.flatMap((document) => [
			...(document.frontmatter?.requirements.map((requirement) => requirement.ruleId) ?? [])
		])
	];
}

export function defineKnowledgePolicy(config: KnowledgePolicyConfig): KnowledgePolicyConfig {
	const classIds = config.documents.allowed.map((document) => document.id);
	if (new Set(classIds).size !== classIds.length)
		throw new Error('Document class IDs must be unique.');
	const ids = ruleIds(config);
	if (new Set(ids).size !== ids.length)
		throw new Error('Knowledge-policy rule IDs must be unique.');
	return config;
}

export function matchesKnowledgeCandidate(policy: KnowledgePolicyConfig, file: string): boolean {
	return policy.repository.candidates(file) && !policy.repository.ignore(file);
}

function sortFindings(findings: PolicyFinding[]): PolicyFinding[] {
	return findings.sort(
		(a, b) =>
			a.file.localeCompare(b.file) ||
			(a.line ?? 0) - (b.line ?? 0) ||
			a.ruleId.localeCompare(b.ruleId) ||
			a.message.localeCompare(b.message)
	);
}

export function evaluateKnowledgePolicy({
	policy,
	repository
}: EvaluateKnowledgePolicyInput): PolicyFinding[] {
	const findings: PolicyFinding[] = [];
	const files = [...new Set(repository.files)].filter((file) =>
		matchesKnowledgeCandidate(policy, file)
	);
	const textCache = new Map<string, string>();
	const readText = (file: string) => {
		if (!textCache.has(file)) textCache.set(file, repository.readText(file));
		return textCache.get(file)!;
	};

	for (const file of files) {
		for (const rule of policy.documents.forbidden) {
			if (!rule.match(file)) continue;
			findings.push(
				finding(policy, rule.severity, {
					ruleId: rule.ruleId,
					file,
					message: typeof rule.message === 'function' ? rule.message(file) : rule.message
				})
			);
		}

		for (const rule of policy.textRules) {
			if (!rule.include(file) || rule.exclude?.(file)) continue;
			for (const match of rule.find(readText(file), file)) {
				findings.push(
					finding(policy, rule.severity, {
						ruleId: rule.ruleId,
						file,
						line: match.line,
						message: match.message
					})
				);
			}
		}

		if (!policy.documents.markdown(file)) continue;
		const classes = policy.documents.allowed.filter((document) => document.match(file));
		if (classes.length === 0 && policy.documents.requireClassification) {
			findings.push(
				finding(policy, policy.documents.requireClassification, {
					ruleId: 'knowledge.document-unclassified',
					file,
					message: 'Markdown does not match an allowed document class.'
				})
			);
		}
		if (classes.length > 1) {
			findings.push(
				finding(policy, policy.documents.requireClassification ?? blocking, {
					ruleId: 'knowledge.document-ambiguous-class',
					file,
					message: `Markdown matches multiple document classes: ${classes.map((item) => item.id).join(', ')}.`
				})
			);
			continue;
		}

		const documentClass = classes[0];
		if (documentClass?.frontmatter || documentClass?.validate) {
			const parsed = parseFlatFrontmatter(readText(file));
			for (const error of parsed.errors) {
				findings.push(
					finding(policy, documentClass.severity, {
						ruleId: 'knowledge.frontmatter-invalid',
						file,
						line: error.line,
						message: error.message
					})
				);
			}
			if (documentClass.frontmatter?.required && !parsed.present) {
				findings.push(
					finding(policy, documentClass.severity, {
						ruleId: 'knowledge.frontmatter-required',
						file,
						line: 1,
						message: `${documentClass.id} documents require frontmatter.`
					})
				);
			}
			if (parsed.errors.length === 0) {
				for (const requirement of documentClass.frontmatter?.requirements ?? []) {
					const field = parsed.fields[requirement.field];
					const message = requirement.validate(field?.value, {
						file,
						field: requirement.field,
						frontmatter: parsed,
						commitExists: repository.commitExists
					});
					if (!message) continue;
					findings.push(
						finding(policy, documentClass.severity, {
							ruleId: requirement.ruleId,
							file,
							line: field?.line ?? 1,
							message: `${requirement.field}: ${message}`
						})
					);
				}
				for (const result of documentClass.validate?.({
					file,
					text: readText(file),
					frontmatter: parsed,
					repository
				}) ?? []) {
					findings.push(
						finding(policy, documentClass.severity, {
							ruleId: result.ruleId,
							file,
							line: result.line,
							message: result.message
						})
					);
				}
			}
		}

		if (policy.links?.include(file) && !policy.links.exclude?.(file)) {
			for (const link of extractMarkdownLinks(readText(file))) {
				const resolved = resolveRelativeLink(file, link);
				if (!resolved) continue;
				if (resolved.outsideRepository) {
					findings.push(
						finding(policy, policy.links.severity, {
							ruleId: 'knowledge.relative-link-outside-repository',
							file,
							line: link.line,
							message: `Relative link escapes the repository: ${link.target}.`
						})
					);
				} else if (!repository.pathExists(resolved.target)) {
					findings.push(
						finding(policy, policy.links.severity, {
							ruleId: 'knowledge.relative-link-missing',
							file,
							line: link.line,
							message: `Relative link target does not exist: ${resolved.target}.`
						})
					);
				}
			}
		}
	}

	return sortFindings(findings);
}

export function formatPolicyFinding(finding: PolicyFinding): string {
	const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
	return `${finding.severity.toUpperCase()} ${finding.ruleId} ${location}: ${finding.message}`;
}
