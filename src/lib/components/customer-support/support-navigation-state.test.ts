import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupportNavigationState } from './support-navigation-state.svelte.ts';

describe('SupportNavigationState', () => {
	let navigation: SupportNavigationState;

	beforeEach(() => {
		navigation = new SupportNavigationState();
	});

	it('starts a compose view and clears the URL thread', () => {
		const onThreadChange = vi.fn();
		navigation.setOnThreadChange(onThreadChange);

		navigation.startNewThread();

		expect(navigation.currentView).toBe('chat');
		expect(onThreadChange).toHaveBeenCalledWith(null);
	});

	it('returns to overview and clears the URL thread', () => {
		const onThreadChange = vi.fn();
		navigation.setOnThreadChange(onThreadChange);
		navigation.showChat();

		navigation.goBack();

		expect(navigation.currentView).toBe('overview');
		expect(onThreadChange).toHaveBeenCalledWith(null);
	});
});
