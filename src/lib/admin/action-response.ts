import type { ResourceRuntime } from '$lib/admin/runtime';
import { toast } from 'svelte-sonner';

export type AdminActionResponse =
	| { type: 'message'; text: string }
	| { type: 'danger'; text: string }
	| { type: 'download'; url: string; filename: string }
	| { type: 'redirect'; url: string }
	| { type: 'modal'; title: string; description: string }
	| { type: 'event'; name: string; payload?: Record<string, unknown> };

type ConvexClientLike = {
	mutation: (...args: any[]) => Promise<unknown>;
};

type NavigateTo = (url: string) => Promise<void>;

export async function handleActionResponse(
	response: AdminActionResponse,
	navigateTo: NavigateTo
): Promise<void> {
	if (response.type === 'danger') {
		toast.error(response.text);
		return;
	}
	if (response.type === 'message') {
		toast.success(response.text);
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
	navigateTo
}: {
	client: ConvexClientLike;
	runtime: ResourceRuntime;
	action: string;
	ids: string[];
	values: Record<string, unknown>;
	navigateTo: NavigateTo;
}): Promise<AdminActionResponse> {
	const response = (await client.mutation(runtime.runAction, {
		action,
		ids,
		values
	} as never)) as AdminActionResponse;

	await handleActionResponse(response, navigateTo);
	return response;
}
