import { onMount, tick, type Component } from 'svelte';
import { createAttachmentKey } from 'svelte/attachments';

type Activation = 'keyboard' | 'pointer';

/** What a lazily loaded menu receives from the button that stood in for its trigger. */
export interface LazyMenuProps {
	open: boolean;
	trigger: HTMLElement | null;
	openedWithKeyboard: boolean;
}

/**
 * A menu whose component, and Bits UI behind it, loads once the page is idle after load, or
 * earlier on the first hover, focus or press of the button that stands in for its trigger. A
 * press before the menu arrives opens it once it does, as `LanguageSwitcher.svelte` does.
 */
export class LazyMenu<Props extends LazyMenuProps> {
	menu: Component<Props> | null = $state(null);
	open = $state(false);
	button: HTMLElement | null = $state(null);
	trigger: HTMLElement | null = $state(null);
	pending: Activation | null = $state(null);
	#loading: Promise<void> | undefined;
	#importMenu: () => Promise<{ default: Component<Props> }>;
	#popup: 'menu' | 'dialog';

	constructor(
		importMenu: () => Promise<{ default: Component<Props> }>,
		popup: 'menu' | 'dialog' = 'menu'
	) {
		this.#importMenu = importMenu;
		this.#popup = popup;
		onMount(() => {
			let cancelIdle = () => {};
			const preloadWhenIdle = () => {
				if ('requestIdleCallback' in window) {
					const id = requestIdleCallback(() => void this.load());
					cancelIdle = () => cancelIdleCallback(id);
				} else {
					const id = setTimeout(() => void this.load());
					cancelIdle = () => clearTimeout(id);
				}
			};
			if (document.readyState === 'complete') preloadWhenIdle();
			else window.addEventListener('load', preloadWhenIdle, { once: true });
			return () => {
				window.removeEventListener('load', preloadWhenIdle);
				cancelIdle();
			};
		});
		$effect(() => {
			if (!this.pending) return;
			const dropOnOutsidePress = (event: PointerEvent) => {
				if (event.target instanceof Node && this.button?.contains(event.target)) return;
				this.pending = null;
			};
			const dropOnEscape = (event: KeyboardEvent) => {
				if (event.key === 'Escape') this.pending = null;
			};
			document.addEventListener('pointerdown', dropOnOutsidePress, true);
			document.addEventListener('keydown', dropOnEscape, true);
			return () => {
				document.removeEventListener('pointerdown', dropOnOutsidePress, true);
				document.removeEventListener('keydown', dropOnEscape, true);
			};
		});
	}

	load = (): Promise<void> => (this.#loading ??= this.#load());

	async #load(): Promise<void> {
		try {
			const module = await this.#importMenu();
			const focused = this.button !== null && document.activeElement === this.button;
			this.menu = module.default;
			await tick();
			if (focused) this.trigger?.focus();
			if (this.pending) this.open = true;
		} catch {
			this.#loading = undefined;
		}
		this.pending = null;
	}

	#activate(origin: Activation) {
		this.pending = origin;
		void this.load();
	}

	/**
	 * Mirrors the Bits UI trigger: a mouse opens on pointerdown, touch on pointerup, a key on
	 * Enter, Space or ArrowDown, and a click only when no pointer made it (detail 0, as from a
	 * screen reader).
	 */
	get standIn() {
		return {
			[createAttachmentKey()]: (node: HTMLElement) => {
				this.button = node;
				return () => {
					this.button = null;
				};
			},
			'aria-haspopup': this.#popup,
			'aria-expanded': 'false',
			'data-state': 'closed',
			onpointerenter: () => void this.load(),
			onfocus: () => void this.load(),
			onfocusout: () => {
				if (!this.menu) this.pending = null;
			},
			onpointerdown: (event: PointerEvent) => {
				if (event.pointerType === 'touch') return event.preventDefault();
				if (event.button !== 0 || event.ctrlKey) return;
				event.preventDefault();
				this.#activate('pointer');
			},
			onpointerup: (event: PointerEvent) => {
				if (event.pointerType !== 'touch') return;
				event.preventDefault();
				this.#activate('pointer');
			},
			onkeydown: (event: KeyboardEvent) => {
				if (event.key === 'Escape') this.pending = null;
				if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return;
				event.preventDefault();
				this.#activate('keyboard');
			},
			onclick: (event: MouseEvent) => {
				if (event.detail !== 0) return;
				event.preventDefault();
				this.#activate('pointer');
			}
		};
	}
}
