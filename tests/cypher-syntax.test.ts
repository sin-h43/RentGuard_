// Parses every Cypher statement the app sends to Neo4j with the official openCypher grammar.
// (Run without a database: catches syntax errors; schema "label not present" warnings are ignored.)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import * as Q from '../src/lib/graph/cypher';

const require = createRequire(import.meta.url);
const { validateSyntax } = require('@neo4j-cypher/language-support');
const empty = { labels: [], relationshipTypes: [], propertyKeys: [], functions: {}, procedures: {} };

describe('Cypher syntax', () => {
  const stmts = Object.entries(Q).flatMap(([name, v]) => (Array.isArray(v) ? v.map((s, i) => [`${name}[${i}]`, s]) : [[name, v]])) as [string, string][];
  for (const [name, text] of stmts) {
    it(name, () => {
      const errs = validateSyntax(text, empty).filter((e: any) => !/not present in the database/i.test(e.message));
      assert.deepEqual(errs.map((e: any) => e.message), []);
    });
  }
  it('the checker really rejects broken Cypher', () => {
    assert.ok(validateSyntax('MATCH (n:Owner RETURN n', empty).length > 0);
  });
});
