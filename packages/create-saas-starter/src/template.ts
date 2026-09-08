import { CLI_VERSION, DEFAULT_TEMPLATE_SHA } from './options.js';

const API_ORIGIN = 'https://api.github.com';
const ARCHIVE_ORIGIN = 'https://codeload.github.com';
const SOURCE_PATH = 'stickerdaniel/saas-starter';
const MAX_API_BYTES = 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ResolvedTemplate {
	ref: string;
	sha: string;
}

function checkedUrl(value: string | URL, allowedHosts: ReadonlySet<string>): URL {
	const url = new URL(value);
	if (
		url.protocol !== 'https:' ||
		url.port !== '' ||
		url.username !== '' ||
		url.password !== '' ||
		!allowedHosts.has(url.hostname)
	) {
		throw new Error(`Template request refused an unexpected host: ${url.hostname || '(missing)'}.`);
	}
	return url;
}

async function responseBytes(
	response: Response,
	limit: number,
	signal: AbortSignal
): Promise<Buffer> {
	if (!response.body) return Buffer.alloc(0);
	const reader = response.body.getReader();
	const chunks: Buffer[] = [];
	let total = 0;
	try {
		while (true) {
			if (signal.aborted) throw signal.reason;
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > limit) throw new Error(`Template response exceeded ${limit} bytes.`);
			chunks.push(Buffer.from(value));
		}
	} catch (error) {
		await reader.cancel(error).catch(() => {});
		throw error;
	}
	return Buffer.concat(chunks, total);
}

async function fixedHostRequest(
	initialUrl: URL,
	configuration: {
		allowedHosts: ReadonlySet<string>;
		limit: number;
		accept: string;
		signal: AbortSignal;
		fetch: FetchLike;
	}
): Promise<Buffer> {
	let url = checkedUrl(initialUrl, configuration.allowedHosts);
	for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
		const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
		const signal = AbortSignal.any([configuration.signal, timeout]);
		const response = await configuration.fetch(url, {
			method: 'GET',
			redirect: 'manual',
			signal,
			headers: {
				Accept: configuration.accept,
				'User-Agent': `create-saas-starter/${CLI_VERSION}`
			}
		});
		if ([301, 302, 303, 307, 308].includes(response.status)) {
			if (redirect === MAX_REDIRECTS)
				throw new Error('Template request exceeded its redirect limit.');
			const location = response.headers.get('location');
			if (!location) throw new Error('Template redirect omitted its destination.');
			await response.body?.cancel();
			url = checkedUrl(new URL(location, url), configuration.allowedHosts);
			continue;
		}
		if (!response.ok) throw new Error(`Template request failed with HTTP ${response.status}.`);
		return await responseBytes(response, configuration.limit, signal);
	}
	throw new Error('Template request exceeded its redirect limit.');
}

export async function resolveTemplateRef(
	ref: string | undefined,
	signal: AbortSignal,
	fetcher: FetchLike = globalThis.fetch
): Promise<ResolvedTemplate> {
	if (ref === undefined) return { ref: DEFAULT_TEMPLATE_SHA, sha: DEFAULT_TEMPLATE_SHA };
	const url = new URL(`/repos/${SOURCE_PATH}/commits/${encodeURIComponent(ref)}`, API_ORIGIN);
	const bytes = await fixedHostRequest(url, {
		allowedHosts: new Set(['api.github.com']),
		limit: MAX_API_BYTES,
		accept: 'application/vnd.github+json',
		signal,
		fetch: fetcher
	});
	let value: unknown;
	try {
		value = JSON.parse(bytes.toString('utf8'));
	} catch {
		throw new Error('GitHub returned invalid revision metadata.');
	}
	const sha = (value as { sha?: unknown } | null)?.sha;
	if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) {
		throw new Error('GitHub did not return a full commit SHA.');
	}
	return { ref, sha };
}

export async function downloadTemplateArchive(
	sha: string,
	signal: AbortSignal,
	fetcher: FetchLike = globalThis.fetch
): Promise<Buffer> {
	if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('Archive download requires a full commit SHA.');
	const url = new URL(`/${SOURCE_PATH}/tar.gz/${sha}`, ARCHIVE_ORIGIN);
	return await fixedHostRequest(url, {
		allowedHosts: new Set(['codeload.github.com']),
		limit: MAX_ARCHIVE_BYTES,
		accept: 'application/gzip',
		signal,
		fetch: fetcher
	});
}
