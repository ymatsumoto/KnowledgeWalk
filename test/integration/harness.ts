import { strict as assert } from 'node:assert';
import type { KnowledgeWalkApi } from '../../src/api';

let api: KnowledgeWalkApi | undefined;

export function setApi(value: KnowledgeWalkApi): void {
  api = value;
}

/** The extension's exported API, available once `run()` has activated it. */
export function getApi(): KnowledgeWalkApi {
  if (!api) {
    throw new Error('The KnowledgeWalk API was not captured; did activate() return it?');
  }
  return api;
}

interface Case {
  name: string;
  fn: () => Promise<void> | void;
}

const cases: Case[] = [];

export function test(name: string, fn: () => Promise<void> | void): void {
  cases.push({ name, fn });
}

export { assert };

/** Poll until `predicate` holds, so tests do not race the workbench's own async work. */
export async function waitFor<T>(
  describe: string,
  predicate: () => T | undefined | false | Promise<T | undefined | false>,
  timeoutMs = 5000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) {
        return value as T;
      }
      last = value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${describe} (last value: ${String(last)})`);
}

export async function runCases(): Promise<void> {
  const failures: string[] = [];
  // KW_ONLY=<text> runs just the cases whose name contains it.
  const only = process.env.KW_ONLY;
  for (const { name, fn } of cases.filter((c) => !only || c.name.includes(only))) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (error) {
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      console.log(`FAIL ${name}\n${detail.split('\n').slice(0, 6).join('\n')}`);
      failures.push(name);
    }
  }
  const ran = cases.filter((c) => !only || c.name.includes(only)).length;
  console.log(`\n${ran - failures.length}/${ran} passed`);
  if (failures.length > 0) {
    throw new Error(`${failures.length} integration test(s) failed:\n  - ${failures.join('\n  - ')}`);
  }
}
