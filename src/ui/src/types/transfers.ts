export type Party = 'student' | 'source_university' | 'target_university';
export type TransferBucket = 'new' | 'in_review' | 'approved' | 'rejected';

export interface DocumentRequestRow {
  id: number;
  byParty: Party;
  fromParty: Party;
  byName: string;
  fromName: string;
  byUser: string | null;
  docTypeKey: string | null;
  docTypeLabel: string | null;
  title: string;
  message: string | null;
  dueDate: string | null;
  overdue: boolean;
  status: 'open' | 'fulfilled' | 'cancelled' | 'declined';
  fulfilledUploadId: string | null;
  fulfilledAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  canFulfil: boolean;
  canDecline: boolean;
  canCancel: boolean;
  canRemind: boolean;
  remindBlockedUntil: string | null;
}

export interface TransferUploadRow {
  id: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  documentType: string | null;
  documentTypeLabel: string | null;
  party: Party | null;
  partyLabel: string | null;
  partyName: string | null;
  institutionName: string | null;
  uploaderName: string | null;
  note: string | null;
  documentRequestId: number | null;
  createdAt: string;
}

export interface PartyReminderRow {
  id: number;
  fromParty: Party;
  toParty: Party;
  fromName: string;
  toName: string;
  sentBy: string | null;
  message: string | null;
  documentRequestId: number | null;
  recipientCount: number;
  emailed: boolean;
  createdAt: string;
}

export interface ExchangeData {
  ready: boolean;
  transfer: {
    id: string;
    studentName: string;
    studentEmail?: string;
    source: { id: number | null; name: string | null };
    target: { id: number | null; name: string | null };
    bucket: TransferBucket;
    bucketLabel: string;
    stageName: string | null;
    receivedAt: string;
  };
  viewer: { parties: Party[]; defaultParty: Party | null; isStudentSide: boolean; readOnly: boolean };
  documentTypes: { docTypeKey: string; label: string }[];
  requests: DocumentRequestRow[];
  uploads: TransferUploadRow[];
  reminders: PartyReminderRow[];
  /** "from>to:" -> ISO time until which a general reminder is blocked. */
  blocked: Record<string, string>;
  reminderHours?: number;
}

export interface SummarySide {
  total: number;
  open: number;
  byStatus: { key: TransferBucket; label: string; count: number }[];
  byStage: { stage: string; count: number }[];
  trend: { week: string; count: number }[];
  inWindow: number;
  overdue: number;
  counterparts: { name: string; count: number }[];
}

export interface TransfersSummary {
  days: number;
  scope: { institutions: { id: number; code: string; name: string }[]; selectedId: number | null; unrestricted: boolean; exchangeReady: boolean };
  incoming: SummarySide;
  outgoing: SummarySide;
  documentRequests: { waiting: number; asked: number };
}

export interface TransferListRow {
  id: string;
  studentName: string;
  sourceId: number;
  sourceName: string;
  targetId: number | null;
  targetName: string | null;
  bucket: TransferBucket;
  bucketLabel: string;
  receivedAt: string;
  stageName: string | null;
  courseCount: number;
  openDocRequests: number;
  exchangeFiles: number;
}

export interface TransferList {
  direction: 'incoming' | 'outgoing';
  page: number;
  pageSize: number;
  total: number;
  rows: TransferListRow[];
}
