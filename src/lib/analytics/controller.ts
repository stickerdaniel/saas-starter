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
	#reconciled = false;
	/** A sign-out or impersonation change is in flight; closed until a fresh session answer. */
	#authChange: 'none' | 'started' | 'refetching' = 'none';
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
		return parseConsentCookie(this.#deps.cookies.read(), this.#deps.nowSeconds());
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
		if (!this.#config || !this.#sdk || this.#paused || this.#localOff) return false;
		if (!this.#reconciled || this.#authChange !== 'none' || !this.#routeReady()) return false;
		return this.#consentIsActive();
	}

	#beforeSend = (event: CaptureResult | null): CaptureResult | null => {
		if (!event || !this.isAdmitted()) return null;
		return sanitizeCaptureResult(event, { epochHasPageview: this.#epochHasPageview });
	};

	/** Call once in the browser after mount. */
	start(): void {
		if (!this.#config) return;
		this.#applyConsent(this.#readConsent(), 'boot');
	}

	/** Re-reads the cookie: visibility, pageshow, a message from another tab, expiry. */
	reconcile(): void {
		if (!this.#config) return;
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
		if (!this.#config) return false;
		const current = this.#readConsent();
		const alreadyActive =
			current.status === 'granted' &&
			!this.#paused &&
			!this.#localOff &&
			(!this.#sdk || current.grantId === this.#activeGrantId);
		if (alreadyActive) {
			// Confirming the current choice keeps the visitor's identity.
			this.#setState({ status: 'granted', bannerOpen: false });
			return true;
		}

		const grantId = createGrantId();
		this.#deps.cookies.write(
			grantCookie(grantId, this.#deps.nowSeconds(), this.#deps.stores.secure)
		);
		const stored = this.#readConsent();
		if (stored.status !== 'granted' || stored.grantId !== grantId) {
			this.#localOff = true;
			this.#close();
			this.#setState({ status: 'pending', bannerOpen: true });
			return false;
		}
		this.#localOff = false;
		this.#paused = false;
		this.#armExpiry(stored);
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

	/** The visitor declined or withdrew in this tab. */
	deny(): void {
		if (!this.#config) return;
		this.#deps.cookies.write(denyCookie(this.#deps.stores.secure));
		// Closed whether or not the write stuck: a failed write must not leave a grant live.
		this.#localOff = this.#readConsent().status !== 'denied';
		this.#close();
		this.#armExpiry({ status: 'denied' });
		this.#setState({ status: 'denied', bannerOpen: false });
		this.#deps.notifyOtherTabs();
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
		if (generation !== this.#startGeneration || this.#paused || this.#localOff) return false;
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

	async #load(generation: number, grantId: string): Promise<void> {
		const config = this.#config;
		if (!config || !this.#stillCurrent(generation, grantId)) return;
		const posthog = await this.#deps.loadSdk();
		if (!this.#stillCurrent(generation, grantId) || this.#sdk) return;
		if (!this.#routeReady()) {
			this.#cancelStart = undefined;
			return;
		}

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
			return;
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
		if (this.#authChange === 'started' && auth.kind === 'pending') this.#authChange = 'refetching';
		else if (this.#authChange === 'refetching' && auth.kind !== 'pending')
			this.#authChange = 'none';
		this.#reconcileIdentity();
	}

	/**
	 * Call right before a sign-out or an impersonation start or stop. The session atom
	 * keeps the previous user until its refetch runs, so this closes admission first
	 * and keeps it closed until a fresh session answer has been reconciled.
	 */
	beginAuthChange(): void {
		this.#authChange = 'started';
		this.#reconciled = false;
	}

	/** The auth change failed before any session refetch; the previous session stands. */
	cancelAuthChange(): void {
		if (this.#authChange === 'started') this.#authChange = 'none';
		this.#reconcileIdentity();
	}

	#reconcileIdentity(): void {
		const sdk = this.#sdk;
		if (!sdk || this.#paused || this.#localOff || this.#authChange !== 'none') return;
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
