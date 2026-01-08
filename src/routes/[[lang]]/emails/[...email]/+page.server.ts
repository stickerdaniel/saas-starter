import { renderer } from '$lib/emails/renderer';
import type { PageServerLoad } from './$types';
import { createEmail, sendEmail } from 'better-svelte-email/preview';
import { env } from '$env/dynamic/private';

// Get list of all email templates using import.meta.glob
const emailFiles = Object.keys(
	import.meta.glob('/src/lib/emails/templates/*.svelte', { eager: false })
);

export const load: PageServerLoad = async () => {
	// Convert file paths to simple names for the preview UI
	const files = emailFiles.map((path) => {
		// Extract just the filename without path and extension
		// e.g., "/src/lib/emails/templates/VerificationEmail.svelte" -> "VerificationEmail"
		return path.split('/').pop()?.replace('.svelte', '') || '';
	});

	return {
		emails: {
			files: files.length > 0 ? files : null,
			path: '/src/lib/emails/templates'
		}
	};
};

// Use the library's createEmail helper with our custom renderer
// sendEmail is only available when RESEND_API_KEY is configured
export const actions = {
	...createEmail({ renderer }),
	...(env.RESEND_API_KEY
		? sendEmail({
				renderer,
				resendApiKey: env.RESEND_API_KEY,
				from: 'Email Preview <noreply@daniel.sticker.name>'
			})
		: {})
};
