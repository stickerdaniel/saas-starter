import { defineApp } from 'convex/server';
import resend from '@convex-dev/resend/convex.config';

const app: ReturnType<typeof defineApp> = defineApp();
app.use(resend);

export default app;
