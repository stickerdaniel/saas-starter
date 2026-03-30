import fs from 'fs';
import path from 'path';

/**
 * Platform-agnostic preview deployment bypass utility.
 *
 * Detects which bypass mechanism to use based on configured secrets:
 * - PREVIEW_BYPASS_SECRET -> Vercel protection bypass
 * - CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET -> Cloudflare Access
 * - Neither -> no bypass (empty headers)
 *
 * Detection is credential-based, not platform-based, because E2E tests
 * run on GitHub Actions runners where platform env vars (VERCEL, CF_PAGES)
 * are not available.
 */

export interface PreviewBypass {
	headers: Record<string, string>;
}

export function getPreviewBypass(): PreviewBypass {
	// Vercel: single bypass secret
	const vercelSecret = process.env.PREVIEW_BYPASS_SECRET;
	if (vercelSecret) {
		return {
			headers: {
				'x-vercel-protection-bypass': vercelSecret,
				'x-vercel-set-bypass-cookie': 'samesitenone'
			}
		};
	}

	// Cloudflare Access: two-header service token (per CF docs)
	const cfClientId = process.env.CF_ACCESS_CLIENT_ID;
	const cfClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
	if (cfClientId && cfClientSecret) {
		return {
			headers: {
				'CF-Access-Client-Id': cfClientId,
				'CF-Access-Client-Secret': cfClientSecret
			}
		};
	}

	// No bypass configured (local dev or public previews)
	return { headers: {} };
}

/**
 * Fetch and save a Vercel bypass cookie for Playwright browser tests.
 * Only applies when Vercel bypass is active and the site is on vercel.app.
 */
export async function fetchVercelBypassCookie(siteUrl: string): Promise<void> {
	const bypass = getPreviewBypass();
	const vercelSecret = bypass.headers['x-vercel-protection-bypass'];

	if (!vercelSecret || !siteUrl.includes('vercel.app')) return;

	console.log('[Setup] Fetching Vercel bypass cookie...');
	try {
		const bypassResponse = await fetch(siteUrl, {
			headers: {
				'x-vercel-protection-bypass': vercelSecret,
				'x-vercel-set-bypass-cookie': 'true'
			},
			redirect: 'manual'
		});

		const setCookie = bypassResponse.headers.get('set-cookie');
		if (setCookie) {
			const authDir = path.join(process.cwd(), 'e2e', '.auth');
			if (!fs.existsSync(authDir)) {
				fs.mkdirSync(authDir, { recursive: true });
			}

			const cookieMatch = setCookie.match(/_vercel_jwt=([^;]+)/);
			if (cookieMatch) {
				const bypassCookie = {
					cookies: [
						{
							name: '_vercel_jwt',
							value: cookieMatch[1],
							domain: new URL(siteUrl).hostname,
							path: '/',
							httpOnly: true,
							secure: true,
							sameSite: 'Lax' as const
						}
					],
					origins: []
				};
				fs.writeFileSync(
					path.join(authDir, 'vercel-bypass.json'),
					JSON.stringify(bypassCookie, null, 2)
				);
				console.log('[Setup]   Vercel bypass cookie saved');
			}
		}
	} catch (error) {
		console.warn('[Setup]   Warning: Failed to get bypass cookie:', error);
	}
}
