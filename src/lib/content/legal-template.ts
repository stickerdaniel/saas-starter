const PLACEHOLDER_NAME = /^[A-Z][A-Z0-9_]*$/;

export type LegalTableAlign = 'left' | 'center' | 'right';

export interface LegalTableCell {
	readonly align: LegalTableAlign | null;
	readonly children: readonly LegalNode[];
}

/** Legal Markdown as `scripts/legal-document.ts` parses it at build time. */
export type LegalNode =
	| { readonly type: 'text'; readonly value: string }
	| { readonly type: 'literal'; readonly name: string }
	| { readonly type: 'codespan'; readonly value: string }
	| { readonly type: 'code'; readonly lang: string; readonly value: string }
	| { readonly type: 'hr' }
	| {
			readonly type: 'heading';
			readonly depth: 1 | 2 | 3 | 4 | 5 | 6;
			readonly children: readonly LegalNode[];
	  }
	| {
			readonly type: 'paragraph' | 'strong' | 'em' | 'blocked';
			readonly children: readonly LegalNode[];
	  }
	| {
			readonly type: 'list';
			readonly ordered: boolean;
			readonly start: number;
			readonly items: ReadonlyArray<readonly LegalNode[]>;
	  }
	| {
			readonly type: 'table';
			readonly head: readonly LegalTableCell[];
			readonly rows: ReadonlyArray<readonly LegalTableCell[]>;
	  }
	| {
			readonly type: 'link';
			readonly href: string;
			readonly external: boolean;
			readonly title?: string;
			readonly children: readonly LegalNode[];
	  }
	| {
			readonly type: 'localLink';
			readonly path: string;
			readonly title?: string;
			readonly children: readonly LegalNode[];
	  }
	| { readonly type: 'image'; readonly src: string; readonly alt: string };

/** The default export of a `*.md?legal-document` import. */
export interface LegalTemplate {
	readonly nodes: readonly LegalNode[];
}

export interface LegalDocument extends LegalTemplate {
	readonly literals: Readonly<Record<string, string>>;
}

function childNodes(node: LegalNode): readonly LegalNode[] {
	switch (node.type) {
		case 'list':
			return node.items.flat();
		case 'table':
			return [...node.head, ...node.rows.flat()].flatMap((cell) => cell.children);
		default:
			return 'children' in node ? node.children : [];
	}
}

function literalNames(nodes: readonly LegalNode[]): string[] {
	return nodes.flatMap((node) =>
		node.type === 'literal' ? [node.name] : literalNames(childNodes(node))
	);
}

function normalizeLineEndings(value: string): string {
	return value.replace(/\r\n?/g, '\n');
}

export function createLegalDocument(
	documentName: string,
	template: LegalTemplate,
	values: Readonly<Record<string, string>>
): LegalDocument {
	const literals: Record<string, string> = Object.create(null);
	for (const name of Object.keys(values)) {
		const value = values[name];
		if (typeof value !== 'string' || value.includes('\0') || !value.isWellFormed()) {
			throw new Error(`Invalid legal literal ${name} for ${documentName}.`);
		}
		literals[name] = normalizeLineEndings(value);
	}

	const used = new Set(literalNames(template.nodes));
	for (const name of used) {
		if (!Object.hasOwn(literals, name)) {
			throw new Error(`Missing placeholder value ${name} for ${documentName}.`);
		}
	}
	for (const name of Object.keys(literals)) {
		if (!PLACEHOLDER_NAME.test(name)) {
			throw new Error(`Invalid placeholder value name ${name} for ${documentName}.`);
		}
		if (!used.has(name)) {
			throw new Error(`Unused placeholder value ${name} for ${documentName}.`);
		}
	}

	return Object.freeze({ nodes: template.nodes, literals: Object.freeze(literals) });
}
