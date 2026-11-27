// The same positional bindings work for node-postgres and the local PostgreSQL test engine.
export function createQueue(queryScalar) {
  return {
    claim: lease => queryScalar('select r24_repo_scoring.claim($1::uuid) as value', [lease]),
    startAttempt: (id, lease) =>
      queryScalar('select r24_repo_scoring.start_attempt($1, $2::uuid) as value', [id, lease]),
    saveResult: (id, lease, result, receipt) =>
      queryScalar('select r24_repo_scoring.save_result($1, $2::uuid, $3::jsonb, $4::jsonb) as value',
        [id, lease, JSON.stringify(result), JSON.stringify(receipt)]),
    ack: (id, lease) => queryScalar('select r24_repo_scoring.ack($1, $2::uuid) as value', [id, lease]),
    hold: (id, lease, reason) =>
      queryScalar('select r24_repo_scoring.hold($1, $2::uuid, $3) as value', [id, lease, reason]),
  };
}
