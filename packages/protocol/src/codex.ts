import { z } from "zod";

import {
  CollaborationModeKindSchema,
  IsoTimestampSchema,
  StreamSequenceSchema,
  WorktreePathSchema,
  LocaleSchema
} from "./common";
import {
  ApprovalRequestSchema,
  NativeRequestKindSchema,
  NativeRequestRecordSchema,
  PatchRecordSchema,
  TurnInputItemSchema,
  TurnRecordSchema
} from "./entities";
import {
  ApprovalIdSchema,
  PatchIdSchema,
  ProjectIdSchema,
  ThreadIdSchema,
  TurnIdSchema
} from "./ids";

export const CodexThreadStateSchema = z.enum([
  "ready",
  "running",
  "waiting_input",
  "waiting_approval",
  "needs_review",
  "completed",
  "failed",
  "interrupted",
  "system_error",
  "archived",
  "unavailable"
]);

export const CodexSyncStateSchema = z.enum([
  "native_confirmed",
  "sync_pending",
  "sync_failed"
]);

export const CodexTimelineItemKindSchema = z.enum([
  "user_message",
  "assistant_message",
  "tool_call",
  "tool_result",
  "approval",
  "patch",
  "status"
]);

export const CodexTimelineItemOriginSchema = z.enum([
  "native_confirmed",
  "gateway_fallback"
]);

export const CodexMessageRoleSchema = z.enum([
  "user",
  "assistant",
  "system_action"
]);

export const CodexMessageDetailKindSchema = z.enum([
  "thinking",
  "editing",
  "testing",
  "tool_call",
  "tool_result",
  "status"
]);

export const CodexQueueEntryKindSchema = z.enum([
  "running",
  "input",
  "approval",
  "patch",
  "failed"
]);

export const CodexProjectSummarySchema = z.object({
  project_id: ProjectIdSchema,
  label: z.string().min(1),
  repo_root: WorktreePathSchema
});

export const CodexModelReasoningLevelSchema = z.object({
  effort: z.string().min(1),
  description: z.string().min(1).optional()
});

export const CodexServiceTierSchema = z.enum(["fast", "flex"]);

export const CodexApprovalPolicySchema = z.union([
  z.enum(["untrusted", "on-failure", "on-request", "never"]),
  z.object({
    reject: z.object({
      sandbox_approval: z.boolean(),
      rules: z.boolean(),
      mcp_elicitations: z.boolean()
    })
  })
]);

export const CodexSandboxModeSchema = z.enum([
  "read-only",
  "workspace-write",
  "danger-full-access"
]);

export const CodexConfigRequirementsSchema = z.object({
  allowed_approval_policies: z.array(CodexApprovalPolicySchema).nullable().optional(),
  allowed_sandbox_modes: z.array(CodexSandboxModeSchema).nullable().optional(),
  allowed_web_search_modes: z.array(z.string().min(1)).nullable().optional(),
  feature_requirements: z.record(z.boolean()).nullable().optional(),
  enforce_residency: z.string().nullable().optional()
});

export const CodexExperimentalFeatureSchema = z.object({
  name: z.string().min(1),
  stage: z.string().min(1),
  display_name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  announcement: z.string().nullable().optional(),
  enabled: z.boolean(),
  default_enabled: z.boolean()
});

export const CodexReviewTargetSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("uncommittedChanges")
  }),
  z.object({
    type: z.literal("baseBranch"),
    branch: z.string().min(1)
  }),
  z.object({
    type: z.literal("commit"),
    sha: z.string().min(1),
    title: z.string().min(1).nullable().optional()
  }),
  z.object({
    type: z.literal("custom"),
    instructions: z.string().min(1)
  })
]);

export const CodexReviewDeliverySchema = z.enum(["inline", "detached"]);

export const CodexThreadSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  short_description: z.string().min(1).optional(),
  display_name: z.string().min(1).optional(),
  path: z.string().min(1)
});

export const CodexSkillScanErrorSchema = z.object({
  path: z.string().min(1),
  message: z.string().min(1)
});

export const CodexAccountSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("apiKey")
  }),
  z.object({
    type: z.literal("chatgpt"),
    email: z.string().min(1),
    plan_type: z.string().min(1)
  })
]);

export const CodexCreditsSnapshotSchema = z.object({
  has_credits: z.boolean(),
  unlimited: z.boolean(),
  balance: z.string().nullable().optional()
});

