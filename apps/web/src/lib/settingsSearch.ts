/**
 * Settings search (PRD 20): pure filter over the Hermes config schema.
 * Accepts human labels ("nudge") and dotpaths ("memory.nudge_interval").
 */

export interface SchemaField {
  type: string;
  description?: string;
  category?: string;
}

export interface SearchHit {
  path: string;
  label: string;
  category?: string;
  type: string;
  score: number;
}

export function searchSchema(
  fields: Record<string, SchemaField>,
  query: string,
  limit = 20,
): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q === '') {
    return [];
  }
  const hits: SearchHit[] = [];
  for (const [path, field] of Object.entries(fields)) {
    const dot = path.toLowerCase();
    const label = (field.description ?? '').toLowerCase();
    let score = -1;
    if (dot === q) score = 0;
    else if (dot.startsWith(q)) score = 1;
    else if (dot.includes(q)) score = 2;
    else if (label.includes(q)) score = 3;
    else {
      // every dotpath segment matches? e.g. "mem nudge" over memory.nudge_interval
      const words = q.split(/\s+/);
      if (words.length > 1 && words.every((word) => dot.includes(word) || label.includes(word))) {
        score = 4;
      }
    }
    if (score >= 0) {
      hits.push({
        path,
        label: field.description ?? path,
        category: field.category,
        type: field.type,
        score,
      });
    }
  }
  return hits.sort((a, b) => a.score - b.score || a.path.localeCompare(b.path)).slice(0, limit);
}

/** Reads a nested value by dotpath ('memory.nudge_interval' -> 35). */
export function getByPath(source: unknown, dotpath: string): unknown {
  let cursor: unknown = source;
  for (const segment of dotpath.split('.')) {
    if (typeof cursor !== 'object' || cursor === null || !(segment in (cursor as Record<string, unknown>))) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** Builds a nested single-value object: ('a.b', 1) -> {a: {b: 1}}. */
export function setByPath(value: unknown, dotpath: string): Record<string, unknown> {
  const segments = dotpath.split('.');
  const root: Record<string, unknown> = {};
  let cursor = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const next: Record<string, unknown> = {};
    cursor[segments[i]!] = next;
    cursor = next;
  }
  cursor[segments[segments.length - 1]!] = value;
  return root;
}
