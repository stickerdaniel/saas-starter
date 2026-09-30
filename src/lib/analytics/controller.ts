import type { CaptureResult, PostHog, Properties } from 'posthog-js';
import type { AnalyticsConfig } from './config';
import {
	createGrantId,
	denyCookie,
	grantCookie,
	parseConsentCookie,
	type ConsentRecord
} from './consent';
import { planIdentity, type AuthState } from './identity';
import { createPosthogInstance } from './posthog';
import { NOT_FOUND_PATH, reportedPath } from './routes';
import { sanitizeCaptureResult } from './sanitize';
import {
	analyticsStorageKeys,
	clearAnalyticsIdentity,
	isStorageUsable,
	type BrowserStores
} from './storage';

/**
 * Owns PostHog for one document: whether it may load, which consent period and
 * identity it runs under, and which events leave the browser.
 *
 * The consent cookie is the only authority. Every controller entrypoint checks it
 * live before calling the SDK, and every event the SDK builds passes the same check
 * again in `before_send`, so a withdrawal in another tab or an expiry in this one
 * closes admission even before any notification arrives. The SDK itself rejects by
 * default and is opted in only right after a live check, so a reset or a lost SDK
 * marker can never turn capture back on by itself.
 *
 * Limits, stated in the playbook: events admitted before a withdrawal may still be
 * delivered by an in-flight request or a retry; custom events attempted while the
 * session is changing are dropped, not queued; there is no pageleave event.
 */

export type ConsentStatus = ConsentRecord['status'];

export interface AnalyticsState {
	enabled: boolean;
	status: ConsentStatus;
	/** The banner asks for a decision: pending consent, or reopened preferences. */
	bannerOpen: boolean;
}

export interface ControllerDeps {
	config: AnalyticsConfig;
	stores: BrowserStores;
	getLocalStorage: () => Storage | undefined;
	getSessionStorage: () => Storage | undefined;
	cookies: { read(): string; write(cookie: string): void };
	loadSdk: () => Promise<PostHog>;
	/** Defers SDK work off the critical path; returns a cancel function. */
	scheduleIdle: (task: () => void) => () => void;
	setTimer: (task: () => void, ms: number) => () => void;
	nowSeconds: () => number;
	location: () => { pathname: string };
	/** Tells other tabs to re-read the cookie. Never carries the decision itself. */
	notifyOtherTabs: () => void;
}

/** SvelteKit route id of the catch-all page, which renders the 404 error. */
export const NOT_FOUND_ROUTE_ID = '/[[lang]]/[...path]';
/** Largest delay a browser timer accepts; longer expiries rearm on each wake. */
const MAX_TIMER_MS = 2_147_483_647;
/** posthog.init returns an existing instance for a known name; every start needs a new one. */
let instanceSequence = 0;

type SdkPersistence = 'localStorage' | 'memory';

interface SettledRoute {
	routeId: string | null;
	pathname: string;
	ok: boolean;
}

export class AnalyticsController {
	#deps: ControllerDeps;
	#config: Extract<AnalyticsConfig, { enabled: true }> | undefined;
	#sdk: PostHog | undefined;
	#persistence: SdkPersistence = 'memory';
	#memoryPeriodStamp: string | undefined;

	/** Consent period the loaded SDK identity belongs to. */
	#activeGrantId: string | undefined;
	/** A grant made in another tab while this SDK runs; lifted only by a reload or a local decision. */
	#paused = false;
	/** A failed cookie write: nothing may reopen until the visitor decides again. */
	#localOff = false;
	#startGeneration = 0;
	#cancelStart: (() => void) | undefined;
	#pendingGrantId: string | undefined;
	#cancelExpiry: (() => void) | undefined;

	#auth: AuthState = { kind: 'pending' };
	/** The SDK identity matches `#auth`. Cleared by every auth change and identity reset. */
	#reconciled = false;
	/** Sign-outs and impersonation changes whose request has not settled yet. */
	#authOperations = new Set<symbol>();
	/**
	 * After a finished (or possibly finished) auth change, the session store must
	 * report a new request and its answer before anything opens again. A refetch that
	 * was already running can still carry the previous account.
	 */
	#sessionAfterAuthChange: 'current' | 'awaiting_request' | 'awaiting_answer' = 'current';
	#disposed = false;
	#route: SettledRoute = { routeId: null, pathname: '', ok: false };