export const CodexRateLimitWindowSchema = z.object({
  used_percent: z.number(),
  window_duration_mins: z.number().nullable().optional(),
  resets_at: IsoTimestampSchema.nullable().optional()
});

export const CodexRateLimitSnapshotSchema = z.object({
  limit_id: z.string().nullable().optional(),
  limit_name: z.string().nullable().optional(),
  primary: CodexRateLimitWindowSchema.nullable().optional(),
  secondary: CodexRateLimitWindowSchema.nullable().optional(),
  credits: CodexCreditsSnapshotSchema.nullable().optional(),
  plan_type: z.string().nullable().optional()
});

export const CodexMcpServerStatusSchema = z.object({
  name: z.string().min(1),
  auth_status: z.enum(["unsupported", "notLoggedIn", "bearerToken", "oAuth"]),
  tool_count: z.number().int().nonnegative().default(0),
  resource_count: z.number().int().nonnegative().default(0),
  resource_template_count: z.number().int().nonnegative().default(0)
});

export const CodexDiagnosticsErrorSetSchema = z.object({
  account: z.string().min(1).optional(),
  rate_limits: z.string().min(1).optional(),
  mcp_servers: z.string().min(1).optional()
});

export const CodexDiagnosticsSummarySchema = z.object({
  account: CodexAccountSchema.nullable().default(null),
  requires_openai_auth: z.boolean().default(false),
  rate_limits: CodexRateLimitSnapshotSchema.nullable().default(null),
  rate_limits_by_limit_id: z.record(CodexRateLimitSnapshotSchema).default({}),
  mcp_servers: z.array(CodexMcpServerStatusSchema).default([]),
  errors: CodexDiagnosticsErrorSetSchema.default({})
});

export const CodexModelOptionSchema = z.object({
  slug: z.string().min(1),
  display_name: z.string().min(1),
  description: z.string().optional(),
  default_reasoning_effort: z.string().min(1).optional(),
  reasoning_levels: z.array(CodexModelReasoningLevelSchema).default([]),
  input_modalities: z.array(z.string().min(1)).default([]),
  supports_personality: z.boolean().default(false),
  is_default: z.boolean().default(false)
});

export const CodexSettingsSchema = z.object({
  locale: LocaleSchema.optional(),
  model: z.string().min(1).optional(),
  model_reasoning_effort: z.string().min(1).optional(),
  service_tier: CodexServiceTierSchema.optional(),
  available_models: z.array(CodexModelOptionSchema).default([]),
  approval_policy: CodexApprovalPolicySchema.optional(),
  sandbox_mode: CodexSandboxModeSchema.optional(),
  requirements: CodexConfigRequirementsSchema.optional(),
  experimental_features: z.array(CodexExperimentalFeatureSchema).default([]),
  source: WorktreePathSchema.optional(),
  read_only: z.boolean().default(false),
  updated_at: IsoTimestampSchema.optional()
});

export const CodexThreadSchema = z.object({
  thread_id: ThreadIdSchema,
  project_id: ProjectIdSchema,
  title: z.string().min(1),
  project_label: z.string().min(1),
  repo_root: WorktreePathSchema,
  source: z.string().min(1).optional(),
  state: CodexThreadStateSchema,
  archived: z.boolean().default(false),
  has_active_run: z.boolean().default(false),
  pending_approvals: z.number().int().nonnegative().default(0),
  pending_patches: z.number().int().nonnegative().default(0),
  pending_native_requests: z.number().int().nonnegative().default(0),
  worktree_path: WorktreePathSchema.optional(),
  active_turn_id: TurnIdSchema.nullable().default(null),
  last_stream_seq: StreamSequenceSchema.default(0),
  sync_state: CodexSyncStateSchema.default("native_confirmed"),
  last_native_observed_at: IsoTimestampSchema.optional(),
  adapter_thread_ref: z.string().min(1).optional(),
  native_status_type: z.string().min(1).optional(),
  native_active_flags: z.array(z.string().min(1)).optional(),
  native_token_usage: z.record(z.string(), z.unknown()).optional(),
  created_at: IsoTimestampSchema.optional(),
  updated_at: IsoTimestampSchema
});

