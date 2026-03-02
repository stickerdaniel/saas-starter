import type { FieldDefinition, ResourceDefinition } from './types';

const PEEK_EXCLUDED_TYPES = new Set(['hasMany', 'heading', 'hidden', 'password']);

/**
 * Returns fields to show in the peek popover (hover on relation links).
 * Uses explicit `showWhenPeeking` flags; falls back to first 4 detail-visible fields.
 */
export function getPeekFields(resource: ResourceDefinition<any>): FieldDefinition<any>[] {
	const explicit = resource.fields.filter((f) => f.showWhenPeeking === true);
	if (explicit.length > 0) return explicit;
	return resource.fields
		.filter((f) => f.showOnDetail !== false && !PEEK_EXCLUDED_TYPES.has(f.type))
		.slice(0, 4);
}

/**
 * Returns fields to show in the preview modal.
 * Uses explicit `showOnPreview` flags; falls back to first 6 index-visible fields.
 */
export function getPreviewFields(resource: ResourceDefinition<any>): FieldDefinition<any>[] {
	const explicit = resource.fields.filter((f) => f.showOnPreview === true);
	if (explicit.length > 0) return explicit;
	return resource.fields.filter((f) => f.showOnIndex !== false).slice(0, 6);
}
