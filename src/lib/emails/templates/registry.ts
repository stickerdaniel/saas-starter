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
			verificationUrl: '__ETA_verificationUrl__',
			expiryMinutes: '__ETA_expiryMinutes__'
		}
	},
	VerificationCodeEmail: {
		outputName: 'verificationCode',
		props: {
			code: '__ETA_code__',
			expiryMinutes: '__ETA_expiryMinutes__'
		}
	},
	PasswordResetEmail: {
		outputName: 'passwordReset',
		props: {
			resetUrl: '__ETA_resetUrl__',
			userName: '__ETA_userName__'
		}
	},
	AdminReplyNotificationEmail: {
		outputName: 'adminReplyNotification',
		props: {
			adminName: '__ETA_adminName__',
			messagePreview: '__ETA_messagePreview__',
			deepLink: '__ETA_deepLink__'
		}
	},
	NewTicketAdminNotificationEmail: {
		outputName: 'newTicketAdminNotification',
		props: {
			titleText: '__ETA_titleText__',
			descriptionText: '__ETA_descriptionText__',
			previewText: '__ETA_previewText__',
			messagesHtml: '__ETA_messagesHtml__',
			adminDashboardLink: '__ETA_adminDashboardLink__'
		}
	},
	NewUserSignupNotificationEmail: {
		outputName: 'newUserSignupNotification',
		props: {
			userName: '__ETA_userName__',
			userEmail: '__ETA_userEmail__',
			signupMethod: '__ETA_signupMethod__',
			signupTime: '__ETA_signupTime__',
			adminDashboardLink: '__ETA_adminDashboardLink__'
		}
	}
};

/** Get all template names (component names) */
export function getTemplateNames(): string[] {
	return Object.keys(EMAIL_TEMPLATES);
}

/** Get the output filename for a template */
export function getOutputFileName(templateName: string): string {
	return EMAIL_TEMPLATES[templateName]?.outputName ?? templateName.toLowerCase();
}

/** Get the placeholder props for a template */
export function getTemplateProps(templateName: string): Record<string, string | number> {
	return EMAIL_TEMPLATES[templateName]?.props ?? {};
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
