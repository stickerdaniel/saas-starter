import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupportNavigationState } from './support-navigation-state.svelte.ts';

describe('SupportNavigationState', () => {
	let navigation: SupportNavigationState;

	beforeEach(() => {
		navigation = new SupportNavigationState();
	});

	it('coordinates selected threads with the URL callback', () => {
		const onThreadChange = vi.fn();
		navigation.setOnThreadChange(onThreadChange);

		navigation.selectThread('thread-1');

		expect(navigation.currentView).toBe('chat');
		expect(onThreadChange).toHaveBeenCalledWith('thread-1');
	});

	it('starts a compose view and clears the URL thread', () => {
		const onThreadChange = vi.fn();
		navigation.setOnThreadChange(onThreadChange);

		navigation.startNewThread();

		expect(navigation.currentView).toBe('chat');
		expect(onThreadChange).toHaveBeenCalledWith(null);
	});

	it('loads a URL thread without echoing the callback', () => {
		const onThreadChange = vi.fn();
		navigation.setOnThreadChange(onThreadChange);

		navigation.selectThreadFromUrl();

		expect(navigation.currentView).toBe('chat');
		expect(navigation.skipAnimation).toBe(true);
		expect(onThreadChange).not.toHaveBeenCalled();
	});

	it('opens an established conversation but leaves an empty widget on its current view', () => {
		navigation.requestWidgetOpen(false);
		expect(navigation.shouldOpenWidget).toBe(true);
		expect(navigation.currentView).toBe('overview');

		navigation.clearWidgetOpenRequest();
		navigation.requestWidgetOpen(true);
		expect(navigation.currentView).toBe('chat');
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
