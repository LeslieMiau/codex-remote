import { z } from "zod";

import { CollaborationModeKindSchema } from "./common";
import { CodexReviewDeliverySchema, CodexReviewTargetSchema } from "./codex";
import { TurnInputItemSchema } from "./entities";
import {
  ActorIdSchema,
  ApprovalIdSchema,
  PatchIdSchema,
  RequestIdSchema,
  ThreadIdSchema,
  TurnIdSchema
} from "./ids";

const CommandMetaSchema = z.object({
  actor_id: ActorIdSchema,
  request_id: RequestIdSchema
});

export const StartTurnCommandSchema = CommandMetaSchema.extend({
  command_type: z.literal("turns.start"),
  thread_id: ThreadIdSchema,
  prompt: z.string().default(""),
  input_items: z.array(TurnInputItemSchema).optional(),
  collaboration_mode: CollaborationModeKindSchema.optional()
});

export const InterruptTurnCommandSchema = CommandMetaSchema.extend({
  command_type: z.literal("turns.interrupt"),
  thread_id: ThreadIdSchema,
  turn_id: TurnIdSchema
});

export const ApproveCommandSchema = CommandMetaSchema.extend({
  command_type: z.literal("approvals.approve"),
  approval_id: ApprovalIdSchema,
  confirmed: z.boolean().optional(),
  native_decision: z.unknown().optional()
});

export const RejectCommandSchema = CommandMetaSchema.extend({
  command_type: z.literal("approvals.reject"),
  approval_id: ApprovalIdSchema,
  reason: z.string().min(1).optional(),
  native_decision: z.unknown().optional()
});

export const ApplyPatchCommandSchema = CommandMetaSchema.extend({
  command_type: z.literal("patches.apply"),
  patch_id: PatchIdSchema
});

export const DiscardPatchCommandSchema = CommandMetaSchema.extend({
  command_type: z.literal("patches.discard"),
  patch_id: PatchIdSchema,
  reason: z.string().min(1).optional()
});

export const RollbackPatchCommandSchema = CommandMetaSchema.extend({
  command_type: z.literal("patches.rollback"),
  patch_id: PatchIdSchema
});

export const RespondNativeRequestCommandSchema = CommandMetaSchema.extend({
  command_type: z.literal("native_requests.respond"),
  native_request_id: z.string().min(1),
  action: z.enum(["respond", "cancel"]).default("respond"),
  response_payload: z.unknown().optional()
});

export const RenameThreadCommandSchema = CommandMetaSchema.extend({
  command_type: z.literal("threads.rename"),
  thread_id: ThreadIdSchema,
  name: z.string().min(1)
});

export const ArchiveThreadCommandSchema = CommandMetaSchema.extend({
  command_type: z.literal("threads.archive"),
  thread_id: ThreadIdSchema
});

export const UnarchiveThreadCommandSchema = CommandMetaSchema.extend({
  command_type: z.literal("threads.unarchive"),
  thread_id: ThreadIdSchema
});

export const CompactThreadCommandSchema = CommandMetaSchema.extend({
  command_type: z.literal("threads.compact"),
  thread_id: ThreadIdSchema
});

export const ForkThreadCommandSchema = CommandMetaSchema.extend({
  command_type: z.literal("threads.fork"),
  thread_id: ThreadIdSchema
});

export const RollbackThreadCommandSchema = CommandMetaSchema.extend({
  command_type: z.literal("threads.rollback"),
  thread_id: ThreadIdSchema,
  num_turns: z.number().int().positive().optional()
});

export const StartReviewCommandSchema = CommandMetaSchema.extend({
  command_type: z.literal("reviews.start"),
  thread_id: ThreadIdSchema,
  target: CodexReviewTargetSchema,
  delivery: CodexReviewDeliverySchema.optional()
});

export const CommandTypeSchema = z.enum([
  "turns.start",
  "turns.interrupt",
  "approvals.approve",
  "approvals.reject",
  "native_requests.respond",
  "patches.apply",
  "patches.discard",
  "patches.rollback",
  "threads.rename",
  "threads.archive",
  "threads.unarchive",
  "threads.compact",
  "threads.fork",
  "threads.rollback",
  "reviews.start"
]);

export const MutatingCommandSchema = z.discriminatedUnion("command_type", [
  StartTurnCommandSchema,
  InterruptTurnCommandSchema,
  ApproveCommandSchema,
  RejectCommandSchema,
  RespondNativeRequestCommandSchema,
  ApplyPatchCommandSchema,
  DiscardPatchCommandSchema,
  RollbackPatchCommandSchema,
  RenameThreadCommandSchema,
  ArchiveThreadCommandSchema,
  UnarchiveThreadCommandSchema,
  CompactThreadCommandSchema,
  ForkThreadCommandSchema,
  RollbackThreadCommandSchema,
  StartReviewCommandSchema
]);

export const DeduplicationKeySchema = z.object({
  actor_id: ActorIdSchema,
  request_id: RequestIdSchema,
  command_type: CommandTypeSchema
});

export interface ProtocolCommandEnvelope {
  command: string;
  payload?: Record<string, unknown>;
}

export type StartTurnCommand = z.infer<typeof StartTurnCommandSchema>;
export type InterruptTurnCommand = z.infer<typeof InterruptTurnCommandSchema>;
export type ApproveCommand = z.infer<typeof ApproveCommandSchema>;
export type RejectCommand = z.infer<typeof RejectCommandSchema>;
export type RespondNativeRequestCommand = z.infer<typeof RespondNativeRequestCommandSchema>;
export type ApplyPatchCommand = z.infer<typeof ApplyPatchCommandSchema>;
export type DiscardPatchCommand = z.infer<typeof DiscardPatchCommandSchema>;
export type RollbackPatchCommand = z.infer<typeof RollbackPatchCommandSchema>;
export type RenameThreadCommand = z.infer<typeof RenameThreadCommandSchema>;
export type ArchiveThreadCommand = z.infer<typeof ArchiveThreadCommandSchema>;
export type UnarchiveThreadCommand = z.infer<typeof UnarchiveThreadCommandSchema>;
export type CompactThreadCommand = z.infer<typeof CompactThreadCommandSchema>;
export type ForkThreadCommand = z.infer<typeof ForkThreadCommandSchema>;
export type RollbackThreadCommand = z.infer<typeof RollbackThreadCommandSchema>;
export type StartReviewCommand = z.infer<typeof StartReviewCommandSchema>;
export type MutatingCommand = z.infer<typeof MutatingCommandSchema>;
export type CommandType = z.infer<typeof CommandTypeSchema>;
export type DeduplicationKey = z.infer<typeof DeduplicationKeySchema>;