	/** Advances on every identity reset: new consent period, account switch, sign-out. */
	#epoch = 0;
	#epochHasPageview = false;
	#lastPageview: { epoch: number; pathname: string } | undefined;

	#state: AnalyticsState;
	#listeners = new Set<(state: AnalyticsState) => void>();

	constructor(deps: ControllerDeps) {
		this.#deps = deps;
		this.#config = deps.config.enabled ? deps.config : undefined;
		this.#state = { enabled: Boolean(this.#config), status: 'pending', bannerOpen: false };
	}

	get state(): AnalyticsState {
		return this.#state;
	}

	subscribe(listener: (state: AnalyticsState) => void): () => void {
		this.#listeners.add(listener);
		listener(this.#state);
		return () => this.#listeners.delete(listener);
	}

	#setState(patch: Partial<AnalyticsState>): void {
		this.#state = { ...this.#state, ...patch };
		for (const listener of this.#listeners) listener(this.#state);
	}

	#readConsent(): ConsentRecord {
		try {
			return parseConsentCookie(this.#deps.cookies.read(), this.#deps.nowSeconds());
		} catch {
			// An unreadable cookie is no decision: stay closed.
			return { status: 'pending' };
		}
	}

	/** Writes the cookie and reads it back. False when the browser refused it. */
	#writeConsent(cookie: string, stored: (consent: ConsentRecord) => boolean): boolean {
		try {
			this.#deps.cookies.write(cookie);
		} catch {
			return false;
		}
		return stored(this.#readConsent());
	}

	#authSettled(): boolean {
		return this.#authOperations.size === 0 && this.#sessionAfterAuthChange === 'current';
	}

