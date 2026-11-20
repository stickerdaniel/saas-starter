// patches/convex-vite-plugin@0.4.0.patch moves the local backend download off
// the anonymous github.com release link, which answered 503 and 504 for hours on
// 2026-11-08 (upstream: juliusmarminge/agent-tools#31). These tests drive the
// installed plugin through its public ConvexBackend.spawn() with a stubbed fetch
// and a temporary binaryCacheDir, so they fail when the patch does not apply.

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConvexBackend } from 'convex-vite-plugin/lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testExecutable } from './test-executable';

const originalFetch = globalThis.fetch;
const originalGithubToken = process.env.GITHUB_TOKEN;
const tempRoots: string[] = [];

const releasesUrl = 'https://api.github.com/repos/get-convex/convex-backend/releases?per_page=50';
const pinnedReleaseUrl =
	'https://api.github.com/repos/get-convex/convex-backend/releases/tags/precompiled-test';
const assetApiUrl = 'https://api.github.com/repos/get-convex/convex-backend/releases/assets/1';
const browserDownloadUrl =
	'https://github.com/get-convex/convex-backend/releases/download/backend.zip';
const version = 'precompiled-test';
const executableSuffix = process.platform === 'win32' ? '.exe' : '';

function temporaryRoot(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'convex-vite-download-'));
	tempRoots.push(root);
	return root;
}

function platformAsset(): string {
	const arch =
		process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : process.arch;
	if (process.platform === 'darwin') return `convex-local-backend-${arch}-apple-darwin.zip`;
	if (process.platform === 'linux') return `convex-local-backend-${arch}-unknown-linux-gnu.zip`;
	return `convex-local-backend-${arch}-pc-windows-msvc.zip`;
}

function release(digest: string | null) {
	return {
		tag_name: version,
		assets: [
			{
				name: platformAsset(),
				url: assetApiUrl,
				browser_download_url: browserDownloadUrl,
				digest
			}
		]
	};
}

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

// The release listing as GitHub's REST API returns it, newest first.
function releasesResponse(digest: string | null = null): Response {
	return jsonResponse([release(digest)]);
}

function sha256(bytes: Uint8Array): string {
	return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function cacheEntries(root: string): string[] {
	const cache = path.join(root, 'cache');
	return fs.existsSync(cache) ? fs.readdirSync(cache) : [];
}

function zipWithFile(root: string, name: string, contents: string): Uint8Array<ArrayBuffer> {
	const source = path.join(root, `archive-source-${randomUUID()}`);
	fs.mkdirSync(source);
	const file = path.join(source, name);
	fs.writeFileSync(file, contents, { mode: 0o755 });
	const zip = path.join(root, `backend-${randomUUID()}.zip`);
	expect(spawnSync('zip', ['-q', '-j', zip, file]).status).toBe(0);
	return new Uint8Array(fs.readFileSync(zip));
}

function executableZip(root: string): Uint8Array<ArrayBuffer> {
	return zipWithFile(root, `convex-local-backend${executableSuffix}`, '#!/bin/sh\nexit 0\n');
}

/** Acquires the binary through the installed plugin; the stub binary exits at once. */
async function acquire(
	root: string,
	fetchImpl: typeof fetch,
	binaryVersion?: string
): Promise<string> {
	globalThis.fetch = fetchImpl;
	const backend = new ConvexBackend(
		{
			binaryCacheDir: path.join(root, 'cache'),
			binaryVersion,
			projectDir: root,
			stdio: 'ignore',
			instanceName: 'test-instance',
			instanceSecret: 'test-secret',
			adminKey: 'test-admin-key'
		},
		'silent'
	);
	const stateDir = path.join(root, 'state');
	fs.mkdirSync(stateDir, { recursive: true });
	await backend.spawn(stateDir);
	backend.process?.kill();
	return path.join(root, 'cache', `convex-local-backend-${version}${executableSuffix}`);
}

function immediateTimeouts() {
	return vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void) => {
		queueMicrotask(callback);
		return 0 as unknown as ReturnType<typeof setTimeout>;
	}) as typeof setTimeout);
}

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalGithubToken === undefined) delete process.env.GITHUB_TOKEN;
	else process.env.GITHUB_TOKEN = originalGithubToken;
	vi.restoreAllMocks();
	for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