export const CodexTimelineItemSchema = z.object({
  item_id: z.string().min(1),
  thread_id: ThreadIdSchema,
  timestamp: IsoTimestampSchema,
  origin: CodexTimelineItemOriginSchema.default("native_confirmed"),
  kind: CodexTimelineItemKindSchema,
  title: z.string().min(1),
  body: z.string().optional(),
  phase: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  turn_id: TurnIdSchema.optional(),
  approval_id: ApprovalIdSchema.optional(),
  patch_id: PatchIdSchema.optional(),
  action_required: z.boolean().default(false),
  mono: z.boolean().default(false)
});

export const CodexMessageDetailSchema = z.object({
  detail_id: z.string().min(1).optional(),
  timestamp: IsoTimestampSchema.optional(),
  kind: CodexMessageDetailKindSchema,
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  status: z.string().min(1).optional(),
  mono: z.boolean().default(false)
});

export const CodexLiveStateSchema = z.object({
  turn_id: TurnIdSchema.optional(),
  status: z.string().min(1),
  detail: z.string().optional(),
  assistant_text: z.string().default(""),
  details: z.array(CodexMessageDetailSchema).default([]),
  updated_at: IsoTimestampSchema,
  awaiting_native_commit: z.boolean().default(false)
});

export const CodexMessageSchema = z.object({
  id: z.string().min(1).optional(),
  message_id: z.string().min(1),
  thread_id: ThreadIdSchema.optional(),
  timestamp: IsoTimestampSchema,
  role: CodexMessageRoleSchema,
  body: z.string().optional(),
  title: z.string().min(1).optional(),
  turn_id: TurnIdSchema.optional(),
  created_at: IsoTimestampSchema.optional(),
  origin: CodexTimelineItemOriginSchema.default("native_confirmed"),
  status: z.string().min(1).optional(),
  approval_id: ApprovalIdSchema.optional(),
  patch_id: PatchIdSchema.optional(),
  action_required: z.boolean().default(false),
  awaiting_native_commit: z.boolean().optional(),
  is_live_draft: z.boolean().optional(),
  input_items: z.array(TurnInputItemSchema).optional(),
  details: z.array(CodexMessageDetailSchema).default([])
});

export const CodexQueueEntrySchema = z.object({
  entry_id: z.string().min(1),
  kind: CodexQueueEntryKindSchema,
  native_request_kind: NativeRequestKindSchema.optional(),
  thread_id: ThreadIdSchema,
  title: z.string().min(1),
  summary: z.string().optional(),
  timestamp: IsoTimestampSchema,
  status: z.string().min(1),
  turn_id: TurnIdSchema.optional(),
  approval_id: ApprovalIdSchema.optional(),
  patch_id: PatchIdSchema.nullable().optional(),
  action_required: z.boolean().default(true)
});

export const CodexCapabilitiesSchema = z.object({
  adapter_kind: z.literal("codex-app-server").optional(),
  collaboration_mode: CollaborationModeKindSchema.default("default"),
  shared_state_available: z.boolean().default(false),
  codex_home: WorktreePathSchema.optional(),
  shared_thread_create: z.boolean().default(false),
  supports_images: z.boolean().default(false),
  run_start: z.boolean().default(false),
  live_follow_up: z.boolean().default(false),
  image_inputs: z.boolean().default(false),
  interrupt: z.boolean().default(false),
  approvals: z.boolean().default(false),
  patch_decisions: z.boolean().default(false),
  thread_rename: z.boolean().default(false),
  thread_archive: z.boolean().default(false),
  thread_compact: z.boolean().default(false),
  thread_fork: z.boolean().default(false),
  thread_rollback: z.boolean().default(false),
  review_start: z.boolean().default(false),
  skills_input: z.boolean().default(false),
  diagnostics_read: z.boolean().default(false),
  settings_read: z.boolean().default(false),
  settings_write: z.boolean().default(false),
  shared_model_config: z.boolean().default(false),
  shared_history: z.boolean().default(false),
  shared_threads: z.boolean().default(false),
  reason: z.string().min(1).optional()
});

export const CodexOverviewSchema = z.object({
  projects: z.array(CodexProjectSummarySchema).default([]),
  threads: z.array(CodexThreadSchema),
  queue: z.array(CodexQueueEntrySchema),
  capabilities: CodexCapabilitiesSchema
});

export const CodexThreadDetailSchema = z.object({
  thread: CodexThreadSchema,
  turns: z.array(TurnRecordSchema),
  approvals: z.array(ApprovalRequestSchema),
  patches: z.array(PatchRecordSchema),
  native_requests: z.array(NativeRequestRecordSchema).default([])
});

