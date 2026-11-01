import { createContext } from 'svelte';
import type { RowSelectionState } from '@tanstack/table-core';
import type {
	NotificationRecipient,
	NotificationToggleField
} from '#lib/convex/admin/notificationPreferences/queries.js';

export type ToggleField = NotificationToggleField;

export const [getTogglePreferenceContext, setTogglePreferenceContext] =
	createContext<(email: string, field: ToggleField, currentValue: boolean) => Promise<void>>();

// Sets one toggle for several recipients in one all-or-nothing update.
export const [getPreferenceForManyContext, setPreferenceForManyContext] =
	createContext<(emails: string[], field: ToggleField, value: boolean) => Promise<void>>();

export const [getRemoveEmailContext, setRemoveEmailContext] =
	createContext<(email: string) => Promise<void>>();

// Keep getters rather than snapshots: selection and optimistic rows change in place.
export const [getRowSelectionContext, setRowSelectionContext] =
	createContext<() => RowSelectionState>();

export const [getRecipientsContext, setRecipientsContext] =
	createContext<() => NotificationRecipient[]>();
