import { createAuth } from '../auth';

// Export a static instance for Better Auth CLI schema generation
// Note: This file is ONLY used by the Better Auth CLI (@better-auth/cli generate)
// and should NOT be imported at runtime (will cause environment variable errors)
export const auth = createAuth({} as any);
