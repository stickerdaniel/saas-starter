import { watch, Context, useEventListener, useResizeObserver } from 'runed';
import { prefersReducedMotion } from 'svelte/motion';

type ResizeMode = 'smooth' | 'instant';
type InitialMode = 'smooth' | 'instant';

export class ChatContainerContext {
	#element: HTMLElement | null = $state(null);
	#content: HTMLElement | null = $state(null);
	#isAtBottom = $state(true);
	// Following is user intent, independent of geometry during reflow or a smooth scroll.
	#following = true;
	#lastScrollTop = 0;
	#lastScrollHeight = 0;
	#resizeMode: ResizeMode = 'smooth';
	#initialMode: InitialMode = 'instant';
	#isInitialized = false;

	isAtBottom = $derived(this.#isAtBottom);

	constructor(resizeMode: ResizeMode = 'smooth', initialMode: InitialMode = 'instant') {
		this.setModes(resizeMode, initialMode);

		watch(
			() => this.#element,
			(element) => {
				if (!element) return;
				this.#following = true;
				this.#isInitialized = false;
				this.#rememberPosition();
				const frame = requestAnimationFrame(() => {
					if (this.#following) this.scrollToBottom();
				});
				return () => cancelAnimationFrame(frame);
			}
		);

		useEventListener(() => this.#element, 'scroll', this.#handleScroll, { passive: true });
		useEventListener(
			() => this.#element,
			'wheel',
			(event) => {
				if (event.deltaY < 0) this.#stopFollowing();
			},
			{ passive: true }
		);

		// Observe the natural content height as well as the viewport. This also catches
		// image loads, font reflow and expanding tool results without a DOM mutation.
		useResizeObserver(
			() => [this.#element, this.#content].filter((el): el is HTMLElement => el !== null),
			(entries) => {
				if (this.#following) {
					const viewportChanged = entries.some((entry) => entry.target === this.#element);
					this.scrollToBottom(viewportChanged ? 'instant' : this.#resizeMode);
				}
				this.#rememberPosition();
			}
		);
	}

	setModes(resizeMode: ResizeMode, initialMode: InitialMode) {
		this.#resizeMode = resizeMode;
		this.#initialMode = initialMode;
	}

	setElement(element: HTMLElement | null) {
		this.#element = element;
	}

	setContentElement(element: HTMLElement | null) {
		this.#content = element;
	}

	scrollToBottom = (behavior?: ScrollBehavior) => {
		if (!this.#element) return;
		const mode = this.#isInitialized ? (behavior ?? this.#resizeMode) : this.#initialMode;
		this.#isInitialized = true;
		this.#following = true;
		this.#element.scrollTo({
			top: this.#element.scrollHeight,
			behavior: prefersReducedMotion.current ? 'instant' : mode
		});
		this.#rememberPosition();
	};

	#stopFollowing() {
		this.#following = false;
		// Cancel an in-flight smooth scroll before it can fight the user's gesture.
		this.#element?.scrollTo({ top: this.#element.scrollTop, behavior: 'instant' });
	}

	#handleScroll = () => {
		if (!this.#element) return;
		const { scrollTop, scrollHeight } = this.#element;
		// A shorter document can clamp scrollTop. That is reflow, not a scroll up.
		const movedUp = scrollTop < this.#lastScrollTop - 1 && scrollHeight === this.#lastScrollHeight;
		const movedDown = scrollTop > this.#lastScrollTop;
		this.#rememberPosition();
		if (movedUp) this.#stopFollowing();
		else if (this.#isAtBottom && movedDown) this.#following = true;
	};

	#rememberPosition() {
		if (!this.#element) return;
		const { scrollTop, scrollHeight, clientHeight } = this.#element;
		this.#isAtBottom = scrollTop + clientHeight >= scrollHeight - 50;
		this.#lastScrollTop = scrollTop;
		this.#lastScrollHeight = scrollHeight;
	}
}

export const chatContainerContext = new Context<ChatContainerContext>('chat-container');
export type { ResizeMode, InitialMode };
