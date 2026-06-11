import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../_generated/api', () => ({
	components: {
		agent: {
			files: {
				getFilesToDelete: 'components.agent.files.getFilesToDelete',
				deleteFiles: 'components.agent.files.deleteFiles'
			}
		}
	},
	internal: {
		files: {
			vacuum: {
				deleteUnusedFiles: 'internal.files.vacuum.deleteUnusedFiles'
			}
		}
	}
}));

import { deleteUnusedFiles } from '../vacuum';

type MutationHandler<TArgs, TResult> = {
	_handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const deleteUnusedFilesHandler = deleteUnusedFiles as unknown as MutationHandler<
	{ cursor?: string },
	void
>;

const DAY_MS = 1000 * 60 * 60 * 24;

type MetadataRow = { _id: string; storageId: string };

function createCtx(options: {
	page: Array<{ _id: string; storageId: string; lastTouchedAt: number }>;
	isDone?: boolean;
	metadataRows?: MetadataRow[];
}) {
	const metadataRows = options.metadataRows ?? [];
	const deletedMetadataIds: string[] = [];

	const ctx = {
		runQuery: vi.fn().mockResolvedValue({
			page: options.page,
			isDone: options.isDone ?? true,
			continueCursor: 'cursor_1'
		}),
		runMutation: vi.fn().mockResolvedValue(undefined),
		storage: { delete: vi.fn().mockResolvedValue(undefined) },
		scheduler: { runAfter: vi.fn().mockResolvedValue(undefined) },
		db: {
			query: vi.fn(() => ({
				withIndex: vi.fn(
					(
						_name: string,
						cb: (q: { eq: (field: string, value: string) => unknown }) => unknown
					) => {
						let requestedStorageId = '';
						cb({
							eq: (_field, value) => {
								requestedStorageId = value;
								return {};
							}
						});
						return {
							collect: vi
								.fn()
								.mockResolvedValue(
									metadataRows.filter((row) => row.storageId === requestedStorageId)
								)
						};
					}
				)
			})),
			delete: vi.fn(async (id: string) => {
				deletedMetadataIds.push(id);
			})
		}
	};

	return { ctx, deletedMetadataIds };
}

describe('files vacuum', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('cascade-deletes fileMetadata rows for vacuumed files', async () => {
		const staleFile = {
			_id: 'agent_file_1',
			storageId: 'storage_1',
			lastTouchedAt: Date.now() - 2 * DAY_MS
		};
		const { ctx, deletedMetadataIds } = createCtx({
			page: [staleFile],
			metadataRows: [
				{ _id: 'meta_1', storageId: 'storage_1' },
				{ _id: 'meta_2', storageId: 'storage_1' },
				{ _id: 'meta_other', storageId: 'storage_other' }
			]
		});

		await deleteUnusedFilesHandler._handler(ctx, {});

		expect(ctx.storage.delete).toHaveBeenCalledWith('storage_1');
		expect(deletedMetadataIds).toEqual(['meta_1', 'meta_2']);
		expect(ctx.runMutation).toHaveBeenCalledWith('components.agent.files.deleteFiles', {
			fileIds: ['agent_file_1']
		});
	});

	it('keeps fileMetadata for recently touched files', async () => {
		const freshFile = {
			_id: 'agent_file_1',
			storageId: 'storage_1',
			lastTouchedAt: Date.now()
		};
		const { ctx, deletedMetadataIds } = createCtx({
			page: [freshFile],
			metadataRows: [{ _id: 'meta_1', storageId: 'storage_1' }]
		});

		await deleteUnusedFilesHandler._handler(ctx, {});

		expect(ctx.storage.delete).not.toHaveBeenCalled();
		expect(deletedMetadataIds).toEqual([]);
		expect(ctx.runMutation).toHaveBeenCalledWith('components.agent.files.deleteFiles', {
			fileIds: []
		});
	});

	it('schedules a continuation when pagination is not done', async () => {
		const { ctx } = createCtx({ page: [], isDone: false });

		await deleteUnusedFilesHandler._handler(ctx, {});

		expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
			0,
			'internal.files.vacuum.deleteUnusedFiles',
			{ cursor: 'cursor_1' }
		);
	});
});
