import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion } from 'svelte/motion';
import { ChatContainerContext } from './chat-container-context.svelte.ts';

// Replay browser geometry at observer/event boundaries. Chromium emits downward
// scroll events before a smooth scroll reaches its target; none is user input.
const callbacks = vi.hoisted(() => ({
	resize: (_entries: Array<{ target: HTMLElement }>) => {},
	events: new Map<string, (event?: { deltaY: number }) => void>()
}));
vi.mock('runed', () => ({
	Context: class {},
	watch: () => {},
	useEventListener: (_target: unknown, event: string, callback: () => void) => {
		callbacks.events.set(event, callback);
	},
	useResizeObserver: (_target: unknown, callback: typeof callbacks.resize) => {
		callbacks.resize = callback;
	}
}));
vi.mock('svelte/motion', () => ({ prefersReducedMotion: { current: false } }));

function viewport() {
	return Object.assign(document.createElement('div'), {
		scrollTo: vi.fn()
	});
}

describe('chat bottom following', () => {
	let context: ChatContainerContext;
	let element: ReturnType<typeof viewport>;
	let content: HTMLElement;
	let height: number;
	let viewportHeight: number;

	beforeEach(() => {
		callbacks.events.clear();
		(prefersReducedMotion as { current: boolean }).current = false;
		element = viewport();
		content = document.createElement('div');
		height = 1200;
		viewportHeight = 400;
		Object.defineProperties(element, {
			scrollHeight: { get: () => height },
			clientHeight: { get: () => viewportHeight }
		});
		element.scrollTop = 800;
		context = new ChatContainerContext();
		context.setElement(element);
		context.setContentElement(content);
		context.scrollToBottom();
		element.scrollTo.mockClear();
	});

	function scroll(top: number) {
		element.scrollTop = top;
		callbacks.events.get('scroll')!();
	}

	it('keeps following through intermediate downward smooth-scroll frames', () => {
		height += 80;
		callbacks.resize([{ target: content }]);
		scroll(803);
		height += 80;
		callbacks.resize([{ target: content }]);
		expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 1360, behavior: 'smooth' });
	});

	it('preserves the bottom pin when the viewport shrinks', () => {
		viewportHeight = 280;
		callbacks.resize([{ target: element }]);
		expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 1200, behavior: 'instant' });
	});

	it('follows content resizing without a DOM mutation', () => {
		height += 300;
		callbacks.resize([{ target: content }]);
		expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 1500, behavior: 'smooth' });
	});

	it('leaves the reader in place after scrolling up, then resumes at the bottom', () => {
		scroll(600);
		element.scrollTo.mockClear();
		height += 100;
		callbacks.resize([{ target: content }]);
		expect(element.scrollTo).not.toHaveBeenCalled();
		scroll(900);
		height += 100;
		callbacks.resize([{ target: content }]);
		expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 1400, behavior: 'smooth' });
	});

	it('cancels a smooth scroll on upward wheel intent before content can pull it back', () => {
		height += 100;
		callbacks.resize([{ target: content }]);
		callbacks.events.get('wheel')!({ deltaY: -50 });
		expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 800, behavior: 'instant' });
		element.scrollTo.mockClear();
		height += 100;
		callbacks.resize([{ target: content }]);
		expect(element.scrollTo).not.toHaveBeenCalled();
		context.scrollToBottom();
		expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 1400, behavior: 'smooth' });
	});

	it('keeps following when shorter content clamps the scroll position', () => {
		height -= 200;
		scroll(600);
		height += 100;
		callbacks.resize([{ target: content }]);
		expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 1100, behavior: 'smooth' });
	});
	it('honors instant resize mode for new content', () => {
		context.setModes('instant', 'instant');
		height += 100;
		callbacks.resize([{ target: content }]);
		expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 1300, behavior: 'instant' });
	});

	it('avoids smooth scrolling when reduced motion is requested', () => {
		(prefersReducedMotion as { current: boolean }).current = true;
		context.scrollToBottom('smooth');
		expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 1200, behavior: 'instant' });
	});
});
