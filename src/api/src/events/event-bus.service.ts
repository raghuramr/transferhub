import { Injectable, Logger } from '@nestjs/common';

export type LiveEventType =
  | 'stage_activated'
  | 'stage_approved'
  | 'stage_rejected'
  | 'stage_returned'
  | 'stage_bypassed'
  | 'stage_auto_approved'
  | 'request_completed'
  | 'note_added'
  | 'document_added'
  | 'document_requested'
  | 'evaluation_decided'
  | 'evaluation_posted'
  | 'reminder_sent';

/**
 * 'all'   = anyone who may see the request (student, agency, staff).
 * 'staff' = staff only (internal notes and similar) - never delivered to a student or agency.
 */
export type LiveAudience = 'all' | 'staff';

/** Deliberately minimal: a type, the request, the stage (name only) and one short line. No PII beyond what the viewer may already see. */
export interface LiveEvent {
  type: LiveEventType;
  transcriptId: string;
  at: string;
  audience: LiveAudience;
  stage?: { order?: number; name?: string; status?: string };
  text: string;
}

export type LiveEventInput = Omit<LiveEvent, 'at' | 'audience'> & { at?: string; audience?: LiveAudience };
export type LiveListener = (event: LiveEvent) => void;

/**
 * In-process pub/sub. emit() is fire-and-forget and can never throw, so calling it from the
 * workflow pipeline can never break a request. (One API process = one bus; with several App Service
 * instances each instance only streams events produced on that instance.)
 */
@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);
  private listeners = new Set<LiveListener>();

  subscribe(fn: LiveListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  get listenerCount() {
    return this.listeners.size;
  }

  emit(input: LiveEventInput): void {
    try {
      if (!input?.transcriptId) return;
      const event: LiveEvent = {
        type: input.type,
        transcriptId: String(input.transcriptId).toLowerCase(),
        at: input.at ?? new Date().toISOString(),
        audience: input.audience ?? 'all',
        stage: input.stage,
        text: String(input.text ?? '').slice(0, 200),
      };
      for (const fn of [...this.listeners]) {
        try {
          fn(event);
        } catch (e) {
          this.logger.warn(`live listener failed: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.logger.warn(`emit failed: ${(e as Error).message}`);
    }
  }
}
