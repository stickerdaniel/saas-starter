import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import type { AuditLogItem } from '$lib/convex/admin/auditLog/queries';
import en from '../../../../i18n/en.json';
import de from '../../../../i18n/de.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

type Translate = (key: string, params?: Record<string, unknown>) => string;

// Tolgee publishes a new translation function whenever the language or its
// dictionary changes; the mock does the same with the checked-in dictionaries.
const translation = vi.hoisted(() => {
	let current: Translate = () => '';
	const subscribers = new Set<(value: Translate) => void>();
	return {
		subscribe(run: (value: Translate) => void) {
			run(current);
			subscribers.add(run);
			return () => void subscribers.delete(run);
		},
		set(next: Translate) {
			current = next;
			for (const run of subscribers) run(next);
		}
	};
});
vi.mock('@tolgee/svelte', () => ({ getTranslate: () => ({ t: translation }) }));

import DetailsCell from './details-cell.svelte';

function translator(dictionary: object): Translate {
	return (key, params = {}) => {
		const template = key
			.split('.')
			.reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], dictionary);
		if (typeof template !== 'string') throw new Error(`Missing translation ${key}`);
		return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]));
	};
}

const TEST_ID = 'audit-log-details-cell';
const LONG_REASON = 'Repeated spam in support threads after several warnings from the team';

// jsdom lays nothing out. Model a 100px details column whose text needs 8px per character.
beforeEach(() => {
	translation.set(translator(en));
	const inCell = (element: HTMLElement) => element.parentElement?.dataset.testid === TEST_ID;
	vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
		this: HTMLElement
	) {
		return inCell(this) ? 100 : 0;
	});
	vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
		this: HTMLElement
	) {
		return inCell(this) ? Math.max(100, (this.textContent?.length ?? 0) * 8) : 0;
	});
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
});

let component: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

async function settle() {
	flushSync();
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
}

const cell = () => document.querySelector<HTMLElement>(`[data-testid="${TEST_ID}"]`)!;
const text = () => cell().textContent?.trim();
const tooltip = () => document.querySelector<HTMLElement>('[data-slot="tooltip-content"]');

it('shows each kind of audit detail and follows metadata and language changes', async () => {
	const props = $state<{ metadata: AuditLogItem['metadata']; lang: string; testId: string }>({
		metadata: { reason: LONG_REASON },
		lang: 'en',
		testId: TEST_ID
	});
	component = mount(DetailsCell, { target: document.body, props });
	await settle();

	expect(text()).toBe(LONG_REASON);
	cell().firstElementChild!.dispatchEvent(
		new PointerEvent('pointerenter', { pointerType: 'mouse' })
	);
	await settle();
	expect(tooltip()?.textContent?.trim()).toBe(LONG_REASON);

	props.metadata = { previousRole: 'user', newRole: 'admin' };
	await settle();
	expect(text()).toBe('user → admin');

	props.metadata = { durationMs: 120_000 };
	await settle();
	expect(text()).toBe('Lasted 2 min');

	props.metadata = {};
	await settle();
	expect(text()).toBe('-');

	props.metadata = undefined;
	await settle();
	expect(text()).toBe('-');

	// A zero duration is still a recorded duration, not missing metadata.
	props.metadata = { durationMs: 0 };
	await settle();
	expect(text()).toBe('Lasted 0 sec');

	// The route updates the language before Tolgee publishes the new dictionary.
	props.lang = 'de';
	await settle();
	translation.set(translator(de));
	await settle();
	expect(text()).toBe('Dauer 0 Sek.');
});
