// Covers a 40-character commit SHA and the local 'dev' build name.
const SUPPORT_APP_VERSION = /^[0-9A-Za-z._-]{1,64}$/;

/**
 * Bounds the build a support client reports. This is sanitation of client-reported
 * diagnostic metadata, not proof of which build actually sent the message.
 * Invalid metadata is omitted so it cannot make the enclosing write fail.
 */
export function normalizeSupportAppVersion(value: string | undefined): string | undefined {
	return value !== undefined && SUPPORT_APP_VERSION.test(value) ? value : undefined;
}
