// core/json-schema.ts
//
// A small JSON Schema validator: just the keywords our contracts use (type,
// required, properties, additionalProperties: false, items, enum, minimum,
// maximum, minLength). No dependency, so it adds almost nothing to the
// bundles. Returns every problem found, each with a path like
// "interests[2].weight".

export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean';
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  [keyword: string]: unknown; // $schema, $id, title, description: ignored
}

export function validateJson(value: unknown, schema: JsonSchema, path = ''): string[] {
  const here = path || '(root)';
  const errors: string[] = [];

  switch (schema.type) {
    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${here}: expected an object`];
      break;
    case 'array':
      if (!Array.isArray(value)) return [`${here}: expected an array`];
      break;
    case 'string':
      if (typeof value !== 'string') return [`${here}: expected a string`];
      break;
    case 'integer':
      if (!Number.isInteger(value)) return [`${here}: expected a whole number`];
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return [`${here}: expected a number`];
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return [`${here}: expected true or false`];
      break;
  }

  if (schema.enum && !schema.enum.includes(value)) errors.push(`${here}: must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${here}: must be at least ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${here}: must be at most ${schema.maximum}`);
  }
  if (typeof value === 'string' && schema.minLength != null && value.length < schema.minLength) {
    errors.push(`${here}: must be at least ${schema.minLength} character${schema.minLength === 1 ? '' : 's'}`);
  }

  if (schema.type === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required || []) if (!(key in obj)) errors.push(`${path ? `${path}.` : ''}${key}: missing`);
    for (const [key, child] of Object.entries(obj)) {
      const childPath = path ? `${path}.${key}` : key;
      const childSchema = schema.properties?.[key];
      if (childSchema) errors.push(...validateJson(child, childSchema, childPath));
      else if (schema.additionalProperties === false) errors.push(`${childPath}: not allowed`);
    }
  }
  if (schema.type === 'array' && schema.items) {
    (value as unknown[]).forEach((child, i) => errors.push(...validateJson(child, schema.items as JsonSchema, `${path}[${i}]`)));
  }
  return errors;
}
