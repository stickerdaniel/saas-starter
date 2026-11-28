import { on } from 'svelte/events';
import { readItem, writeItem } from '#lib/storage/web-storage.ts';

export type Scheme = 'light' | 'dark';
type UserMode = Scheme | 'system';

export const MODE_STORAGE_KEY = 'mode-watcher-mode';

const toUserMode = (value: string | null | undefined): UserMode =>
	value === 'light' || value === 'dark' ? value : 'system';

let userMode: UserMode = 'system';
let systemLight = false;
let current = $state<Scheme | undefined>();
let pauseTransitions: HTMLStyleElement | undefined;

function write(scheme: Scheme) {
	const root = document.documentElement;
	root.classList.toggle('dark', scheme === 'dark');
	root.style.colorScheme = scheme;
}

function apply() {
	const scheme = userMode === 'system' ? (systemLight ? 'light' : 'dark') : userMode;
	if (scheme === current) return;
	if (current === undefined) {
		current = scheme;
		write(scheme);
		return;
	}
	current = scheme;
	pauseTransitions ??= Object.assign(document.createElement('style'), {
		textContent: '*{transition:none!important}'
	});
	const pause = pauseTransitions;
	document.head.appendChild(pause);
	write(scheme);
	requestAnimationFrame(() => pause.remove());
}

if (typeof window !== 'undefined') {
	const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)');
	userMode = toUserMode(readItem('local', MODE_STORAGE_KEY));
	writeItem('local', MODE_STORAGE_KEY, userMode);
	systemLight = prefersLight?.matches ?? false;
	apply();
	const stopSystem = prefersLight
		? on(prefersLight, 'change', (event) => {
				systemLight = event.matches;
				apply();
			})
		: undefined;
	const stopStorage = on(window, 'storage', (event) => {
		if (event.key !== MODE_STORAGE_KEY || event.newValue === null) return;
		userMode = toUserMode(event.newValue);
		apply();
	});
	import.meta.hot?.dispose(() => {
		stopSystem?.();
		stopStorage();
	});
}

export const mode = {
	get current(): Scheme | undefined {
		return current;
	}
};

export function toggleMode(): void {
	const next = current === 'dark' ? 'light' : 'dark';
	if (!writeItem('local', MODE_STORAGE_KEY, next)) return;
	userMode = next;
	apply();
}
