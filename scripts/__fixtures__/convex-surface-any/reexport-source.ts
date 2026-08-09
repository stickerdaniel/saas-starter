import { toolkit } from './toolkit';

// Recovered as any after a dependency API drift.
export const drifted = toolkit.mutation({ handler: async () => null });
