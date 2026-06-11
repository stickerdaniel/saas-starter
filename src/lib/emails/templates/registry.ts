/**
 * Email Template Registry
 *
 * Single source of truth for email template configurations.
 * Used by both the build script and API endpoint.
 */

/**
 * Template configuration with placeholder markers.
 * Markers like __ETA_xxx__ are replaced with {{xxx}} template syntax after rendering.
 */
export interface TemplateConfig {
	/** Output filename (without extension) for the generated TypeScript file */
	outputName: string;
	/** Placeholder props passed to the template during rendering */
	props: Record<string, string | number>;
}

/**
 * Registry of all email templates.
 *
 * To add a new template:
 * 1. Create the Svelte component in src/lib/emails/templates/
 * 2. Add an entry here with the component name as key
 * 3. Run `bun run build:emails` to generate the TypeScript files
 */
export const EMAIL_TEMPLATES: Record<string, TemplateConfig> = {
	VerificationEmail: {
		outputName: 'verification',
		props: {
			lang: '__ETA_lang__',
			verificationUrl: '__ETA_verificationUrl__',
			badgeText: '__ETA_badgeText__',
			titleText: '__ETA_titleText__',
			descriptionText: '__ETA_descriptionText__',
			previewText: '__ETA_previewText__',
			introText: '__ETA_introText__',
			buttonText: '__ETA_buttonText__',
			expiryText: '__ETA_expiryText__',
			disclaimerText: '__ETA_disclaimerText__'
		}
	},
	VerificationCodeEmail: {
		outputName: 'verificationCode',
		props: {
			lang: '__ETA_lang__',
			code: '__ETA_code__',
			badgeText: '__ETA_badgeText__',
			titleText: '__ETA_titleText__',
			descriptionText: '__ETA_descriptionText__',
			previewText: '__ETA_previewText__',
			expiryText: '__ETA_expiryText__',
			disclaimerText: '__ETA_disclaimerText__'
		}
	},
	PasswordResetEmail: {
		outputName: 'passwordReset',
		props: {
			lang: '__ETA_lang__',
			resetUrl: '__ETA_resetUrl__',
			badgeText: '__ETA_badgeText__',
			titleText: '__ETA_titleText__',
			greetingText: '__ETA_greetingText__',
			previewText: '__ETA_previewText__',
			bodyText: '__ETA_bodyText__',
			buttonText: '__ETA_buttonText__',
			expiryText: '__ETA_expiryText__',
			disclaimerText: '__ETA_disclaimerText__'
		}
	},
	AdminReplyNotificationEmail: {
		outputName: 'adminReplyNotification',
		props: {
			lang: '__ETA_lang__',
			messagePreview: '__ETA_messagePreview__',
			deepLink: '__ETA_deepLink__',
			badgeText: '__ETA_badgeText__',
			titleText: '__ETA_titleText__',
			descriptionText: '__ETA_descriptionText__',
			previewText: '__ETA_previewText__',
			buttonText: '__ETA_buttonText__',
			footerText: '__ETA_footerText__'
		}
	},
	NewTicketAdminNotificationEmail: {
		outputName: 'newTicketAdminNotification',
		props: {
			lang: '__ETA_lang__',
			titleText: '__ETA_titleText__',
			descriptionText: '__ETA_descriptionText__',
			previewText: '__ETA_previewText__',
			messagesHtml: '__ETA_messagesHtml__',
			adminDashboardLink: '__ETA_adminDashboardLink__',
			badgeText: '__ETA_badgeText__',
			buttonText: '__ETA_buttonText__',
			footerText: '__ETA_footerText__'
		}
	},
	NewUserSignupNotificationEmail: {
		outputName: 'newUserSignupNotification',
		props: {
			lang: '__ETA_lang__',
			userName: '__ETA_userName__',
			userEmail: '__ETA_userEmail__',
			signupMethod: '__ETA_signupMethod__',
			signupTime: '__ETA_signupTime__',
			adminDashboardLink: '__ETA_adminDashboardLink__',
			badgeText: '__ETA_badgeText__',
			titleText: '__ETA_titleText__',
			descriptionText: '__ETA_descriptionText__',
			previewText: '__ETA_previewText__',
			nameLabel: '__ETA_nameLabel__',
			emailLabel: '__ETA_emailLabel__',
			methodLabel: '__ETA_methodLabel__',
			timeLabel: '__ETA_timeLabel__',
			buttonText: '__ETA_buttonText__',
			footerText: '__ETA_footerText__'
		}
	}
};

/** Get the output filename for a template */
export function getOutputFileName(templateName: string): string {
	return EMAIL_TEMPLATES[templateName]?.outputName ?? templateName.toLowerCase();
}

/** Get all templates with their props (for rendering) */
export function getTemplatesForRendering(): Array<{
	name: string;
	props: Record<string, string | number>;
}> {
	return Object.entries(EMAIL_TEMPLATES).map(([name, config]) => ({
		name,
		props: config.props
	}));
}
