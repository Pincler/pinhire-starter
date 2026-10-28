# PinHire by Pincler — Starter Kit for the 60-Minute Test

This is the **PinHire by Pincler** starter kit for the 60-minute test ([www.pincler.com/pinhire](https://www.pincler.com/pinhire)).

## Quick Start (Zero Dependencies · Node.js v22+)

```bash
cp .env.example .env
node server.js
```

## Included Production Modules
1. **`server.js`**: Complete 60-minute proctored exam webhook microservice (`/api/guard` & `/health`) implementing:
   - Constant-time HMAC-SHA256 verification (`crypto.timingSafeEqual`) over raw request `Buffer`
   - 64KB stream body limit against JSON bomb DoS
   - Atomic Idempotency Lock (`tx_ref_id` with configurable TTL)
   - Deterministic Code-Level Policy Firewall (`amount_aed <= PINHIRE_REFUND_CAP_AED`)
   - Automatic Primary-to-Fallback LLM Provider Failover (`<650ms` SLA)
2. **`tokenBudgetLua.js`**: Atomic Redis Lua script (`EVAL`) for pre-reserving token budgets + post-call reconciliation + Full-Jitter exponential backoff circuit breaker.
3. **`hybridRrfSearch.sql`**: PostgreSQL `pgvector` HNSW (`hnsw.iterative_scan = relaxed_order`) + Lexical `tsvector` (`websearch_to_tsquery`) merged via Reciprocal Rank Fusion (`RRF`, $k = 60$) with strict `tenant_id` pre-filtering.
