import { createContext } from 'svelte';
import type { RowSelectionState } from '@tanstack/table-core';
import type { NotificationRecipient } from '$lib/convex/admin/notificationPreferences/queries';

export type ToggleField = 'notifyNewSupportTickets' | 'notifyUserReplies' | 'notifyNewSignups';

export const [getTogglePreferenceContext, setTogglePreferenceContext] =
	createContext<(email: string, field: ToggleField, currentValue: boolean) => Promise<void>>();

export const [getRemoveEmailContext, setRemoveEmailContext] =
	createContext<(email: string) => Promise<void>>();

// Keep getters rather than snapshots: selection and optimistic rows change in place.
export const [getRowSelectionContext, setRowSelectionContext] =
	createContext<() => RowSelectionState>();

export const [getRecipientsContext, setRecipientsContext] =
	createContext<() => NotificationRecipient[]>();
