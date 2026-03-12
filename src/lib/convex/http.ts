import type { CreateAuth } from '@convex-dev/better-auth';
import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { authComponent, createAuth } from './auth';
import type { DataModel } from './_generated/dataModel';
import { resend } from './emails/resend';

const http = httpRouter();

const createRegisterableAuth: CreateAuth<DataModel> = (ctx) =>
	// Better Auth 1.5 widens baseURL typing, but registerRoutes still expects a string baseURL.
	createAuth(ctx) as ReturnType<CreateAuth<DataModel>>;

// Better Auth routes
authComponent.registerRoutes(http, createRegisterableAuth);

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
