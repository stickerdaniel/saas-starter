const PLACEHOLDER_NAME = /^[A-Z][A-Z0-9_]*$/;
const PLACEHOLDER = /\{\{([^{}\r\n]*)\}\}/g;
const SINGLE_PLACEHOLDER = /\{\{([^{}\r\n]*)\}\}/;

export function renderAuthoredTemplate(
	documentName: string,
	template: string,
	values: Readonly<Record<string, string>>
): string {
	const normalizedTemplate = template.replace(/\r\n?/g, '\n');
	const placeholders = new Set<string>();

	for (const match of normalizedTemplate.matchAll(PLACEHOLDER)) {
		const name = match[1]!;
		if (!PLACEHOLDER_NAME.test(name)) {
			throw new Error(`Invalid placeholder {{${name}}} in ${documentName}.`);
		}
		placeholders.add(name);
	}

	const templateWithoutPlaceholders = normalizedTemplate.replace(PLACEHOLDER, '');
	if (templateWithoutPlaceholders.includes('{{') || templateWithoutPlaceholders.includes('}}')) {
		throw new Error(`Invalid placeholder syntax in ${documentName}.`);
	}

	for (const name of placeholders) {
		if (!Object.prototype.hasOwnProperty.call(values, name)) {
			throw new Error(`Missing placeholder value ${name} for ${documentName}.`);
		}
	}

	for (const name of Object.keys(values)) {
		if (!PLACEHOLDER_NAME.test(name)) {
			throw new Error(`Invalid placeholder value name ${name} for ${documentName}.`);
		}
		if (!placeholders.has(name)) {
			throw new Error(`Unused placeholder value ${name} for ${documentName}.`);
		}
	}

	const rendered = normalizedTemplate.replace(PLACEHOLDER, (_token, name: string) => values[name]!);
	const unresolved = SINGLE_PLACEHOLDER.exec(rendered);
	if (unresolved) {
		throw new Error(`Unresolved placeholder {{${unresolved[1]}}} in ${documentName}.`);
	}
	if (rendered.includes('{{') || rendered.includes('}}')) {
		throw new Error(`Unresolved placeholder syntax in ${documentName}.`);
	}

	return rendered;
}
