import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import en from '../../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: () => {} } }));
vi.mock('@tolgee/svelte', () => ({
	getTranslate: () => ({
		t: {
			subscribe(run: (value: (key: string) => string) => void) {
				run((key) => (key === 'common.cancel' ? en.common.cancel : key));
				return () => {};
			}
		}
	})
}));

import { ConfirmDialog, confirm, type ConfirmOptions } from './index';

let host: ReturnType<typeof mount> | undefined;

function mountHost() {
	host = mount(ConfirmDialog, { target: document.body });
	flushSync();
}

afterEach(async () => {
	if (host) await unmount(host);
	host = undefined;
	document.body.replaceChildren();
});

function deferred() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function open(options: Partial<ConfirmOptions> = {}) {
	confirm({
		title: 'Ban User',
		description: 'Ban this user?',
		confirmText: 'Confirm',
		tone: 'destructive',
		onConfirm: async () => {},
		...options
	});
	flushSync();
}

const byTestId = <T extends HTMLElement>(id: string) =>
	document.querySelector<T>(`[data-testid="${id}"]`);
const confirmButton = () => byTestId<HTMLButtonElement>('confirm-dialog-confirm');
const cancelButton = () => byTestId<HTMLButtonElement>('confirm-dialog-cancel');
const field = () => byTestId<HTMLInputElement>('confirm-dialog-field');
const isOpen = () =>
	document.querySelector('[role="alertdialog"]')?.getAttribute('data-state') === 'open';

function typeInto(input: HTMLInputElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

function pressEscape() {
	document.dispatchEvent(
		new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
	);
	flushSync();
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ConfirmDialog', () => {
	it('calls onConfirm once when confirm is activated twice', async () => {
		mountHost();
		const pending = deferred();
		const onConfirm = vi.fn(() => pending.promise);
		open({ onConfirm });

		confirmButton()!.click();
		confirmButton()!.click();
		flushSync();

		expect(onConfirm).toHaveBeenCalledTimes(1);
		expect(confirmButton()!.disabled).toBe(true);
		expect(confirmButton()!.getAttribute('aria-busy')).toBe('true');

		pending.resolve();
		await settle();
		flushSync();
		expect(isOpen()).toBe(false);
	});

	it('cannot be dismissed while the confirmation is pending', async () => {
		mountHost();
		const pending = deferred();
		open({ onConfirm: () => pending.promise });

		confirmButton()!.click();
		flushSync();
		pressEscape();
		cancelButton()!.click();
		flushSync();

		expect(isOpen()).toBe(true);
		expect(cancelButton()!.disabled).toBe(true);

		pending.resolve();
		await settle();
	});

	it('closes on Escape when nothing is pending', () => {
		mountHost();
		open();

		pressEscape();

		expect(isOpen()).toBe(false);
	});

	it('stays open and enabled after onConfirm rejects', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mountHost();
		const pending = deferred();
		const onConfirm = vi.fn(() => pending.promise);
		open({ onConfirm, field: { label: 'Reason', placeholder: 'Reason' } });

		confirmButton()!.click();
		flushSync();
		expect(field()!.disabled).toBe(true);

		pending.reject(new Error('mutation failed'));
		await settle();
		flushSync();

		expect(isOpen()).toBe(true);
		expect(confirmButton()!.disabled).toBe(false);
		expect(cancelButton()!.disabled).toBe(false);
		expect(field()!.disabled).toBe(false);

		confirmButton()!.click();
		expect(onConfirm).toHaveBeenCalledTimes(2);
	});

	it('passes the field value to onConfirm', async () => {
		mountHost();
		const onConfirm = vi.fn(async () => {});
		open({ onConfirm, field: { label: 'Reason', placeholder: 'Reason' } });

		typeInto(field()!, 'Spam');
		confirmButton()!.click();
		await settle();

		expect(onConfirm).toHaveBeenCalledWith('Spam');
	});

	it('puts focus in the field of a confirmation that asks for one', async () => {
		mountHost();
		open({ field: { label: 'Reason', placeholder: 'Reason' } });
		await settle();

		expect(document.activeElement).toBe(field());
	});

	it('starts a new confirmation with an empty field', () => {
		mountHost();
		const fieldOptions = { field: { label: 'Reason', placeholder: 'Reason' } };
		open(fieldOptions);
		typeInto(field()!, 'Spam');
		cancelButton()!.click();
		flushSync();

		open(fieldOptions);

		expect(field()!.value).toBe('');
	});

	it('ignores a settlement that arrives after its host unmounted', async () => {
		mountHost();
		const stale = deferred();
		open({ title: 'Stale', onConfirm: () => stale.promise });
		confirmButton()!.click();
		flushSync();

		await unmount(host!);
		document.body.replaceChildren();
		mountHost();
		expect(isOpen()).toBe(false);

		open({ title: 'Fresh' });
		stale.resolve();
		await settle();
		flushSync();

		expect(isOpen()).toBe(true);
		expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Fresh');
		expect(confirmButton()!.disabled).toBe(false);
	});
});
