<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import {
		SUPPORTED_LANGUAGES,
		LANGUAGE_COOKIE_NAME,
		LANGUAGE_COOKIE_MAX_AGE
	} from '#lib/i18n/languages.js';
	import { onMount, tick } from 'svelte';
	import LanguageSwitcherButton from './ui/language-switcher/language-switcher-button.svelte';
	import type LanguageSwitcherMenu from './ui/language-switcher/language-switcher.svelte';
	import type { LanguageSwitcherProps } from './ui/language-switcher/types';
	import { useLanguage } from '#lib/utils/i18n.js';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { updateUserWithLocale } from '#lib/auth-client.js';
	import { preloadTranslations } from '#lib/i18n/load-translations.js';

	interface Props {
		/** Button variant */
		variant?: 'outline' | 'ghost';
		/** Dropdown alignment */
		align?: 'start' | 'center' | 'end';
		/** Custom class */
		class?: string;
	}

	let { variant = 'outline', align = 'end', class: className }: Props = $props();

	const auth = useAuth();

	// Get current language from context (reactive)
	let currentLanguage = $derived(useLanguage());

	// Map our language format to shadcn's expected format
	const languages: LanguageSwitcherProps['languages'] = SUPPORTED_LANGUAGES.map((lang) => ({
		code: lang.code,
		label: lang.name
	}));

	/**
	 * Switch to a new language.
	 * Also persists the locale to the user's profile if authenticated.
	 */
	async function switchLanguage(newLang: string) {
		const currentPath = page.url.pathname;
		const currentLang = currentLanguage;

		// Replace language in current path
		let newPath: string;
		if (currentLang && currentPath.startsWith(`/${currentLang}`)) {
			newPath = currentPath.replace(`/${currentLang}`, `/${newLang}`);
		} else {
			// If no lang in path (shouldn't happen with [[lang]]), prepend new lang
			newPath = `/${newLang}${currentPath}`;
		}

		// Remember the explicit choice so a future bare/prefixless visit resolves
		// to this language during SSR (handleLanguage reads lang_pref before
		// falling back to Accept-Language).
		if (typeof document !== 'undefined') {
			document.cookie = `${LANGUAGE_COOKIE_NAME}=${newLang}; path=/; max-age=${LANGUAGE_COOKIE_MAX_AGE}; SameSite=Lax`;
		}

		// Keep the query. The URL comes from the current page, so it goes to goto()
		// verbatim: resolve() would read brackets or slashes in it as route syntax.
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- see above
		goto(newPath + page.url.search);

		// Persist locale to user profile if authenticated
		if (auth.isAuthenticated) {
			try {
				await updateUserWithLocale({ locale: newLang });
			} catch {
				// Silently fail - URL change already happened, locale update is best-effort
				console.warn('Failed to persist locale preference to user profile');
			}
		}
	}

	// The menu, and Bits UI behind it, loads once the page is idle after load,
	// or earlier on the first hover, focus or press. Until then this button
	// stands in for its trigger.
	let Menu: typeof LanguageSwitcherMenu | null = $state(null);
	let loading: Promise<void> | undefined;
	let button: HTMLElement | null = $state(null);
	let trigger: HTMLElement | null = $state(null);
	let open = $state(false);
	let pending: 'keyboard' | 'pointer' | null = $state(null);

	function load(): Promise<void> {
		loading ??= importMenu();
		return loading;
	}

	async function importMenu(): Promise<void> {
		try {
			const module = await import('./ui/language-switcher/language-switcher.svelte');
			const focused = button !== null && document.activeElement === button;
			Menu = module.default;
			await tick();
			// The trigger replaces the focused button, which takes focus with it.
			if (focused) trigger?.focus();
			if (pending) open = true;
			pending = null;
		} catch {
			loading = undefined;
			pending = null;
		}
	}

	onMount(() => {
		let cancelIdle = () => {};
		const preloadWhenIdle = () => {
			if ('requestIdleCallback' in window) {
				const id = requestIdleCallback(() => void load());
				cancelIdle = () => cancelIdleCallback(id);
			} else {
				const id = setTimeout(() => void load());
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

	// Mirrors the Bits UI trigger: a mouse opens on pointerdown, touch on
	// pointerup, a key on Enter, Space or ArrowDown, and a click only when no
	// pointer made it (detail 0, as from a screen reader). Every one of them
	// opens, so a second activation before the menu loaded cannot close it.
	$effect(() => {
		if (!pending) return;
		const dropOnOutsidePress = (event: PointerEvent) => {
			if (event.target instanceof Node && button?.contains(event.target)) return;
			pending = null;
		};
		const dropOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') pending = null;
		};
		document.addEventListener('pointerdown', dropOnOutsidePress, true);
		document.addEventListener('keydown', dropOnEscape, true);
		return () => {
			document.removeEventListener('pointerdown', dropOnOutsidePress, true);
			document.removeEventListener('keydown', dropOnEscape, true);
		};
	});

	function activate(origin: 'keyboard' | 'pointer') {
		pending = origin;
		void load();
	}

	function onpointerdown(event: PointerEvent) {
		if (event.pointerType === 'touch') return event.preventDefault();
		if (event.button !== 0 || event.ctrlKey) return;
		event.preventDefault();
		activate('pointer');
	}

	function onpointerup(event: PointerEvent) {
		if (event.pointerType !== 'touch') return;
		event.preventDefault();
		activate('pointer');
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') pending = null;
		if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return;
		event.preventDefault();
		activate('keyboard');
	}

	function onclick(event: MouseEvent) {
		if (event.detail !== 0) return;
		event.preventDefault();
		activate('pointer');
	}
</script>

{#if Menu}
	<Menu
		{languages}
		value={currentLanguage}
		{variant}
		{align}
		bind:open
		bind:trigger
		openedWithKeyboard={pending === 'keyboard'}
		onChange={switchLanguage}
		onIntent={preloadTranslations}
		class={className}
	/>
{:else}
	<LanguageSwitcherButton
		bind:ref={button}
		{variant}
		class={className}
		aria-haspopup="menu"
		aria-expanded="false"
		data-state="closed"
		onpointerenter={() => void load()}
		onfocus={() => void load()}
		onfocusout={() => {
			if (!Menu) pending = null;
		}}
		{onpointerdown}
		{onpointerup}
		{onkeydown}
		{onclick}
	/>
{/if}
