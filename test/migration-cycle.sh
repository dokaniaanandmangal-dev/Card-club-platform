#!/usr/bin/env bash
set -euo pipefail

CID="${1:?usage: migration-cycle.sh <postgres-container-id>}"

psql_file() {
  docker exec -i "$CID" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$1"
}

psql_q() {
  docker exec -i "$CID" psql -v ON_ERROR_STOP=1 -At -U postgres -d postgres -c "$1"
}

psql_file db/migrations/010_club_settings_base.sql
psql_q "INSERT INTO club_settings (tenant_id, display_name) VALUES ('club-old-1', 'Old Client One');" >/dev/null

# Expand: the new column is nullable, so old writers remain compatible.
psql_file db/migrations/011_expand_settlement_mode.sql
psql_q "INSERT INTO club_settings (tenant_id, display_name) VALUES ('club-old-2', 'Old Client Two');" >/dev/null
psql_q "INSERT INTO club_settings (tenant_id, display_name, settlement_mode) VALUES ('club-new-1', 'New Client', 'auto');" >/dev/null

nulls="$(psql_q "SELECT count(*) FROM club_settings WHERE settlement_mode IS NULL;")"
test "$nulls" = "2"

# Backfill and establish a default before contraction.
psql_file db/migrations/012_backfill_settlement_mode.sql
nulls="$(psql_q "SELECT count(*) FROM club_settings WHERE settlement_mode IS NULL;")"
test "$nulls" = "0"

# Contract only after backfill. Old writers still work because the default exists.
psql_file db/migrations/013_contract_settlement_mode.sql
nullable="$(psql_q "SELECT is_nullable FROM information_schema.columns WHERE table_name='club_settings' AND column_name='settlement_mode';")"
test "$nullable" = "NO"
psql_q "INSERT INTO club_settings (tenant_id, display_name) VALUES ('club-old-3', 'Old Client Three');" >/dev/null
mode="$(psql_q "SELECT settlement_mode FROM club_settings WHERE tenant_id='club-old-3';")"
test "$mode" = "manual"

# Invalid new data fails after the validated constraint.
if psql_q "INSERT INTO club_settings (tenant_id, display_name, settlement_mode) VALUES ('club-bad', 'Bad Client', 'unsafe');" >/dev/null 2>&1; then
  echo 'invalid settlement mode was accepted' >&2
  exit 1
fi

# Test the pre-launch full down migration and restore the base schema.
psql_file db/migrations/down/013_to_010_settlement_mode.sql
exists="$(psql_q "SELECT count(*) FROM information_schema.columns WHERE table_name='club_settings' AND column_name='settlement_mode';")"
test "$exists" = "0"
psql_q "INSERT INTO club_settings (tenant_id, display_name) VALUES ('club-after-rollback', 'Rollback Client');" >/dev/null
rows="$(psql_q "SELECT count(*) FROM club_settings;")"
test "$rows" = "5"

echo 'migration evidence: expand=PASS old-writer-compat=PASS backfill=PASS contract=PASS constraint=PASS rollback=PASS'
