import { z } from "zod";

// Proposal contracts, not a generated client for an installed database.
// No credential access, network calls, or database writes live in this module.
export const idSchema = z.uuid();
export const revisionSchema = z.number().int().min(1).max(2147483646);
// Reserve 200 increments for a 100-step, two-pass reorder with parent stamping.
export const chainRevisionSchema = revisionSchema.max(2147483446);
const text = (max: number) => z.string().trim().min(1).max(max);
const byteText = (max: number) =>
  z
    .string()
    .refine(
      (value) => new TextEncoder().encode(value).byteLength <= max,
      `Text must be at most ${max} UTF-8 bytes`,
    );
export const generationConfigSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    max_output_tokens: z.number().int().min(1).max(65536).optional(),
  })
  .strict();
export const chainDefinitionSchema = z
  .object({
    name: text(120),
    slug: text(120).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    version: z.number().int().min(1).max(2147483647),
    description: text(2000),
  })
  .strict();
export const createChainSchema = chainDefinitionSchema;
export const updateChainSchema = chainDefinitionSchema
  .extend({ id: idSchema, revision: chainRevisionSchema })
  .strict();
export const stepDefinitionSchema = z
  .object({
    name: text(120),
    instruction: text(20000),
    model_id: idSchema,
    input_source: z.enum(["chain_input", "previous_output"]),
    generation_config: generationConfigSchema,
  })
  .strict();
export const createStepSchema = stepDefinitionSchema
  .extend({ chain_id: idSchema, chain_revision: chainRevisionSchema })
  .strict();
export const updateStepSchema = createStepSchema
  .extend({ id: idSchema, revision: revisionSchema })
  .strict();
export const reorderStepsSchema = z
  .object({
    chain_id: idSchema,
    chain_revision: chainRevisionSchema,
    step_ids: z.array(idSchema).max(100),
  })
  .strict()
  .refine(
    (value) => new Set(value.step_ids).size === value.step_ids.length,
    "Every step must appear exactly once",
  );
export const deleteChainSchema = z
  .object({
    id: idSchema,
    revision: chainRevisionSchema,
    confirmation: z.literal("DELETE"),
  })
  .strict();
export const deleteStepSchema = z
  .object({
    id: idSchema,
    revision: revisionSchema,
    chain_id: idSchema,
    chain_revision: chainRevisionSchema,
    confirmation: z.literal("DELETE"),
  })
  .strict();
export const enqueueRunSchema = z
  .object({
    chain_id: idSchema,
    chain_revision: chainRevisionSchema,
    input_text: text(20000),
    idempotency_key: idSchema,
  })
  .strict();
export const claimStepSchema = z
  .object({ run_id: idSchema, run_revision: revisionSchema })
  .strict();
export const usageSchema = z
  .object({
    input_tokens: z.number().int().min(0).max(2147483647).optional(),
    output_tokens: z.number().int().min(0).max(2147483647).optional(),
    total_tokens: z.number().int().min(0).max(2147483647).optional(),
  })
  .strict();
export const mediaReferenceSchema = z
  .object({
    kind: z.enum(["image", "audio", "video"]),
    bucket_id: z.literal("prompt-chain-artifacts"),
    object_path: z
      .string()
      .regex(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/,
      ),
    mime_type: z.string().regex(/^(image|audio|video)\/[a-zA-Z0-9.+-]+$/),
    byte_size: z.number().int().min(1).max(52428800),
  })
  .strict()
  .refine(
    (value) => value.mime_type.split("/")[0] === value.kind,
    "Media kind and MIME type must agree",
  );
const completionBase = z.object({
  run_id: idSchema,
  step_id: idSchema,
  step_revision: revisionSchema,
  lease_token: idSchema,
  usage: usageSchema,
});
export const finishStepSchema = z
  .discriminatedUnion("status", [
    completionBase
      .extend({
        status: z.literal("succeeded"),
        output_text: byteText(262144).nullable(),
        media: z.array(mediaReferenceSchema).max(16),
        error_code: z.null(),
        error_message: z.null(),
      })
      .strict(),
    completionBase
      .extend({
        status: z.literal("failed"),
        output_text: z.null(),
        media: z.array(mediaReferenceSchema).length(0),
        error_code: z.enum(["provider_error", "timeout", "invalid_output"]),
        // Future handlers must use redacted/canned messages, never raw provider errors.
        error_message: byteText(2000).nullable(),
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    if (
      value.status === "succeeded" &&
      !value.output_text?.trim() &&
      !value.media.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Successful steps require text or media",
      });
    if (
      value.media.some(
        (media) => media.object_path.split("/")[0] !== value.run_id,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Media must belong to the same run",
      });
    if (
      new Set(value.media.map((media) => media.object_path)).size !==
      value.media.length
    )
      ctx.addIssue({ code: "custom", message: "Duplicate media object" });
  });
export const stopRunSchema = z
  .object({
    run_id: idSchema,
    run_revision: revisionSchema,
    reason: z.enum(["cancelled", "lease_expired"]),
  })
  .strict();
export const historySchema = z
  .object({
    chain_id: idSchema,
    before_at: z.iso.datetime({ offset: true }).nullable(),
    before_id: idSchema.nullable(),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict()
  .refine(
    (value) => (value.before_at === null) === (value.before_id === null),
    "Both cursor fields are required together",
  );
export const linkArtifactSchema = z
  .object({
    artifact_id: idSchema,
    revision: revisionSchema,
    generation_id: idSchema.nullable(),
    response_id: idSchema.nullable(),
    image_id: idSchema.nullable(),
  })
  .strict();
