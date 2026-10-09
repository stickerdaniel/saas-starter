import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ValidatorJSON } from 'convex/values';

vi.mock('../auth', () => ({
	authComponent: {
		getAuthUser: vi.fn().mockResolvedValue({ _id: 'reader' }),
		safeGetAuthUser: vi.fn()
	}
}));

vi.mock('../autumn', () => ({
	checkAndCountUsage: vi.fn()
}));

import { checkAndCountUsage } from '../autumn';
import { enforceAndTrackMessageUsage, list, markMessageSettled, removeMessage } from '../messages';
import { createJourneyStore } from '../admin/journey/journeyStore.fixtures';

type Registered = { _handler: (ctx: never, args: never) => Promise<unknown> };

const checkAndCountUsageMock = checkAndCountUsage as unknown as ReturnType<typeof vi.fn>;
const START = Date.UTC(2026, 9, 8, 12);

function setup() {
	const store = createJourneyStore({
		users: ['owner'],
		functions: {
			'messages:removeMessage': removeMessage as unknown as Registered,
			'messages:markMessageSettled': markMessageSettled as unknown as Registered
		}
	});
	const messageId = store.insert('messages', { userId: 'owner', body: 'hello' });
	const enforce = (outcome: string) => {
		checkAndCountUsageMock.mockResolvedValue(outcome);
		return (enforceAndTrackMessageUsage as unknown as Registered)._handler(
			store.actionCtx() as never,
			{ userId: 'owner', messageId } as never
		);
	};
	const settle = () => store.mutate(markMessageSettled as unknown as Registered, { messageId });
	const marker = () =>
		store.docs('journeyCaptureStarts').filter((row) => row.source === 'community');
	return { store, messageId, enforce, settle, marker };
}

/**
 * Whether `value` passes a Convex validator, objects exact as on the server:
 * a field the validator does not name is a failure.
 */
function conforms(validator: ValidatorJSON, value: unknown): boolean {
	switch (validator.type) {
		case 'string':
		case 'id':
			return typeof value === 'string';
		case 'number':
			return typeof value === 'number';
		case 'array':
			return Array.isArray(value) && value.every((item) => conforms(validator.value, item));
		case 'object': {
			if (typeof value !== 'object' || value === null) return false;
			const record = value as Record<string, unknown>;
			const fields = validator.value;
			return (
				Object.keys(record).every((key) => key in fields || record[key] === undefined) &&
				Object.entries(fields).every(([key, field]) =>
					record[key] === undefined ? field.optional : conforms(field.fieldType, record[key])
				)
			);
		}
		default:
			throw new Error(`Validator type ${validator.type} is not modelled`);
	}
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(START);
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe('community message settlement', () => {
	it.each(['counted', 'unavailable'])('keeps and settles a %s message', async (outcome) => {
		const { store, enforce, marker } = setup();

		await enforce(outcome);

		expect(store.docs('messages')).toEqual([
			expect.objectContaining({ body: 'hello', quotaSettledAt: START })
		]);
		expect(marker()).toEqual([expect.objectContaining({ startedAt: START })]);
	});

	it('deletes a denied message and records nothing', async () => {
		const { store, enforce, marker } = setup();

		await enforce('denied');

		expect(store.docs('messages')).toEqual([]);
		expect(marker()).toEqual([]);
	});

	it('leaves a settled message as it was when settled again', async () => {
		const { store, settle } = setup();

		await settle();
		vi.setSystemTime(START + 60_000);
		await settle();

		expect(store.docs('messages')[0]?.quotaSettledAt).toBe(START);
	});

	it('does nothing for a message that is already gone', async () => {
		const { store, messageId, settle, marker } = setup();
		await store.mutate(removeMessage as unknown as Registered, { messageId });

		await expect(settle()).resolves.toBeNull();

		expect(marker()).toEqual([]);
	});

	it('writes nothing once the owner has been deleted', async () => {
		const { store, settle, marker } = setup();
		store.deleteUser('owner');

		await settle();

		expect(store.docs('messages')[0]?.quotaSettledAt).toBeUndefined();
		expect(marker()).toEqual([]);
	});
});

describe('messages.list', () => {
	it('returns the public shape for unsettled and settled messages', async () => {
		const { store, settle } = setup();
		store.insert('messages', { userId: 'owner', body: 'later, never settled' });
		await settle();

		const result = await store.mutate((ctx) =>
			(list as unknown as Registered)._handler(ctx as never, {} as never)
		);

		const returns = JSON.parse((list as unknown as { exportReturns(): string }).exportReturns());
		expect(conforms(returns as ValidatorJSON, result)).toBe(true);
		expect(result).toEqual([
			expect.objectContaining({ body: 'hello', author: 'Name of owner' }),
			expect.objectContaining({ body: 'later, never settled', author: 'Name of owner' })
		]);
	});
});
