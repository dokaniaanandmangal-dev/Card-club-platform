# Database Migration Policy

Production schema changes use an **expand → backfill → contract** sequence.

1. **Expand** adds backward-compatible schema only. Existing application versions must continue to read and write successfully.
2. **Backfill** is idempotent and completes before stricter constraints are enabled.
3. **Contract** is permitted only after compatibility evidence and backfill completion.
4. **Rollback** normally means rolling application code back while retaining the expanded schema. Destructive down migrations are not the first-line production recovery mechanism.
5. A full schema down migration may be used only before launch, on isolated/test environments, or after explicit recovery analysis confirms that no required live data will be destroyed.

The certification test intentionally exercises a full down migration because real-money operation is disabled and the test database is disposable. This proves reversibility of the schema package without establishing destructive rollback as normal production practice.
