import "server-only";

import { requireMutationSuperadmin, requireSuperadmin } from "./guards";

export async function authenticatedApi() {
  return requireSuperadmin();
}

export async function mutationApi(request: Request) {
  return requireMutationSuperadmin(request);
}
