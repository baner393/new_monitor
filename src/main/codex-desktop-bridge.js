import { execFile } from 'child_process';
import path from 'path';

const SUBMIT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CodexDesktopWindow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@

# The deep-link process receives navigation asynchronously when Codex is already open.
Start-Sleep -Milliseconds 900
$deadline = [DateTime]::UtcNow.AddSeconds(12)
$target = $null
do {
  $candidates = @(Get-Process -Name 'ChatGPT','Codex' -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowHandle -ne 0
  })
  $foreground = [CodexDesktopWindow]::GetForegroundWindow()
  $foregroundPid = [uint32]0
  [void][CodexDesktopWindow]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
  $target = $candidates | Where-Object { $_.Id -eq $foregroundPid } | Select-Object -First 1
  if ($null -eq $target) {
    $target = $candidates | Sort-Object StartTime -Descending | Select-Object -First 1
  }
  if ($null -eq $target) { Start-Sleep -Milliseconds 100 }
} while ($null -eq $target -and [DateTime]::UtcNow -lt $deadline)

if ($null -eq $target) { throw 'Codex desktop window was not found' }
[void][CodexDesktopWindow]::ShowWindowAsync($target.MainWindowHandle, 9)
[object]$windowShell = New-Object -ComObject WScript.Shell
if (-not $windowShell.AppActivate([int]$target.Id)) { throw 'Codex desktop window activation failed' }
[void][CodexDesktopWindow]::SetForegroundWindow($target.MainWindowHandle)
Start-Sleep -Milliseconds 220

$foreground = [CodexDesktopWindow]::GetForegroundWindow()
$foregroundPid = [uint32]0
[void][CodexDesktopWindow]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
if ($foregroundPid -ne [uint32]$target.Id) { throw 'Codex desktop window did not keep keyboard focus' }

$window = [System.Windows.Automation.AutomationElement]::FromHandle($target.MainWindowHandle)
$composerDeadline = [DateTime]::UtcNow.AddSeconds(12)
$composer = $null
do {
  $edits = $window.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit
    ))
  )
  foreach ($edit in $edits) {
    try {
      if ($edit.Current.ProcessId -eq $target.Id -and
          $edit.Current.IsEnabled -and
          $edit.Current.ClassName -match 'ProseMirror') {
        $composer = $edit
        break
      }
    } catch {}
  }
  if ($null -eq $composer) { Start-Sleep -Milliseconds 100 }
} while ($null -eq $composer -and [DateTime]::UtcNow -lt $composerDeadline)

if ($null -eq $composer) { throw 'Codex composer was not found in the active task' }
$composer.SetFocus()
Start-Sleep -Milliseconds 120
$focusedComposer = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($null -eq $focusedComposer -or
    $focusedComposer.Current.ProcessId -ne $target.Id -or
    $focusedComposer.Current.ClassName -notmatch 'ProseMirror') {
  throw 'Codex composer did not receive keyboard focus'
}
$composer = $focusedComposer
$encodedText = $env:MONITOR_CODEX_MESSAGE_B64
if ([string]::IsNullOrWhiteSpace($encodedText)) { throw 'Codex desktop message payload was empty' }
$expectedText = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($encodedText))
if ([string]::IsNullOrWhiteSpace($expectedText)) { throw 'Codex desktop message text was empty' }
$valuePattern = $composer.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
$valuePattern.SetValue($expectedText)
Start-Sleep -Milliseconds 180

$foreground = [CodexDesktopWindow]::GetForegroundWindow()
$foregroundPid = [uint32]0
[void][CodexDesktopWindow]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
if ($foregroundPid -ne [uint32]$target.Id) { throw 'Codex desktop window lost foreground before submit' }
if ($composer.Current.ProcessId -ne $target.Id -or
    $composer.Current.ClassName -notmatch 'ProseMirror') {
  throw 'Codex composer changed before submit'
}
$confirmedText = $composer.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
if ($confirmedText -ne $expectedText) { throw 'Codex composer did not accept the complete message' }

