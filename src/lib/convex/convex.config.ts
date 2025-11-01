import { defineApp } from 'convex/server';
import resend from '@convex-dev/resend/convex.config';
import autumn from '@useautumn/convex/convex.config';

const app: ReturnType<typeof defineApp> = defineApp();
app.use(resend);
app.use(autumn);
/**
 * Convex application configured with Autumn billing integration.
 *
 * This configuration registers the Autumn billing plugin with the Convex backend,
 * enabling subscription and usage tracking functionality.
 */
export default app;
