import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { test } from 'node:test';
import { deploy, remoteCommand, waitForCommand } from './ssm-deploy.mjs';

const sha = 'a'.repeat(40);
const instance = 'i-0123456789abcdef0';
const id = '00000000-0000-0000-0000-000000000068';

const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const cd = readFileSync('.github/workflows/cd.yml', 'utf8');
const [ciHeader, quality] = ci.split(/^  quality:\r?$/m);
const [cdHeader, reusable, publish, deployJob] = cd.split(
  /^  (?:quality|publish|deploy):\r?$/m,
);
const mainOnly =
  /if: github.ref == 'refs\/heads\/main' && \(github.event_name == 'push' \|\| github.event_name == 'workflow_dispatch'\)/;

test('CI runs only PR checks or reusable quality with read-only permissions', () => {
  assert.match(ciHeader, /^name: CI\r?$/m);
  assert.match(
    ciHeader,
    /on:\s+pull_request:\s+branches: \[main\]\s+workflow_call:\s+permissions:/,
  );
  assert.match(ciHeader, /permissions:\s+contents: read/);
  // This is the required status context in the main branch ruleset.
  assert.match(quality, /name: Quality checks/);
  assert.deepEqual(
    [...quality.matchAll(/run: (pnpm .+)/g)].map((match) => match[1].trim()),
    [
      'pnpm install --frozen-lockfile',
      'pnpm lint',
      'pnpm test',
      'pnpm build',
      'pnpm test:infra',
      'pnpm format:check',
    ],
  );
  assert.deepEqual(
    [...ci.matchAll(/^  (\w+):\r?$/gm)].map((m) => m[1]),
    ['pull_request', 'workflow_call', 'quality'],
  );
  assert.doesNotMatch(
    ci,
    /packages:|id-token:|environment:|ghcr\.io|secrets\.|ssm-deploy|smoke\.mjs|docker\/|aws-actions\//,
  );
});

test('CD calls CI on main and gates publishing and deployment on success', () => {
  assert.match(cdHeader, /^name: CD\r?$/m);
  assert.match(
    cdHeader,
    /on:\s+push:\s+branches: \[main\]\s+workflow_dispatch:\s+permissions:/,
  );
  assert.match(cdHeader, /permissions:\s+contents: read/);
  assert.deepEqual(
    [...cd.matchAll(/^  (\w+):\r?$/gm)].map((m) => m[1]),
    ['push', 'workflow_dispatch', 'quality', 'publish', 'deploy'],
  );
  assert.match(reusable, /uses: \.\/\.github\/workflows\/ci\.yml/);
  assert.doesNotMatch(
    reusable,
    /runs-on:|steps:|secrets:|permissions:|environment:/,
  );
  assert.match(publish, /needs: quality/);
  assert.match(deployJob, /needs: \[quality, publish\]/);
  for (const job of [reusable, publish, deployJob]) assert.match(job, mainOnly);
  // The implicit success() condition must remain in effect for dependent jobs.
  assert.doesNotMatch(cd, /continue-on-error|always\(|!cancelled\(|failure\(/);
  assert.equal([...cd.matchAll(/environment:/g)].length, 1);
  assert.match(deployJob, /environment: production/);
  assert.match(publish, /permissions:\s+contents: read\s+packages: write/);
  assert.match(deployJob, /permissions:\s+contents: read\s+id-token: write/);
  assert.doesNotMatch(
    cdHeader + reusable + publish,
    /id-token:|configure-aws-credentials/,
  );
  assert.doesNotMatch(cdHeader + reusable + deployJob, /packages:/);
});

test('caller and reusable concurrency never collide or interrupt production', () => {
  assert.match(ciHeader, /group: ci-quality-\$\{\{ github.ref \}\}/);
  assert.match(
    ciHeader,
    /cancel-in-progress: \$\{\{ github.event_name == 'pull_request' \}\}/,
  );
  assert.match(
    cdHeader,
    /group: cd-\$\{\{ github.ref \}\}\s+#.*\s+cancel-in-progress: false/,
  );
  assert.match(
    deployJob,
    /group: kanvexa-production\s+cancel-in-progress: false/,
  );
  const ciGroups = [...ci.matchAll(/group: (.+)/g)].map((m) => m[1].trim());
  const cdGroups = [...cd.matchAll(/group: (.+)/g)].map((m) => m[1].trim());
  for (const group of cdGroups) assert(!ciGroups.includes(group));
  assert.doesNotMatch(ci + cd, /group:.*github.workflow/);
  assert.equal([...ci.matchAll(/concurrency:/g)].length, 1);
  assert.equal([...cd.matchAll(/concurrency:/g)].length, 2);
});

test('production delivery retains SHA images, pinned actions and OIDC without new secrets', () => {
  for (const job of [publish, deployJob]) {
    assert.match(job, /ref: \$\{\{ github.sha \}\}/);
  }
  assert.match(publish, /platforms: linux\/amd64/);
  assert.match(publish, /VITE_API_BASE_URL=\/api/);
  assert.match(
    publish,
    /kanvexa-\$\{\{ matrix.service \}\}:\$\{\{ github.sha \}\}/,
  );
  assert.match(publish, /org.opencontainers.image.source=/);
  assert.match(publish, /secrets.GITHUB_TOKEN/);
  for (const variable of ['AWS_ROLE_ARN', 'AWS_REGION', 'EC2_INSTANCE_ID'])
    assert(deployJob.includes(`vars.${variable}`));
  assert.match(deployJob, /configure-aws-credentials@[a-f0-9]{40}/);
  assert.match(deployJob, /run: node scripts\/deployment\/ssm-deploy.mjs/);
  assert.match(deployJob, /RELEASE_SHA: \$\{\{ github.sha \}\}/);
  assert.match(deployJob, /smoke.mjs https:\/\/kanvexa.tech/);
  assert.doesNotMatch(
    ci + cd,
    /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|upload-artifact|inputs:/,
  );
  assert.deepEqual(
    [...(ci + cd).matchAll(/secrets\.(\w+)/g)].map((m) => m[1]),
    ['GITHUB_TOKEN'],
  );
  for (const action of (ci + cd).matchAll(/uses: (\S+)/g)) {
    if (action[1] === './.github/workflows/ci.yml') continue;
    assert.match(
      action[1],
      /@[a-f0-9]{40}$/,
      'Actions must use reviewed commit pins',
    );
  }
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
