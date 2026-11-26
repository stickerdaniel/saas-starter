import { PUBLIC_CONVEX_SITE_URL } from '$app/env/public';
import { authClient } from '../auth-client.js';
import type { UploadPurpose } from '../confect/files/uploadRoute.js';
import { UploadError, uploadBlobWithProgress, type UploadProgressCallback } from './transfer.js';

export type UploadToEndpointOptions<T> = {
	purpose: UploadPurpose;
	blob: Blob;
	query?: Readonly<Record<string, string | number | undefined>>;
	anonymousUserId?: string;
	decode: (body: unknown) => T;
	onProgress: UploadProgressCallback;
	signal?: AbortSignal;
};

async function convexToken(): Promise<string | undefined> {
	const result = await authClient.convex.token().catch((cause: unknown) => {
		throw new UploadError('network', undefined, { cause });
	});
	return result.data?.token ?? undefined;
}

export async function uploadToEndpoint<T>(options: UploadToEndpointOptions<T>): Promise<T> {
	const { purpose, blob, query, anonymousUserId, decode, onProgress, signal } = options;
	const url = new URL(`/uploads/${purpose}`, PUBLIC_CONVEX_SITE_URL);
	for (const [name, value] of Object.entries(query ?? {})) {
		if (value !== undefined) url.searchParams.set(name, String(value));
	}
	const token = await convexToken();
	const headers: Record<string, string> = {};
	if (token) headers.Authorization = `Bearer ${token}`;
	if (anonymousUserId) headers['X-Anonymous-User-Id'] = anonymousUserId;
	return await uploadBlobWithProgress({ url: url.href, blob, headers, decode, onProgress, signal });
}
