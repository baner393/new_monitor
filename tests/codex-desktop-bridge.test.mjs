import assert from 'node:assert/strict';
import test from 'node:test';

import {
  submitCodexDesktopClipboard,
  waitForCodexDesktopUserMessage,
  windowsPowerShellPath,
} from '../src/main/codex-desktop-bridge.js';

test('desktop submit bridge targets Windows PowerShell without machine-specific paths', () => {
  assert.equal(
    windowsPowerShellPath({ SystemRoot: 'D:\\Windows' }),
    'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  );
});

test('desktop submit bridge verifies a confirmed Codex submission result', async () => {
  let invocation;
  const result = await submitCodexDesktopClipboard({
    text: '客户端消息',
    env: { SystemRoot: 'C:\\Windows' },
    execFileImpl: (file, args, options, callback) => {
      invocation = { file, args, options };
      callback(null, '{"submitted":true,"inputConfirmed":true,"processId":18032,"submitMethod":"uia-invoke"}\r\n', '');
    },
  });
  assert.equal(result.submitted, true);
  assert.equal(result.inputConfirmed, true);
  assert.equal(result.processId, 18032);
  assert.equal(result.submitMethod, 'uia-invoke');
  assert.match(invocation.file, /powershell\.exe$/i);
  assert.equal(invocation.options.windowsHide, true);
  assert.equal(
    Buffer.from(invocation.options.env.MONITOR_CODEX_MESSAGE_B64, 'base64').toString('utf8'),
    '客户端消息',
  );
  assert.match(invocation.args.at(-1), /Get-Process -Name 'ChatGPT','Codex'/);
  assert.match(invocation.args.at(-1), /Where-Object \{ \$_\.Id -eq \$foregroundPid \}/);
  assert.match(invocation.args.at(-1), /AddSeconds\(12\)/);
  assert.match(invocation.args.at(-1), /AppActivate/);
  assert.match(invocation.args.at(-1), /ValuePattern/);
  assert.match(invocation.args.at(-1), /ControlType\]::Edit/);
  assert.match(invocation.args.at(-1), /\$composer\.SetFocus\(\)/);
  assert.match(invocation.args.at(-1), /SetValue\(\$expectedText\)/);
  assert.match(invocation.args.at(-1), /lost foreground before submit/);
  assert.doesNotMatch(invocation.args.at(-1), /lost keyboard focus before submit/);
  assert.match(invocation.args.at(-1), /FromBase64String/);
  assert.match(invocation.args.at(-1), /InvokePattern/);
  assert.match(invocation.args.at(-1), /发送\|提交\|Send\|Send message\|Submit/);
  assert.match(invocation.args.at(-1), /size-token-button-composer/);
  assert.match(invocation.args.at(-1), /bg-token-foreground/);
  assert.match(invocation.args.at(-1), /SendWait\('\{ENTER\}'\)/);
  assert.match(invocation.args.at(-1), /SendWait\('\^\{ENTER\}'\)/);
  assert.equal(invocation.options.timeout, 30000);
});

test('desktop submit bridge rejects an unconfirmed or failed automation result', async () => {
  await assert.rejects(
    submitCodexDesktopClipboard({
      text: 'focus test',
      execFileImpl: (_file, _args, _options, callback) => callback(null, '{"submitted":false}', ''),
    }),
    /not confirmed/,
  );
  await assert.rejects(
    submitCodexDesktopClipboard({
      text: 'focus test',
      execFileImpl: (_file, _args, _options, callback) => callback(new Error('focus failed'), '', 'focus failed'),
    }),
    /focus failed/,
  );
});

test('desktop submit confirmation requires a new matching user message', async () => {
  let reads = 0;
  const confirmed = await waitForCodexDesktopUserMessage({
    text: '客户端消息',
    sinceMs: 10_000,
    intervalMs: 0,
    delayImpl: async () => {},
    readMessages: async () => {
      reads += 1;
      return reads < 2
        ? [{ role: 'user', message: '客户端消息', createdAtMs: 1000 }]
        : [{ role: 'user', message: '客户端消息', createdAtMs: 10_100 }];
    },
  });
  assert.equal(confirmed, true);
  assert.equal(reads, 2);

  const missing = await waitForCodexDesktopUserMessage({
    text: '未记录消息',
    sinceMs: 10_000,
    attempts: 2,
    intervalMs: 0,
    delayImpl: async () => {},
    readMessages: async () => [{ role: 'assistant', message: '未记录消息', createdAtMs: 10_100 }],
  });
  assert.equal(missing, false);
});
