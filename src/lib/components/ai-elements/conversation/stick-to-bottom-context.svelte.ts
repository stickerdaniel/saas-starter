import {
	watch,
	Context,
	useEventListener,
	useIntersectionObserver,
	useMutationObserver,
	useResizeObserver
} from 'runed';

export class StickToBottomContext {
	#element: HTMLElement | null = $state(null);
	#isAtBottom = $state(true);
	#sentinel: HTMLElement | null = $state(null);
	#userHasScrolled = $state(false);

	isAtBottom = $derived(this.#isAtBottom);

	constructor() {
		// Sentinel lifecycle. Declared before the observers below so the initial
		// append happens before the MutationObserver starts watching.
		watch(
			() => this.#element,
			(element) => {
				if (!element) return;

				this.#sentinel = this.#createSentinel(element);

				// Check initial state
				this.#checkScrollPosition();

				return () => {
					if (this.#sentinel && element.contains(this.#sentinel)) {
						element.removeChild(this.#sentinel);
					}
					this.#sentinel = null;
				};
			}
		);

		// Detect user scrolling
		useEventListener(() => this.#element, 'scroll', this.#handleScroll, { passive: true });

		// Re-stick to bottom when the container resizes
		useResizeObserver(
			() => this.#element,
			() => {
				this.#checkScrollPosition();
				if (this.#isAtBottom && !this.#userHasScrolled) {
					this.scrollToBottom('auto');
				}
			}
		);

		// Re-stick to bottom when content changes
		useMutationObserver(
			() => this.#element,
			() => {
				// Small delay to ensure DOM has updated
				requestAnimationFrame(() => {
					// Only auto-scroll if user was at bottom and hasn't manually scrolled
					const shouldAutoScroll = this.#isAtBottom && !this.#userHasScrolled;
					this.#checkScrollPosition();

					if (shouldAutoScroll) {
						this.scrollToBottom('smooth');
					}
				});
			},
			{ childList: true, subtree: true, characterData: true }
		);

		// Backup bottom detection: a visible sentinel always counts as at-bottom
		useIntersectionObserver(
			() => this.#sentinel,
			(entries) => {
				const entry = entries[0]!;
				if (entry.isIntersecting) {
					this.#isAtBottom = true;
					this.#userHasScrolled = false;
				}
			},
			// Explicit threshold: 0 to keep the previous observer's behavior (runed defaults to 0.1)
			{ threshold: 0, root: () => this.#element }
		);
	}

	setElement(element: HTMLElement) {
		this.#element = element;
	}

	scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
		if (!this.#element) return;

		this.#userHasScrolled = false; // Reset user scroll flag when programmatically scrolling
		this.#element.scrollTo({
			top: this.#element.scrollHeight,
			behavior
		});
	};

	#handleScroll = () => {
		if (!this.#element) return;

		// Detect if user has scrolled up from bottom
		const { scrollTop, scrollHeight, clientHeight } = this.#element;
		const threshold = 200; // Increased threshold for better UX
		const isAtBottom = scrollTop + clientHeight >= scrollHeight - threshold;

		// Update the isAtBottom state based on scroll position
		this.#isAtBottom = isAtBottom;

		if (!isAtBottom) {
			this.#userHasScrolled = true;
		} else if (isAtBottom && this.#userHasScrolled) {
			// User scrolled back to bottom, reset flag
			this.#userHasScrolled = false;
		}
	};

	#createSentinel(element: HTMLElement): HTMLElement {
		const sentinel = document.createElement('div');
		sentinel.style.height = '1px';
		sentinel.style.width = '100%';
		sentinel.style.pointerEvents = 'none';
		sentinel.style.opacity = '0';
		sentinel.setAttribute('data-stick-to-bottom-sentinel', '');

		// Append to the end of the scrollable content, not positioned absolutely
		element.appendChild(sentinel);
		return sentinel;
	}

	#checkScrollPosition() {
		if (!this.#element) return;

		const { scrollTop, scrollHeight, clientHeight } = this.#element;
		const threshold = 200; // Increased threshold for better UX
		const isAtBottom = scrollTop + clientHeight >= scrollHeight - threshold;

		this.#isAtBottom = isAtBottom;
	}
}

export const stickToBottomContext = new Context<StickToBottomContext>('stick-to-bottom');