// The fixture backend is a shell script packed with the zip CLI, and spawn()
// executes it, so these cases need a Unix host.
describe.skipIf(process.platform === 'win32')('convex-vite-plugin binary download', () => {
	it('downloads the asset through the release API with the token', async () => {
		process.env.GITHUB_TOKEN = 'test-token';
		const root = temporaryRoot();
		const archive = executableZip(root);
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			requests.push({ url: String(input), init });
			return requests.length === 1 ? releasesResponse() : new Response(archive, { status: 200 });
		});
		const binaryPath = await acquire(root, fetchImpl);
		expect(fs.statSync(binaryPath).mode & 0o111).not.toBe(0);
		expect(requests.map((request) => request.url)).toEqual([releasesUrl, assetApiUrl]);
		const assetRequest = requests[1]!.init;
		const headers = new Headers(assetRequest?.headers);
		expect(headers.get('accept')).toBe('application/octet-stream');
		expect(headers.get('authorization')).toBe('Bearer test-token');
		expect(assetRequest?.redirect).toBe('follow');
	});

	it('falls back to the browser link without the token once the API rate limit is spent', async () => {
		process.env.GITHUB_TOKEN = 'test-token';
		const root = temporaryRoot();
		const archive = executableZip(root);
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			requests.push({ url, init });
			if (url === assetApiUrl) {
				return new Response('rate limited', {
					status: 403,
					headers: { 'x-ratelimit-remaining': '0' }
				});
			}
			if (url === browserDownloadUrl) return new Response(archive, { status: 200 });
			return releasesResponse(sha256(archive));
		});
		const binaryPath = await acquire(root, fetchImpl);
		expect(fs.existsSync(binaryPath)).toBe(true);
		expect(requests.map((request) => request.url).slice(1)).toEqual([
			assetApiUrl,
			browserDownloadUrl
		]);
		expect(new Headers(requests[2]!.init?.headers).has('authorization')).toBe(false);
	});

	it('fails fast for a 403 asset response with rate limit left', async () => {
		const root = temporaryRoot();
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(releasesResponse())
			.mockResolvedValueOnce(
				new Response('forbidden', {
					status: 403,
					statusText: 'Forbidden',
					headers: { 'x-ratelimit-remaining': '42' }
				})
			);
		await expect(acquire(root, fetchImpl)).rejects.toThrow('403 Forbidden');
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('publishes an archive whose digest matches the release', async () => {
		const root = temporaryRoot();
		const archive = executableZip(root);
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(releasesResponse(sha256(archive)))
			.mockResolvedValueOnce(new Response(archive, { status: 200 }));
		expect(fs.existsSync(await acquire(root, fetchImpl))).toBe(true);
	});

	it('accepts a valid archive when the release has no digest', async () => {
		const root = temporaryRoot();
		const archive = executableZip(root);
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(releasesResponse(null))
			.mockResolvedValueOnce(new Response(archive, { status: 200 }));
		expect(fs.existsSync(await acquire(root, fetchImpl))).toBe(true);
	});

	it('rejects a valid archive whose digest differs and publishes nothing', async () => {
		immediateTimeouts();
		const root = temporaryRoot();
		const archive = executableZip(root);
		const otherDigest = sha256(new TextEncoder().encode('another archive'));
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(releasesResponse(otherDigest))
			.mockImplementation(async () => new Response(archive, { status: 200 }));
		await expect(acquire(root, fetchImpl)).rejects.toThrow('digest');
		expect(fetchImpl).toHaveBeenCalledTimes(4);
		expect(cacheEntries(root)).toEqual([]);
	});

	it('retries release listing failures with 1s and 2s backoff', async () => {
		const timeouts = immediateTimeouts();
		const root = temporaryRoot();
		const archive = executableZip(root);
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockRejectedValueOnce(new TypeError('listing reset'))
			.mockResolvedValueOnce(new Response('busy', { status: 502 }))
			.mockResolvedValueOnce(releasesResponse())
			.mockResolvedValueOnce(new Response(archive, { status: 200 }));
		expect(fs.existsSync(await acquire(root, fetchImpl))).toBe(true);
		expect(fetchImpl).toHaveBeenCalledTimes(4);
		expect(timeouts.mock.calls.map((call) => call[1])).toEqual([1_000, 2_000]);
	});

	it('retries a release listing body that fails mid-read', async () => {
		immediateTimeouts();
		const root = temporaryRoot();
		const archive = executableZip(root);
		const brokenBody = new ReadableStream({
			start(controller) {
				controller.error(new TypeError('listing body reset'));
			}
		});
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response(brokenBody, { status: 200 }))
			.mockResolvedValueOnce(releasesResponse())
			.mockResolvedValueOnce(new Response(archive, { status: 200 }));
		expect(fs.existsSync(await acquire(root, fetchImpl))).toBe(true);
		expect(fetchImpl).toHaveBeenCalledTimes(3);
	});

	it('retries transient asset failures and publishes the binary', async () => {
		immediateTimeouts();
		const root = temporaryRoot();
		const archive = executableZip(root);
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(releasesResponse())
			.mockRejectedValueOnce(new TypeError('asset reset'))
			.mockResolvedValueOnce(new Response('busy', { status: 504 }))
			.mockResolvedValueOnce(new Response(archive, { status: 200 }));
		const binaryPath = await acquire(root, fetchImpl);
		expect(fetchImpl).toHaveBeenCalledTimes(4);
		expect(cacheEntries(root)).toEqual([path.basename(binaryPath)]);
	});

	it('reads a pinned version by its release tag', async () => {
		const root = temporaryRoot();
		const archive = executableZip(root);
		const requests: string[] = [];
		const fetchImpl = vi.fn(async (input: string | URL | Request) => {
			requests.push(String(input));
			return requests.length === 1 ? jsonResponse(release(sha256(archive))) : new Response(archive);
		});
		expect(fs.existsSync(await acquire(root, fetchImpl, version))).toBe(true);
		expect(requests).toEqual([pinnedReleaseUrl, assetApiUrl]);
	});

	it('refuses a pinned version whose release publishes no digest', async () => {
		const root = temporaryRoot();
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(release(null)));
		await expect(acquire(root, fetchImpl, version)).rejects.toThrow(
			`Convex backend ${version} publishes no SHA-256 digest`
		);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(cacheEntries(root)).toEqual([]);
	});

	describe.skipIf(process.getuid?.() === 0)('when another process publishes first', () => {
		const originalPath = process.env.PATH;

		afterEach(() => {
			process.env.PATH = originalPath;
			for (const root of tempRoots) {
				const cache = path.join(root, 'cache');
				if (fs.existsSync(cache)) fs.chmodSync(cache, 0o755);
			}
		});

		function publishDuringExtraction(root: string, contents: string): void {
			const published = path.join(root, 'published');
			fs.writeFileSync(published, contents, { mode: 0o755 });
			const bin = path.join(root, 'bin');
			fs.mkdirSync(bin);
			const target = path.join(root, 'cache', `convex-local-backend-${version}${executableSuffix}`);
			fs.writeFileSync(
				path.join(bin, 'unzip'),
				[
					'#!/bin/sh',
					`${JSON.stringify(testExecutable('unzip'))} "$@" || exit 1`,
					`cp ${JSON.stringify(published)} ${JSON.stringify(target)}`,
					`chmod 555 ${JSON.stringify(path.dirname(target))}`
				].join('\n'),
				{ mode: 0o755 }
			);
			process.env.PATH = `${bin}${path.delimiter}${originalPath}`;
		}

		function pinnedFetch(archive: Uint8Array<ArrayBuffer>) {
			return vi
				.fn<typeof fetch>()
				.mockResolvedValueOnce(jsonResponse(release(sha256(archive))))
				.mockResolvedValueOnce(new Response(archive, { status: 200 }));
		}

		it('refuses a published binary that differs from the verified archive', async () => {
			const root = temporaryRoot();
			const archive = executableZip(root);
			publishDuringExtraction(root, '#!/bin/sh\nexit 1\n');
			await expect(acquire(root, pinnedFetch(archive), version)).rejects.toThrow(
				'differs from the verified'
			);
		});

		it('accepts a published binary with the verified bytes', async () => {
			const root = temporaryRoot();
			const archive = executableZip(root);
			publishDuringExtraction(root, '#!/bin/sh\nexit 0\n');
			expect(fs.existsSync(await acquire(root, pinnedFetch(archive), version))).toBe(true);
		});
	});

	it('starts a cached pinned version without contacting GitHub', async () => {
		const root = temporaryRoot();
		const cached = path.join(root, 'cache', `convex-local-backend-${version}${executableSuffix}`);
		fs.mkdirSync(path.dirname(cached), { recursive: true });
		fs.writeFileSync(cached, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
		const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
		expect(await acquire(root, fetchImpl, version)).toBe(cached);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('leaves no binary or temporary files after exhausted failures', async () => {
		immediateTimeouts();
		const root = temporaryRoot();
		const incompleteArchive = zipWithFile(root, 'wrong-file', 'incomplete');
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(releasesResponse())
			.mockResolvedValueOnce(new Response('not a zip', { status: 200 }))
			.mockResolvedValueOnce(new Response(incompleteArchive, { status: 200 }))
			.mockResolvedValueOnce(new Response('busy', { status: 503 }));
		await expect(acquire(root, fetchImpl)).rejects.toThrow('503');
		expect(fetchImpl).toHaveBeenCalledTimes(4);
		expect(cacheEntries(root)).toEqual([]);
	});
});
