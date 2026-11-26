import * as Schema from 'effect/Schema';

export const toAiInputSchema = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) =>
	Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(schema));
