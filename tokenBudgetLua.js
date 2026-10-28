// ============================================================================
// PinHire by Pincler — Boilerplate #2: Atomic Redis Lua Pre-Reserve & Reconcile
// Prevents concurrent async race conditions on per-tenant daily LLM token caps
// ============================================================================

const RESERVE_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local requested = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

if (current + requested) > limit then
  return -1
end

local updated = redis.call('INCRBY', KEYS[1], requested)
if updated == requested then
  redis.call('EXPIRE', KEYS[1], ttl)
end
return updated
`;

const RECONCILE_SCRIPT = `
local delta = tonumber(ARGV[1])
local updated = redis.call('DECRBY', KEYS[1], delta)
if updated < 0 then
  redis.call('SET', KEYS[1], 0)
  return 0
end
return updated
`;

async function runWithAtomicTokenBudget(redis, {
  tenantId,
  promptTokens,
  maxOutputTokens,
  dailyLimit = 100000,
  ttlSeconds = 86400,
  executeLlmCall
}) {
  const key = `quota:${tenantId}:${new Date().toISOString().slice(0, 10)}`;
  const worstCaseTokens = promptTokens + maxOutputTokens;

  // 1. Atomically reserve worst-case tokens BEFORE calling the LLM API
  const reservedTotal = await redis.eval(
    RESERVE_SCRIPT,
    1,
    key,
    String(worstCaseTokens),
    String(dailyLimit),
    String(ttlSeconds)
  );

  if (Number(reservedTotal) === -1) {
    const err = new Error(`Tenant ${tenantId} exceeded daily token budget (${dailyLimit})`);
    err.statusCode = 429;
    throw err;
  }

  try {
    // 2. Execute the LLM call safely knowing budget is locked
    const response = await executeLlmCall();
    const actualTokens = response?.usage?.total_tokens ?? worstCaseTokens;
    const unusedTokens = Math.max(0, worstCaseTokens - actualTokens);

    // 3. Refund unused tokens back to the tenant's daily quota
    if (unusedTokens > 0) {
      await redis.eval(RECONCILE_SCRIPT, 1, key, String(unusedTokens));
    }
    return response;
  } catch (error) {
    // 4. Full refund if upstream LLM failed before generating billable tokens
    await redis.eval(RECONCILE_SCRIPT, 1, key, String(worstCaseTokens));
    throw error;
  }
}

module.exports = {
  RESERVE_SCRIPT,
  RECONCILE_SCRIPT,
  runWithAtomicTokenBudget
};
