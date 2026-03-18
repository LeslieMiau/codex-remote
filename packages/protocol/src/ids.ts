import { z } from "zod";

const NonEmptyIdSchema = z.string().min(1);

export const ActorIdSchema = NonEmptyIdSchema;
export const ApprovalIdSchema = NonEmptyIdSchema;
export const AttachmentIdSchema = NonEmptyIdSchema;
export const ItemIdSchema = NonEmptyIdSchema;
export const NativeRequestIdSchema = NonEmptyIdSchema;
export const PatchIdSchema = NonEmptyIdSchema;
export const ProjectIdSchema = NonEmptyIdSchema;
export const RequestIdSchema = z.string().min(8);
export const ThreadIdSchema = NonEmptyIdSchema;
export const TurnIdSchema = NonEmptyIdSchema;

export type ProtocolId = string;
export type ActorId = z.infer<typeof ActorIdSchema>;
export type ApprovalId = z.infer<typeof ApprovalIdSchema>;
export type AttachmentId = z.infer<typeof AttachmentIdSchema>;
export type ItemId = z.infer<typeof ItemIdSchema>;
export type NativeRequestId = z.infer<typeof NativeRequestIdSchema>;
export type PatchId = z.infer<typeof PatchIdSchema>;
export type ProjectId = z.infer<typeof ProjectIdSchema>;
export type RequestId = z.infer<typeof RequestIdSchema>;
export type ThreadId = z.infer<typeof ThreadIdSchema>;
export type TurnId = z.infer<typeof TurnIdSchema>;
