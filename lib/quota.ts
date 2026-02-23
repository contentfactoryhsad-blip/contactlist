import { countActiveAccess, countPendingRequests } from "@/lib/store";

const quotaLimits: Record<string, number> = {
  Viewer: 3,
  Editor: 2
};

export function getQuotaLimit(access: string) {
  return quotaLimits[access] ?? 0;
}

export async function isQuotaExceeded(branch: string, access: string) {
  const active = await countActiveAccess(branch, access);
  const pending = await countPendingRequests(branch, access);
  const limit = getQuotaLimit(access);
  return {
    active,
    pending,
    total: active + pending,
    limit,
    exceeded: active + pending >= limit
  };
}
