import * as Schema from 'effect/Schema';

export const NotificationTypeSchema = Schema.Literals([
	'newTickets',
	'userReplies',
	'newSignups',
	'newCustomers',
	'cancellations'
]);

export const NotificationToggleFieldSchema = Schema.Literals([
	'notifyNewSupportTickets',
	'notifyUserReplies',
	'notifyNewSignups',
	'notifyNewCustomers',
	'notifyCancellations'
]);

export const NotificationRecipientSchema = Schema.Struct({
	email: Schema.String,
	name: Schema.optional(Schema.String),
	userId: Schema.optional(Schema.String),
	isAdminUser: Schema.Boolean,
	notifyNewSupportTickets: Schema.Boolean,
	notifyUserReplies: Schema.Boolean,
	notifyNewSignups: Schema.Boolean,
	notifyNewCustomers: Schema.Boolean,
	notifyCancellations: Schema.Boolean,
	createdAt: Schema.Number,
	updatedAt: Schema.Number
});

const RecipientTypeFilterSchema = Schema.Literals(['admin', 'custom']);

const RecipientSortSchema = Schema.Struct({
	field: Schema.Literals(['email', 'name', 'type', 'createdAt']),
	direction: Schema.Literals(['asc', 'desc'])
});

const recipientFilterFields = {
	search: Schema.optionalKey(Schema.String),
	typeFilter: Schema.optionalKey(RecipientTypeFilterSchema)
};

export const ListRecipientsArgsSchema = Schema.Struct({
	cursor: Schema.optionalKey(Schema.String),
	numItems: Schema.Number,
	...recipientFilterFields,
	sortBy: Schema.optionalKey(RecipientSortSchema)
});

export const RecipientCountArgsSchema = Schema.Struct(recipientFilterFields);

export const RecipientsLastPageArgsSchema = Schema.Struct({
	numItems: Schema.Number,
	...recipientFilterFields
});

export const PreferenceToggleArgsSchema = Schema.Struct({
	email: Schema.String,
	field: NotificationToggleFieldSchema,
	value: Schema.Boolean
});

export const PreferenceBatchArgsSchema = Schema.Struct({
	emails: Schema.Array(Schema.String),
	field: NotificationToggleFieldSchema,
	value: Schema.Boolean
});
