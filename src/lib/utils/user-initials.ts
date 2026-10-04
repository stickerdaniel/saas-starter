/**
 * Avatar initials for a person: the first letters of the first and last word of
 * the name, or the first letter of the email's local part when there is no name.
 * `max: 1` keeps only the first word's letter. `?` when neither yields a letter.
 */
export function userInitials(
	name: string | null | undefined,
	email: string | null | undefined,
	max: 1 | 2 = 2
): string {
	const [first, ...rest] = name?.trim().split(/\s+/).filter(Boolean) ?? [];
	if (first) {
		const last = max === 2 ? rest.at(-1) : undefined;
		return (firstLetter(first) + (last ? firstLetter(last) : '')).toUpperCase();
	}
	const local = email?.split('@')[0]?.trim() ?? '';
	return local ? firstLetter(local).toUpperCase() : '?';
}

// Code points, so a name starting with an astral character keeps the whole character.
function firstLetter(word: string): string {
	return Array.from(word)[0] ?? '';
}
