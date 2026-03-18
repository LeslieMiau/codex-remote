import { z } from "zod";

import {
  ActorIdSchema,
  ApprovalIdSchema,
  AttachmentIdSchema,
  PatchIdSchema,
  ProjectIdSchema,
  ThreadIdSchema,
  TurnIdSchema
} from "./ids";
import {
  IsoTimestampSchema,
  StreamSequenceSchema,
  UnknownRecordSchema,
  WorktreePathSchema
} from "./common";

export const ThreadStateSchema = z.enum([
  "created",
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

export const TurnStateSchema = z.enum([
  "queued",
  "started",
  "streaming",
  "waiting_input",
  "waiting_approval",
  "resumed",
  "completed",
  "failed",
  "interrupted"
]);

export const ApprovalStateSchema = z.enum([
  "requested",
  "approved",
  "rejected",
  "expired",
  "canceled"
]);

export const PatchStateSchema = z.enum([
  "generated",
  "reviewed",
  "applied",
  "discarded"
]);

export const TestRunStatusSchema = z.enum(["passed", "failed", "skipped"]);

export const TurnProgressChannelSchema = z.enum([
  "status",
  "thinking",
  "editing",
  "testing",
  "tool_call",
  "tool_result"
]);

export const ApprovalKindSchema = z.enum([
  "filesystem",
  "network",
  "destructive",
  "command"
]);

export const ApprovalSourceSchema = z.enum(["native", "legacy_gateway"]);

export const NativeRequestStatusSchema = z.enum([
  "requested",
  "responded",
  "resolved",
  "failed",
  "canceled"
]);

export const NativeRequestKindSchema = z.enum([
  "user_input",
  "dynamic_tool",
  "auth_refresh"
]);

export const TurnInputItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("image_attachment"),
    attachment_id: AttachmentIdSchema,
    file_name: z.string().min(1).optional()
  }),
  z.object({
    type: z.literal("skill"),
    name: z.string().min(1),
    path: z.string().min(1)
  })
]);

export const ApprovalRequestSchema = z.object({
  approval_id: ApprovalIdSchema,
  project_id: ProjectIdSchema.optional(),
  thread_id: ThreadIdSchema.optional(),
  turn_id: TurnIdSchema.optional(),
  kind: ApprovalKindSchema.default("command"),
  source: ApprovalSourceSchema.default("legacy_gateway"),
  native_ref: z.string().min(1).optional(),
  status: ApprovalStateSchema.default("requested"),
  title: z.string().min(1).optional(),
  reason: z.string().min(1).default("Approval required"),
  requested_at: IsoTimestampSchema,
  expires_at: IsoTimestampSchema.optional(),
  resolved_at: IsoTimestampSchema.optional(),
  actor_id: ActorIdSchema.optional(),
  recoverable: z.boolean().default(true),
  command: z.string().min(1).nullable().optional(),
  cwd: WorktreePathSchema.nullable().optional(),
  permissions: UnknownRecordSchema.optional(),
  available_decisions: z.array(z.string().min(1)).optional()
});

export const PatchFileSummarySchema = z.object({
  path: z.string().min(1),
  added_lines: z.number().int().nonnegative().default(0),
  removed_lines: z.number().int().nonnegative().default(0)
});

export const PatchSetSchema = z.object({
  patch_id: PatchIdSchema,
  project_id: ProjectIdSchema.optional(),
  thread_id: ThreadIdSchema.optional(),
  turn_id: TurnIdSchema.optional(),
  status: PatchStateSchema.default("generated"),
  summary: z.string().min(1),
  files: z.array(PatchFileSummarySchema).default([]),
  test_summary: z.string().nullable().optional(),
  created_at: IsoTimestampSchema.optional(),
  updated_at: IsoTimestampSchema.optional()
});

export const PatchChangeSchema = z.object({
  path: z.string().min(1),
  before_content: z.string().nullable().default(null),
  after_content: z.string().nullable().default(null),
  unified_diff: z.string().nullable().optional()
});

export const PatchRecordSchema = PatchSetSchema.extend({
  project_id: ProjectIdSchema,
  thread_id: ThreadIdSchema,
  created_at: IsoTimestampSchema,
  updated_at: IsoTimestampSchema,
  applied_at: IsoTimestampSchema.optional(),
  discarded_at: IsoTimestampSchema.optional(),
  rollback_available: z.boolean().default(false),
  changes: z.array(PatchChangeSchema).default([])
});

export const NativeRequestRecordSchema = z.object({
  native_request_id: z.string().min(1),
  project_id: ProjectIdSchema.optional(),
  thread_id: ThreadIdSchema.optional(),
  turn_id: TurnIdSchema.optional(),
  item_id: z.string().min(1).optional(),
  kind: NativeRequestKindSchema,
  source: z.literal("native").default("native"),
  native_ref: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  status: NativeRequestStatusSchema.default("requested"),
  payload: UnknownRecordSchema.optional(),
  response_payload: z.unknown().optional(),
  requested_at: IsoTimestampSchema,
  resolved_at: IsoTimestampSchema.optional(),
  actor_id: ActorIdSchema.optional()
});

export const ResourceLimitsSchema = z.object({
  max_active_threads: z.number().int().positive().default(3),
  max_queued_threads: z.number().int().positive().default(20),
  max_active_turns_per_thread: z.number().int().positive().default(1),
  thread_idle_timeout_minutes: z.number().int().positive().default(30),
  worktree_retention_after_terminal_hours: z.number().int().positive().default(24)
});