	#consentIsActive(): boolean {
		const consent = this.#readConsent();
		return consent.status === 'granted' && consent.grantId === this.#activeGrantId;
	}

	/**
	 * A successfully rendered, known route whose pathname is what the browser shows.
	 * Between a history update and the settled page state they can disagree.
	 */
	#routeReady(): boolean {
		const { routeId, pathname, ok } = this.#route;
		if (!ok || routeId === null || routeId === NOT_FOUND_ROUTE_ID) return false;
		if (reportedPath(pathname) === NOT_FOUND_PATH) return false;
		return pathname === this.#deps.location().pathname;
	}

	/** The admission predicate: checked before every SDK call and again in before_send. */
	isAdmitted(): boolean {
		if (!this.#config || !this.#sdk || this.#disposed || this.#paused || this.#localOff)
			return false;
		if (!this.#reconciled || !this.#authSettled() || !this.#routeReady()) return false;
		if (this.#auth.kind !== 'user' && this.#auth.kind !== 'anonymous') return false;
		return this.#consentIsActive();
	}

	#beforeSend = (event: CaptureResult | null): CaptureResult | null => {
		if (!event || !this.isAdmitted()) return null;
		return sanitizeCaptureResult(event, { epochHasPageview: this.#epochHasPageview });
	};

	/** Call once in the browser after mount. */
	start(): void {
		if (!this.#config || this.#disposed) return;
		this.#applyConsent(this.#readConsent(), 'boot');
	}

	/** Re-reads the cookie: visibility, pageshow, a message from another tab, expiry. */
	reconcile(): void {
		if (!this.#config || this.#disposed) return;
		this.#applyConsent(this.#readConsent(), 'observed');
	}

	#applyConsent(consent: ConsentRecord, source: 'boot' | 'observed'): void {
		this.#armExpiry(consent);
		if (consent.status !== 'granted') {
			this.#close();
			this.#setState({ status: consent.status, bannerOpen: consent.status === 'pending' });
			return;
		}
		this.#setState({ status: 'granted', bannerOpen: false });
		if (this.#localOff) return;
		if (this.#sdk) {
			// A different period than the one this SDK runs under was granted elsewhere.
			// Resetting here would overwrite the identity that tab just established.
			if (consent.grantId !== this.#activeGrantId) this.#paused = true;
			return;
		}
		if (source === 'boot' || this.#pendingGrantId !== consent.grantId) {
			this.#scheduleStart(consent.grantId);
		}
	}

	#armExpiry(consent: ConsentRecord): void {
		this.#cancelExpiry?.();
		this.#cancelExpiry = undefined;
		if (consent.status !== 'granted') return;
		const remainingMs = (consent.expiresAt - this.#deps.nowSeconds()) * 1000 + 1000;
		this.#cancelExpiry = this.#deps.setTimer(
			() => this.reconcile(),
			Math.min(remainingMs, MAX_TIMER_MS)
		);
	}

	/** The visitor allowed analytics in this tab. Returns false if it could not be stored. */
	grant(): boolean {
		if (!this.#config || this.#disposed) return false;
		const current = this.#readConsent();
		const alreadyActive =
			current.status === 'granted' &&
			!this.#paused &&
			!this.#localOff &&
			(!this.#sdk || current.grantId === this.#activeGrantId);
		if (alreadyActive) {
			// Confirming the current choice keeps the visitor's identity. A start that
			// never completed, such as a failed SDK import, gets another attempt.
			this.#setState({ status: 'granted', bannerOpen: false });
			if (!this.#sdk && !this.#cancelStart) this.#scheduleStart(current.grantId);
			return true;
		}

		const grantId = createGrantId();
		const stored = this.#writeConsent(
			grantCookie(grantId, this.#deps.nowSeconds(), this.#deps.stores.secure),
			(consent) => consent.status === 'granted' && consent.grantId === grantId
		);
		if (!stored) {
			this.#localOff = true;
			this.#close();
			this.#setState({ status: 'pending', bannerOpen: true });
			return false;
		}
		this.#localOff = false;
		this.#paused = false;
		this.#armExpiry(this.#readConsent());
		this.#setState({ status: 'granted', bannerOpen: false });
		this.#deps.notifyOtherTabs();
		if (this.#sdk) {
			this.#establishPeriod(grantId);
			this.#reconcileIdentity();
		} else {
			this.#scheduleStart(grantId);
		}
		return true;
	}

	/**
	 * The visitor declined or withdrew in this tab. Returns false when the browser
	 * refused to store the refusal: analytics is off in this document, but a reload
	 * reads the previous cookie again.
	 */
	deny(): boolean {
		if (!this.#config || this.#disposed) return false;
		// Closed before the write, so a refused or throwing write cannot leave capture on.
		this.#localOff = true;
		this.#close();
		this.#armExpiry({ status: 'denied' });
		const stored = this.#writeConsent(
			denyCookie(this.#deps.stores.secure),
			(consent) => consent.status === 'denied'
		);
		this.#localOff = !stored;
		this.#setState({ status: 'denied', bannerOpen: false });
		if (stored) this.#deps.notifyOtherTabs();
		return stored;
	}

	/** Stops timers and pending starts. The controller admits nothing afterwards. */
	dispose(): void {
		this.#disposed = true;
		this.#startGeneration += 1;
		this.#cancelStart?.();
		this.#cancelStart = undefined;
		this.#cancelExpiry?.();
		this.#cancelExpiry = undefined;
		this.#listeners.clear();
	}

	openPreferences(): void {
		if (this.#config) this.#setState({ bannerOpen: true });
	}

	closePreferences(): void {
		if (this.#state.status !== 'pending') this.#setState({ bannerOpen: false });
	}

	/** Stops capture, rotates the in-memory identity and removes stored identity. */
	#close(): void {
		this.#startGeneration += 1;
		this.#cancelStart?.();
		this.#cancelStart = undefined;
		this.#pendingGrantId = undefined;
		this.#reconciled = false;
		if (this.#sdk) {
			// Opt-out first: it switches the SDK's persistence off, so the reset below
			// rotates ids in memory without writing them back to storage.
			this.#sdk.opt_out_capturing();
			this.#sdk.reset(true);
		}
		this.#activeGrantId = undefined;
		this.#memoryPeriodStamp = undefined;
		this.#newEpoch();
		if (this.#config) clearAnalyticsIdentity(this.#config.apiKey, this.#deps.stores);
	}

	#newEpoch(): void {
		this.#epoch += 1;
		this.#epochHasPageview = false;
	}

	#stillCurrent(generation: number, grantId: string): boolean {
		if (generation !== this.#startGeneration || this.#disposed) return false;
		if (this.#paused || this.#localOff) return false;
		const consent = this.#readConsent();
		return consent.status === 'granted' && consent.grantId === grantId;
	}

	#scheduleStart(grantId: string): void {
		if (!this.#config) return;
		this.#cancelStart?.();
		this.#cancelStart = undefined;
		this.#pendingGrantId = grantId;
		// The SDK computes landing and session data from the URL at init, so it only
		// starts on a settled, known route. setRoute schedules it again later.
		if (!this.#routeReady()) return;
		const generation = ++this.#startGeneration;
		this.#cancelStart = this.#deps.scheduleIdle(() => {
			void this.#load(generation, grantId);
		});
	}

	/** Ends the current start task, so a later route, reconcile or Allow can start again. */
	#endStart(generation: number): void {
		if (generation !== this.#startGeneration) return;
		this.#cancelStart = undefined;
		this.#pendingGrantId = undefined;
	}

	async #load(generation: number, grantId: string): Promise<void> {
		const config = this.#config;
		// Every exit ends the task (generation-guarded), so a later start can run; the
		// later start checks consent and route again.
		if (!config || !this.#stillCurrent(generation, grantId)) return this.#endStart(generation);
		// The visitor may have left the known route while the task waited for idle time.
		if (!this.#routeReady()) return this.#endStart(generation);
		let posthog: PostHog;
		try {
			posthog = await this.#deps.loadSdk();
		} catch {
			// A failed chunk load is retried by the next start; nothing is queued meanwhile.
			return this.#endStart(generation);
		}
		if (!this.#stillCurrent(generation, grantId) || this.#sdk) return this.#endStart(generation);
		if (!this.#routeReady()) return this.#endStart(generation);

		// Both stores must be durable, or the SDK would fall back to a cookie for one of
		// them. Without them the identity lives only as long as this document.
		const durable =
			isStorageUsable(this.#deps.getLocalStorage) && isStorageUsable(this.#deps.getSessionStorage);
		this.#persistence = durable ? 'localStorage' : 'memory';

		const sdk = createPosthogInstance(posthog, {
			apiKey: config.apiKey,
			apiHost: config.apiHost,
			uiHost: config.uiHost,
			persistence: this.#persistence,
			beforeSend: this.#beforeSend,
			name: `app_${++instanceSequence}`
		});
		if (!sdk || !this.#stillCurrent(generation, grantId)) {
			sdk?.opt_out_capturing();
			return this.#endStart(generation);
		}
		this.#sdk = sdk;
		this.#cancelStart = undefined;
		this.#pendingGrantId = undefined;
		if (this.#readPeriodStamp() === grantId) {
			// Same consent period as the stored identity: keep it (reload stability).
			this.#activeGrantId = grantId;
			this.#newEpoch();
			this.#ensureOptedIn();
		} else {
			this.#establishPeriod(grantId);
		}
		this.#reconcileIdentity();
	}

	#readPeriodStamp(): string | undefined {
		if (this.#persistence === 'memory') return this.#memoryPeriodStamp;
		try {
			const key = analyticsStorageKeys(this.#config!.apiKey).periodStamp;
			return this.#deps.getLocalStorage()?.getItem(key) ?? undefined;
		} catch {
			return undefined;
		}
	}

	#writePeriodStamp(grantId: string): void {
		this.#memoryPeriodStamp = grantId;
		if (this.#persistence === 'memory') return;
		try {
			const key = analyticsStorageKeys(this.#config!.apiKey).periodStamp;
			this.#deps.getLocalStorage()?.setItem(key, grantId);
		} catch {
			// Without the stamp the next document starts a fresh period; never a reuse.
		}
	}

	/** A new consent period in this tab: fresh ids, nothing linked to the last period. */
	#establishPeriod(grantId: string): void {
		const sdk = this.#sdk;
		if (!sdk) return;
		this.#reconciled = false;
		sdk.opt_out_capturing();
		sdk.reset(true);
		this.#activeGrantId = grantId;
		this.#paused = false;
		this.#newEpoch();
		this.#ensureOptedIn();
		this.#writePeriodStamp(grantId);
	}

	#ensureOptedIn(): void {
		if (!this.#sdk || this.#paused || this.#localOff || !this.#consentIsActive()) return;
		this.#sdk.opt_in_capturing({ captureEventName: false });
	}

	setAuth(auth: AuthState): void {
		this.#auth = auth;
		// Whatever the SDK identity matched belongs to the previous snapshot. It is
		// checked again below, or when the route next settles.
		this.#reconciled = false;
		if (this.#sessionAfterAuthChange === 'awaiting_request' && auth.kind === 'pending') {
			this.#sessionAfterAuthChange = 'awaiting_answer';
		} else if (this.#sessionAfterAuthChange === 'awaiting_answer' && auth.kind !== 'pending') {
			this.#sessionAfterAuthChange = 'current';
		}
		this.#reconcileIdentity();
	}

	/**
	 * Call right before a sign-out or an impersonation start or stop, and pass the
	 * returned token to `endAuthChange`. Admission stays closed while any change is
	 * in flight.
	 */
	beginAuthChange(): symbol {
		const operation = Symbol('auth change');
		this.#authOperations.add(operation);
		this.#reconciled = false;
		return operation;
	}

	/**
	 * The session store started a fetch that replaces any earlier one. After a
	 * finished auth change, its answer is the first one that can be trusted.
	 */
	sessionRequested(): void {
		if (this.#sessionAfterAuthChange === 'awaiting_request') {
			this.#sessionAfterAuthChange = 'awaiting_answer';
		}
	}

	/**
	 * `unchanged`: the server refused, the previous session stands. `changed` or
	 * `unknown` (the request failed in transit): admission reopens only after the
	 * session store has fetched and answered again.
	 */
	endAuthChange(operation: symbol, outcome: 'changed' | 'unchanged' | 'unknown'): void {
		if (!this.#authOperations.delete(operation)) return;
		if (outcome !== 'unchanged') this.#sessionAfterAuthChange = 'awaiting_request';
		this.#reconcileIdentity();
	}

	#reconcileIdentity(): void {
		const sdk = this.#sdk;
		if (!sdk || this.#disposed || this.#paused || this.#localOff || !this.#authSettled()) return;
		if (!this.#routeReady() || !this.#consentIsActive()) return;
		const plan = planIdentity(this.#auth, {
			identified: sdk.get_property('$user_state') === 'identified',
			distinctId: sdk.get_distinct_id()
		});
		if (!plan.ready) {
			this.#reconciled = false;
			return;
		}
		if (plan.resetFirst) {
			this.#reconciled = false;
			sdk.reset();
			this.#newEpoch();
			this.#ensureOptedIn();
		}
		// Open before identify: the $identify event carries the anonymous-to-user merge
		// and must pass admission. No listener runs between these two statements.
		this.#reconciled = true;
		if (plan.identify) sdk.identify(plan.identify);
		this.#capturePageview();
	}

	/**
	 * A SvelteKit navigation settled. `ok` is false for error pages. Call from
	 * `afterNavigate`, registered during component init.
	 */
	setRoute(routeId: string | null, pathname: string, ok = true): void {
		this.#route = { routeId, pathname, ok };
		if (!this.#routeReady()) return;
		if (!this.#sdk) {
			const consent = this.#readConsent();
			if (consent.status === 'granted' && !this.#localOff && !this.#cancelStart) {
				this.#scheduleStart(consent.grantId);
			}
			return;
		}
		if (this.#reconciled) this.#capturePageview();
		else this.#reconcileIdentity();
	}

	/** A back/forward cache restore is a new view of the page. */
	pageRestored(): void {
		this.reconcile();
		this.#lastPageview = undefined;
		this.#reconcileIdentity();
	}

	#capturePageview(): void {
		const pathname = this.#deps.location().pathname;
		const last = this.#lastPageview;
		if (last && last.epoch === this.#epoch && last.pathname === pathname) return;
		if (!this.isAdmitted()) return;
		const result = this.#sdk?.capture('$pageview');
		if (!result) return;
		this.#lastPageview = { epoch: this.#epoch, pathname };
		this.#epochHasPageview = true;
	}

	/** Custom product events. Values are primitives; never put personal data in them. */
	capture(event: string, properties?: Record<string, string | number | boolean>): void {
		if (!this.isAdmitted()) return;
		this.#sdk?.capture(event, properties as Properties | undefined);
	}
}
