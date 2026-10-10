import { requireBillingConfiguration } from '../../env';

/**
 * One Autumn customer read for the admin customer emails, classified into a
 * fixed result. The webhook awaits it before answering, so the whole read,
 * headers and body, runs under one 8 s signal: a planning allocation inside
 * Svix's 15 s delivery timeout that leaves room for admission.
 *
 * Nothing from the provider leaves this module except the parsed body of a
 * successful read: no status text, error, request or response body is
 * logged, thrown or returned. It never throws.
 */

const AUTUMN_API = 'https://api.useautumn.com/v1';
const READ_TIMEOUT_MS = 8000;

export type RetryCode =
	| 'autumn_not_ready'
	| 'autumn_rate_limited'
	| 'autumn_unavailable'
	| 'autumn_timeout'
	| 'autumn_network'
	| 'autumn_bad_response';
export type FailedCode = 'billing_unconfigured' | 'autumn_auth' | 'autumn_unexpected_status';

export type CustomerBillingRead =
	/** A 2xx with a JSON body; the normalizer judges its shape. */
	| { kind: 'ok'; data: unknown }
	/** Autumn has no customer with this id. */
	| { kind: 'not_found' }
	/** Worth asking again later: the webhook answers 503 and Svix redelivers. */
	| { kind: 'retry'; code: RetryCode }
	/** Needs an operator; redelivery alone will not fix it. */
	| { kind: 'failed'; code: FailedCode };

const retry = (code: RetryCode) => ({ kind: 'retry', code }) as const;
const failed = (code: FailedCode) => ({ kind: 'failed', code }) as const;

function classifyStatus(status: number): CustomerBillingRead | null {
	if (status === 404) return { kind: 'not_found' };
	// Autumn answers 202 while it cannot serve a definitive record.
	if (status === 202) return retry('autumn_not_ready');
	if (status === 429) return retry('autumn_rate_limited');
	if (status === 408 || (status >= 500 && status <= 599)) return retry('autumn_unavailable');
	if (status === 401 || status === 403) return failed('autumn_auth');
	if (status < 200 || status > 299) return failed('autumn_unexpected_status');
	return null;
}

/** Read a customer's products and invoices from Autumn. */
export async function readCustomerBilling(customerId: string): Promise<CustomerBillingRead> {
	let secretKey: string;
	try {
		({ secretKey } = requireBillingConfiguration());
	} catch {
		return failed('billing_unconfigured');
	}

	const signal = AbortSignal.timeout(READ_TIMEOUT_MS);
	let response: Response;
	try {
		response = await fetch(
			`${AUTUMN_API}/customers/${encodeURIComponent(customerId)}?expand=invoices`,
			{
				headers: { Authorization: `Bearer ${secretKey}`, 'x-api-version': '1.2' },
				signal
			}
		);
	} catch {
		return signal.aborted ? retry('autumn_timeout') : retry('autumn_network');
	}

	const classified = classifyStatus(response.status);
	if (classified) return classified;
	try {
		// The same signal bounds the body: a stalled body rejects when it aborts.
		const data: unknown = JSON.parse(await response.text());
		return { kind: 'ok', data };
	} catch {
		return signal.aborted ? retry('autumn_timeout') : retry('autumn_bad_response');
	}
}
