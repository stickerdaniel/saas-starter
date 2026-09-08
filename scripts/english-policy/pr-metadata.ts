import { readFileSync, statSync } from 'node:fs';
import { classifyEnglish, splitTextWindows } from './classifier';
import { withoutFencedCode } from './markdown';

interface PullRequestDocument {
	pull_request: {
		title: string;
		body: string | null;
	};
}

interface PullRequestTrigger {
	action: 'opened' | 'edited' | 'reopened' | 'synchronize';
	number: number;
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

export type PullRequestFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface MetadataCliOptions {
	eventPath?: string;
	repository?: string;
	apiUrl?: string;
	fetcher?: PullRequestFetch;
}

const MAX_EVENT_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TITLE_LENGTH = 1_024;
const MAX_BODY_LENGTH = 1_000_000;
const MAX_DIAGNOSTICS = 8;
const FETCH_TIMEOUT_MS = 10_000;
const ACTIONS = new Set(['opened', 'edited', 'reopened', 'synchronize']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validPullRequestNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function parsePullRequestDocument(value: unknown): PullRequestDocument {
	if (!isRecord(value) || !isRecord(value.pull_request)) {
		throw new TypeError('Value does not contain pull request metadata.');
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

export function parsePullRequestEvent(value: unknown): PullRequestTrigger {
	if (!isRecord(value) || !isRecord(value.pull_request)) {
		throw new TypeError('Event does not contain pull request metadata.');
	}
	const { action, number } = value;
	if (typeof action !== 'string' || !ACTIONS.has(action)) {
		throw new TypeError('Pull request action is invalid.');
	}
	if (!validPullRequestNumber(number) || value.pull_request.number !== number) {
		throw new TypeError('Pull request number is invalid.');
	}
	return { action: action as PullRequestTrigger['action'], number };
}

function repositorySegments(repository: string): [string, string] {
	const segments = repository.split('/');
	if (
		segments.length !== 2 ||
		segments.some(
			(segment) =>
				segment.length === 0 ||
				segment.length > 100 ||
				segment === '.' ||
				segment === '..' ||
				!/^[A-Za-z0-9_.-]+$/u.test(segment)
		)
	) {
		throw new TypeError('GitHub repository is invalid.');
	}
	return segments as [string, string];
}

export function currentPullRequestUrl(
	apiUrl: string | undefined,
	repository: string | undefined,
	number: number
): string {
	if (!apiUrl || !repository || !validPullRequestNumber(number)) {
		throw new TypeError('Current pull request location is invalid.');
	}
	const endpoint = new URL(apiUrl);
	if (
		endpoint.protocol !== 'https:' ||
		endpoint.hostname !== 'api.github.com' ||
		endpoint.port !== '' ||
		endpoint.username !== '' ||
		endpoint.password !== '' ||
		(endpoint.pathname !== '' && endpoint.pathname !== '/') ||
		endpoint.search !== '' ||
		endpoint.hash !== ''
	) {
		throw new TypeError('GitHub API URL is invalid.');
	}
	const [owner, name] = repositorySegments(repository);
	return `https://api.github.com/repos/${owner}/${name}/pulls/${number}`;
}

async function readBoundedResponse(response: Response): Promise<unknown> {
	const contentLength = response.headers.get('content-length');
	if (contentLength !== null) {
		if (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES) {
			throw new TypeError('GitHub response exceeds the inspection limit.');
		}
	}
	if (response.body === null) throw new TypeError('GitHub response body is missing.');

	const chunks: Uint8Array[] = [];
	let total = 0;
	const reader = response.body.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_RESPONSE_BYTES) {
				await reader.cancel();
				throw new TypeError('GitHub response exceeds the inspection limit.');
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function parseCurrentPullRequest(
	value: unknown,
	expectedNumber: number,
	expectedRepository: string
): PullRequestDocument {
	if (
		!isRecord(value) ||
		value.number !== expectedNumber ||
		!isRecord(value.base) ||
		!isRecord(value.base.repo) ||
		value.base.repo.full_name !== expectedRepository
	) {
		throw new TypeError('GitHub response does not match the requested pull request.');
	}
	return parsePullRequestDocument({ pull_request: { title: value.title, body: value.body } });
}

export async function fetchCurrentPullRequest(
	apiUrl: string | undefined,
	repository: string | undefined,
	number: number,
	fetcher: PullRequestFetch = fetch
): Promise<PullRequestDocument> {
	const requestUrl = currentPullRequestUrl(apiUrl, repository, number);
	const response = await fetcher(requestUrl, {
		method: 'GET',
		headers: {
			Accept: 'application/vnd.github+json',
			'User-Agent': 'saas-starter-english-policy',
			'X-GitHub-Api-Version': '2022-11-28'
		},
		redirect: 'error',
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
	});
	if (
		response.status !== 200 ||
		response.redirected ||
		response.url !== requestUrl ||
		!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '')
	) {
		throw new TypeError('GitHub response is invalid.');
	}
	return parseCurrentPullRequest(await readBoundedResponse(response), number, repository!);
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

export function evaluatePullRequestMetadata(event: PullRequestDocument): MetadataResult {
	const result: MetadataResult = { findings: [], insufficientEvidence: 0 };
	inspect(event.pull_request.title, 'title', null, result);
	for (const [index, paragraph] of paragraphTexts(event.pull_request.body ?? '').entries()) {
		inspect(paragraph, 'body', index + 1, result);
	}
	return result;
}

export function readPullRequestEvent(eventPath: string | undefined): PullRequestTrigger {
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

export async function runPrMetadataCli(options: MetadataCliOptions = {}): Promise<number> {
	try {
		const trigger = readPullRequestEvent(options.eventPath ?? process.env.GITHUB_EVENT_PATH);
		const current = await fetchCurrentPullRequest(
			options.apiUrl ?? process.env.GITHUB_API_URL,
			options.repository ?? process.env.GITHUB_REPOSITORY,
			trigger.number,
			options.fetcher
		);
		const result = evaluatePullRequestMetadata(current);
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
		console.error(
			'English policy failed: current pull request metadata could not be read or validated.'
		);
		return 1;
	}
}

if (import.meta.main) process.exit(await runPrMetadataCli());
