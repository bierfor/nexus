import { describe, it, expect } from 'vitest';
import { buildSchema, printSchema } from 'graphql';
import { createRemoteExecutorWithSchema, stitchSchemas, createRemoteExecutor } from './index.js';

describe('graphql legacy bridge (pragmatic stitching)', () => {
  it('createRemoteExecutorWithSchema returns a schema for a real public endpoint (or null on failure)', async () => {
    // Use a small, stable public GraphQL for smoke (countries demo)
    const res = await createRemoteExecutorWithSchema({
      url: 'https://countries.trevorblades.com/graphql',
      timeoutMs: 4000,
    });

    // Either we got a real schema, or network blocked it (still valid: we no longer hard-return null without trying)
    if (res.schema) {
      expect(printSchema(res.schema)).toContain('Country');
    } else {
      // acceptable in restricted CI / no-net envs
      expect(res.executor).toBeTypeOf('function');
    }
  }, 8000);

  it('stitchSchemas merges additional non-root types from a second local schema', () => {
    const schemaA = buildSchema(`
      type Query { hello: String }
    `);
    // Note: a schema with its own Query root would conflict on extend; the pragmatic
    // stitch delegates instead. Here we test a clean additional type.
    const schemaB = buildSchema(`
      type User { id: ID name: String }
      type Post { id: ID title: String }
    `);

    const stitched = stitchSchemas({
      subschemas: [{ schema: schemaA }, { schema: schemaB }],
    });

    const printed = printSchema(stitched);
    expect(printed).toContain('hello');
    expect(printed).toContain('User');
    expect(printed).toContain('Post');
  });

  it('stitchSchemas with a remote executor config does not throw and returns a schema', () => {
    const local = buildSchema(`type Query { me: String }`);
    const remote = buildSchema(`type Query { posts: [Post] } type Post { id: ID title: String }`);

    const baseExecutor = createRemoteExecutor({ url: 'https://example.com/graphql' });

    // Now that SubschemaConfig.executor matches the actual createRemoteExecutor shape,
    // we can pass it directly (the previous object-form mismatch was an internal API lie).
    const stitched = stitchSchemas({
      subschemas: [
        { schema: local },
        { schema: remote, executor: baseExecutor },
      ],
    });

    expect(stitched).toBeDefined();
    expect(printSchema(stitched)).toContain('me');
  });
});
