import { createContext } from 'svelte';
import type { ActionEvent } from './data-table-actions.svelte';

export const [getUserActionHandler, setUserActionHandler] =
	createContext<(event: ActionEvent) => void>();
