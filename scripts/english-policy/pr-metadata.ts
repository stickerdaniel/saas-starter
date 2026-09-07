import { readFileSync, statSync } from 'node:fs';
import { classifyEnglish, splitTextWindows } from './classifier';

interface PullRequestEvent {
	pull_request: {
		title: string;
		body: string | null;
	};
}

export interface MetadataFinding {
	field: 'title' | 'body';
	paragraph: number | null;
	language: string;
	topScore: number;
	englishScore: number | null;
}

export interface MetadataResult {
	findings: MetadataFinding[];
	insufficientEvidence: number;
}

const MAX_EVENT_BYTES = 2 * 1024 * 1024;
const MAX_TITLE_LENGTH = 1_024;
const MAX_BODY_LENGTH = 1_000_000;
const MAX_DIAGNOSTICS = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parsePullRequestEvent(value: unknown): PullRequestEvent {
	if (!isRecord(value) || !isRecord(value.pull_request)) {
		throw new TypeError('Event does not contain pull_request metadata.');
	}
	const { title, body } = value.pull_request;
	if (typeof title !== 'string' || title.length === 0 || title.length > MAX_TITLE_LENGTH) {
		throw new TypeError('Pull request title is missing or invalid.');
	}
	if (body !== null && typeof body !== 'string') {
		throw new TypeError('Pull request body is invalid.');
	}
	if (typeof body === 'string' && body.length > MAX_BODY_LENGTH) {
		throw new TypeError('Pull request body exceeds the inspection limit.');
	}
	return { pull_request: { title, body } };
}

function withoutFencedCode(text: string): string {
	const kept: string[] = [];
	let fence: string | null = null;
	for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
		const marker = line.match(/^\s*(`{3,}|~{3,})/u)?.[1];
		if (marker !== undefined) {
			if (fence === null) fence = marker[0]!;
			else if (marker.startsWith(fence)) fence = null;
			kept.push('');
			continue;
		}
		kept.push(fence === null ? line : '');
	}
	return kept.join('\n');
}

function paragraphTexts(text: string): string[] {
	return withoutFencedCode(text)
		.split(/\n\s*\n/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean);
}

function inspect(
	text: string,
	field: 'title' | 'body',
	paragraph: number | null,
	result: MetadataResult
): void {
	for (const window of splitTextWindows(text)) {
		const classification = classifyEnglish(window.text);
		if (classification.outcome === 'insufficient-evidence') {
			result.insufficientEvidence++;
			continue;
		}
		if (classification.outcome !== 'violation') continue;
		result.findings.push({
			field,
			paragraph,
			language: classification.language,
			topScore: classification.topScore,
			englishScore: classification.englishScore
		});
		return;
	}
}

export function evaluatePullRequestMetadata(event: PullRequestEvent): MetadataResult {
	const result: MetadataResult = { findings: [], insufficientEvidence: 0 };
	inspect(event.pull_request.title, 'title', null, result);
	for (const [index, paragraph] of paragraphTexts(event.pull_request.body ?? '').entries()) {
		inspect(paragraph, 'body', index + 1, result);
	}
	return result;
}

export function readPullRequestEvent(eventPath: string | undefined): PullRequestEvent {
	if (!eventPath) throw new TypeError('GITHUB_EVENT_PATH is not set.');
	if (statSync(eventPath).size > MAX_EVENT_BYTES) {
		throw new TypeError('GitHub event exceeds the inspection limit.');
	}
	return parsePullRequestEvent(JSON.parse(readFileSync(eventPath, 'utf8')));
}

function printFinding(finding: MetadataFinding): void {
	const location =
		finding.field === 'title' ? 'PR title' : `PR body paragraph ${finding.paragraph ?? '?'}`;
	const english = finding.englishScore === null ? 'unavailable' : finding.englishScore.toFixed(3);
	console.error(
		`${location}: clear non-English prose (${finding.language}; top score ${finding.topScore.toFixed(3)}; English score ${english}).`
	);
}

export function runPrMetadataCli(eventPath = process.env.GITHUB_EVENT_PATH): number {
	try {
		const result = evaluatePullRequestMetadata(readPullRequestEvent(eventPath));
		if (result.findings.length === 0) {
			console.log(
				`English policy passed (${result.insufficientEvidence} segment(s) had insufficient evidence).`
			);
			return 0;
		}
		for (const finding of result.findings.slice(0, MAX_DIAGNOSTICS)) printFinding(finding);
		if (result.findings.length > MAX_DIAGNOSTICS) {
			console.error(
				`${result.findings.length - MAX_DIAGNOSTICS} additional finding(s) were omitted.`
			);
		}
		console.error('English policy failed: write the pull request title and body prose in English.');
		return 1;
	} catch {
		console.error('English policy failed: pull request metadata could not be read or validated.');
		return 1;
	}
}

if (import.meta.main) process.exit(runPrMetadataCli());
