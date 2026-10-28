-- ============================================================================
-- PinHire by Pincler — Boilerplate #3: Hybrid BM25 + pgvector HNSW RRF Search
-- Enforces Tenant Isolation, ACL Overlap, HNSW Iterative Scan, and RRF (k=60)
-- ============================================================================

-- Ensure pgvector 0.8.0+ iterative scan is enabled for filtered queries
SET LOCAL hnsw.iterative_scan = relaxed_order;
SET LOCAL hnsw.ef_search = 100;

WITH dense_candidates AS (
  SELECT
    chunk_id,
    doc_id,
    content,
    metadata,
    ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS dense_rank
  FROM knowledge_chunks
  WHERE tenant_id = $2
    AND allowed_groups && $3::text[]
    AND status = 'active'
  ORDER BY embedding <=> $1::vector
  LIMIT 40
),
sparse_candidates AS (
  SELECT
    chunk_id,
    doc_id,
    content,
    metadata,
    ROW_NUMBER() OVER (
      ORDER BY ts_rank_cd(fts_vector, websearch_to_tsquery('english', $4)) DESC
    ) AS sparse_rank
  FROM knowledge_chunks
  WHERE tenant_id = $2
    AND allowed_groups && $3::text[]
    AND status = 'active'
    AND fts_vector @@ websearch_to_tsquery('english', $4)
  ORDER BY ts_rank_cd(fts_vector, websearch_to_tsquery('english', $4)) DESC
  LIMIT 40
)
SELECT
  COALESCE(d.chunk_id, s.chunk_id) AS chunk_id,
  COALESCE(d.doc_id, s.doc_id) AS doc_id,
  COALESCE(d.content, s.content) AS content,
  COALESCE(d.metadata, s.metadata) AS metadata,
  d.dense_rank,
  s.sparse_rank,
  (
    COALESCE(1.0 / (60 + d.dense_rank), 0.0) +
    COALESCE(1.0 / (60 + s.sparse_rank), 0.0)
  ) AS rrf_score
FROM dense_candidates d
FULL OUTER JOIN sparse_candidates s USING (chunk_id)
ORDER BY rrf_score DESC
LIMIT 15;
