import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TEMPLATE_SHA } from '../src/options.js';
import { downloadTemplateArchive, resolveTemplateRef, type FetchLike } from '../src/template.js';

const signal = () => new AbortController().signal;

describe('template HTTP client', () => {
	it('uses the pinned SHA without a ref-resolution request', async () => {
		const fetcher = vi.fn<FetchLike>();
		await expect(resolveTemplateRef(undefined, signal(), fetcher)).resolves.toEqual({
			ref: DEFAULT_TEMPLATE_SHA,
			sha: DEFAULT_TEMPLATE_SHA
		});
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('resolves one user ref through the credential-free GitHub API', async () => {
		const sha = 'a'.repeat(40);
		const fetcher = vi.fn<FetchLike>(async (input, init) => {
			const url = new URL(String(input));
			const headers = new Headers(init?.headers);
			expect(url.href).toBe(
				'https://api.github.com/repos/stickerdaniel/saas-starter/commits/release%2Fv1'
			);
			expect(init?.redirect).toBe('manual');
			expect(headers.has('authorization')).toBe(false);
			return Response.json({ sha });
		});

		await expect(resolveTemplateRef('release/v1', signal(), fetcher)).resolves.toEqual({
			ref: 'release/v1',
			sha
		});
		expect(fetcher).toHaveBeenCalledOnce();
	});

	it('downloads only a full SHA from codeload', async () => {
		const sha = 'b'.repeat(40);
		const fetcher = vi.fn<FetchLike>(async (input, init) => {
			expect(String(input)).toBe(
				`https://codeload.github.com/stickerdaniel/saas-starter/tar.gz/${sha}`
			);
			expect(new Headers(init?.headers).has('authorization')).toBe(false);
			return new Response(Buffer.from('archive'));
		});
		await expect(downloadTemplateArchive(sha, signal(), fetcher)).resolves.toEqual(
			Buffer.from('archive')
		);
		await expect(downloadTemplateArchive('main', signal(), fetcher)).rejects.toThrow(
			'full commit SHA'
		);
	});

	it('rejects redirect hosts, redirect loops, HTTP failures, and malformed metadata', async () => {
		await expect(
			resolveTemplateRef(
				'main',
				signal(),
				async () =>
					new Response(null, {
						status: 302,
						headers: { location: 'https://example.com/steal' }
					})
			)
		).rejects.toThrow('unexpected host');
		await expect(
			resolveTemplateRef(
				'main',
				signal(),
				async () => new Response(null, { status: 302, headers: { location: '/again' } })
			)
		).rejects.toThrow('redirect limit');
		await expect(
			resolveTemplateRef('main', signal(), async () => new Response('no', { status: 503 }))
		).rejects.toThrow('HTTP 503');
		await expect(
			resolveTemplateRef('main', signal(), async () => Response.json({ sha: 'short' }))
		).rejects.toThrow('full commit SHA');
	});

	it('stops oversized responses and honors abort signals', async () => {
		await expect(
			resolveTemplateRef('main', signal(), async () => new Response(Buffer.alloc(1024 * 1024 + 1)))
		).rejects.toThrow('exceeded');
		const controller = new AbortController();
		controller.abort(new Error('test abort'));
		const fetcher: FetchLike = async (_input, init) => {
			if (init?.signal?.aborted) throw init.signal.reason;
			return Response.json({ sha: 'a'.repeat(40) });
		};
		await expect(resolveTemplateRef('main', controller.signal, fetcher)).rejects.toThrow(
			'test abort'
		);
	});
});
