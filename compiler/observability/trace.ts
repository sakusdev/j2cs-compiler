import { createHash } from 'node:crypto';

export type TraceDomain = 'ipc' | 'network' | 'dom' | 'visual' | 'lifecycle' | 'filesystem' | 'security';
export type TraceField = readonly [key: string, value: string];

export interface TraceEvent {
  readonly sequence: number;
  readonly domain: TraceDomain;
  readonly operation: string;
  readonly resource?: string;
  readonly fields: readonly TraceField[];
}

export interface TraceMismatch {
  readonly index: number;
  readonly expected?: string;
  readonly actual?: string;
}

export interface TraceDiff {
  readonly equal: boolean;
  readonly expectedCount: number;
  readonly actualCount: number;
  readonly firstMismatch?: TraceMismatch;
}

function escapePart(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\|/g, '\\p')
    .replace(/;/g, '\\s')
    .replace(/=/g, '\\e');
}

function canonicalFields(fields: readonly TraceField[]): readonly TraceField[] {
  const sorted = [...fields].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1]?.[0] === sorted[i]?.[0]) throw new Error(`Duplicate trace field: ${sorted[i]?.[0]}`);
  }
  return sorted;
}

export function encodeTraceEvent(event: TraceEvent): string {
  if (!Number.isSafeInteger(event.sequence) || event.sequence <= 0) throw new Error('Trace sequence must be a positive safe integer.');
  if (!event.operation) throw new Error('Trace operation must be non-empty.');
  const fields = canonicalFields(event.fields)
    .map(([key, value]) => `${escapePart(key)}=${escapePart(value)}`)
    .join(';');
  return [
    String(event.sequence),
    escapePart(event.domain),
    escapePart(event.operation),
    escapePart(event.resource ?? ''),
    fields,
  ].join('|');
}

export class TraceRecorder {
  readonly #events: TraceEvent[] = [];
  readonly #maxEvents: number;
  #sequence = 0;

  constructor(maxEvents = 100_000) {
    if (!Number.isSafeInteger(maxEvents) || maxEvents <= 0) throw new Error('Trace maxEvents must be a positive safe integer.');
    this.#maxEvents = maxEvents;
  }

  append(domain: TraceDomain, operation: string, resource?: string, fields: readonly TraceField[] = []): TraceEvent {
    if (this.#events.length >= this.#maxEvents) throw new Error(`Trace event limit ${this.#maxEvents} exceeded.`);
    const event: TraceEvent = {
      sequence: ++this.#sequence,
      domain,
      operation,
      ...(resource === undefined ? {} : { resource }),
      fields: canonicalFields(fields),
    };
    this.#events.push(event);
    return event;
  }

  snapshot(): readonly TraceEvent[] {
    return this.#events.map(event => ({ ...event, fields: [...event.fields] }));
  }

  canonicalLines(): readonly string[] {
    return this.#events.map(encodeTraceEvent);
  }

  sha256(): string {
    return createHash('sha256').update(this.canonicalLines().join('\n')).digest('hex');
  }
}

export function diffTrace(expected: readonly TraceEvent[], actual: readonly TraceEvent[]): TraceDiff {
  const expectedLines = expected.map(encodeTraceEvent);
  const actualLines = actual.map(encodeTraceEvent);
  const length = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < length; index++) {
    if (expectedLines[index] !== actualLines[index]) {
      return {
        equal: false,
        expectedCount: expectedLines.length,
        actualCount: actualLines.length,
        firstMismatch: { index, expected: expectedLines[index], actual: actualLines[index] },
      };
    }
  }
  return { equal: true, expectedCount: expectedLines.length, actualCount: actualLines.length };
}
