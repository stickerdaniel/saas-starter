import { describe, expect, it, vi } from 'vitest';
import type { MutationCtx } from '../_generated/server';
import { components } from '../_generated/api';
import { cleanupExpiredFiles } from './cleanup';

const handler = (
	cleanupExpiredFiles as unknown as {
		_handler: (
			ctx: MutationCtx,
			args: { limit?: number }
		) => Promise<{ deletedCount: number; hasMore: boolean }>;
	}
)._handler;

describe('expired file cleanup', () => {
	it.each([false, true])(
		'leaves continuation ownership to the component (hasMore=%s)',
		async (hasMore) => {
			// files-control 0.5.8 schedules its own continuation before returning this result.
			// See src/component/cleanUp.ts in the pinned dependency.
			const result = { deletedCount: 10, hasMore };
			const runMutation = vi.fn().mockResolvedValue(result);
			const runAfter = vi.fn();
			const ctx = { runMutation, scheduler: { runAfter } } as unknown as MutationCtx;

			await expect(handler(ctx, { limit: 10 })).resolves.toEqual(result);
			expect(runMutation).toHaveBeenCalledExactlyOnceWith(
				components.convexFilesControl.cleanUp.cleanupExpired,
				{ limit: 10 }
			);
			expect(runAfter.mock.calls.length, 'The component must be the only cleanup scheduler').toBe(
				0
			);
		}
	);
});
