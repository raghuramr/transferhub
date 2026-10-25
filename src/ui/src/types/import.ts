export type EntityType = 'universities' | 'programs' | 'courses';
export type BatchStatus = 'pending' | 'partial' | 'imported' | 'rejected';
export type RowStatus = 'pending' | 'rejected' | 'created' | 'updated' | 'failed';

export interface PartnerKey {
  id: number;
  label: string;
  prefix: string;
  isActive: boolean;
  revoked: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface Partner {
  id: number;
  universityName: string;
  universityCode: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  website: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  submissions: number;
  openSubmissions: number;
  lastSubmissionAt: string | null;
  keys: PartnerKey[];
}

export interface PartnerInput {
  universityName: string;
  universityCode: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  website?: string;
  notes?: string;
  emailKey?: boolean;
}

export interface IssuedKey {
  apiKey: string;
  prefix: string;
  endpoint: string;
  emailed: boolean;
  instructions: string;
  partnerId?: number;
}

export interface BatchCounts {
  total?: number;
  pending?: number;
  rejected?: number;
  created?: number;
  updated?: number;
  failed?: number;
  errors?: number;
  warnings?: number;
}

export interface BatchSummary {
  id: number;
  reference: string;
  source: 'api' | 'manual';
  status: BatchStatus;
  note: string | null;
  submittedAt: string;
  submittedIp: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewerNote: string | null;
  reportSentAt: string | null;
  partner: { id: number; universityName: string; universityCode: string; contactName: string; contactEmail: string } | null;
  counts: BatchCounts;
}

export interface BatchRow {
  id: number;
  rowNo: number;
  entityType: EntityType;
  label: string;
  payload: Record<string, unknown>;
  validation: 'valid' | 'warning' | 'error';
  messages: string[];
  plannedAction: 'create' | 'update' | 'skip';
  status: RowStatus;
  outcomeMessage: string | null;
  decidedAt: string | null;
}

export interface BatchDetail extends BatchSummary {
  rows: BatchRow[];
}

export interface ImportRunResult {
  created: number;
  updated: number;
  failed: number;
  blocked: number;
  reportSent: boolean;
}
