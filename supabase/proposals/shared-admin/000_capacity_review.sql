-- SELECT-only review. Target: maqhbfhrzluqznzrpisb. No settings or data changes.
SELECT pg_catalog.pg_database_size(pg_catalog.current_database()) AS database_bytes,
  500000000 - pg_catalog.pg_database_size(pg_catalog.current_database()) AS free_plan_remaining_bytes;
SELECT n.nspname AS schema_name, c.relname AS table_name,
  pg_catalog.pg_total_relation_size(c.oid) AS bytes
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind='r' AND n.nspname IN ('public','prompt_tool')
ORDER BY pg_catalog.pg_total_relation_size(c.oid) DESC;