$buttons = $window.FindAll(
  [System.Windows.Automation.TreeScope]::Descendants,
  (New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
  ))
)
$sendButton = $null
foreach ($button in $buttons) {
  try {
    $className = $button.Current.ClassName
    $accessibleName = $button.Current.Name
    $invokePattern = $null
    $canInvoke = $button.TryGetCurrentPattern(
      [System.Windows.Automation.InvokePattern]::Pattern,
      [ref]$invokePattern
    )
    if ($button.Current.IsEnabled -and
        $canInvoke -and
        (($className -match 'size-token-button-composer' -and
          $className -match 'bg-token-foreground') -or
         $accessibleName -match '^(发送|提交|Send|Send message|Submit)$')) {
      $sendButton = $button
      break
    }
  } catch {}
}

$submitMethod = 'uia-invoke'
if ($null -ne $sendButton) {
  $invokePattern = $sendButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $invokePattern.Invoke()
} else {
  # Older Codex clients may not expose the icon button through InvokePattern.
  # Try the configured Enter behavior first, then restore the exact message and
  # try Ctrl+Enter only when the editor demonstrably did not clear.
  $submitMethod = 'enter'
  $composer.SetFocus()
  Start-Sleep -Milliseconds 80
  $focusedComposer = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($null -eq $focusedComposer -or
      $focusedComposer.Current.ProcessId -ne $target.Id -or
      $focusedComposer.Current.ClassName -notmatch 'ProseMirror') {
    throw 'Codex composer did not receive keyboard focus for fallback submit'
  }
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 220
  $currentComposer = [System.Windows.Automation.AutomationElement]::FocusedElement
  $currentText = $null
  if ($null -ne $currentComposer -and
      $currentComposer.Current.ProcessId -eq $target.Id -and
      $currentComposer.Current.ClassName -match 'ProseMirror') {
    $currentText = $currentComposer.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
  }
  if (-not [string]::IsNullOrEmpty($currentText)) {
    $submitMethod = 'ctrl-enter'
    $currentComposer.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($expectedText)
    [System.Windows.Forms.SendKeys]::SendWait('^{ENTER}')
  }
}

Write-Output (ConvertTo-Json @{
  submitted = $true
  processId = $target.Id
  inputConfirmed = $true
  submitMethod = $submitMethod
} -Compress)
`;

export function windowsPowerShellPath(env = process.env) {
  const systemRoot = String(env.SystemRoot || env.WINDIR || 'C:\\Windows');
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export function submitCodexDesktopClipboard({ text, execFileImpl = execFile, env = process.env, timeoutMs = 30000 } = {}) {
  const encodedText = Buffer.from(String(text || ''), 'utf8').toString('base64');
  return new Promise((resolve, reject) => {
    execFileImpl(
      windowsPowerShellPath(env),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SUBMIT_SCRIPT],
      {
        windowsHide: true,
        timeout: timeoutMs,
        encoding: 'utf8',
        env: { ...env, MONITOR_CODEX_MESSAGE_B64: encodedText },
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || error.message || '').trim();
          reject(new Error(detail || 'Codex desktop submit bridge failed'));
          return;
        }
        try {
          const result = JSON.parse(String(stdout || '').trim());
          if (result?.submitted !== true || result?.inputConfirmed !== true) {
            throw new Error('Codex desktop submit was not confirmed');
          }
          resolve(result);
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });
}

export async function waitForCodexDesktopUserMessage({
  readMessages,
  text,
  sinceMs,
  attempts = 40,
  intervalMs = 500,
  delayImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const expected = String(text || '').trim();
  const lowerBound = Number(sinceMs || Date.now()) - 2000;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await delayImpl(intervalMs);
    const messages = await readMessages();
    const found = (messages || []).some((message) => message?.role === 'user'
      && String(message.message || '').trim() === expected
      && Number(message.createdAtMs || 0) >= lowerBound);
    if (found) return true;
  }
  return false;
}
