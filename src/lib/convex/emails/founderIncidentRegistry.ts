import { defineFounderIncidentRegistry } from './founderIncidentTypes';

/**
 * Add reviewed application incidents here. Keys and copy are append-only after
 * their first use. Names beginning with `__` are reserved for binding tests.
 */
export const founderIncidentRegistry = defineFounderIncidentRegistry({});

export type FounderIncidentKey = keyof typeof founderIncidentRegistry;
