import { z } from "zod";

import {
  CodexCapabilitiesSchema,
  CodexDiagnosticsSummarySchema,
  CodexQueueEntrySchema,
  CodexReviewDeliverySchema,
  CodexReviewTargetSchema,
  CodexServiceTierSchema,
  CodexSettingsSchema,
  CodexSkillScanErrorSchema,
  CodexThreadDetailSchema,
  CodexThreadSchema,
  CodexThreadSkillSchema,
  CodexTimelineSchema,
  CodexTranscriptPageSchema,
  CodexOverviewSchema
} from "./codex";
import {
  DeliveryPolicySchema,
  NativeRequestRecordSchema,
  PatchRecordSchema,
  ProjectSummarySchema,
  SecurityPolicySchema,
  ThreadDetailSchema,
  ThreadSnapshotSchema,
  TurnInputItemSchema,
  TurnRecordSchema
} from "./entities";
import { GatewayEventSchema } from "./events";
import { IsoTimestampSchema, LocaleSchema } from "./common";

export interface ApiEnvelope<T = unknown> {
  data: T;
}

export const CommandReceiptSchema = z.object({
  deduplicated: z.boolean().default(false)
});

export const SharedThreadStartResponseSchema = CommandReceiptSchema.extend({
  project: ProjectSummarySchema,
  thread: ThreadSnapshotSchema,
  turn: TurnRecordSchema.optional()
});

export const StartTurnResponseSchema = CommandReceiptSchema.extend({
  thread: ThreadSnapshotSchema,
  turn: TurnRecordSchema
});

export const CodexThreadActionResponseSchema = CommandReceiptSchema.extend({
  thread: CodexThreadSchema
});

export const CodexThreadForkResponseSchema = CommandReceiptSchema.extend({
  thread: CodexThreadSchema
});

export const CodexReviewStartBodySchema = z.object({
  actor_id: z.string().min(1).optional(),
  request_id: z.string().min(8).optional(),
  thread_id: z.string().min(1).optional(),
  threadId: z.string().min(1).optional(),
  target: CodexReviewTargetSchema,
  delivery: CodexReviewDeliverySchema.optional()
});

export const CodexReviewStartResponseSchema = CommandReceiptSchema.extend({
  review_thread_id: z.string().min(1),
  review_turn_id: z.string().min(1)
});

export const SharedRunRequestBodySchema = z.object({
  actor_id: z.string().min(1),
  request_id: z.string().min(8),
  prompt: z.string().default(""),
  input_items: z.array(TurnInputItemSchema).optional(),
  collaboration_mode: z.enum(["default", "plan"]).optional()
});

export const UploadedImageAttachmentSchema = z.object({
  attachment_id: z.string().min(1),
  thread_id: z.string().min(1),
  file_name: z.string().min(1),
  content_type: z.string().min(1),
  byte_size: z.number().int().nonnegative(),
  uploaded_at: IsoTimestampSchema,
  expires_at: IsoTimestampSchema
});

export const CodexThreadSkillsResponseSchema = z.object({
  cwd: z.string().min(1),
  skills: z.array(CodexThreadSkillSchema).default([]),
  errors: z.array(CodexSkillScanErrorSchema).default([])
});

export const CodexDiagnosticsSummaryResponseSchema = CodexDiagnosticsSummarySchema;

export const ApprovalActionResponseSchema = CommandReceiptSchema.extend({
  approval: z.object({
    approval_id: z.string().min(1),
    status: z.string().min(1)
  }),
  thread: ThreadSnapshotSchema
});

export const PatchActionResponseSchema = CommandReceiptSchema.extend({
  patch: PatchRecordSchema,
  thread: ThreadSnapshotSchema
});

export const NativeRequestActionResponseSchema = CommandReceiptSchema.extend({
  native_request: NativeRequestRecordSchema,
  thread: ThreadSnapshotSchema.optional()
});

export const RollbackPatchResponseSchema = CommandReceiptSchema.extend({
  patch: PatchRecordSchema
});

export const ThreadListResponseSchema = z.object({
  threads: z.array(ThreadSnapshotSchema)
});

