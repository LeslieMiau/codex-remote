import { z } from "zod";

export const CURRENT_SCHEMA_VERSION = "2026-03-13";

export const IsoTimestampSchema = z.string().min(1);
export const StreamSequenceSchema = z.number().int().nonnegative();
export const WorktreePathSchema = z.string().min(1);
export const CollaborationModeKindSchema = z.enum(["default", "plan"]);
export const LocaleSchema = z.enum(["zh", "en"]);
export const UnknownRecordSchema = z.record(z.string(), z.unknown());

export interface TimestampedRecord {
  created_at?: string;
  updated_at?: string;
}

export type CollaborationModeKind = z.infer<typeof CollaborationModeKindSchema>;
export type Locale = z.infer<typeof LocaleSchema>;
