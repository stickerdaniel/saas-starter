import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFunctionAddress } from 'convex/server';
import { storeFile } from '@convex-dev/agent';
import type * as AgentModule from '@convex-dev/agent';
import type { ActionCtx } from '../_generated/server';
import { saveUploadedFile as saveSupportFile } from '../support/files';
import { saveUploadedFile as saveChatFile } from '../aiChat/files';

vi.mock('@convex-dev/agent', async (original) => ({
	...(await original<typeof AgentModule>()),
	storeFile: vi.fn()
}));

afterEach(() => vi.restoreAllMocks());

type UploadArgs = {
	storageId: string;
	uploadToken: string;
	mimeType: string;
	width?: number;
	height?: number;
};
type SaveHandler = { _handler: (ctx: ActionCtx, args: UploadArgs) => Promise<unknown> };

describe.each([
	['support', saveSupportFile],
	['AI chat', saveChatFile]
])('%s upload staging', (_name, fn) => {
	const save = (fn as unknown as SaveHandler)._handler;
	const args: UploadArgs = {
		storageId: 'staging-id',
		uploadToken: 'token',
		mimeType: 'text/plain'
	};

	function fixture(failure?: 'fetch' | 'store' | 'metadata' | 'cleanup' | 'invalid') {
		// Shapes come from files-control 0.5.8 and Agent 0.7.1, exercised on the local backend.
		const staging = new Map<string, number | null>();
		const agentFiles = new Map<string, string>();
		const error = new Error('Processing failed');
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
			if (failure === 'fetch') throw error;
			return new Response('content', {
				headers: { 'Content-Type': failure === 'invalid' ? 'application/x-unknown' : 'image/png' }
			});
		});
		vi.mocked(storeFile).mockImplementation(async () => {
			if (failure === 'store') throw error;
			agentFiles.set('agent-storage-id', 'content');
			return {
				file: {
					fileId: 'file-id',
					storageId: 'agent-storage-id',
					url: 'https://file.test',
					hash: 'hash'
				}
			} as Awaited<ReturnType<typeof storeFile>>;
		});
		const ctx = {
			runMutation: async (
				ref: Parameters<ActionCtx['runMutation']>[0],
				input: Record<string, unknown>
			) => {
				const address = JSON.stringify(getFunctionAddress(ref));
				if (address.includes('finalizeUpload'))
					staging.set(String(input.storageId), input.expiresAt as number | null);
				if (address.includes('createDownloadGrant')) return { downloadToken: 'download-token' };
				if (address.includes('consumeDownloadGrantForUrl'))
					return { status: 'ok', downloadUrl: 'https://staging.test' };
				if (address.includes('storeFileMetadata') && failure === 'metadata') throw error;
				if (address.includes('deleteFile')) {
					if (failure === 'cleanup') throw new Error('Cleanup failed');
					staging.delete(String(input.storageId));
				}
				return null;
			}
		} as unknown as ActionCtx;
		return { ctx, staging, agentFiles, error };
	}

	it('releases staging and preserves the promoted file', async () => {
		const { ctx, staging, agentFiles } = fixture();
		await expect(save(ctx, args)).resolves.toMatchObject({ storageId: 'agent-storage-id' });
		expect(staging.size, 'Accepted uploads must release their staging copy').toBe(0);
		expect(agentFiles.get('agent-storage-id')).toBe('content');
	});

	it.each(['fetch', 'store', 'metadata'] as const)(
		'releases staging after %s failure and preserves the error',
		async (failure) => {
			const { ctx, staging, error } = fixture(failure);
			await expect(save(ctx, { ...args, width: 10, height: 10 })).rejects.toBe(error);
			expect(staging.size).toBe(0);
		}
	);

	it('releases rejected uploads', async () => {
		const { ctx, staging } = fixture('invalid');
		await expect(save(ctx, args)).rejects.toThrow();
		expect(staging.size).toBe(0);
	});

	it('keeps an accepted result with finite expiry when cleanup fails', async () => {
		const { ctx, staging } = fixture('cleanup');
		const started = Date.now();
		await expect(save(ctx, args)).resolves.toMatchObject({ storageId: 'agent-storage-id' });
		expect(staging.get('staging-id')).toBeGreaterThan(started);
		expect(staging.get('staging-id')).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000);
	});
});
