$ErrorActionPreference = 'Stop'

$port = 9222
$appUserModelId = 'OpenAI.Codex_2p2nqsd0c76g0!App'
$listenAddress = '127.0.0.1'

function Test-CodexMainShellTarget {
  param($Target)

  try {
    $targetUri = [Uri]$Target.url
    $isMainShell = (
      $Target.type -eq 'page' -and
      $targetUri.Scheme -eq 'app' -and
      $targetUri.Host -eq '-' -and
      $targetUri.AbsolutePath -eq '/index.html' -and
      [string]::IsNullOrEmpty($targetUri.Query)
    )
    if (-not $isMainShell -or [regex]::IsMatch([string]$Target.title, '\bdetached(?:\s+window)?\b', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
      return $false
    }
    $fragment = $targetUri.Fragment -replace '^#', ''
    $hashRoute = [Uri]::UnescapeDataString($fragment).TrimStart('/')
    if ($hashRoute -match '^(?:avatar-overlay|global-dictation|detached(?:-window)?)(?:[/?#]|$)') {
      return $false
    }
    return $true
  } catch {
    return $false
  }
}

$registeredApp = @(Get-StartApps -ErrorAction SilentlyContinue | Where-Object {
  $_.AppID -eq $appUserModelId
}) | Select-Object -First 1
if (-not $registeredApp) {
  $package = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($package) {
    $manifestPath = Join-Path $package.InstallLocation 'AppxManifest.xml'
    if (Test-Path -LiteralPath $manifestPath) {
      [xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
      $application = @($manifest.SelectNodes("//*[local-name()='Application']") | Where-Object {
        $_.GetAttribute('Id') -eq 'App'
      }) | Select-Object -First 1
      if ($application -and "$($package.PackageFamilyName)!$($application.GetAttribute('Id'))" -eq $appUserModelId) {
        $registeredApp = $application
      }
    }
  }
}
if (-not $registeredApp) {
  throw "Codex application ID '$appUserModelId' could not be verified. No processes were stopped."
}

$existingListener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
if ($existingListener) {
  throw "Port $port is already in use. Close the existing listener before restarting Codex."
}

$chatGptProcesses = @(Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue)
$previousChatGptProcessIds = @($chatGptProcesses | ForEach-Object { $_.Id })
foreach ($process in $chatGptProcesses) {
  Stop-Process -Id $process.Id -Force
}
if ($chatGptProcesses.Count -gt 0) {
  Start-Sleep -Seconds 2
}

$activationManagerSource = @'
using System;
using System.Runtime.InteropServices;

namespace TurtleMonitor.CodexActivation {
  [ComImport]
  [Guid("2e941141-7f97-4756-ba1d-9decde894a3d")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IApplicationActivationManager {
    [PreserveSig]
    int ActivateApplication(
      [MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
      [MarshalAs(UnmanagedType.LPWStr)] string arguments,
      uint options,
      out uint processId);
  }

  [ComImport]
  [Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
  [ClassInterface(ClassInterfaceType.None)]
  public class ApplicationActivationManager { }

  public static class Launcher {
    public static uint Activate(string appUserModelId, string arguments) {
      var manager = (IApplicationActivationManager)new ApplicationActivationManager();
      uint processId;
      int result = manager.ActivateApplication(appUserModelId, arguments, 0, out processId);
      if (result < 0) Marshal.ThrowExceptionForHR(result);
      return processId;
    }
  }
}
'@

Add-Type -TypeDefinition $activationManagerSource
$arguments = "--remote-debugging-address=$listenAddress --remote-debugging-port=$port"
$processId = [TurtleMonitor.CodexActivation.Launcher]::Activate($appUserModelId, $arguments)
if (-not $processId) {
  throw 'Windows did not return a process ID for the Codex activation; refusing to continue.'
}

$deadline = (Get-Date).AddSeconds(30)
$targets = $null
$mainShell = $null
while ((Get-Date) -lt $deadline) {
  try {
    $targetResponse = Invoke-RestMethod -Uri "http://$listenAddress`:$port/json/list" -TimeoutSec 2
    $targets = @(foreach ($target in $targetResponse) { $target })
    $mainShell = @($targets | Where-Object {
      (Test-CodexMainShellTarget $_) -and
      $_.url -match '^app://-/index\.html(?:#.*)?$'
    }) | Select-Object -First 1
    if ($mainShell) { break }
  } catch {
    # The CDP endpoint may start before Chromium publishes its main page target.
  }
  Start-Sleep -Milliseconds 500
}

if ($null -eq $targets) {
  throw "Codex did not open its local debugging endpoint on $listenAddress`:$port."
}
if (-not $mainShell) {
  throw 'The local endpoint opened, but the Codex main app page was not published within 30 seconds.'
}

$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
$nonLoopbackListeners = @($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') })
if ($listeners.Count -eq 0 -or $nonLoopbackListeners.Count -gt 0) {
  $startedChatGptProcessIds = @(
    Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue |
      Where-Object { $_.Id -notin $previousChatGptProcessIds } |
      ForEach-Object { $_.Id }
  )
  foreach ($listener in $listeners) {
    if ($listener.LocalAddress -notin @('127.0.0.1', '::1') -and
        $listener.OwningProcess -in $startedChatGptProcessIds) {
      Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }
  throw 'Codex debugging port is unavailable or not bound exclusively to loopback. No unrelated listener process was stopped.'
}

if (-not $mainShell.webSocketDebuggerUrl.StartsWith("ws://$listenAddress`:$port/")) {
  throw 'Codex returned a debugger socket that is not bound to the expected loopback address.'
}

[pscustomobject]@{
  ProcessId = $processId
  MainWindowFound = $true
  DebugAddress = "$listenAddress`:$port"
  Status = 'Ready for Turtle Monitor client-compatible sending'
} | ConvertTo-Json -Compress
