import { createContext } from 'svelte';

class GlobalSearchState {
	open = $state(false);
	shouldLoadMenu = $state(false);

	preloadMenu = (): void => {
		this.shouldLoadMenu = true;
	};

	setOpen = (open: boolean): void => {
		if (open) this.preloadMenu();
		this.open = open;
	};

	openMenu = (): void => {
		this.setOpen(true);
	};

	closeMenu = (): void => {
		this.open = false;
	};

	toggleMenu = (): void => {
		this.setOpen(!this.open);
	};
}

export type GlobalSearchContextState = GlobalSearchState;

const [getGlobalSearch, setGlobalSearch] = createContext<GlobalSearchContextState>();

export function setGlobalSearchContext(): GlobalSearchContextState {
	return setGlobalSearch(new GlobalSearchState());
}

export function useGlobalSearchContext(): GlobalSearchContextState {
	return getGlobalSearch();
}
