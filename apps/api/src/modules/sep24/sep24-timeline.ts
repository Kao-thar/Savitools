import { randomUUID } from 'crypto';
import { REDACTED, redactValue, redactString, redactHeaders, isSensitiveKey } from '../../common/redaction';

export type TimelineEntryKind =
  | 'discovery'
  | 'auth'
  | 'interactive_url'
  | 'redirect'
  | 'callback'
  | 'poll'
  | 'error';

export interface TimelineEntry {
  id: string;
  kind: TimelineEntryKind;
  timestamp: string;
  method?: string;
  url?: string;
  status?: number;
  durationMs?: number;
  request?: unknown;
  response?: unknown;
  message?: string;
  details?: Record<string, unknown>;
}

export interface TimelineExport {
  sessionId: string;
  assetCode: string;
  operation: 'deposit' | 'withdrawal';
  anchorDomain: string;
  generatedAt: string;
  entries: TimelineEntry[];
}

export class Sep24Timeline {
  private readonly entries: TimelineEntry[] = [];

  constructor(
    public readonly sessionId: string,
    public readonly context: {
      assetCode: string;
      operation: 'deposit' | 'withdrawal';
      anchorDomain: string;
    },
  ) {}

  record(entry: Omit<TimelineEntry, 'id' | 'timestamp'>): TimelineEntry {
    const recorded: TimelineEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
      request: redactValue(entry.request),
      response: redactValue(entry.response),
      details: entry.details
        ? (redactValue(entry.details) as Record<string, unknown>)
        : undefined,
    };
    this.entries.push(recorded);
    return recorded;
  }

  getEntries(): TimelineEntry[] {
    return this.entries.slice();
  }

  export(): TimelineExport {
    return {
      sessionId: this.sessionId,
      assetCode: this.context.assetCode,
      operation: this.context.operation,
      anchorDomain: this.context.anchorDomain,
      generatedAt: new Date().toISOString(),
      entries: this.getEntries(),
    };
  }
}