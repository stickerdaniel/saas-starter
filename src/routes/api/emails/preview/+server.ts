import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { getEmailComponent } from 'better-svelte-email/preview';
import { renderer } from '$lib/emails/renderer';
import type { RequestHandler } from './$types';

const TEMPLATES_PATH = '/src/lib/emails/templates';

const MOCK_DATA = {
	VerificationEmail: {
		verificationUrl: 'https://example.com/verify?token=abc123',
		expiryMinutes: 20
	},
	PasswordResetEmail: {
		resetUrl: 'https://example.com/reset?token=abc123',
		userName: 'John Doe'
	},
	AdminReplyNotificationEmail: {
		adminName: 'Support Team',
		messagePreview: 'Thank you for reaching out. We have looked into your issue...',
		deepLink: 'https://example.com/support?thread=123'
	}
};

export const GET: RequestHandler = async ({ url }) => {
	const templateName = url.searchParams.get('template') || 'VerificationEmail';

	try {
		// Get template component
		const component = await getEmailComponent(TEMPLATES_PATH, templateName);

		// Get mock props for this template
		const props = MOCK_DATA[templateName as keyof typeof MOCK_DATA] || {};

		// Render with current base URL (for preview)
		const baseUrl = env.PUBLIC_PROD_URL || url.origin;
		const html = await renderer.render(component, {
			props: { ...props }
		});

		// Replace __BASEURL__ placeholder with actual URL for preview
		const htmlWithBaseUrl = html.replace(/__BASEURL__/g, baseUrl);

		return json({ html: htmlWithBaseUrl, templateName });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};
