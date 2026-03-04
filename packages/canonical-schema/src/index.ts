/**
 * AetherCore Canonical Schema
 */

// Export all canonical event types and utilities
export * from './schemas';

// Legacy schema validator (kept for backwards compatibility)
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
