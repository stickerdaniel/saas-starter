import { mutation } from 'a-package-that-does-not-exist';

export const orphan = mutation({ handler: async () => null });
