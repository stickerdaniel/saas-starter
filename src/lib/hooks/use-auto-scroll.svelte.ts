/*
	Installed from @ieedan/shadcn-svelte-extras
*/

/** Use this on a vertically scrollable container to ensure that it automatically scrolls to the bottom of the content.
 *
 * ## Usage
 * ```svelte
 * <script lang="ts">
 *      import { UseAutoScroll } from '$lib/hooks/use-auto-scroll.svelte';
 *
 *      let { children } = $props();
 *
 *      const autoScroll = new UseAutoScroll();
 * </script>
 *
 * <div>
 *      <div bind:this={autoScroll.ref}>
 *          {@render children?.()}
 *      </div>
 *      {#if !autoScroll.isAtBottom}
 *          <button onclick={() => autoScroll.scrollToBottom()}>
 *              Scroll To Bottom
 *          </button>
 *      {/if}
 * </div>
 * ```
 */
export class UseAutoScroll {
	#ref = $state<HTMLElement>();
	#scrollY: number = $state(0);
	#userHasScrolled = $state(false);
	private lastScrollHeight = 0;

	constructor() {
		// $effect watches #ref — teardown runs automatically before re-run and on destroy
		$effect(() => {
			const el = this.#ref;
			if (!el) return;

			this.lastScrollHeight = el.scrollHeight;

			// start from bottom or start position
			el.scrollTo(0, this.#scrollY ? this.#scrollY : el.scrollHeight);

			const onScroll = () => {
				this.#scrollY = el.scrollTop;
				this.disableAutoScroll();
			};
			el.addEventListener('scroll', onScroll);

			const onResize = () => {
				this.scrollToBottom(true);
			};
			window.addEventListener('resize', onResize);

			// should detect when something changed that effected the scroll height
			const observer = new MutationObserver(() => {
				if (el.scrollHeight !== this.lastScrollHeight) {
					this.scrollToBottom(true);
				}
				this.lastScrollHeight = el.scrollHeight;
			});
			observer.observe(el, { childList: true, subtree: true });

			return () => {
				el.removeEventListener('scroll', onScroll);
				window.removeEventListener('resize', onResize);
				observer.disconnect();
			};
		});
	}

	set ref(ref: HTMLElement | undefined) {
		this.#ref = ref;
	}

	get ref() {
		return this.#ref;
	}

	get scrollY() {
		return this.#scrollY;
	}

	/** Checks if the container is scrolled to the bottom */
	get isAtBottom() {
		if (!this.#ref) return true;

		return this.#scrollY + this.#ref.offsetHeight >= this.#ref.scrollHeight;
	}

	/** Disables auto scrolling until the container is scrolled back to the bottom */
	disableAutoScroll() {
		if (this.isAtBottom) {
			this.#userHasScrolled = false;
		} else {
			this.#userHasScrolled = true;
		}
	}

	/** Scrolls the container to the bottom */
	scrollToBottom(auto = false) {
		if (!this.#ref) return;

		// don't auto scroll if user has scrolled
		if (auto && this.#userHasScrolled) return;

		this.#ref.scrollTo(0, this.#ref.scrollHeight);
	}
}
