import { watch, Context } from 'runed';
import { browser } from '$app/environment';

export class ScrollContext {
	#element: HTMLElement | null = $state(null);
	#isAtBottom = $state(true);

	isAtBottom = $derived(this.#isAtBottom);

	constructor() {
		// Only set up watchers in browser environment
		if (browser) {
			watch(
				() => this.#element,
				() => {
					if (this.#element) {
						this.#setupScrollListener();
						return () => this.#cleanup();
					}
				}
			);
		}
	}

	setElement(element: HTMLElement | null) {
		if (browser) {
			this.#element = element;
		}
	}

	scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
		if (!browser || !this.#element) return;

		this.#element.scrollTo({
			top: this.#element.scrollHeight,
			behavior
		});
	};

	#handleScroll = () => {
		if (!this.#element) return;

		const { scrollTop, scrollHeight, clientHeight } = this.#element;
		const threshold = 50;
		const isAtBottom = scrollTop + clientHeight >= scrollHeight - threshold;

		this.#isAtBottom = isAtBottom;
	};

	#setupScrollListener() {
		if (!this.#element) return;

		this.#element.addEventListener('scroll', this.#handleScroll, {
			passive: true
		});

		// Initial check
		this.#handleScroll();
	}

	#cleanup() {
		if (this.#element) {
			this.#element.removeEventListener('scroll', this.#handleScroll);
		}
	}
}

export const scrollContext = new Context<ScrollContext>('scroll');
