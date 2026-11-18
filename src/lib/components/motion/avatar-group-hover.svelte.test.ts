import { afterEach, describe, expect, it, vi } from 'vitest';
import { avatarGroupHover } from './avatar-group-hover.svelte.ts';

/** A matchMedia stub whose hover capability the test flips. */
function hoverQuery(matches: boolean) {
	const listeners = new Set<() => void>();
	const query = {
		matches,
		addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
		removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
		change(next: boolean) {
			query.matches = next;
			for (const listener of listeners) listener();
		},
		listeners
	};
	vi.stubGlobal('matchMedia', () => query);
	return query;
}

function avatarRow() {
	const row = document.createElement('div');
	row.innerHTML = '<span class="t-avatar"></span><span class="t-avatar"></span>';
	document.body.append(row);
	const [first, second] = row.querySelectorAll<HTMLElement>('.t-avatar');
	return { row, first: first!, second: second! };
}

const shift = (item: HTMLElement) => item.style.getPropertyValue('--shift');

afterEach(() => {
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

describe('avatarGroupHover', () => {
	it('lifts the hovered avatar more than its neighbour', () => {
		hoverQuery(true);
		const { row, first, second } = avatarRow();
		avatarGroupHover(row);

		first.dispatchEvent(new MouseEvent('mouseenter'));

		expect(Number.parseFloat(shift(first))).toBeLessThan(Number.parseFloat(shift(second)));
		expect(Number.parseFloat(shift(second))).toBeLessThan(0);
	});

	it('settles the row and stops lifting once destroyed', () => {
		const query = hoverQuery(true);
		const { row, first } = avatarRow();
		const destroy = avatarGroupHover(row) as () => void;
		first.dispatchEvent(new MouseEvent('mouseenter'));

		destroy();
		first.dispatchEvent(new MouseEvent('mouseenter'));

		expect(shift(first)).toBe('0px');
		expect(query.listeners.size).toBe(0);
	});

	it('wires up avatars added later, and none after it is destroyed', async () => {
		hoverQuery(true);
		const { row } = avatarRow();
		const destroy = avatarGroupHover(row) as () => void;
		const addAvatar = async () => {
			const avatar = document.createElement('span');
			avatar.className = 't-avatar';
			row.append(avatar);
			// MutationObserver callbacks run as a microtask after the change.
			await Promise.resolve();
			avatar.dispatchEvent(new MouseEvent('mouseenter'));
			return avatar;
		};

		expect(Number.parseFloat(shift(await addAvatar()))).toBeLessThan(0);
		destroy();
		expect(shift(await addAvatar())).toBe('');
	});

	// A tap fires mouseenter without a matching mouseleave, which would leave the row lifted.
	it('ignores hover while the pointer cannot hover', () => {
		const query = hoverQuery(true);
		const { row, first } = avatarRow();
		avatarGroupHover(row);

		query.change(false);
		first.dispatchEvent(new MouseEvent('mouseenter'));

		expect(shift(first)).toBe('0px');
	});
});
