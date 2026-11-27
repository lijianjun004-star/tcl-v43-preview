import assert from 'node:assert/strict';
import test from 'node:test';
import {acceptsQueueSignal} from './run.mjs';

test('a private default-branch sweep accepts only wake reasons; no payload or replay', () => {
  const env = {GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',R24_REPO_SCORING_ENABLED:'true',
    GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'sample/private'};
  const repository = {private:true,full_name:'sample/private',default_branch:'main'};
  const event = {repository,inputs:{signal:'submission_saved'}};
  assert.equal(acceptsQueueSignal(event,env),true);
  assert.equal(acceptsQueueSignal({repository,inputs:{signal:'sweep'}},env),true);
  assert.equal(acceptsQueueSignal({repository},env),true);
  for (const inputs of [{signal:'other'}, {signal:'submission_saved',answer:'synthetic content'}]) {
    assert.equal(acceptsQueueSignal({...event,inputs},env),false);
  }
  for (const replacement of [{...repository,private:false},{...repository,full_name:'other/target'}]) {
    assert.equal(acceptsQueueSignal({...event,repository:replacement},env),false);
  }
  for (const changes of [{GITHUB_REF:'refs/heads/other'},{GITHUB_RUN_ATTEMPT:'2'},{R24_REPO_SCORING_ENABLED:'false'}]) {
    assert.equal(acceptsQueueSignal(event,{...env,...changes}),false);
  }
  assert.equal(acceptsQueueSignal({}, {...env,GITHUB_EVENT_NAME:'schedule'}),true);
});
