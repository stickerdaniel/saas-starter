import { createContext } from 'svelte';

class GlobalSearchState {
	open = $state(false);

	setOpen = (open: boolean): void => {
		this.open = open;
	};

	openMenu = (): void => {
		this.open = true;
	};

	closeMenu = (): void => {
		this.open = false;
	};

	toggleMenu = (): void => {
		this.open = !this.open;
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
