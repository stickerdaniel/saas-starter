import { httpRouter } from 'convex/server';
import { registerRoutes as registerFilesControlRoutes } from '@gilhrpenner/convex-files-control';
import { httpAction } from './_generated/server';
import { components } from './_generated/api';
import { authComponent, createAuth } from './auth';
import { resend } from './emails/resend';

const http = httpRouter();

// Better Auth routes
authComponent.registerRoutes(http, createAuth);

// files-control download route (/files/download?token=...). Serves files from
// the component's storage namespace via download grants; profile images use
// permanent shareable grants (no access key), so no checkDownloadRequest hook
// is needed. Upload stays on the presigned-URL flow (no HTTP upload route).
registerFilesControlRoutes(http, components.convexFilesControl, {
	enableDownloadRoute: true,
	enableUploadRoute: false
});

// Resend webhook endpoint
// Configure this URL in your Resend dashboard: https://your-deployment.convex.site/resend-webhook
// This endpoint receives email events (delivered, bounced, complained, opened, clicked)
http.route({
	path: '/resend-webhook',
	method: 'POST',
	handler: httpAction(async (ctx, req) => {
		return await resend.handleResendEventWebhook(ctx, req);
	})
});

export default http;
