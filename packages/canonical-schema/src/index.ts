/**
 * AetherCore Canonical Schema
 */

export interface Schema {
  name: string;
  version: string;
}

export class SchemaValidator {
  validate(schema: Schema): boolean {
    return Boolean(schema.name && schema.version);
  }
}

export default SchemaValidator;
