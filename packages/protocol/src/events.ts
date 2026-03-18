import { z } from "zod";

import {
  CURRENT_SCHEMA_VERSION,
  IsoTimestampSchema,
  StreamSequenceSchema,
  UnknownRecordSchema
} from "./common";
import { ProjectIdSchema, ThreadIdSchema, TurnIdSchema } from "./ids";

export const GatewayEventTypeSchema = z.string().min(1);

export const GatewayEventSchema = z.object({
  event_id: z.string().min(1).optional(),
  stream_seq: StreamSequenceSchema,
  schema_version: z.string().min(1).default(CURRENT_SCHEMA_VERSION),
  event_type: GatewayEventTypeSchema,
  project_id: ProjectIdSchema.optional(),
  thread_id: ThreadIdSchema.optional(),
  turn_id: TurnIdSchema.optional(),
  timestamp: IsoTimestampSchema.optional(),
  payload: UnknownRecordSchema
});

export interface ProtocolEventEnvelope {
  event_type: string;
  payload: Record<string, unknown>;
}

export type GatewayEventType = z.infer<typeof GatewayEventTypeSchema>;
export type GatewayEvent = z.infer<typeof GatewayEventSchema>;
