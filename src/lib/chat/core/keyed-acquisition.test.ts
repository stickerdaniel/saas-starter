import { describe, expect, it } from 'vitest';
import { KeyedAcquisition } from './keyed-acquisition.ts';

type Key = { readonly scope: number };
const sameKey = (a: Key, b: Key) => a.scope === b.scope;

describe('KeyedAcquisition', () => {
	it('shares one start between distinct keys with equal values', async () => {
		const acquisition = new KeyedAcquisition<Key, string>(sameKey);
		let starts = 0;
		const start = () => Promise.resolve(`thread-${++starts}`);

		const first = acquisition.acquire({ scope: 1 }, start);
		expect(acquisition.current({ scope: 1 })).toBe(first);
		const second = acquisition.acquire({ scope: 1 }, start);

		expect(second).toBe(first);
		await expect(second).resolves.toBe('thread-1');
		expect(starts).toBe(1);
	});

	it('keeps a newer acquisition when an invalidated one settles', async () => {
		const acquisition = new KeyedAcquisition<Key, string>(sameKey);
		const stale = Promise.withResolvers<string>();
		const older = acquisition.acquire({ scope: 1 }, () => stale.promise);
		acquisition.invalidate();
		const newer = acquisition.acquire({ scope: 1 }, () => new Promise<string>(() => {}));

		stale.resolve('thread-old');
		await expect(older).resolves.toBe('thread-old');

		expect(acquisition.current({ scope: 1 })).toBe(newer);
	});
});
