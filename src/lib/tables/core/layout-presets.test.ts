import { describe, expect, it } from 'vitest';
import type { ColumnDef } from '@tanstack/table-core';
import { getTableSkeletonColumnsFromColumnDefs } from '$lib/components/tables/table-loading-skeleton.js';
import {
	applyColumnLayoutPreset,
	buildColumnStyle,
	COLUMN_LAYOUT_PRESETS,
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

	it('keeps inline action preset widths stable', () => {
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
			cellClass: '[&:has([role=checkbox])]:ps-3'
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
		const invalidWidth = buildColumnStyle({ width: Number.NaN });

		expect(widthOnly).toBe('width: 140px;');
		expect(widthWithInvalidMin).toBe('width: 140px;');
		expect(invalidWidth).toBe('');
		expect(widthOnly).not.toContain('undefinedpx');
		expect(widthWithInvalidMin).not.toContain('undefinedpx');
	});
});
