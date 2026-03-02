import { toast } from 'svelte-sonner';
import type { OptimisticLocalStore } from 'convex/browser';
import type { ResourceRuntime } from '$lib/admin/types';

type ConvexClientLike = {
	mutation: (...args: any[]) => Promise<unknown>;
};

export type ResourceActionDeps = {
	client: ConvexClientLike;
	runtime: ResourceRuntime;
	resourceName: string;
	t: (key: string) => string;
};

type MutationOptions = {
	optimisticUpdate?: (store: OptimisticLocalStore) => void;
};

/**
 * Creates reusable single-record CRUD action handlers for admin resources.
 *
 * Each handler wraps the mutation call in a try/catch with standardized
 * toast messages and console logging. Callers can provide optional
 * optimistic updates and post-success callbacks (e.g. navigation).
 */
export function createResourceActions(deps: ResourceActionDeps) {
	const { client, runtime, resourceName, t } = deps;

	async function softDelete(
		id: string,
		opts?: MutationOptions & { onSuccess?: () => Promise<void> | void }
	) {
		try {
			await client.mutation(
				runtime.delete,
				{ id } as never,
				opts?.optimisticUpdate ? { optimisticUpdate: opts.optimisticUpdate } : undefined
			);
			toast.success(t('admin.resources.toasts.deleted'));
			await opts?.onSuccess?.();
		} catch (error) {
			console.error(`[admin:${resourceName}] delete failed`, error);
			toast.error(t('admin.resources.toasts.action_error'));
		}
	}

	async function restore(
		id: string,
		opts?: MutationOptions & { onSuccess?: () => Promise<void> | void }
	) {
		try {
			await client.mutation(
				runtime.restore,
				{ id } as never,
				opts?.optimisticUpdate ? { optimisticUpdate: opts.optimisticUpdate } : undefined
			);
			toast.success(t('admin.resources.toasts.restored'));
			await opts?.onSuccess?.();
		} catch (error) {
			console.error(`[admin:${resourceName}] restore failed`, error);
			toast.error(t('admin.resources.toasts.action_error'));
		}
	}

	async function forceDelete(
		id: string,
		opts?: MutationOptions & { onSuccess?: () => Promise<void> | void }
	) {
		try {
			await client.mutation(
				runtime.forceDelete,
				{ id } as never,
				opts?.optimisticUpdate ? { optimisticUpdate: opts.optimisticUpdate } : undefined
			);
			toast.success(t('admin.resources.toasts.force_deleted'));
			await opts?.onSuccess?.();
		} catch (error) {
			console.error(`[admin:${resourceName}] force delete failed`, error);
			toast.error(t('admin.resources.toasts.action_error'));
		}
	}

	async function replicate(id: string, opts?: { onSuccess?: () => Promise<void> | void }) {
		try {
			await client.mutation(runtime.replicate, { id } as never);
			toast.success(t('admin.resources.toasts.replicated'));
			await opts?.onSuccess?.();
		} catch (error) {
			console.error(`[admin:${resourceName}] replicate failed`, error);
			toast.error(t('admin.resources.toasts.action_error'));
		}
	}

	return { softDelete, restore, forceDelete, replicate };
}
