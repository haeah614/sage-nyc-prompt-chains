import { beforeEach, expect, it, vi } from "vitest";
import { AuthError } from "@/lib/auth/errors";

const mocks = vi.hoisted(() => ({
  mutationApi: vi.fn(),
  promptRpc: vi.fn(),
}));
vi.mock("@/lib/auth/api", () => ({ mutationApi: mocks.mutationApi }));
vi.mock("@/lib/database/rpc", () => ({ promptRpc: mocks.promptRpc }));

import { DELETE } from "@/app/api/steps/[id]/route";

const chainId = "11111111-1111-4111-8111-111111111111";
const stepId = "22222222-2222-4222-8222-222222222222";
const params = { params: Promise.resolve({ id: stepId }) };
function request(body: unknown) {
  return new Request(`https://chains.example.test/api/steps/${stepId}`, {
    method: "DELETE",
    headers: {
      origin: "https://chains.example.test",
      "content-type": "application/json",
      "x-prompt-chains-csrf": "1",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.mutationApi.mockResolvedValue({ id: "verified-superadmin" });
  mocks.promptRpc.mockResolvedValue(true);
});

it("deletes only the selected step through the guarded RPC", async () => {
  const response = await DELETE(
    request({
      chain_id: chainId,
      chain_revision: 3,
      revision: 2,
      confirmation: "DELETE",
    }),
    params,
  );
  expect(response.status).toBe(204);
  expect(mocks.promptRpc).toHaveBeenCalledExactlyOnceWith("pct_delete_step", {
    p_chain_id: chainId,
    p_chain_revision: 3,
    p_step_id: stepId,
    p_step_revision: 2,
  });
});

it("rejects cancellation without touching the RPC", async () => {
  const response = await DELETE(
    request({
      chain_id: chainId,
      chain_revision: 3,
      revision: 2,
      confirmation: "CANCEL",
    }),
    params,
  );
  expect(response.status).toBe(400);
  expect(mocks.promptRpc).not.toHaveBeenCalled();
});

it("returns 403 for an unauthorized requester", async () => {
  mocks.mutationApi.mockRejectedValue(
    new AuthError(403, "Superadmin authorization required."),
  );
  const response = await DELETE(
    request({
      chain_id: chainId,
      chain_revision: 3,
      revision: 2,
      confirmation: "DELETE",
    }),
    params,
  );
  expect(response.status).toBe(403);
  expect(mocks.promptRpc).not.toHaveBeenCalled();
});

it("sanitizes database deletion failures", async () => {
  mocks.promptRpc.mockRejectedValue(
    new Error("database details should not leak"),
  );
  const response = await DELETE(
    request({
      chain_id: chainId,
      chain_revision: 3,
      revision: 2,
      confirmation: "DELETE",
    }),
    params,
  );
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("database details");
});
