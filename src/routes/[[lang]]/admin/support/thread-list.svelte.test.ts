import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import type { PaginationStatus } from 'convex/browser';
import en from '../../../../i18n/en.json';
import de from '../../../../i18n/de.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('@tolgee/svelte', async () => {
	const { translation } = await import('./test-fixtures/translation');
	const { default: T } = await import('./test-fixtures/translated-key.svelte');
	return { getTranslate: () => ({ t: translation }), T };
});
vi.mock('$app/state', () => ({
	page: { data: { lang: 'en' }, params: {}, url: new URL('http://localhost/en/admin/support') }
}));
vi.mock('#lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: () => {} } }));

import { useDictionary } from './test-fixtures/translation';
import ThreadList from './thread-list.svelte';

/**
 * The browser's IntersectionObserver, reduced to what the list depends on: an
 * observer reports its target once when it starts observing, and again when
 * the target moves in or out of view. Nothing else produces an intersection,
 * so every load below comes from an observation the list itself arranged or
 * from a simulated scroll.
 */
const viewport = { sentinelVisible: false, sentinelObservations: 0 };
const observers = new Set<ControlledObserver>();

class ControlledObserver {
	target: Element | undefined;
	constructor(private callback: IntersectionObserverCallback) {}
	observe(target: Element) {
		this.target = target;
		observers.add(this);
		if (!isSentinel(target)) return;
		viewport.sentinelObservations++;
		// Like the browser, the first report arrives in a later task.
		setTimeout(() => this.report(), 0);
	}
	disconnect() {
		observers.delete(this);
	}
	unobserve() {}
	takeRecords() {
		return [];
	}
	report() {
		if (!observers.has(this) || !this.target) return;
		const entry = { isIntersecting: viewport.sentinelVisible, target: this.target };
		this.callback([entry as IntersectionObserverEntry], this as unknown as IntersectionObserver);
	}
}

function isSentinel(target: Element) {
	return target.classList.contains('infinite-intersection-target');
}

function reportSentinel() {
	for (const observer of observers) {
		if (observer.target && isSentinel(observer.target)) observer.report();
	}
}

/** The user scrolls the end of the list out of view and back. */
async function scrollToEnd() {
	viewport.sentinelVisible = false;
	reportSentinel();
	viewport.sentinelVisible = true;
	reportSentinel();
	await settle();
}

/**
 * Runs effects, promise continuations and the observer's reports. A zero-delay
 * timer created while the fake clock ticks is due a millisecond later, so each
 * step moves the clock by one.
 */
async function settle() {
	for (let i = 0; i < 10; i++) {
		flushSync();
		await vi.advanceTimersByTimeAsync(1);
	}
	flushSync();
}

type Thread = {
	_id: string;
	_creationTime: number;
	status: 'active';
	lastMessage: string;
	supportMetadata: {
		_id: string;
		_creationTime: number;
		threadId: string;
		status: 'open' | 'done';
		priority?: 'low' | 'medium' | 'high';
		createdAt: number;
		updatedAt: number;
	};
};

let nextRow = 0;
function rows(count: number, overrides: Partial<Thread['supportMetadata']> = {}): Thread[] {
	return Array.from({ length: count }, () => {
		const id = `thread_${++nextRow}`;
		return {
			_id: id,
			_creationTime: 0,
			status: 'active',
			lastMessage: `Message ${id}`,
			supportMetadata: {
				_id: `meta_${id}`,
				_creationTime: 0,
				threadId: id,
				status: 'open',
				createdAt: 0,
				updatedAt: 0,
				...overrides
			}
		};
	});
}

/**
 * The paginated query as the page hands it on. `loadMore` behaves like
 * convex-svelte's: it only acts in CanLoadMore and then reports LoadingMore.
 */
function createQuery(initial: {
	threads?: Thread[];
	status?: PaginationStatus;
	isLoading?: boolean;
	queryIdentity?: string;
}) {
	const query = $state({
		threads: initial.threads ?? rows(25),
		status: initial.status ?? ('CanLoadMore' as PaginationStatus),
		isLoading: initial.isLoading ?? false,
		error: undefined as Error | undefined,
		queryIdentity: initial.queryIdentity ?? '{"filter":"all","status":"open"}'
	});
	const loadMore = vi.fn((): boolean => {
		if (query.status !== 'CanLoadMore') return false;
		query.status = 'LoadingMore';
		query.isLoading = true;
		return true;
	});
	return {
		query,
		loadMore,
		deliverPage(count: number, { last = false } = {}) {
			query.threads = [...query.threads, ...rows(count)];
			query.status = last ? 'Exhausted' : 'CanLoadMore';
			query.isLoading = false;
			query.error = undefined;
		}
	};
}

let component: ReturnType<typeof mount> | undefined;

function renderList(source: ReturnType<typeof createQuery>) {
	const { query, loadMore } = source;
	component = mount(ThreadList, {
		target: document.body,
		props: {
			filterMode: 'all',
			statusFilter: 'open',
			searchQuery: '',
			selectedThreadId: null,
			get threads() {
				return query.threads;
			},
			get status() {
				return query.status;
			},
			get isLoading() {
				return query.isLoading;
			},
			get error() {
				return query.error;
			},
			get queryIdentity() {
				return query.queryIdentity;
			},
			onFilterChange: () => {},
			onStatusChange: () => {},
			onSearchChange: () => {},
			onThreadSelect: () => {},
			onLoadMore: loadMore
		}
	});
}

const renderedRows = () => document.querySelectorAll('[data-tolgee-restricted] h3').length;
const skeletons = () => document.querySelectorAll('[data-slot="skeleton"]').length;
const loadingMore = () => document.body.textContent?.includes(en.admin.support.thread.loading);
const statusRegion = () => document.querySelector('[role="status"]');
const buttonLabels = () =>
	[...document.querySelectorAll('button')].map((button) => button.textContent?.trim());

beforeEach(() => {
	vi.useFakeTimers();
	useDictionary(en);
	viewport.sentinelVisible = false;
	viewport.sentinelObservations = 0;
	observers.clear();
	vi.stubGlobal('IntersectionObserver', ControlledObserver);
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('ThreadList loading', () => {
	it('shows skeletons only while the list has no rows', async () => {
		const source = createQuery({ threads: [], status: 'LoadingFirstPage', isLoading: true });
		renderList(source);
		await settle();
		expect(skeletons()).toBeGreaterThan(0);

		source.deliverPage(25);
		await settle();
		expect(skeletons()).toBe(0);
		expect(renderedRows()).toBe(25);
	});

	it('keeps the rows on screen while the next page loads', async () => {
		const source = createQuery({});
		renderList(source);
		await settle();
		await scrollToEnd();

		expect(source.loadMore).toHaveBeenCalledTimes(1);
		expect(renderedRows()).toBe(25);
		expect(skeletons()).toBe(0);
		expect(loadingMore()).toBe(true);

		source.deliverPage(25);
		await settle();
		expect(renderedRows()).toBe(50);
	});

	it('neither finishes nor loads twice when the end is seen again while a page loads', async () => {
		const source = createQuery({});
		renderList(source);
		await settle();
		await scrollToEnd();
		await scrollToEnd();

		expect(source.loadMore).toHaveBeenCalledTimes(1);
		expect(loadingMore()).toBe(true);

		// Still loading, not finished: the page that arrives lets the next one load.
		source.deliverPage(25);
		await settle();
		expect(source.loadMore).toHaveBeenCalledTimes(2);
	});

	it('loads exactly one more page when a page arrives and the end is still in view', async () => {
		const source = createQuery({});
		renderList(source);
		await settle();
		await scrollToEnd();
		const observations = viewport.sentinelObservations;

		source.deliverPage(25);
		await settle();

		expect(viewport.sentinelObservations).toBe(observations + 1);
		expect(source.loadMore).toHaveBeenCalledTimes(2);
		expect(loadingMore()).toBe(true);
	});

	it('waits for the page under way when loadMore declines', async () => {
		const source = createQuery({});
		// The query had already started a page of its own, so loadMore declines.
		source.loadMore.mockImplementationOnce(() => {
			source.query.status = 'LoadingMore';
			source.query.isLoading = true;
			return false;
		});
		renderList(source);
		await settle();
		await scrollToEnd();
		expect(loadingMore()).toBe(true);

		source.deliverPage(25);
		await settle();
		expect(renderedRows()).toBe(50);
		// Not taken as the end of the list: the next page loads.
		expect(source.loadMore).toHaveBeenCalledTimes(2);
	});

	it('settles an attempt whose page was available at once', async () => {
		const source = createQuery({});
		source.loadMore.mockImplementationOnce(() => {
			source.deliverPage(25);
			return true;
		});
		renderList(source);
		await settle();
		await scrollToEnd();

		expect(renderedRows()).toBe(50);
		// The attempt finished, so the end that is still in view loads the next page.
		expect(source.loadMore).toHaveBeenCalledTimes(2);
	});

	it('settles an attempt that waited for a changed query to load its first page', async () => {
		const source = createQuery({});
		renderList(source);
		await settle();
		// The search changes; the previous rows stay while the new query loads.
		source.query.queryIdentity = '{"filter":"all","search":"refund","status":"open"}';
		source.query.status = 'LoadingFirstPage';
		source.query.isLoading = true;
		await settle();
		await scrollToEnd();

		expect(source.loadMore).not.toHaveBeenCalled();
		expect(renderedRows()).toBe(25);
		expect(loadingMore()).toBe(true);

		source.query.threads = rows(25);
		source.query.status = 'CanLoadMore';
		source.query.isLoading = false;
		await settle();

		expect(source.loadMore).toHaveBeenCalledTimes(1);
		expect(loadingMore()).toBe(true);
	});
});

describe('ThreadList load failures', () => {
	it('reports a failure after the last page in the region that was already there', async () => {
		const source = createQuery({});
		renderList(source);
		await settle();
		const region = statusRegion();
		expect(region?.textContent?.trim()).toBe('');

		await scrollToEnd();
		source.deliverPage(5, { last: true });
		await settle();
		expect(source.loadMore).toHaveBeenCalledTimes(1);

		source.query.error = new Error('subscription failed');
		await settle();
		expect(statusRegion()).toBe(region);
		expect(region?.textContent).toContain(en.admin.support.thread.load_failed);
		expect(renderedRows()).toBe(30);

		source.query.error = undefined;
		await settle();
		expect(statusRegion()).toBe(region);
		expect(region?.textContent?.trim()).toBe('');
		expect(source.loadMore).toHaveBeenCalledTimes(1);
	});

	it('reports a failure that leaves the page status as it was and asks for nothing more', async () => {
		const source = createQuery({});
		renderList(source);
		await settle();
		const region = statusRegion();
		await scrollToEnd();
		expect(source.loadMore).toHaveBeenCalledTimes(1);

		// convex-svelte keeps LoadingMore when the page fails.
		source.query.error = new Error('page failed');
		source.query.isLoading = false;
		await settle();
		expect(source.query.status).toBe('LoadingMore');
		expect(statusRegion()).toBe(region);
		expect(region?.textContent).toContain(en.admin.support.thread.load_failed);
		expect(loadingMore()).toBe(false);

		await scrollToEnd();
		expect(source.loadMore).toHaveBeenCalledTimes(1);
		expect(buttonLabels()).not.toContain('Retry');
	});

	it('asks for nothing while the end is in view during a failure, and loads once after recovery', async () => {
		const source = createQuery({});
		source.query.error = new Error('subscription failed');
		renderList(source);
		await settle();
		await scrollToEnd();

		expect(source.loadMore).not.toHaveBeenCalled();
		expect(statusRegion()?.textContent).toContain(en.admin.support.thread.load_failed);
		expect(document.body.textContent).not.toContain('Oops, something went wrong');

		const observations = viewport.sentinelObservations;
		source.query.error = undefined;
		await settle();

		expect(viewport.sentinelObservations).toBe(observations + 1);
		expect(source.loadMore).toHaveBeenCalledTimes(1);
	});

	it('shows the error instead of the list when nothing has loaded', async () => {
		const source = createQuery({ threads: [], status: 'LoadingFirstPage' });
		source.query.error = new Error('subscription failed');
		renderList(source);
		await settle();

		expect(document.querySelector('[data-testid="admin-support-threads-error"]')).not.toBeNull();
		expect(skeletons()).toBe(0);
	});
});

describe('ThreadList query changes', () => {
	it('keeps the new attempt busy after the previous query’s attempt has ended', async () => {
		const source = createQuery({});
		renderList(source);
		await settle();
		await scrollToEnd();
		expect(source.loadMore).toHaveBeenCalledTimes(1);

		// The filter changes while that page is still loading. The query keeps its
		// rows and status until the new arguments answer.
		source.query.queryIdentity = '{"filter":"unassigned","status":"open"}';
		await settle();
		source.query.threads = rows(25);
		source.query.status = 'CanLoadMore';
		source.query.isLoading = false;
		await settle();

		// The new query loads its next page on a fresh observation.
		expect(source.loadMore).toHaveBeenCalledTimes(2);
		expect(loadingMore()).toBe(true);

		await scrollToEnd();
		await vi.advanceTimersByTimeAsync(1000);
		await settle();
		expect(loadingMore()).toBe(true);
		expect(source.loadMore).toHaveBeenCalledTimes(2);
	});

	it('loads once when a changed query becomes ready after the previous one had ended', async () => {
		const source = createQuery({});
		renderList(source);
		await settle();
		await scrollToEnd();
		source.deliverPage(5, { last: true });
		await settle();
		await scrollToEnd();
		expect(source.loadMore).toHaveBeenCalledTimes(1);

		source.query.queryIdentity = '{"filter":"unassigned","status":"open"}';
		source.query.isLoading = true;
		await settle();
		expect(renderedRows()).toBe(30);
		expect(source.loadMore).toHaveBeenCalledTimes(1);

		source.query.threads = rows(25);
		source.query.status = 'CanLoadMore';
		source.query.isLoading = false;
		await settle();

		expect(source.loadMore).toHaveBeenCalledTimes(2);
	});

	it('loads on after the query restarts its pagination with the same arguments', async () => {
		const source = createQuery({});
		renderList(source);
		await settle();
		await scrollToEnd();
		source.deliverPage(5, { last: true });
		await settle();
		expect(source.loadMore).toHaveBeenCalledTimes(1);

		// convex-svelte answers an invalid cursor by reloading the first page of the
		// unchanged arguments.
		source.query.threads = [];
		source.query.status = 'LoadingFirstPage';
		source.query.isLoading = true;
		await settle();
		source.query.threads = rows(25);
		source.query.status = 'CanLoadMore';
		source.query.isLoading = false;
		await settle();

		expect(renderedRows()).toBe(25);
		expect(source.loadMore).toHaveBeenCalledTimes(2);
	});

	it('does not take the previous query’s last page as the end of my inbox once the viewer resolves', async () => {
		// My inbox lists every thread until the viewer is known, then only theirs.
		const source = createQuery({ queryIdentity: '{"filter":"all","status":"open"}' });
		renderList(source);
		await settle();
		await scrollToEnd();
		expect(source.loadMore).toHaveBeenCalledTimes(1);

		// The list can see the new arguments before the query has taken them up,
		// with the previous query's final page in place.
		source.query.queryIdentity = '{"filter":{"assignedTo":"admin_1"},"status":"open"}';
		source.deliverPage(5, { last: true });
		await settle();
		source.query.isLoading = true;
		await settle();
		expect(source.loadMore).toHaveBeenCalledTimes(1);

		source.query.threads = rows(25);
		source.query.status = 'CanLoadMore';
		source.query.isLoading = false;
		await settle();

		expect(source.loadMore).toHaveBeenCalledTimes(2);
	});
});

describe('ThreadList loop guard', () => {
	it('loads again by itself once the loader has cooled down', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const source = createQuery({});
		// Every page is available at once, as on a tall screen with a warm cache.
		source.loadMore.mockImplementation(() => {
			source.deliverPage(1, { last: source.loadMore.mock.calls.length >= 6 });
			return true;
		});
		viewport.sentinelVisible = true;
		renderList(source);
		await settle();

		// Five loads in a row trip the guard; the re-observation that follows the
		// fifth arrives while it cools down and is dropped.
		expect(source.loadMore).toHaveBeenCalledTimes(5);
		const observations = viewport.sentinelObservations;

		// The default cooldown is 3,000 ms.
		await vi.advanceTimersByTimeAsync(2500);
		await settle();
		expect(source.loadMore).toHaveBeenCalledTimes(5);
		expect(viewport.sentinelObservations).toBe(observations);

		await vi.advanceTimersByTimeAsync(500);
		await settle();
		expect(viewport.sentinelObservations).toBe(observations + 1);
		expect(source.loadMore).toHaveBeenCalledTimes(6);
		expect(document.body.textContent).not.toContain('Potential loop detected');
	});
});

describe('ThreadList labels', () => {
	it('shows status, priority and the anonymous customer in the reader’s language', async () => {
		useDictionary(de);
		const source = createQuery({
			threads: [...rows(1, { priority: 'high' }), ...rows(1, { status: 'done', priority: 'low' })],
			status: 'Exhausted'
		});
		renderList(source);
		await settle();

		const text = document.body.textContent ?? '';
		expect(text).toContain(de.admin.support.priority.high);
		expect(text).toContain(de.admin.support.priority.low);
		expect(text).toContain(de.admin.support.status.open);
		expect(text).toContain(de.admin.support.status.done);
		expect(text).toContain(de.admin.support.anonymous);
		expect(text).not.toMatch(/\b(high|low|open|done|Anonymous)\b/);
	});
});
