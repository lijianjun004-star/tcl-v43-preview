import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createQueue} from './queue.mjs';
import {createRepositoryArchive} from './archive.mjs';
import {createOpenAIScorer, processOne} from './worker.mjs';

async function main(env) {
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  if (!['schedule', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME) || env.GITHUB_RUN_ATTEMPT !== '1' ||
      (env.GITHUB_EVENT_NAME === 'workflow_dispatch' && (event.repository?.private !== true ||
       event.repository.full_name !== env.GITHUB_REPOSITORY || env.GITHUB_REF !== 'refs/heads/' + event.repository.default_branch)) ||
      env.R24_REPO_SCORING_ENABLED !== 'true')
    throw new Error('JOB_DISABLED');

  const archive = createRepositoryArchive({repo: env.GITHUB_REPOSITORY, token: env.GITHUB_TOKEN});
  await archive.verifyDestination();
  const uri = new URL(env.R24_SCORE_DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(uri.protocol) || !uri.username || !uri.password ||
      !uri.hostname || !/^\/[A-Za-z0-9_.-]+$/.test(uri.pathname) || uri.search || uri.hash)
    throw new Error('INVALID_DB_CONFIGURATION');
  const client = new pg.Client({
    host: uri.hostname, port: uri.port ? Number(uri.port) : 5432, database: uri.pathname.slice(1),
    user: decodeURIComponent(uri.username), password: decodeURIComponent(uri.password),
    ssl: {rejectUnauthorized: true, ...(env.R24_SCORE_DB_CA_PEM ? {ca: env.R24_SCORE_DB_CA_PEM} : {})},
    connectionTimeoutMillis: 10000, statement_timeout: 15000, application_name: 'r24-repository-scoring',
  });
  await client.connect();
  try {
    const check = await client.query(`select pg_has_role(current_user, 'r24_scoring_worker', 'USAGE') as worker,
      has_table_privilege(current_user, 'public.tcl_r24_sync_v1_submissions', 'SELECT,INSERT,UPDATE,DELETE') as broad`);
    if (!check.rows[0].worker || check.rows[0].broad) throw new Error('INVALID_DB_ROLE');
    const queue = createQueue(async (sql, args) => (await client.query(sql, args)).rows[0].value);
    const score = env.OPENAI_API_KEY?.trim() ? createOpenAIScorer(env.OPENAI_API_KEY) : null;
    let needsAttention = false;
    for (let processed = 0; processed < 3; processed++) {
      const {status} = await processOne({queue, archive, score, lease: randomUUID()});
      if (status === 'empty') break;
      if (status !== 'archived') { needsAttention = true; continue; }
      console.log('One score receipt was archived.');
    }
    if (needsAttention) throw new Error('JOB_NEEDS_ATTENTION');
  } finally {
    await client.end();
  }
}

// Provider and database messages can contain identifying information.
main(process.env).catch(() => { console.error('Private scoring worker stopped. Check the scoped queue and destination configuration.'); process.exitCode = 1; });
