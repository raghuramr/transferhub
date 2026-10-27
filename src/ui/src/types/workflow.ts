export type StageType = 'system' | 'review' | 'approval';
export type AgentTask = 'none' | 'intake' | 'match' | 'finalize';
export type StageStatus = 'pending' | 'active' | 'approved' | 'rejected' | 'returned' | 'skipped' | 'bypassed';
export type WorkflowStatus = 'active' | 'approved' | 'rejected' | 'bypassed' | null;
export type Recommendation = 'approve' | 'review' | 'reject';

export interface TimelineNote {
  id: number;
  audience: 'internal' | 'student';
  kind: 'note' | 'decision' | 'system';
  author: string;
  authorRole: string | null;
  body: string;
  createdAt: string;
}

export interface BriefCourse {
  courseId?: string;
  flags?: import('./policy').PolicyFlag[];
  evaluationId: string | null;
  code: string;
  title: string;
  grade: string;
  lane: string;
  credits: number;
  suggested: { code: string; title: string | null; confidence: number | null } | null;
  decided: { code: string | null; title: string | null; outcome: string | null; awardedCredits: number | null } | null;
}

export interface StageBrief {
  generatedAt: string;
  totals: { courses: number; applied: number; likely: number; needsSyllabus: number; electiveOnly: number; notEligible: number; pending: number };
  credits: { applied: number; atStake: number };
  flags: string[];
  notes?: string[];
  courses: BriefCourse[];
  previousStages: { stage: string; status: string; comment: string | null; at: string | null }[];
  narrative: string | null;
}

export interface TimelineStage {
  id: number;
  order: number;
  key: string;
  name: string;
  description: string | null;
  type: StageType;
  agentTask: AgentTask;
  status: StageStatus;
  activatedAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  overdue: boolean;
  decidedBy: { name: string; role: string } | null;
  approvers: string[];
  canSkip: boolean;
  requiresComment: boolean;
  aiRecommendation: Recommendation | null;
  aiBrief: StageBrief | null;
  notes: TimelineNote[];
}

export interface ChecklistItem {
  docTypeKey: string;
  label: string;
  perCourse: boolean;
  required: boolean;
  uploaded: number;
  needed?: number;
}

export interface UploadedDocument {
  id: number;
  docTypeKey: string;
  label: string;
  fileName: string;
  uploadId: string;
  transcriptCourseId: string | null;
  courseCode: string | null;
  notes: string | null;
  createdAt: string;
}

export interface RequestTimeline {
  transcript: {
    id: string;
    status: string;
    workflowStatus: WorkflowStatus;
    receivedAt: string;
    processedAt: string | null;
    studentName: string;
    studentEmail?: string;
    institutionName: string;
    targetInstitutionName: string | null;
    documentFileName: string | null;
    workflow: { id: number; name: string; allowBypass: boolean } | null;
    evaluationKind?: import('./policy').EvaluationKind;
    preapprovalExpiresAt?: string | null;
  };
  student?: import('./policy').StudentApplicationProfile | null;
  credit?: import('./policy').CreditSummary | null;
  stages: TimelineStage[];
  generalNotes: TimelineNote[];
  permissions: {
    isStaff: boolean;
    canAct: boolean;
    canAccept: boolean;
    canStartWorkflow: boolean;
    canMakeOfficial?: boolean;
    canNoteInternal: boolean;
    canNoteStudent: boolean;
    canSeeAiUsage: boolean;
  };
  documents: { checklist: ChecklistItem[]; uploaded: UploadedDocument[] };
  reminders: {
    canNudge: boolean;
    canSendUpdate: boolean;
    lastNudgeAt: string | null;
    lastUpdateAt: string | null;
    emailConfigured: boolean;
  };
}

export interface QueueRow {
  stageId: number;
  transcriptId: string;
  studentName: string;
  institutionName: string;
  stageName: string;
  activatedAt: string | null;
  dueAt: string | null;
  overdue: boolean;
  aiRecommendation: Recommendation | null;
  flagCount: number;
  courseCount: number;
  canAct: boolean;
  assignedToMe: boolean;
}

