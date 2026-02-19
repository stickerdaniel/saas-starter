import type { ResourceRuntime } from '$lib/admin/types';
import { toast } from 'svelte-sonner';

export const DEFAULT_CHUNK_SIZE = 50;

export type AdminActionResponse =
	| { type: 'message'; text: string }
	| { type: 'danger'; text: string }
	| { type: 'download'; url: string; filename: string }
	| { type: 'redirect'; url: string }
	| { type: 'modal'; title: string; description: string }
	| { type: 'event'; name: string; payload?: Record<string, unknown> };

export type ChunkProgress = {
	currentChunk: number;
	totalChunks: number;
	processedIds: number;
	totalIds: number;
	failedChunks: number;
};

export type ChunkedActionResult = {
	responses: AdminActionResponse[];
	failedChunks: Array<{ chunkIndex: number; error: unknown }>;
	cancelled: boolean;
	totalProcessed: number;
	totalFailed: number;
};

export type ChunkedMutationResult = {
	succeeded: number;
	failed: number;
	cancelled: boolean;
};

type ConvexClientLike = {
	mutation: (...args: any[]) => Promise<unknown>;
};

type NavigateTo = (url: string) => Promise<void>;

export function chunkArray<T>(array: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += size) {
		chunks.push(array.slice(i, i + size));
	}
	return chunks;
}

export async function handleActionResponse(
	response: AdminActionResponse,
	navigateTo: NavigateTo,
	t?: (key: string) => string
): Promise<void> {
	const translate = (text: string) => (t ? t(text) : text);
	if (response.type === 'danger') {
		toast.error(translate(response.text));
		return;
	}
	if (response.type === 'message') {
		toast.success(translate(response.text));
		return;
	}
	if (response.type === 'download') {
		const anchor = document.createElement('a');
		anchor.href = response.url;
		anchor.download = response.filename;
		anchor.click();
		return;
	}
	if (response.type === 'redirect') {
		await navigateTo(response.url);
		return;
	}
	if (response.type === 'modal') {
		toast.message(response.title, { description: response.description });
		return;
	}
	if (response.type === 'event') {
		window.dispatchEvent(new CustomEvent(response.name, { detail: response.payload }));
	}
}

export async function executeResourceAction({
	client,
	runtime,
	action,
	ids,
	values,
	navigateTo,
	t
}: {
	client: ConvexClientLike;
	runtime: ResourceRuntime;
	action: string;
	ids: string[];
	values: Record<string, unknown>;
	navigateTo: NavigateTo;
	t?: (key: string) => string;
}): Promise<AdminActionResponse> {
	const response = (await client.mutation(runtime.runAction, {
		action,
		ids,
		values
	} as never)) as AdminActionResponse;

	await handleActionResponse(response, navigateTo, t);
	return response;
}

export async function executeChunkedResourceAction({
	client,
	runtime,
	action,
	ids,
	values,
	navigateTo,
	t,
	chunkSize = DEFAULT_CHUNK_SIZE,
	onProgress,
	shouldCancel
}: {
	client: ConvexClientLike;
	runtime: ResourceRuntime;
	action: string;
	ids: string[];
	values: Record<string, unknown>;
	navigateTo: NavigateTo;
	t?: (key: string) => string;
	chunkSize?: number;
	onProgress?: (progress: ChunkProgress) => void;
	shouldCancel?: () => boolean;
}): Promise<ChunkedActionResult> {
	if (ids.length <= chunkSize) {
		try {
			const response = await executeResourceAction({
				client,
				runtime,
				action,
				ids,
				values,
				navigateTo,
				t
			});
			return {
				responses: [response],
				failedChunks: [],
				cancelled: false,
				totalProcessed: ids.length,
				totalFailed: response.type === 'danger' ? ids.length : 0
			};
		} catch (error) {
			return {
				responses: [],
				failedChunks: [{ chunkIndex: 0, error }],
				cancelled: false,
				totalProcessed: 0,
				totalFailed: ids.length
			};
		}
	}

	const chunks = chunkArray(ids, chunkSize);
	const responses: AdminActionResponse[] = [];
	const failedChunks: Array<{ chunkIndex: number; error: unknown }> = [];
	let processedIds = 0;

	for (let i = 0; i < chunks.length; i++) {
		if (shouldCancel?.()) {
			return {
				responses,
				failedChunks,
				cancelled: true,
				totalProcessed: processedIds,
				totalFailed: failedChunks.reduce((sum, fc) => sum + (chunks[fc.chunkIndex]?.length ?? 0), 0)
			};
		}

		onProgress?.({
			currentChunk: i + 1,
			totalChunks: chunks.length,
			processedIds,
			totalIds: ids.length,
			failedChunks: failedChunks.length
		});

		try {
			const response = (await client.mutation(runtime.runAction, {
				action,
				ids: chunks[i],
				values
			} as never)) as AdminActionResponse;
			responses.push(response);
			processedIds += chunks[i].length;
		} catch (error) {
			failedChunks.push({ chunkIndex: i, error });
			processedIds += chunks[i].length;
		}
	}

	// Handle the last successful response for toast/redirect
	const lastSuccess = [...responses].reverse().find((r) => r.type !== 'danger');
	if (lastSuccess) {
		await handleActionResponse(lastSuccess, navigateTo, t);
	}

	return {
		responses,
		failedChunks,
		cancelled: false,
		totalProcessed: processedIds,
		totalFailed: failedChunks.reduce((sum, fc) => sum + (chunks[fc.chunkIndex]?.length ?? 0), 0)
	};
}

export async function executeChunkedMutations({
	ids,
	chunkSize = DEFAULT_CHUNK_SIZE,
	executeMutation,
	onProgress,
	shouldCancel
}: {
	ids: string[];
	chunkSize?: number;
	executeMutation: (id: string) => Promise<unknown>;
	onProgress?: (progress: ChunkProgress) => void;
	shouldCancel?: () => boolean;
}): Promise<ChunkedMutationResult> {
	if (ids.length <= chunkSize) {
		const results = await Promise.allSettled(ids.map((id) => executeMutation(id)));
		const failed = results.filter((r) => r.status === 'rejected').length;
		return { succeeded: ids.length - failed, failed, cancelled: false };
	}

	const chunks = chunkArray(ids, chunkSize);
	let succeeded = 0;
	let failed = 0;

	for (let i = 0; i < chunks.length; i++) {
		if (shouldCancel?.()) {
			return { succeeded, failed, cancelled: true };
		}

		onProgress?.({
			currentChunk: i + 1,
			totalChunks: chunks.length,
			processedIds: succeeded + failed,
			totalIds: ids.length,
			failedChunks: failed
		});

		const results = await Promise.allSettled(chunks[i].map((id) => executeMutation(id)));
		const chunkFailed = results.filter((r) => r.status === 'rejected').length;
		succeeded += chunks[i].length - chunkFailed;
		failed += chunkFailed;
	}

	return { succeeded, failed, cancelled: false };
}
