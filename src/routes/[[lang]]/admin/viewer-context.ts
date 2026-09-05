import { createContext } from 'svelte';

// The layout must provide this snapshot, even while the viewer is unavailable.
export const [getAdminViewerId, setAdminViewerId] = createContext<string | undefined>();
