import { CONDITIONS, EFFECTS, FIELDS, KINDS, VERDICTS } from "@/lib/data/overlap-schema";

const values = (list: readonly string[]) => list.map(s => "'" + s + "'").join(",");

export const SCHEMA_SQL = `
CREATE TABLE snapshot (
  snapshot_id TEXT PRIMARY KEY, as_of TEXT NOT NULL, source_sha256 TEXT NOT NULL UNIQUE
) STRICT;
CREATE TABLE policy_raw (
  snapshot_id TEXT NOT NULL REFERENCES snapshot, policy_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0), raw_json TEXT NOT NULL CHECK(json_valid(raw_json)),
  PRIMARY KEY(snapshot_id, policy_id), UNIQUE(snapshot_id, ordinal),
  CHECK(length(policy_id)=20 AND policy_id NOT GLOB '*[^0-9]*' AND json_type(raw_json,'$.plcyNo') IS 'text' AND policy_id=json_extract(raw_json,'$.plcyNo'))
) STRICT;
CREATE TABLE verified_policy (
  snapshot_id TEXT NOT NULL, policy_id TEXT NOT NULL, verified_json TEXT NOT NULL CHECK(json_valid(verified_json)),
  PRIMARY KEY(snapshot_id,policy_id), FOREIGN KEY(snapshot_id,policy_id) REFERENCES policy_raw
) STRICT;
CREATE TABLE verification_result (
  snapshot_id TEXT NOT NULL, policy_id TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  PRIMARY KEY(snapshot_id,policy_id), FOREIGN KEY(snapshot_id,policy_id) REFERENCES policy_raw
) STRICT;
CREATE TABLE supporting_data (
  snapshot_id TEXT NOT NULL REFERENCES snapshot, dataset_key TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  PRIMARY KEY(snapshot_id,dataset_key)
) STRICT;
CREATE TABLE evidence (
  evidence_id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, policy_id TEXT NOT NULL, round_id TEXT,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('api','official')), source_field TEXT, source_url TEXT,
  quote_text TEXT NOT NULL CHECK(length(trim(quote_text))>0), checked_at TEXT NOT NULL,
  UNIQUE(evidence_id,snapshot_id,policy_id), FOREIGN KEY(snapshot_id,policy_id) REFERENCES policy_raw,
  CHECK((source_kind='api' AND length(trim(coalesce(source_field,'')))>0) OR
        (source_kind='official' AND length(trim(coalesce(source_url,'')))>0))
) STRICT;
CREATE TABLE policy_overlap_rule (
  rule_id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL,
  source_policy_id TEXT NOT NULL, target_policy_id TEXT NOT NULL, target_round_id TEXT, evidence_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN (${values(KINDS)}) AND kind NOT IN ('allowed','not_restriction')),
  effect_type TEXT CHECK(effect_type IN (${values(EFFECTS)})), condition_type TEXT CHECK(condition_type IN (${values(CONDITIONS)})),
  reference_event TEXT, condition_params_json TEXT NOT NULL CHECK(json_valid(condition_params_json) AND json_type(condition_params_json)='object'),
  exception_json TEXT CHECK(exception_json IS NULL OR json_valid(exception_json) AND json_type(exception_json)='text'),
  judgement TEXT NOT NULL CHECK(judgement IN ('blocked','needs_check')), needs_check_reason TEXT,
  source TEXT NOT NULL CHECK(source IN ('agent','research')), model TEXT, run_id TEXT, restricted_item TEXT, period_text TEXT,
  verify_verdict TEXT CHECK(verify_verdict IN (${values(VERDICTS)})), verify_quote TEXT,
  a_group_ids TEXT NOT NULL CHECK(json_valid(a_group_ids) AND json_type(a_group_ids)='array'),
  research_basis_json TEXT CHECK(research_basis_json IS NULL OR json_valid(research_basis_json) AND json_type(research_basis_json)='object'),
  FOREIGN KEY(snapshot_id,source_policy_id) REFERENCES policy_raw, FOREIGN KEY(snapshot_id,target_policy_id) REFERENCES policy_raw,
  FOREIGN KEY(evidence_id,snapshot_id,target_policy_id) REFERENCES evidence(evidence_id,snapshot_id,policy_id),
  CHECK(source_policy_id<>target_policy_id),
  CHECK(source<>'agent' OR (length(trim(coalesce(model,'')))>0 AND length(trim(coalesce(run_id,'')))>0)),
  CHECK(judgement<>'needs_check' OR length(trim(coalesce(needs_check_reason,'')))>0)
) STRICT;
CREATE TABLE agent_clause (
  clause_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, b_policy_id TEXT NOT NULL,
  field TEXT NOT NULL CHECK(field IN (${values(FIELDS)})), pass INTEGER NOT NULL CHECK(pass IN (1,2)),
  response_hash TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  FOREIGN KEY(snapshot_id,b_policy_id) REFERENCES policy_raw
) STRICT;
CREATE TABLE agent_run (
  run_id TEXT PRIMARY KEY, report_json TEXT NOT NULL CHECK(json_valid(report_json))
) STRICT;
CREATE TABLE source_file (path TEXT PRIMARY KEY, sha256 TEXT NOT NULL) STRICT;
`;
