import { expect, it } from "vitest";
import {
  createChainSchema,
  createStepSchema,
  reorderStepsSchema,
  deleteChainSchema,
  generationConfigSchema,
  enqueueRunSchema,
  finishStepSchema,
  historySchema,
  mediaReferenceSchema,
} from "@/lib/database/schemas";
import { planStepReorder } from "@/lib/database/reorder";
const chain = "11111111-1111-4111-8111-111111111111";
const step = "22222222-2222-4222-8222-222222222222";
const model = "33333333-3333-4333-8333-333333333333";
const run = "44444444-4444-4444-8444-444444444444";
const definition = {
  name: "Research",
  slug: "research",
  version: 1,
  description: "A research chain",
};
const completion = {
  run_id: run,
  step_id: step,
  step_revision: 2,
  lease_token: model,
  usage: {},
  status: "succeeded",
  output_text: "Result",
  media: [],
  error_code: null,
  error_message: null,
};
it("validates definition fields and rejects client-controlled roles, actor IDs, revisions and mix weights on creation", () => {
  expect(createChainSchema.parse(definition)).toEqual(definition);
  for (const extra of [
    { mix_weight: 1 },
    { is_superadmin: true },
    { actor_id: chain },
    { revision: 1 },
  ])
    expect(
      createChainSchema.safeParse({ ...definition, ...extra }).success,
    ).toBe(false);
  expect(
    createChainSchema.safeParse({ ...definition, slug: "Not a slug" }).success,
  ).toBe(false);
});
it("validates the Week 7 field limits and requires conflict tokens and deletion confirmation", () => {
  expect(
    createChainSchema.safeParse({ ...definition, name: "x".repeat(121) })
      .success,
  ).toBe(false);
  expect(
    deleteChainSchema.safeParse({
      id: chain,
      revision: 1,
      confirmation: "DELETE",
    }).success,
  ).toBe(true);
  expect(
    deleteChainSchema.safeParse({
      id: chain,
      revision: 0,
      confirmation: "DELETE",
    }).success,
  ).toBe(false);
  expect(deleteChainSchema.safeParse({ id: chain, revision: 1 }).success).toBe(
    false,
  );
});
it("accepts strictly bounded generation parameters, not arbitrary Gemini request bodies", () => {
  expect(
    generationConfigSchema.parse({
      temperature: 0,
      top_p: 1,
      max_output_tokens: 1024,
    }),
  ).toBeDefined();
  for (const value of [
    { temperature: 3 },
    { top_p: -1 },
    { max_output_tokens: 1.5 },
    { max_output_tokens: 65537 },
    { api_key: "secret" },
    { safety_settings: [] },
  ])
    expect(generationConfigSchema.safeParse(value).success).toBe(false);
});
it("step input does not accept a manual position, chain reassignment or embedded output references", () => {
  const value = {
    chain_id: chain,
    chain_revision: 1,
    model_id: model,
    name: "Summarize",
    instruction: "Summarize the supplied text",
    input_source: "previous_output",
    generation_config: {},
  };
  expect(createStepSchema.safeParse(value).success).toBe(true);
  expect(createStepSchema.safeParse({ ...value, position: 1 }).success).toBe(
    false,
  );
  expect(
    createStepSchema.safeParse({ ...value, input_source: "arbitrary-step-id" })
      .success,
  ).toBe(false);
});
it("requires an explicit idempotency key and revision to enqueue", () => {
  expect(
    enqueueRunSchema.safeParse({
      chain_id: chain,
      chain_revision: 1,
      input_text: "Brief",
      idempotency_key: run,
    }).success,
  ).toBe(true);
  expect(
    enqueueRunSchema.safeParse({
      chain_id: chain,
      chain_revision: 1,
      input_text: "Brief",
    }).success,
  ).toBe(false);
});
it("accepts valid successful/failed completions and rejects contradictory result states", () => {
  expect(finishStepSchema.safeParse(completion).success).toBe(true);
  expect(
    finishStepSchema.safeParse({
      ...completion,
      status: "failed",
      output_text: null,
      error_code: "timeout",
      error_message: "Request timed out",
    }).success,
  ).toBe(true);
  for (const value of [
    { ...completion, output_text: "" },
    { ...completion, status: "failed" },
    { ...completion, error_code: "timeout" },
    { ...completion, status: "pending" },
    { ...completion, usage: { api_key: "secret" } },
  ])
    expect(finishStepSchema.safeParse(value).success).toBe(false);
});
it("uses UTF-8 byte limits for outputs and sanitized error messages", () => {
  expect(
    finishStepSchema.safeParse({
      ...completion,
      output_text: "é".repeat(131072),
    }).success,
  ).toBe(true);
  expect(
    finishStepSchema.safeParse({
      ...completion,
      output_text: "é".repeat(131073),
    }).success,
  ).toBe(false);
  expect(
    finishStepSchema.safeParse({
      ...completion,
      status: "failed",
      output_text: null,
      error_code: "timeout",
      error_message: "é".repeat(1001),
    }).success,
  ).toBe(false);
});
it("requires private same-run media references, unique paths and matching MIME types", () => {
  const media = {
    kind: "image",
    bucket_id: "prompt-chain-artifacts",
    object_path: `${run}/${model}.png`,
    mime_type: "image/png",
    byte_size: 128,
  };
  expect(
    finishStepSchema.safeParse({
      ...completion,
      output_text: null,
      media: [media],
    }).success,
  ).toBe(true);
  expect(
    finishStepSchema.safeParse({ ...completion, media: [media, media] })
      .success,
  ).toBe(false);
  expect(
    finishStepSchema.safeParse({
      ...completion,
      media: [{ ...media, object_path: `${chain}/${model}.png` }],
    }).success,
  ).toBe(false);
  for (const value of [
    { ...media, bucket_id: "admin-images" },
    { ...media, object_path: "https://signed.example/token" },
    { ...media, mime_type: "audio/mp3" },
    { ...media, byte_size: 52428801 },
  ])
    expect(mediaReferenceSchema.safeParse(value).success).toBe(false);
});
it("requires both history cursor fields and a bounded page size", () => {
  expect(
    historySchema.safeParse({
      chain_id: chain,
      before_at: null,
      before_id: null,
    }).success,
  ).toBe(true);
  expect(
    historySchema.safeParse({
      chain_id: chain,
      before_at: "2026-10-31T00:00:00Z",
      before_id: run,
      limit: 100,
    }).success,
  ).toBe(true);
  expect(
    historySchema.safeParse({
      chain_id: chain,
      before_at: null,
      before_id: run,
    }).success,
  ).toBe(false);
  expect(
    historySchema.safeParse({
      chain_id: chain,
      before_at: null,
      before_id: null,
      limit: 101,
    }).success,
  ).toBe(false);
});
it("rejects incomplete, duplicate, foreign and overflowing reorder plans", () => {
  const current = [
    { id: step, position: 1, revision: 1 },
    { id: model, position: 3, revision: 1 },
  ];
  for (const ids of [[step], [step, step], [step, chain]])
    expect(() => planStepReorder(current, ids)).toThrow();
  expect(() =>
    planStepReorder([{ id: step, position: 2147483647, revision: 1 }], [step]),
  ).toThrow("headroom");
  expect(() =>
    planStepReorder([{ id: step, position: 3, revision: 2147483646 }], [step]),
  ).toThrow("headroom");
  expect(
    reorderStepsSchema.safeParse({
      chain_id: chain,
      chain_revision: 1,
      step_ids: [step, step],
    }).success,
  ).toBe(false);
});
it("empty and already contiguous unchanged orders need no writes", () => {
  expect(planStepReorder([], [])).toEqual({ temporary: [], final: [] });
  expect(
    planStepReorder([{ id: step, position: 1, revision: 1 }], [step]),
  ).toEqual({ temporary: [], final: [] });
});
it("two-pass reorder maintains immediate uniqueness for every intermediate row across 100 sizes", () => {
  for (let count = 1; count <= 100; count++) {
    const current = Array.from({ length: count }, (_, i) => ({
      id: `step-${i}`,
      position: 2 * i + 2,
      revision: 1,
    }));
    const ids = current.map((s) => s.id).reverse();
    const plan = planStepReorder(current, ids);
    const positions = new Map(current.map((s) => [s.id, s.position]));
    for (const move of [...plan.temporary, ...plan.final]) {
      expect(move.position).toBeGreaterThan(0);
      expect(
        [...positions].some(
          ([id, position]) => id !== move.id && position === move.position,
        ),
      ).toBe(false);
      positions.set(move.id, move.position);
    }
    expect(ids.map((id) => positions.get(id))).toEqual(
      Array.from({ length: count }, (_, i) => i + 1),
    );
  }
});
