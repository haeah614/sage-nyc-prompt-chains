import { beforeEach, expect, it, vi } from "vitest";
import { AuthError } from "@/lib/auth/errors";

const mocks = vi.hoisted(() => ({
  mutationApi: vi.fn(),
  promptRpc: vi.fn(),
}));
vi.mock("@/lib/auth/api", () => ({ mutationApi: mocks.mutationApi }));
vi.mock("@/lib/database/rpc", () => ({ promptRpc: mocks.promptRpc }));

import { DELETE } from "@/app/api/chains/[id]/route";

const chainId = "11111111-1111-4111-8111-111111111111";
const params = { params: Promise.resolve({ id: chainId }) };
function request(body: unknown) {
  return new Request(`https://chains.example.test/api/chains/${chainId}`, {
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

it("deletes the selected chain through the guarded history-aware RPC", async () => {
  const response = await DELETE(
    request({ revision: 3, confirmation: "DELETE" }),
    params,
  );
  expect(response.status).toBe(204);
  expect(mocks.promptRpc).toHaveBeenCalledExactlyOnceWith(
    "pct_delete_chain_with_history",
    { p_chain_id: chainId, p_chain_revision: 3 },
  );
});

it("rejects cancellation or missing confirmation without touching the RPC", async () => {
  const response = await DELETE(
    request({ revision: 3, confirmation: "CANCEL" }),
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
    request({ revision: 3, confirmation: "DELETE" }),
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
    request({ revision: 3, confirmation: "DELETE" }),
    params,
  );
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("database details");
});
