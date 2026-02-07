import { Context } from 'runed';

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

const globalSearchContext = new Context<GlobalSearchContextState>('global-search');

export function setGlobalSearchContext(): GlobalSearchContextState {
	return globalSearchContext.set(new GlobalSearchState());
}

export function useGlobalSearchContext(): GlobalSearchContextState {
	return globalSearchContext.get();
}