export const ProjectListResponseSchema = z.object({
  projects: z.array(ProjectSummarySchema)
});

export const ThreadEventsResponseSchema = z.object({
  events: z.array(GatewayEventSchema)
});

export const GatewayConfigResponseSchema = z.object({
  schema_version: z.string().min(1),
  delivery_policy: DeliveryPolicySchema,
  security_policy: SecurityPolicySchema
});

export const ThreadDetailResponseSchema = ThreadDetailSchema;
export const CodexOverviewResponseSchema = CodexOverviewSchema;
export const CodexThreadDetailResponseSchema = CodexThreadDetailSchema;
export const CodexTimelineResponseSchema = CodexTimelineSchema;
export const CodexTranscriptPageResponseSchema = CodexTranscriptPageSchema;
export const CodexQueueResponseSchema = z.object({
  entries: z.array(CodexQueueEntrySchema)
});
export const CodexCapabilitiesResponseSchema = CodexCapabilitiesSchema;
export const CodexSharedSettingsResponseSchema = CodexSettingsSchema;

export const UpdateCodexSharedSettingsBodySchema = z.object({
  locale: LocaleSchema.optional(),
  model: z.string().min(1).optional(),
  model_reasoning_effort: z.string().min(1).optional(),
  service_tier: CodexServiceTierSchema.optional()
});

export const UpdateCodexSharedSettingsResponseSchema = CodexSettingsSchema;

export type SharedThreadStartResponse = z.infer<typeof SharedThreadStartResponseSchema>;
export type StartTurnResponse = z.infer<typeof StartTurnResponseSchema>;
export type CodexThreadActionResponse = z.infer<typeof CodexThreadActionResponseSchema>;
export type CodexThreadForkResponse = z.infer<typeof CodexThreadForkResponseSchema>;
export type CodexReviewStartBody = z.infer<typeof CodexReviewStartBodySchema>;
export type CodexReviewStartResponse = z.infer<typeof CodexReviewStartResponseSchema>;
export type SharedRunRequestBody = z.infer<typeof SharedRunRequestBodySchema>;
export type UploadedImageAttachment = z.infer<typeof UploadedImageAttachmentSchema>;
export type CodexThreadSkillsResponse = z.infer<typeof CodexThreadSkillsResponseSchema>;
export type CodexDiagnosticsSummaryResponse = z.infer<
  typeof CodexDiagnosticsSummaryResponseSchema
>;
export type ApprovalActionResponse = z.infer<typeof ApprovalActionResponseSchema>;
export type PatchActionResponse = z.infer<typeof PatchActionResponseSchema>;
export type NativeRequestActionResponse = z.infer<typeof NativeRequestActionResponseSchema>;
export type RollbackPatchResponse = z.infer<typeof RollbackPatchResponseSchema>;
export type ThreadListResponse = z.infer<typeof ThreadListResponseSchema>;
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;
export type ThreadEventsResponse = z.infer<typeof ThreadEventsResponseSchema>;
export type GatewayConfigResponse = z.infer<typeof GatewayConfigResponseSchema>;
export type ThreadDetailResponse = z.infer<typeof ThreadDetailResponseSchema>;
export type CodexOverviewResponse = z.infer<typeof CodexOverviewResponseSchema>;
export type CodexThreadDetailResponse = z.infer<typeof CodexThreadDetailResponseSchema>;
export type CodexTimelineResponse = z.infer<typeof CodexTimelineResponseSchema>;
export type CodexTranscriptPageResponse = z.infer<typeof CodexTranscriptPageResponseSchema>;
export type CodexQueueResponse = z.infer<typeof CodexQueueResponseSchema>;
export type CodexCapabilitiesResponse = z.infer<typeof CodexCapabilitiesResponseSchema>;
export type CodexSharedSettingsResponse = z.infer<typeof CodexSharedSettingsResponseSchema>;
export type UpdateCodexSharedSettingsBody = z.infer<typeof UpdateCodexSharedSettingsBodySchema>;
export type UpdateCodexSharedSettingsResponse = z.infer<
  typeof UpdateCodexSharedSettingsResponseSchema
>;
