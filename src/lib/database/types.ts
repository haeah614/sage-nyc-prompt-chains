import type { z } from "zod";
import type {
  chainDefinitionSchema,
  stepDefinitionSchema,
  finishStepSchema,
  mediaReferenceSchema,
  usageSchema,
} from "./schemas";

// Handwritten proposal types. Regenerate Supabase Database types only after an
// approved isolated installation; these do not assert a live schema exists.
export type ChainDefinition = z.infer<typeof chainDefinitionSchema>;
export type StepDefinition = z.infer<typeof stepDefinitionSchema>;
export type StepCompletion = z.infer<typeof finishStepSchema>;
export type MediaReference = z.infer<typeof mediaReferenceSchema>;
export type Usage = z.infer<typeof usageSchema>;
export type RunStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type StepStatus =
  "pending" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";
export type ErrorCode =
  | "provider_error"
  | "timeout"
  | "invalid_output"
  | "cancelled"
  | "lease_expired";
export interface StampedRow {
  id: string;
  created_at: string;
  updated_at: string;
  revision: number;
}
export interface ChainRow extends ChainDefinition, StampedRow {
  mix_weight: number;
}
export interface StepRow extends StepDefinition, StampedRow {
  chain_id: string;
  position: number;
}
export interface StepSnapshot extends StepRow {
  model_key: string;
  model_revision: number;
  provider_id: string;
  provider_key: string;
  provider_revision: number;
}
export interface RunRow {
  id: string;
  chain_id: string;
  requested_by: string | null;
  idempotency_key: string;
  chain_revision: number;
  chain_snapshot: ChainRow;
  input_text: string;
  status: RunStatus;
  revision: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_code: ErrorCode | null;
  error_message: string | null;
}
export interface RunStepRow {
  id: string;
  run_id: string;
  chain_id: string;
  source_step_id: string;
  position: number;
  step_snapshot: StepSnapshot;
  status: StepStatus;
  revision: number;
  input_text: string | null;
  output_text: string | null;
  error_code: ErrorCode | null;
  error_message: string | null;
  executed_by: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  usage: Usage;
}
export type HistoryStep = Omit<RunStepRow, "lease_token">;
export type RunHistoryItem = Pick<
  RunRow,
  | "id"
  | "chain_id"
  | "requested_by"
  | "chain_revision"
  | "status"
  | "revision"
  | "created_at"
  | "started_at"
  | "finished_at"
  | "error_code"
>;
export interface ArtifactRow extends StampedRow {
  chain_id: string;
  run_id: string;
  run_step_id: string;
  kind: "text" | "image" | "audio" | "video";
  text_content: string | null;
  bucket_id: string | null;
  object_path: string | null;
  mime_type: string | null;
  byte_size: number | null;
  generation_id: string | null;
  response_id: string | null;
  image_id: string | null;
}
export interface RunDetail {
  run: RunRow;
  steps: HistoryStep[];
  artifacts: ArtifactRow[];
}
