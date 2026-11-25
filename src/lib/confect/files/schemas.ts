import * as Schema from 'effect/Schema';

export const UploadUrlSchema = Schema.Struct({
	uploadUrl: Schema.String,
	uploadToken: Schema.String,
	uploadTokenExpiresAt: Schema.Number,
	storageProvider: Schema.Literals(['convex', 'r2']),
	storageId: Schema.NullOr(Schema.String)
});

export const FileReferenceFields = {
	fileId: Schema.String,
	storageId: Schema.String
};
