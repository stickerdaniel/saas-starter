import { describe, expect, it } from 'vitest';
import type { ColumnDef } from '@tanstack/table-core';
import { getTableSkeletonColumnsFromColumnDefs } from '$lib/components/tables/table-loading-skeleton.js';
import {
	applyColumnLayoutPreset,
	buildColumnStyle,
	COLUMN_LAYOUT_PRESETS,
	getColumnStyleArgs,
	getResourceFieldLayoutPreset
} from './layout-presets';

type Row = { id: string };

describe('table layout presets', () => {
	it('maps resource field types to deterministic presets', () => {
		expect(
			getResourceFieldLayoutPreset({
				fieldType: 'select',
				attribute: 'status',
				inlineEditable: true
			})
		).toBe(COLUMN_LAYOUT_PRESETS.inlineSelect);

		expect(
			getResourceFieldLayoutPreset({
				fieldType: 'select',
				attribute: 'status',
				inlineEditable: false
			})
		).toBe(COLUMN_LAYOUT_PRESETS.badgeMd);

		expect(
			getResourceFieldLayoutPreset({
				fieldType: 'boolean',
				attribute: 'isFeatured',
				inlineEditable: true
			})
		).toBe(COLUMN_LAYOUT_PRESETS.inlineCheckbox);

		expect(
			getResourceFieldLayoutPreset({
				fieldType: 'boolean',
				attribute: 'isFeatured',
				inlineEditable: false
			})
		).toBe(COLUMN_LAYOUT_PRESETS.badgeSm);

		expect(
			getResourceFieldLayoutPreset({
				fieldType: 'text',
				attribute: 'ownerEmail',
				inlineEditable: false
			})
		).toBe(COLUMN_LAYOUT_PRESETS.email);

		expect(
			getResourceFieldLayoutPreset({
				fieldType: 'belongsTo',
				attribute: 'projectId',
				inlineEditable: false
			})
		).toBe(COLUMN_LAYOUT_PRESETS.relationTitle);
	});

	it('maps new field types to correct presets', () => {
		expect(
			getResourceFieldLayoutPreset({
				fieldType: 'color',
				attribute: 'color',
				inlineEditable: false
			})
		).toBe(COLUMN_LAYOUT_PRESETS.colorSwatch);

		expect(
			getResourceFieldLayoutPreset({
				fieldType: 'avatar',
				attribute: 'avatar',
				inlineEditable: false
			})
		).toBe(COLUMN_LAYOUT_PRESETS.avatar);

		expect(
			getResourceFieldLayoutPreset({
				fieldType: 'currency',
				attribute: 'price',
				inlineEditable: false
			})
		).toBe(COLUMN_LAYOUT_PRESETS.currency);

		expect(
			getResourceFieldLayoutPreset({
				fieldType: 'status',
				attribute: 'status',
				inlineEditable: false
			})
		).toBe(COLUMN_LAYOUT_PRESETS.badgeMd);

		expect(
			getResourceFieldLayoutPreset({
				fieldType: 'password',
				attribute: 'password',
				inlineEditable: false
			})
		).toBe(COLUMN_LAYOUT_PRESETS.textSm);

		expect(
			getResourceFieldLayoutPreset({
				fieldType: 'slug',
				attribute: 'slug',
				inlineEditable: false
			})
		).toBe(COLUMN_LAYOUT_PRESETS.textMd);

		expect(
			getResourceFieldLayoutPreset({
				fieldType: 'booleanGroup',
				attribute: 'permissions',
				inlineEditable: false
			})
		).toBe(COLUMN_LAYOUT_PRESETS.badgeSm);

		expect(
			getResourceFieldLayoutPreset({
				fieldType: 'multiselect',
				attribute: 'tags',
				inlineEditable: false
			})
		).toBe(COLUMN_LAYOUT_PRESETS.textMd);

		expect(
			getResourceFieldLayoutPreset({
				fieldType: 'keyValue',
				attribute: 'metadata',
				inlineEditable: false
			})
		).toBe(COLUMN_LAYOUT_PRESETS.badgeSm);
	});

	it('keeps inline action preset widths stable', () => {
		expect(COLUMN_LAYOUT_PRESETS.selectCheckbox.meta.sizingMode).toBe('fixed');
		expect(COLUMN_LAYOUT_PRESETS.actionsMenu.meta.sizingMode).toBe('fixed');
		expect(COLUMN_LAYOUT_PRESETS.actionsInline3.size).toBe(128);
		expect(COLUMN_LAYOUT_PRESETS.actionsInline4.size).toBe(168);
		expect(COLUMN_LAYOUT_PRESETS.actionsInline4.minSize).toBe(168);
		expect(COLUMN_LAYOUT_PRESETS.actionsInline4.maxSize).toBe(168);
	});

	it('derives skeleton variants from shared column metadata', () => {
		const columns: ColumnDef<Row>[] = [
			applyColumnLayoutPreset({
				preset: COLUMN_LAYOUT_PRESETS.selectCheckbox,
				column: {
					id: 'select',
					header: 'Select',
					cell: () => 'select'
				}
			}),
			applyColumnLayoutPreset({
				preset: COLUMN_LAYOUT_PRESETS.inlineSelect,
				column: {
					id: 'status',
					header: 'Status',
					cell: () => 'status'
				}
			}),
			applyColumnLayoutPreset({
				preset: COLUMN_LAYOUT_PRESETS.actionsInline3,
				column: {
					id: 'actions',
					header: 'Actions',
					cell: () => 'actions'
				}
			})
		];

		const skeletonColumns = getTableSkeletonColumnsFromColumnDefs(columns);
		const selectSkeleton = skeletonColumns.find((column) => column.key === 'select');
		const statusSkeleton = skeletonColumns.find((column) => column.key === 'status');
		const actionsSkeleton = skeletonColumns.find((column) => column.key === 'actions');

		expect(selectSkeleton).toMatchObject({
			kind: 'checkbox',
			cellClass: '[&:has([role=checkbox])]:px-0'
		});
		expect(statusSkeleton).toMatchObject({
			kind: 'selectTrigger'
		});
		expect(actionsSkeleton).toMatchObject({
			kind: 'iconButtonGroup',
			iconCount: 3
		});
	});

	it('guards style generation against undefined/NaN values', () => {
		const widthOnly = buildColumnStyle({ width: 140 });
		const widthWithInvalidMin = buildColumnStyle({ width: 140, minWidth: Number.NaN });
		const fixedWidth = buildColumnStyle({ width: 40, minWidth: 40, maxWidth: 40 });
		const widthWithInvalidMax = buildColumnStyle({ width: 140, maxWidth: Number.NaN });
		const invalidWidth = buildColumnStyle({ width: Number.NaN });
		const minOnly = buildColumnStyle({ minWidth: 120 });

		expect(widthOnly).toBe('width: 140px;');
		expect(widthWithInvalidMin).toBe('width: 140px;');
		expect(fixedWidth).toBe('width: 40px; min-width: 40px; max-width: 40px;');
		expect(widthWithInvalidMax).toBe('width: 140px;');
		expect(invalidWidth).toBe('');
		expect(minOnly).toBe('min-width: 120px;');
		expect(widthOnly).not.toContain('undefinedpx');
		expect(widthWithInvalidMin).not.toContain('undefinedpx');
		expect(fixedWidth).not.toContain('undefinedpx');
		expect(widthWithInvalidMax).not.toContain('undefinedpx');
	});

	it('computes fixed vs fluid style args from sizing mode', () => {
		expect(
			getColumnStyleArgs({
				size: 40,
				minSize: 40,
				maxSize: 40,
				meta: { sizingMode: 'fixed' }
			})
		).toEqual({
			width: 40,
			minWidth: 40,
			maxWidth: 40
		});

		expect(
			getColumnStyleArgs({
				size: 180,
				minSize: 140
			})
		).toEqual({
			minWidth: 140
		});
	});
});
