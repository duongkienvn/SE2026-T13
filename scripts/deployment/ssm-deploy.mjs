import { spawnSync } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export function remoteCommand(sha) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid full release SHA');
  // Only a validated SHA is interpolated. No dispatch inputs or shell fragments.
  return `env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/root /bin/bash -s <<'KANVEXA'
set -euo pipefail
umask 077
exec 9>/run/lock/kanvexa-deploy.lock
flock -n 9 || { echo 'Deployment already locked; inspect active SSM command'; exit 1; }
install -d -m 0700 /var/log/kanvexa
log=$(mktemp /var/log/kanvexa/deploy-${sha}.XXXXXX.log)
echo "Release ${sha}; protected diagnostics: $log"
trap 'echo "Deployment failed; inspect protected diagnostics and container/migration state before retry"' ERR
(
  cd /opt/kanvexa
  git() { command git -c safe.directory=/opt/kanvexa "$@"; }
  test "$(git remote get-url origin)" = https://github.com/duongkienvn/SE2026-T13.git
  test -z "$(git status --porcelain --untracked-files=all)"
  git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
  git cat-file -e '${sha}^{commit}'
  git merge-base --is-ancestor '${sha}' refs/remotes/origin/main
  git checkout --detach '${sha}'
  test "$(git rev-parse HEAD)" = '${sha}'
  python3 -I scripts/deployment/deploy.py '${sha}'
) >>"$log" 2>&1
echo 'Deployment and Compose health succeeded; runner HTTPS smoke follows'
KANVEXA`;
}

function aws(args) {
  const result = spawnSync(
    'aws',
    [...args, '--output', 'json', '--no-cli-pager'],
    {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      // SendCommand has no idempotency key. Never automatically resubmit it.
      env: {
        ...process.env,
        AWS_MAX_ATTEMPTS: args[1] === 'send-command' ? '1' : '3',
      },
    },
  );
  if (result.error || result.status !== 0) {
    // Never echo CLI output: invocation output could contain operational data.
    const error = new Error('AWS CLI request failed');
    error.notVisible = result.stderr?.includes('InvocationDoesNotExist');
    throw error;
  }
  return JSON.parse(result.stdout);
}

export async function waitForCommand(
  id,
  instance,
  { request = aws, sleep = delay, now = Date.now, timeoutMs = 1_980_000 } = {},
) {
  const deadline = now() + timeoutMs;
  let errors = 0;
  let last;
  while (now() < deadline) {
    let invocation;
    try {
      invocation = request([
        'ssm',
        'get-command-invocation',
        '--command-id',
        id,
        '--instance-id',
        instance,
        '--query',
        '{Status:Status,ResponseCode:ResponseCode}',
      ]);
      errors = 0;
    } catch (error) {
      // Run Command is eventually consistent immediately after send-command.
      if (!error.notVisible && ++errors >= 5)
        throw new Error(
          `Cannot observe SSM ${id}; remote state unknown. Inspect SSM before retry; do not cancel migrations.`,
        );
      await sleep(5_000);
      continue;
    }
    if (invocation.Status !== last) {
      last = invocation.Status;
      console.log(`SSM ${id}: ${last}`);
    }
    if (last === 'Success' && invocation.ResponseCode === 0) return;
    if (!['Pending', 'InProgress', 'Delayed'].includes(last))
      throw new Error(
        `SSM ${id} ended ${last} (code ${invocation.ResponseCode}). Inspect protected EC2 diagnostics; no automatic rollback.`,
      );
    await sleep(5_000);
  }
  throw new Error(
    `SSM ${id} observation deadline exceeded; remote state unknown. Inspect SSM before retry; no cancellation sent.`,
  );
}

export async function deploy(
  sha,
  instance,
  request = aws,
  wait = waitForCommand,
) {
  const command = remoteCommand(sha);
  if (!/^i-(?:[a-f0-9]{8}|[a-f0-9]{17})$/.test(instance))
    throw new Error('Invalid EC2_INSTANCE_ID');
  let result;
  try {
    result = request([
      'ssm',
      'send-command',
      '--cli-input-json',
      JSON.stringify({
        DocumentName: 'AWS-RunShellScript',
        InstanceIds: [instance],
        TimeoutSeconds: 60,
        Parameters: { commands: [command], executionTimeout: ['1800'] },
        CloudWatchOutputConfig: { CloudWatchOutputEnabled: false },
        Comment: `Kanvexa ${sha}`,
      }),
      '--query',
      'Command.CommandId',
    ]);
  } catch {
    throw new Error(
      `SSM submission for ${sha} failed; remote state unknown. Inspect recent SSM commands before retry; no automatic resubmission.`,
    );
  }
  if (typeof result !== 'string' || !/^[a-f0-9-]{36}$/.test(result))
    throw new Error(
      'SSM did not return a valid command ID; inspect SSM before retry',
    );
  console.log(`SSM command: ${result}; instance: ${instance}; release: ${sha}`);
  await wait(result, instance, { request });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await deploy(process.env.RELEASE_SHA, process.env.EC2_INSTANCE_ID);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
