import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { test } from 'node:test';
import { deploy, remoteCommand, waitForCommand } from './ssm-deploy.mjs';

const sha = 'a'.repeat(40);
const instance = 'i-0123456789abcdef0';
const id = '00000000-0000-0000-0000-000000000068';

test('production workflow keeps publishing and OIDC behind explicit gates', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  const [quality, publish, cd] = workflow.split(/^  (?:publish|deploy):\r?$/m);
  assert.match(quality, /pull_request:\s+branches: \[main\]/);
  assert.match(quality, /pnpm test:infra/);
  assert.match(
    quality,
    /cancel-in-progress: \$\{\{ github.event_name == 'pull_request' \}\}/,
  );
  for (const job of [publish, cd]) {
    assert.match(
      job,
      /if: github.ref == 'refs\/heads\/main' && \(github.event_name == 'push' \|\| github.event_name == 'workflow_dispatch'\)/,
    );
    assert.match(job, /ref: \$\{\{ github.sha \}\}/);
  }
  assert.match(publish, /needs: quality/);
  assert.match(publish, /packages: write/);
  assert.match(publish, /platforms: linux\/amd64/);
  assert.match(publish, /VITE_API_BASE_URL=\/api/);
  assert.match(
    publish,
    /kanvexa-\$\{\{ matrix.service \}\}:\$\{\{ github.sha \}\}/,
  );
  assert.match(publish, /org.opencontainers.image.source=/);
  assert.match(publish, /secrets.GITHUB_TOKEN/);
  assert.doesNotMatch(
    quality + publish,
    /id-token: write|configure-aws-credentials/,
  );
  assert.match(cd, /needs: \[quality, publish\]/);
  assert.match(cd, /environment: production/);
  assert.match(cd, /group: kanvexa-production\s+cancel-in-progress: false/);
  assert.match(cd, /id-token: write/);
  for (const variable of ['AWS_ROLE_ARN', 'AWS_REGION', 'EC2_INSTANCE_ID'])
    assert(cd.includes(`vars.${variable}`));
  assert.match(cd, /smoke.mjs https:\/\/kanvexa.tech/);
  assert.doesNotMatch(
    workflow,
    /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|upload-artifact|inputs:/,
  );
  for (const action of workflow.matchAll(/uses: (\S+)/g))
    assert.match(
      action[1],
      /@[a-f0-9]{40}$/,
      'Actions must use reviewed commit pins',
    );
  assert.doesNotMatch(cd, /continue-on-error|if: always/);
});

test('SSM bootstrap validates main ancestry and cleanliness before checkout', () => {
  const script = remoteCommand(sha);
  assert(script.indexOf('status --porcelain') < script.indexOf('git checkout'));
  assert(
    script.indexOf('merge-base --is-ancestor') < script.indexOf('git checkout'),
  );
  assert.match(script, /flock -n 9/);
  assert.match(script, /umask 077/);
  assert.match(script, /python3 -I scripts\/deployment\/deploy.py/);
  assert.throws(() => remoteCommand('main; touch /tmp/injected'));
});

test('SSM bootstrap passes actual Bash syntax validation', (t) => {
  const bash =
    process.platform === 'win32'
      ? 'C:/Program Files/Git/bin/bash.exe'
      : '/bin/bash';
  if (!existsSync(bash))
    return t.skip('Bash is unavailable on this workstation');
  execFileSync(bash, ['-n'], {
    input: remoteCommand(sha),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
});

test('SSM request targets only one instance with bounded delivery and execution', async () => {
  let body;
  let waited = false;
  await deploy(
    sha,
    instance,
    (args) => {
      body = JSON.parse(args[args.indexOf('--cli-input-json') + 1]);
      return id;
    },
    async (commandId, target) => {
      assert.equal(commandId, id);
      assert.equal(target, instance);
      waited = true;
    },
  );
  assert(waited);
  assert.deepEqual(body.InstanceIds, [instance]);
  assert.equal(body.DocumentName, 'AWS-RunShellScript');
  assert.equal(body.TimeoutSeconds, 60);
  assert.deepEqual(body.Parameters.executionTimeout, ['1800']);
  assert.equal(body.OutputS3BucketName, undefined);
  assert.equal(body.CloudWatchOutputConfig.CloudWatchOutputEnabled, false);
  await assert.rejects(deploy(sha, 'i-123; id'));
});

test('uncertain SSM submission is never blindly retried', async () => {
  let attempts = 0;
  await assert.rejects(
    deploy(sha, instance, () => {
      attempts++;
      throw new Error('connection lost after submission');
    }),
    /remote state unknown/,
  );
  assert.equal(attempts, 1);
});

function observer(sequence, timeoutMs = 20_000) {
  let time = 0;
  const requests = [];
  return {
    requests,
    options: {
      timeoutMs,
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      request: (args) => {
        requests.push(args);
        const next = sequence.shift() ?? {
          Status: 'InProgress',
          ResponseCode: -1,
        };
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

test('observer tolerates eventual consistency and actually waits for success', async () => {
  const missing = new Error('not visible yet');
  missing.notVisible = true;
  const { requests, options } = observer([
    missing,
    { Status: 'Pending', ResponseCode: -1 },
    { Status: 'InProgress', ResponseCode: -1 },
    { Status: 'Success', ResponseCode: 0 },
  ]);
  await waitForCommand(id, instance, options);
  assert.equal(requests.length, 4);
  for (const args of requests)
    assert.equal(
      args[args.indexOf('--query') + 1],
      '{Status:Status,ResponseCode:ResponseCode}',
    );
});

test('all SSM failures, nonzero success and observation timeout fail closed', async () => {
  for (const Status of [
    'Failed',
    'TimedOut',
    'Cancelled',
    'Cancelling',
    'Success',
  ]) {
    await assert.rejects(
      waitForCommand(
        id,
        instance,
        observer([{ Status, ResponseCode: 1 }]).options,
      ),
      /no automatic rollback/,
    );
  }
  await assert.rejects(
    waitForCommand(id, instance, observer([]).options),
    /state unknown/,
  );
  await assert.rejects(
    waitForCommand(
      id,
      instance,
      observer(
        Array.from({ length: 5 }, () => new Error('AWS unavailable')),
        30_000,
      ).options,
    ),
    /Cannot observe/,
  );
});

test('isolated Python env and deployment failure tests', () => {
  execFileSync(
    process.platform === 'win32' ? 'python' : 'python3',
    ['-B', 'scripts/deployment/deploy_test.py'],
    { stdio: 'pipe' },
  );
});