export const DeliveryPolicySchema = z.object({
  primary_stream_transport: z.literal("websocket").default("websocket"),
  fallback_stream_transport: z.literal("sse").default("sse"),
  delivery_semantics: z.literal("at-least-once").default("at-least-once"),
  heartbeat_seconds: z.number().int().positive().default(20),
  mobile_session_ttl_hours: z.number().int().positive().default(24),
  approval_ttl_minutes: z.number().int().positive().default(10)
});

export const SecurityPolicySchema = z.object({
  gateway_bind_address: z.literal("127.0.0.1").default("127.0.0.1"),
  tailscale_ingress_only: z.literal(true).default(true),
  public_funnel_allowed: z.literal(false).default(false),
  direct_app_server_exposure: z.literal(false).default(false),
  network_access_default: z.literal("disabled").default("disabled"),
  requires_second_confirmation_for_destructive_commands: z
    .literal(true)
    .default(true)
});

export const AdapterKindSchema = z.literal("codex-app-server");

export const ThreadSnapshotSchema = z.object({
  project_id: ProjectIdSchema,
  thread_id: ThreadIdSchema,
  state: ThreadStateSchema,
  active_turn_id: TurnIdSchema.nullable().default(null),
  pending_turn_ids: z.array(TurnIdSchema).default([]),
  pending_approval_ids: z.array(ApprovalIdSchema).default([]),
  worktree_path: WorktreePathSchema.optional(),
  adapter_kind: AdapterKindSchema.optional(),
  adapter_thread_ref: z.string().min(1).optional(),
  native_title: z.string().min(1).optional(),
  native_archived: z.boolean().optional(),
  native_status_type: z.string().min(1).optional(),
  native_active_flags: z.array(z.string().min(1)).optional(),
  native_turn_ref: z.string().min(1).optional(),
  native_token_usage: UnknownRecordSchema.optional(),
  last_stream_seq: StreamSequenceSchema.default(0),
  created_at: IsoTimestampSchema.optional(),
  cleanup_after: IsoTimestampSchema.optional(),
  updated_at: IsoTimestampSchema
});

export const ProjectSummarySchema = z.object({
  project_id: ProjectIdSchema,
  repo_root: WorktreePathSchema,
  default_branch: z.string().min(1).optional(),
  created_at: IsoTimestampSchema.optional(),
  updated_at: IsoTimestampSchema.optional()
});

export const TurnRecordSchema = z.object({
  project_id: ProjectIdSchema,
  thread_id: ThreadIdSchema,
  turn_id: TurnIdSchema,
  prompt: z.string(),
  state: TurnStateSchema,
  summary: z.string().optional(),
  created_at: IsoTimestampSchema,
  updated_at: IsoTimestampSchema
});

export const ThreadDetailSchema = z.object({
  project: ProjectSummarySchema,
  thread: ThreadSnapshotSchema,
  turns: z.array(TurnRecordSchema).default([]),
  approvals: z.array(ApprovalRequestSchema).default([]),
  patches: z.array(PatchRecordSchema).default([]),
  native_requests: z.array(NativeRequestRecordSchema).default([])
});

export const DEFAULT_DELIVERY_POLICY = DeliveryPolicySchema.parse({});
export const DEFAULT_RESOURCE_LIMITS = ResourceLimitsSchema.parse({});
export const DEFAULT_SECURITY_POLICY = SecurityPolicySchema.parse({});

export interface ProtocolEntityRef {
  id: string;
  kind: string;
}

export type ThreadState = z.infer<typeof ThreadStateSchema>;
export type TurnState = z.infer<typeof TurnStateSchema>;
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;
export type PatchState = z.infer<typeof PatchStateSchema>;
export type TestRunStatus = z.infer<typeof TestRunStatusSchema>;
export type TurnProgressChannel = z.infer<typeof TurnProgressChannelSchema>;
export type ApprovalKind = z.infer<typeof ApprovalKindSchema>;
export type ApprovalSource = z.infer<typeof ApprovalSourceSchema>;
export type NativeRequestStatus = z.infer<typeof NativeRequestStatusSchema>;
export type NativeRequestKind = z.infer<typeof NativeRequestKindSchema>;
export type TurnInputItem = z.infer<typeof TurnInputItemSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type PatchFileSummary = z.infer<typeof PatchFileSummarySchema>;
export type PatchSet = z.infer<typeof PatchSetSchema>;
export type PatchChange = z.infer<typeof PatchChangeSchema>;
export type PatchRecord = z.infer<typeof PatchRecordSchema>;
export type NativeRequestRecord = z.infer<typeof NativeRequestRecordSchema>;
export type ResourceLimits = z.infer<typeof ResourceLimitsSchema>;
export type DeliveryPolicy = z.infer<typeof DeliveryPolicySchema>;
export type SecurityPolicy = z.infer<typeof SecurityPolicySchema>;
export type AdapterKind = z.infer<typeof AdapterKindSchema>;
export type ThreadSnapshot = z.infer<typeof ThreadSnapshotSchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type TurnRecord = z.infer<typeof TurnRecordSchema>;
export type ThreadDetail = z.infer<typeof ThreadDetailSchema>;
