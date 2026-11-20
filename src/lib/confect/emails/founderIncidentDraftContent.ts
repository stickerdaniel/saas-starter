import { ConvexError } from 'convex/values';
import { isSupportedLocale, SUPPORTED_LOCALES } from '../i18n/translations';
import { sha256Hex } from '../utils/sha256';
import type {
	FounderIncidentEnvelope,
	FounderIncidentRegistry,
	FounderIncidentRenderInput,
	FounderIncidentTemplate
} from './founderIncidentTypes';

const MAX_SUBJECT_LENGTH = 200;
const MAX_TEXT_LENGTH = 20_000;
const PLACEHOLDER = /\{\{(userFirstName|founderName)\}\}/g;

export function validateDraftIncident(incident: string, registry: FounderIncidentRegistry): void {
	if (
		!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(incident) ||
		Object.prototype.hasOwnProperty.call(registry, incident)
	) {
		throw new ConvexError('Invalid or reserved founder incident draft key');
	}
}

/** Canonical locale ordering makes retries independent of input array order. */
export function validateDraftTemplates(templates: FounderIncidentTemplate[]) {
	if (templates.length === 0 || templates.length > SUPPORTED_LOCALES.length) {
		throw new ConvexError('Invalid founder incident template count');
	}
	const locales = new Set<string>();
	for (const { locale, subject, text } of templates) {
		if (!isSupportedLocale(locale) || locales.has(locale)) {
			throw new ConvexError('Unsupported or duplicate founder incident locale');
		}
		locales.add(locale);
		if (
			!subject.trim() ||
			subject.length > MAX_SUBJECT_LENGTH ||
			/[\r\n]/.test(subject) ||
			!text.trim() ||
			text.length > MAX_TEXT_LENGTH
		) {
			throw new ConvexError('Invalid founder incident template content');
		}
		for (const value of [subject, text]) {
			if (/[{}]/.test(value.replace(PLACEHOLDER, ''))) {
				throw new ConvexError('Only userFirstName and founderName placeholders are supported');
			}
		}
	}
	return templates
		.map(({ locale, subject, text }) => ({ locale, subject, text }))
		.sort((a, b) => (a.locale < b.locale ? -1 : a.locale > b.locale ? 1 : 0));
}

export function renderDraftTemplate(
	templates: FounderIncidentTemplate[],
	{ locale, recipientName, senderName }: FounderIncidentRenderInput
) {
	const template = templates.find((entry) => entry.locale === locale);
	if (!template) throw new ConvexError('Missing founder incident template for recipient locale');
	const values = {
		userFirstName: recipientName?.trim().split(/\s+/)[0] ?? '',
		founderName: senderName
	};
	const render = (value: string) =>
		value.replace(PLACEHOLDER, (_match, key: keyof typeof values) => values[key]);
	const subject = render(template.subject);
	if (/[\r\n]/.test(subject)) throw new ConvexError('Invalid founder incident rendered subject');
	return { subject, text: render(template.text) };
}

export function validateDraftEnvelope(envelope: FounderIncidentEnvelope): void {
	const headers = [
		envelope.from,
		envelope.to,
		...(envelope.replyTo ?? []),
		envelope.subject,
		...envelope.headers.flatMap(({ name, value }) => [name, value])
	];
	if (
		headers.some((value) => !value.trim() || /[\r\n]/.test(value)) ||
		envelope.subject.length > MAX_SUBJECT_LENGTH ||
		envelope.text.length > MAX_TEXT_LENGTH
	) {
		throw new ConvexError('Invalid founder incident email envelope');
	}
}

/** Fixed, versioned fields bind approval to the final message, not unused account data. */
export function draftApprovalDigest(snapshot: {
	incident: string;
	revision: number;
	userId: string;
	locale: string;
	envelope: FounderIncidentEnvelope;
}): string {
	const { incident, revision, userId, locale, envelope } = snapshot;
	return sha256Hex(
		JSON.stringify([
			'founder-incident-draft-v1',
			incident,
			revision,
			userId,
			locale,
			envelope.from,
			envelope.to,
			envelope.replyTo ?? [],
			envelope.headers.map(({ name, value }) => [name, value]),
			envelope.subject,
			envelope.text
		])
	);
}
