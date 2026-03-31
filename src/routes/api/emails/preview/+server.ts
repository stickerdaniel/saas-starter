import { json, error as httpError } from '@sveltejs/kit';
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
	if (!import.meta.env.DEV) httpError(404, 'Not available in production');

	const { getEmailComponent } = await import('better-svelte-email/preview');
	const { renderer } = await import('$lib/emails/renderer');

	const templateName = url.searchParams.get('template') || 'VerificationEmail';

	try {
		const component = await getEmailComponent(TEMPLATES_PATH, templateName);
		const props = MOCK_DATA[templateName as keyof typeof MOCK_DATA] || {};
		const baseUrl = url.origin;
		const html = await renderer.render(component, { props: { ...props } });
		const htmlWithBaseUrl = html.replace(/__BASEURL__/g, baseUrl);

		return json({ html: htmlWithBaseUrl, templateName });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};