export const CodexTimelineSchema = z.object({
  thread: CodexThreadSchema,
  items: z.array(CodexTimelineItemSchema),
  approvals: z.array(ApprovalRequestSchema),
  patches: z.array(PatchRecordSchema),
  native_requests: z.array(NativeRequestRecordSchema).default([])
});

export const CodexTranscriptPageSchema = z.object({
  thread: CodexThreadSchema,
  items: z.array(CodexMessageSchema),
  approvals: z.array(ApprovalRequestSchema),
  patches: z.array(PatchRecordSchema),
  native_requests: z.array(NativeRequestRecordSchema).default([]),
  live_state: CodexLiveStateSchema.nullable().optional(),
  next_cursor: z.string().min(1).nullable().optional(),
  has_more: z.boolean().default(false)
});

export type CodexThreadState = z.infer<typeof CodexThreadStateSchema>;
export type CodexSyncState = z.infer<typeof CodexSyncStateSchema>;
export type CodexTimelineItemKind = z.infer<typeof CodexTimelineItemKindSchema>;
export type CodexTimelineItemOrigin = z.infer<typeof CodexTimelineItemOriginSchema>;
export type CodexMessageRole = z.infer<typeof CodexMessageRoleSchema>;
export type CodexMessageDetailKind = z.infer<typeof CodexMessageDetailKindSchema>;
export type CodexQueueEntryKind = z.infer<typeof CodexQueueEntryKindSchema>;
export type CodexProjectSummary = z.infer<typeof CodexProjectSummarySchema>;
export type CodexModelReasoningLevel = z.infer<typeof CodexModelReasoningLevelSchema>;
export type CodexServiceTier = z.infer<typeof CodexServiceTierSchema>;
export type CodexApprovalPolicy = z.infer<typeof CodexApprovalPolicySchema>;
export type CodexSandboxMode = z.infer<typeof CodexSandboxModeSchema>;
export type CodexConfigRequirements = z.infer<typeof CodexConfigRequirementsSchema>;
export type CodexExperimentalFeature = z.infer<typeof CodexExperimentalFeatureSchema>;
export type CodexReviewTarget = z.infer<typeof CodexReviewTargetSchema>;
export type CodexReviewDelivery = z.infer<typeof CodexReviewDeliverySchema>;
export type CodexThreadSkill = z.infer<typeof CodexThreadSkillSchema>;
export type CodexSkillScanError = z.infer<typeof CodexSkillScanErrorSchema>;
export type CodexAccount = z.infer<typeof CodexAccountSchema>;
export type CodexCreditsSnapshot = z.infer<typeof CodexCreditsSnapshotSchema>;
export type CodexRateLimitWindow = z.infer<typeof CodexRateLimitWindowSchema>;
export type CodexRateLimitSnapshot = z.infer<typeof CodexRateLimitSnapshotSchema>;
export type CodexMcpServerStatus = z.infer<typeof CodexMcpServerStatusSchema>;
export type CodexDiagnosticsErrorSet = z.infer<typeof CodexDiagnosticsErrorSetSchema>;
export type CodexDiagnosticsSummary = z.infer<typeof CodexDiagnosticsSummarySchema>;
export type CodexModelOption = z.infer<typeof CodexModelOptionSchema>;
export type CodexSettings = z.infer<typeof CodexSettingsSchema>;
export type CodexThread = z.infer<typeof CodexThreadSchema>;
export type CodexTimelineItem = z.infer<typeof CodexTimelineItemSchema>;
export type CodexMessageDetail = z.infer<typeof CodexMessageDetailSchema>;
export type CodexLiveState = z.infer<typeof CodexLiveStateSchema>;
export type CodexMessage = z.infer<typeof CodexMessageSchema>;
export type CodexQueueEntry = z.infer<typeof CodexQueueEntrySchema>;
export type CodexCapabilities = z.infer<typeof CodexCapabilitiesSchema>;
export type CodexOverview = z.infer<typeof CodexOverviewSchema>;
export type CodexThreadDetail = z.infer<typeof CodexThreadDetailSchema>;
export type CodexTimeline = z.infer<typeof CodexTimelineSchema>;
export type CodexTranscriptPage = z.infer<typeof CodexTranscriptPageSchema>;
export type CodexPatchRecord = z.infer<typeof PatchRecordSchema>;
