import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { auth } from './auth';
import { resend } from './emails/resend';

const http = httpRouter();

// Authentication routes
auth.addHttpRoutes(http);

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
