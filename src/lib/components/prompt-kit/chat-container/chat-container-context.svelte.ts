import {
	watch,
	Context,
	useEventListener,
	useIntersectionObserver,
	useMutationObserver,
	useResizeObserver
} from 'runed';

type ResizeMode = 'smooth' | 'instant';
type InitialMode = 'smooth' | 'instant';

export class ChatContainerContext {
	#element: HTMLElement | null = $state(null);
	#isAtBottom = $state(true);
	#sentinel: HTMLElement | null = $state(null);
	#userHasScrolled = $state(false);
	#resizeMode: ResizeMode = 'smooth';
	#initialMode: InitialMode = 'instant';
	#isInitialized = false;

	isAtBottom = $derived(this.#isAtBottom);

	constructor(resizeMode: ResizeMode = 'smooth', initialMode: InitialMode = 'instant') {
		this.#resizeMode = resizeMode;
		this.#initialMode = initialMode;

		// Sentinel lifecycle. Declared before the observers below so the initial
		// append happens before the MutationObserver starts watching.
		watch(
			() => this.#element,
			(element) => {
				if (!element) return;

				this.#sentinel = this.#createSentinel(element);

				// Initial scroll to bottom
				requestAnimationFrame(() => {
					this.#checkScrollPosition();
					this.scrollToBottom();
				});

				return () => {
					if (this.#sentinel && element.contains(this.#sentinel)) {
						element.removeChild(this.#sentinel);
					}
					this.#sentinel = null;
				};
			}
		);

		useEventListener(() => this.#element, 'scroll', this.#handleScroll, { passive: true });

		useResizeObserver(
			() => this.#element,
			() => {
				this.#checkScrollPosition();
				if (this.#isAtBottom && !this.#userHasScrolled) {
					const behavior = this.#resizeMode === 'smooth' ? 'smooth' : 'instant';
					this.scrollToBottom(behavior);
				}
			}
		);

		useMutationObserver(
			() => this.#element,
			() => {
				requestAnimationFrame(() => {
					const shouldAutoScroll = this.#isAtBottom && !this.#userHasScrolled;
					this.#checkScrollPosition();

					if (shouldAutoScroll) {
						this.scrollToBottom('smooth');
					}
				});
			},
			{ childList: true, subtree: true, characterData: true }
		);

		useIntersectionObserver(
			() => this.#sentinel,
			(entries) => {
				const entry = entries[0]!;
				if (entry.isIntersecting && !this.#userHasScrolled) {
					this.#isAtBottom = true;
				}
			},
			// Explicit threshold: 0 to keep the previous observer's behavior (runed defaults to 0.1)
			{ threshold: 0, root: () => this.#element }
		);
	}

	setModes(resizeMode: ResizeMode, initialMode: InitialMode) {
		this.#resizeMode = resizeMode;
		this.#initialMode = initialMode;
	}

	setElement(element: HTMLElement) {
		this.#element = element;
	}

	scrollToBottom = (behavior?: ScrollBehavior) => {
		if (!this.#element) return;

		// Use initial mode for first scroll, then use provided behavior or resize mode
		let scrollBehavior: ScrollBehavior;
		if (!this.#isInitialized) {
			scrollBehavior = this.#initialMode === 'instant' ? 'instant' : 'smooth';
			this.#isInitialized = true;
		} else {
			scrollBehavior = behavior || (this.#resizeMode === 'smooth' ? 'smooth' : 'instant');
		}

		this.#userHasScrolled = false;
		this.#element.scrollTo({
			top: this.#element.scrollHeight,
			behavior: scrollBehavior
		});
	};

	#handleScroll = () => {
		if (!this.#element) return;

		const { scrollTop, scrollHeight, clientHeight } = this.#element;
		const threshold = 50;
		const isAtBottom = scrollTop + clientHeight >= scrollHeight - threshold;

		this.#isAtBottom = isAtBottom;

		if (!isAtBottom) {
			this.#userHasScrolled = true;
		} else if (isAtBottom && this.#userHasScrolled) {
			this.#userHasScrolled = false;
		}
	};

	#createSentinel(element: HTMLElement): HTMLElement {
		const sentinel = document.createElement('div');
		sentinel.style.height = '1px';
		sentinel.style.width = '100%';
		sentinel.style.pointerEvents = 'none';
		sentinel.style.opacity = '0';
		sentinel.setAttribute('data-chat-container-sentinel', '');

		element.appendChild(sentinel);
		return sentinel;
	}

	#checkScrollPosition() {
		if (!this.#element) return;

		const { scrollTop, scrollHeight, clientHeight } = this.#element;
		const threshold = 50;
		const isAtBottom = scrollTop + clientHeight >= scrollHeight - threshold;

		this.#isAtBottom = isAtBottom;
	}
}

export const chatContainerContext = new Context<ChatContainerContext>('chat-container');

export type { ResizeMode, InitialMode };
