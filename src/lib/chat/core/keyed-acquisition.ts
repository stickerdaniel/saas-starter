import type * as Data from 'effect/Data';

type Acquisition<Key, A> = Data.TaggedEnum<{
	None: Record<never, never>;
	Acquiring: { readonly key: Key; readonly result: Promise<A> };
}>;

export class KeyedAcquisition<Key, A> {
	readonly #equals: (a: Key, b: Key) => boolean;
	#slot: Acquisition<Key, A> = { _tag: 'None' };

	constructor(equals: (a: Key, b: Key) => boolean) {
		this.#equals = equals;
	}

	current(key: Key): Promise<A> | undefined {
		const slot = this.#slot;
		return slot._tag === 'Acquiring' && this.#equals(slot.key, key) ? slot.result : undefined;
	}

	acquire(key: Key, start: () => Promise<A>): Promise<A> {
		const running = this.current(key);
		if (running) return running;
		const slot: Acquisition<Key, A> = {
			_tag: 'Acquiring',
			key,
			result: start().finally(() => {
				if (this.#slot === slot) this.invalidate();
			})
		};
		this.#slot = slot;
		return slot.result;
	}

	invalidate(): void {
		this.#slot = { _tag: 'None' };
	}
}
