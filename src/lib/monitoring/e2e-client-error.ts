// Hands a client error to the E2E guard in e2e/utils/test.ts, which exposes
// `window.__e2eReportClientError` on every browser context a test drives and
// fails the test on any message it did not allow. Outside Playwright the
// function is absent and this does nothing.

function messageOf(error: unknown): string {
	if (typeof error === 'object' && error !== null && 'message' in error) {
		if (typeof error.message === 'string') return error.message;
	}
	return String(error);
}

/** Reports `error` to a driving E2E test by its message only. */
export function reportClientErrorToE2e(error: unknown): void {
	window.__e2eReportClientError?.(messageOf(error));
}