export interface StageApprover {
  id?: number;
  approverType: 'role' | 'group' | 'user';
  roleName?: string | null;
  groupId?: number | null;
  groupName?: string | null;
  userId?: string | null;
  userName?: string | null;
}

export interface WorkflowStageDef {
  id?: number;
  stageOrder?: number;
  stageKey?: string;
  name: string;
  description?: string | null;
  stageType: StageType;
  agentTask: AgentTask;
  slaDays: number | null;
  isEnabled: boolean;
  canBypass: boolean;
  requiresComment: boolean;
  autoApprove?: boolean;
  autoApproveMinConfidence?: number | null;
  approvers: StageApprover[];
}

export interface WorkflowSummary {
  id: number;
  institutionId: number | null;
  institutionName: string | null;
  name: string;
  description: string | null;
  allowBypass: boolean;
  isActive: boolean;
  stageCount: number;
  activeRequests: number;
}

export interface WorkflowDetail extends Omit<WorkflowSummary, 'stageCount' | 'activeRequests'> {
  stages: WorkflowStageDef[];
  documents: { docTypeKey: string; label: string; description: string | null; perCourse: boolean; isRequired: boolean; offered: boolean }[];
}

export interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface ApproverGroup {
  id: number;
  name: string;
  description: string | null;
  institutionId: number | null;
  isActive: boolean;
  members: { userId: string; name: string; email: string }[];
}

export interface AiSettings {
  id: number | null;
  institutionId: number | null;
  institutionName?: string | null;
  isEnabled: boolean;
  autoRunOnIntake: boolean;
  matchModel: string;
  escalationModel: string | null;
  escalateBelowConfidence: number;
  autoLikelyThreshold: number;
  prefilterTopN: number;
  maxDescriptionChars: number;
  useTopics: boolean;
  useResultCache: boolean;
  usePromptCaching: boolean;
  maxOutputTokens: number;
  maxTokensPerRequest: number | null;
  monthlyTokenBudget: number | null;
  narrativeBriefEnabled: boolean;
  rulesFallbackEnabled: boolean;
}

export interface AgentSkill {
  id: number;
  skillKey: string;
  title: string;
  category: 'matching' | 'policy' | 'token_saving' | 'documents';
  instructions: string;
  isActive: boolean;
  sortOrder: number;
  tokenEstimate: number;
}

export interface UsageSummary {
  days: number;
  totals: {
    calls: number; skippedCalls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number;
    cacheWriteTokens: number; costUsd: number; tokensSaved: number; requests: number;
  };
  byDay: { day: string; tokens: number; costUsd: number; tokensSaved: number }[];
  byOperation: { operation: string; calls: number; tokens: number; costUsd: number }[];
  skippedBy: { reason: string; n: number; tokensSaved: number }[];
  prefilterTokensSaved: number;
  monthTokens: number;
  cache: { entries: number; hits: number };
}

export interface RequestUsageRow {
  transcriptId: string;
  studentName: string;
  institutionName: string;
  receivedAt: string;
  status: string;
  calls: number;
  cacheHits: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  costUsd: number;
  tokensSaved: number;
}

export interface RequestUsageDetail {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  costUsd: number;
  tokensSaved: number;
  rows: {
    id: number; operation: string; model: string | null; inputTokens: number; outputTokens: number; cacheReadTokens: number;
    cacheWriteTokens: number; costUsd: number; skipped: boolean; skipReason: string | null; tokensSaved: number;
    catalogSize: number | null; candidatesSent: number | null; createdAt: string;
  }[];
}

export interface ReadinessItem {
  key: string;
  label: string;
  status: 'ok' | 'warn' | 'error';
  detail: string;
  hint?: string;
}

export interface Readiness {
  ready: boolean;
  items: ReadinessItem[];
}

export interface WorkflowInsights {
  days: number;
  totals: {
    requests: number; active: number; approved: number; rejected: number; bypassed: number;
    autoApprovedStages: number; avgDaysToComplete: number | null;
  };
  stages: {
    stageKey: string; stageOrder: number; name: string; stageType: string; completed: number; avgHours: number | null;
    activeNow: number; overdueNow: number; late: number; skipped: number;
  }[];
}

export interface BulkApproveResult {
  approved: number;
  failed: number;
  results: { id: string; ok: boolean; message: string }[];
}
