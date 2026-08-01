import { execFile, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { windowsPowerShellPath } from './codex-desktop-bridge.js';

const SUBMIT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ClaudeClientWindow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@

Start-Sleep -Milliseconds ([int]$env:MONITOR_CLAUDE_FOCUS_DELAY_MS)
$names = @('Code','Cursor','Windsurf','WindowsTerminal','wt','powershell','pwsh','cmd')
$foreground = [ClaudeClientWindow]::GetForegroundWindow()
$foregroundPid = [uint32]0
[void][ClaudeClientWindow]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
$target = $null
$targetHandle = [IntPtr]::Zero
if ($env:MONITOR_CLAUDE_PREFER_FOREGROUND -eq '1') {
  $foregroundProcess = Get-Process -Id $foregroundPid -ErrorAction SilentlyContinue
  if ($null -ne $foregroundProcess -and $names -contains $foregroundProcess.ProcessName) {
    $target = $foregroundProcess
    $targetHandle = $foreground
  }
}

$requestedPid = 0
[void][int]::TryParse($env:MONITOR_CLAUDE_PROCESS_ID, [ref]$requestedPid)
$candidateIds = New-Object System.Collections.Generic.List[int]
if ($requestedPid -gt 0) {
  $cursor = $requestedPid
  for ($depth = 0; $depth -lt 10 -and $cursor -gt 0; $depth++) {
    $candidateIds.Add($cursor)
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $cursor" -ErrorAction SilentlyContinue
    if ($null -eq $processInfo) { break }
    $cursor = [int]$processInfo.ParentProcessId
  }
}

if ($null -eq $target) {
  foreach ($candidateId in $candidateIds) {
    $candidate = Get-Process -Id $candidateId -ErrorAction SilentlyContinue
    if ($null -ne $candidate -and $candidate.MainWindowHandle -ne 0) {
      $target = $candidate
      $targetHandle = $candidate.MainWindowHandle
      break
    }
  }
}
if ($null -eq $target) {
  $candidates = @(Get-Process -Name $names -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
  $target = $candidates | Where-Object { $_.Id -eq $foregroundPid } | Select-Object -First 1
  if ($null -eq $target) { $target = $candidates | Sort-Object StartTime -Descending | Select-Object -First 1 }
  if ($null -ne $target) { $targetHandle = $target.MainWindowHandle }
}
if ($null -eq $target) { throw 'Claude Code client window was not found' }
if ($targetHandle -eq [IntPtr]::Zero) { $targetHandle = $target.MainWindowHandle }

[void][ClaudeClientWindow]::ShowWindowAsync($targetHandle, 9)
[object]$windowShell = New-Object -ComObject WScript.Shell
if (-not $windowShell.AppActivate([int]$target.Id)) { throw 'Claude Code client window activation failed' }
[void][ClaudeClientWindow]::SetForegroundWindow($targetHandle)
Start-Sleep -Milliseconds 220
$foreground = [ClaudeClientWindow]::GetForegroundWindow()
$foregroundPid = [uint32]0
[void][ClaudeClientWindow]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
if ($foreground -ne $targetHandle) { throw 'Claude Code client did not keep the requested window focus' }

if ($env:MONITOR_CLAUDE_PASTE -eq '1') {
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds 160
}
if ($env:MONITOR_CLAUDE_SHORTCUT -eq 'none') {
  $method = 'focus-only'
} elseif ($env:MONITOR_CLAUDE_SHORTCUT -eq 'ctrl-enter') {
  [System.Windows.Forms.SendKeys]::SendWait('^{ENTER}')
  $method = 'ctrl-enter'
} else {
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  $method = 'enter'
}

Write-Output (ConvertTo-Json @{
  submitted = $true
  processId = $target.Id
  submitMethod = $method
} -Compress)
`;

export function claudeVsCodeUri({ sessionId = '', prompt = '', scheme = 'vscode' } = {}) {
  const params = new URLSearchParams();
  if (sessionId) params.set('session', String(sessionId));
  if (prompt) params.set('prompt', String(prompt));
  const query = params.toString();
  return `${scheme}://anthropic.claude-code/open${query ? `?${query}` : ''}`;
}

export function resolveClaudeIdeTarget(claudeHome, cwd = '') {
  const root = path.join(claudeHome || path.join(os.homedir(), '.claude'), 'ide');
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return null; }
  const normalizedCwd = path.resolve(cwd || os.homedir()).toLowerCase();
  const matches = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.lock')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(root, entry.name), 'utf8'));
      const pid = Number(data.pid);
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); }
        catch { continue; }
      }
      const folders = Array.isArray(data.workspaceFolders) ? data.workspaceFolders : [];
      const score = folders.some((folder) => {
        const normalized = path.resolve(String(folder)).toLowerCase();
        return normalizedCwd === normalized || normalizedCwd.startsWith(`${normalized}${path.sep}`);
      }) ? 1 : 0;
      matches.push({ ...data, score });
    } catch { /* IDE lock can be replaced while it is read. */ }
  }
  const target = matches.sort((left, right) => right.score - left.score)[0];
  if (!target || (cwd && target.score <= 0)) return null;
  const name = String(target.ideName || '').toLowerCase();
  const scheme = name.includes('cursor') ? 'cursor'
    : name.includes('windsurf') ? 'windsurf'
      : name.includes('insider') ? 'vscode-insiders'
        : name.includes('codium') ? 'vscodium'
          : 'vscode';
  return { pid: Number(target.pid) || 0, scheme, ideName: target.ideName || '' };
}

export function submitClaudeClientClipboard({
  processId = 0,
  paste = true,
  shortcut = 'enter',
  preferForeground = false,
  focusDelayMs = 900,
  execFileImpl = execFile,
  env = process.env,
  timeoutMs = 30000,
} = {}) {
  return new Promise((resolve, reject) => {
    execFileImpl(
      windowsPowerShellPath(env),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SUBMIT_SCRIPT],
      {
        windowsHide: true,
        timeout: timeoutMs,
        encoding: 'utf8',
        env: {
          ...env,
          MONITOR_CLAUDE_PROCESS_ID: String(Number(processId) || 0),
          MONITOR_CLAUDE_PASTE: paste ? '1' : '0',
          MONITOR_CLAUDE_SHORTCUT: shortcut === 'none' ? 'none' : shortcut === 'ctrl-enter' ? 'ctrl-enter' : 'enter',
          MONITOR_CLAUDE_PREFER_FOREGROUND: preferForeground ? '1' : '0',
          MONITOR_CLAUDE_FOCUS_DELAY_MS: String(Math.max(0, Number(focusDelayMs) || 0)),
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || error.message || 'Claude Code client submit failed').trim()));
          return;
        }
        try {
          const result = JSON.parse(String(stdout || '').trim());
          if (result?.submitted !== true) throw new Error('Claude Code client submit was not confirmed');
          resolve(result);
        } catch (parseError) { reject(parseError); }
      },
    );
  });
}

export function launchClaudeTerminalSession({ executable, cwd, sessionId, prompt, spawnImpl = spawn } = {}) {
  if (!executable) throw new Error('Claude Code CLI path is missing');
  const args = ['--resume', String(sessionId || '')];
  if (String(prompt || '')) args.push(String(prompt));
  const child = spawnImpl(executable, args, {
    cwd: cwd || os.homedir(),
    env: { ...process.env },
    detached: true,
    windowsHide: false,
    stdio: 'ignore',
  });
  child.once?.('error', (error) => console.warn('[Claude] Terminal launch failed:', error.message));
  child.unref?.();
  return { opened: true, processId: child.pid || 0 };
}
