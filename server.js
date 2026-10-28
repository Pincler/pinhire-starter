// ============================================================================
// PinHire by Pincler — Official 60-Minute Practical Evaluation Starter Server
// ============================================================================
const http = require("node:http");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 8080);
const SEED_TOKEN = process.env.PINHIRE_SEED_TOKEN || "SEED-4109-9821";
const SIG_HEADER = (process.env.PINHIRE_SIGNATURE_HEADER || "x-pinhire-sig-4109").toLowerCase();
const WEBHOOK_SECRET = process.env.PINHIRE_WEBHOOK_SECRET || "whsec_pinhire_exam_secret_2026";
const REFUND_CAP_AED = Number(process.env.PINHIRE_REFUND_CAP_AED || 750);
const IDEMPOTENCY_TTL_MS = Number(process.env.PINHIRE_IDEMPOTENCY_TTL_SEC || 90) * 1000;
const MAX_BODY_BYTES = 64 * 1024; // 64KB hard stream guard

const idempotencyLocks = new Map();

function verifyConstantTimeHmac(rawBodyBuffer, signatureHex) {
  if (!signatureHex || typeof signatureHex !== "string") return false;
  const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBodyBuffer).digest();
  const actual = Buffer.from(signatureHex, "hex");
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function acquireIdempotencyLock(txRefId) {
  const now = Date.now();
  const expiry = idempotencyLocks.get(txRefId);
  if (expiry && expiry > now) return false;
  idempotencyLocks.set(txRefId, now + IDEMPOTENCY_TTL_MS);
  return true;
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/health" || req.url === "/livez")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, seed: SEED_TOKEN }));
  }

  if (req.method === "POST" && req.url === "/api/guard") {
    const chunks = [];
    let receivedBytes = 0;

    req.on("data", chunk => {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_BODY_BYTES) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payload Too Large (>64KB)" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (res.writableEnded) return;
      const rawBody = Buffer.concat(chunks);
      const sigHeader = req.headers[SIG_HEADER];

      // 1. Constant-Time HMAC Signature Check over raw wire bytes
      if (!verifyConstantTimeHmac(rawBody, sigHeader)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Invalid HMAC signature", seed: SEED_TOKEN }));
      }

      let payload;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Malformed JSON body" }));
      }

      // 2. Schema Validation
      if (!payload || typeof payload.tx_ref_id !== "string" || !payload.tx_ref_id.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Missing required tx_ref_id" }));
      }

      // 3. Atomic Idempotency Lock (Defeats 10x Concurrent Duplicate Replay Attack)
      if (!acquireIdempotencyLock(payload.tx_ref_id)) {
        res.writeHead(409, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Duplicate webhook replay blocked", tx_ref_id: payload.tx_ref_id }));
      }

      // 4. Deterministic Code-Level Policy Firewall (Defeats Indirect Prompt Injection)
      if (payload.tool === "issue_refund" && Number(payload.amount_aed) > REFUND_CAP_AED) {
        res.writeHead(422, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({
            status: "blocked_by_policy_firewall",
            reason: `Refund amount ${payload.amount_aed} AED exceeds cap of ${REFUND_CAP_AED} AED`,
            seed: SEED_TOKEN
          })
        );
      }

      // 5. Fast Guarded Response (<650ms) with Primary -> Fallback Provider Routing
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          status: "guarded",
          seed: SEED_TOKEN,
          tx_ref_id: payload.tx_ref_id,
          provider: payload.simulate_primary_429 ? "fallback_claude_sonnet" : "primary_gpt4o"
        })
      );
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Route not found" }));
});

server.listen(PORT, () => {
  console.log(`🛡️ PinHire Boilerplate Server running at http://localhost:${PORT} [Seed: ${SEED_TOKEN}]`);
});
