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

// Inline variant of the download route (/files/inline?token=...), used for
// avatar images. The component's /files/download hardcodes
// `Cache-Control: no-store` + `Content-Disposition: attachment` and proxy-
// streams the file body through the httpAction (measured 4-16s for a 310KB
// avatar), so every avatar render re-downloaded the file and lost the race
// against UI entrance animations (support-widget greeting). This route
// resolves the same download grant but 302-redirects to the underlying
// storage URL: no body proxying, and the storage response itself is
// browser-cacheable (private, max-age=30d). The redirect is cacheable for a
// day; a new avatar upload mints a new grant token (= a new URL), so redirect
// staleness only matters for provider transfers, where the old blob keeps
// serving until deleted.
http.route({
	path: '/files/inline',
	method: 'GET',
	handler: httpAction(async (ctx, request) => {
		const token = new URL(request.url).searchParams.get('token');
		if (!token) {
			return Response.json({ error: "Missing 'token' query parameter" }, { status: 400 });
		}
		const result = await ctx.runMutation(
			components.convexFilesControl.download.consumeDownloadGrantForUrl,
			{ downloadToken: token }
		);
		if (result.status !== 'ok' || !result.downloadUrl) {
			// Status mapping mirrors the component's own download route.
			const status =
				result.status === 'expired' ||
				result.status === 'exhausted' ||
				result.status === 'file_expired'
					? 410
					: result.status === 'password_required'
						? 401
						: result.status === 'access_denied' || result.status === 'invalid_password'
							? 403
							: 404;
			return Response.json({ error: 'Download unavailable' }, { status });
		}
		return new Response(null, {
			status: 302,
			headers: {
				Location: result.downloadUrl,
				'Cache-Control': 'public, max-age=86400'
			}
		});
	})
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
