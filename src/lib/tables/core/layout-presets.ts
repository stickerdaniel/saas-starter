import type { ColumnDef, RowData } from '@tanstack/table-core';
import type { TableColumnMeta } from './types';

export type CanonicalColumnMeta = TableColumnMeta;

// Augment TanStack column metadata with canonical table layout metadata.
declare module '@tanstack/table-core' {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	interface ColumnMeta<TData extends RowData, TValue> {
		headClass?: TableColumnMeta['headClass'];
		cellClass?: TableColumnMeta['cellClass'];
		skeleton?: TableColumnMeta['skeleton'];
	}
}

export type ColumnLayoutPreset = {
	size: number;
	minSize: number;
	maxSize?: number;
	meta?: TableColumnMeta;
};

export const COLUMN_LAYOUT_PRESETS = {
	selectCheckbox: {
		size: 40,
		minSize: 40,
		maxSize: 40,
		meta: {
			headClass: '[&:has([role=checkbox])]:ps-3',
			cellClass: '[&:has([role=checkbox])]:ps-3',
			skeleton: {
				kind: 'checkbox',
				cellClass: '[&:has([role=checkbox])]:ps-3'
			}
		}
	},
	actionsMenu: {
		size: 50,
		minSize: 50,
		maxSize: 50,
		meta: {
			headClass: 'text-right',
			cellClass: 'text-right',
			skeleton: {
				kind: 'iconButton',
				cellClass: 'text-right'
			}
		}
	},
	actionsInline3: {
		size: 128,
		minSize: 128,
		maxSize: 128,
		meta: {
			headClass: 'text-right',
			cellClass: 'text-right',
			skeleton: {
				kind: 'iconButtonGroup',
				iconCount: 3,
				cellClass: 'text-right'
			}
		}
	},
	actionsInline4: {
		size: 168,
		minSize: 168,
		maxSize: 168,
		meta: {
			headClass: 'text-right',
			cellClass: 'text-right',
			skeleton: {
				kind: 'iconButtonGroup',
				iconCount: 4,
				cellClass: 'text-right'
			}
		}
	},
	textSm: {
		size: 120,
		minSize: 100,
		meta: {
			skeleton: {
				kind: 'text',
				widthClass: 'w-20'
			}
		}
	},
	textMd: {
		size: 180,
		minSize: 140,
		meta: {
			skeleton: {
				kind: 'text',
				widthClass: 'w-24'
			}
		}
	},
	textLg: {
		size: 250,
		minSize: 200,
		meta: {
			skeleton: {
				kind: 'text',
				widthClass: 'w-40'
			}
		}
	},
	avatarText: {
		size: 180,
		minSize: 180,
		meta: {
			skeleton: {
				kind: 'avatarText',
				widthClass: 'w-20'
			}
		}
	},
	email: {
		size: 250,
		minSize: 200,
		meta: {
			skeleton: {
				kind: 'text',
				widthClass: 'w-40'
			}
		}
	},
	badgeSm: {
		size: 100,
		minSize: 80,
		meta: {
			skeleton: {
				kind: 'badge',
				widthClass: 'w-12'
			}
		}
	},
	badgeMd: {
		size: 120,
		minSize: 100,
		meta: {
			skeleton: {
				kind: 'badge',
				widthClass: 'w-14'
			}
		}
	},
	date: {
		size: 120,
		minSize: 110,
		meta: {
			skeleton: {
				kind: 'text',
				widthClass: 'w-20'
			}
		}
	},
	number: {
		size: 110,
		minSize: 100,
		meta: {
			skeleton: {
				kind: 'text',
				widthClass: 'w-16'
			}
		}
	},
	inlineSelect: {
		size: 140,
		minSize: 120,
		meta: {
			skeleton: {
				kind: 'selectTrigger',
				widthClass: 'w-24'
			}
		}
	},
	inlineCheckbox: {
		size: 100,
		minSize: 100,
		meta: {
			headClass: 'text-center',
			cellClass: 'text-center',
			skeleton: {
				kind: 'checkbox',
				cellClass: 'text-center'
			}
		}
	},
	relationTitle: {
		size: 220,
		minSize: 180,
		meta: {
			skeleton: {
				kind: 'text',
				widthClass: 'w-32'
			}
		}
	}
} as const satisfies Record<string, ColumnLayoutPreset>;

function mergeMeta(base: CanonicalColumnMeta | undefined, extra: CanonicalColumnMeta | undefined) {
	if (!base && !extra) return undefined;
	return {
		...(base ?? {}),
		...(extra ?? {}),
		skeleton: {
			...(base?.skeleton ?? {}),
			...(extra?.skeleton ?? {})
		}
	} satisfies CanonicalColumnMeta;
}

export function applyColumnLayoutPreset<TData extends RowData>(args: {
	column: ColumnDef<TData>;
	preset: ColumnLayoutPreset;
	overrides?: Partial<ColumnLayoutPreset>;
}) {
	const merged: ColumnLayoutPreset = {
		...args.preset,
		...(args.overrides ?? {}),
		meta: mergeMeta(args.preset.meta, args.overrides?.meta)
	};

	return {
		...args.column,
		size: merged.size,
		minSize: merged.minSize,
		maxSize: merged.maxSize,
		meta: mergeMeta(args.column.meta as CanonicalColumnMeta | undefined, merged.meta)
	} as ColumnDef<TData>;
}

export function getResourceFieldLayoutPreset(args: {
	fieldType: string;
	attribute: string;
	inlineEditable: boolean;
}) {
	const attribute = args.attribute.toLowerCase();
	if (args.fieldType === 'image') return COLUMN_LAYOUT_PRESETS.avatarText;
	if (args.fieldType === 'email' || attribute.includes('email')) return COLUMN_LAYOUT_PRESETS.email;
	if (args.fieldType === 'date' || args.fieldType === 'datetime') return COLUMN_LAYOUT_PRESETS.date;
	if (args.fieldType === 'number') return COLUMN_LAYOUT_PRESETS.number;
	if (args.fieldType === 'badge') return COLUMN_LAYOUT_PRESETS.badgeMd;
	if (args.fieldType === 'select') {
		return args.inlineEditable ? COLUMN_LAYOUT_PRESETS.inlineSelect : COLUMN_LAYOUT_PRESETS.badgeMd;
	}
	if (args.fieldType === 'boolean') {
		return args.inlineEditable
			? COLUMN_LAYOUT_PRESETS.inlineCheckbox
			: COLUMN_LAYOUT_PRESETS.badgeSm;
	}
	if (
		args.fieldType === 'belongsTo' ||
		args.fieldType === 'manyToMany' ||
		args.fieldType === 'morphTo'
	) {
		return COLUMN_LAYOUT_PRESETS.relationTitle;
	}
	if (args.fieldType === 'hasMany') return COLUMN_LAYOUT_PRESETS.badgeSm;
	if (attribute.includes('title') || attribute.includes('name'))
		return COLUMN_LAYOUT_PRESETS.textMd;
	return COLUMN_LAYOUT_PRESETS.textMd;
}

export function buildColumnStyle(args: { width: number; minWidth?: number }) {
	const parts: string[] = [];
	if (Number.isFinite(args.width)) {
		parts.push(`width: ${args.width}px;`);
	}
	if (typeof args.minWidth === 'number' && Number.isFinite(args.minWidth)) {
		parts.push(`min-width: ${args.minWidth}px;`);
	}
	return parts.join(' ');
}
