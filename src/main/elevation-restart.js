import { execFileSync, spawn } from 'child_process';
import path from 'path';

function quotePowerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function quoteWindowsCommandLineArgument(value) {
  const argument = String(value);
  if (argument && !/[\s"]/.test(argument)) return argument;
  let quoted = '"';
  let backslashes = 0;
  for (const character of argument) {
    if (character === '\\') {
      backslashes += 1;
      continue;
    }
    if (character === '"') {
      quoted += `${'\\'.repeat(backslashes * 2 + 1)}"`;
      backslashes = 0;
      continue;
    }
    quoted += `${'\\'.repeat(backslashes)}${character}`;
    backslashes = 0;
  }
  return `${quoted}${'\\'.repeat(backslashes * 2)}"`;
}

function windowsPowerShellPath(env = process.env) {
  const systemRoot = env.SystemRoot || env.WINDIR || 'C:\\Windows';
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export function isWindowsProcessElevated({
  platform = process.platform,
  execFileSyncImpl = execFileSync,
  env = process.env,
} = {}) {
  if (platform !== 'win32') return false;
  try {
    const script = '[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)';
    const output = execFileSyncImpl(windowsPowerShellPath(env), [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script,
    ], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    return String(output).trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

export function createElevationScript(executable, args = [], workingDirectory = null) {
  const nativeArguments = args.map(quoteWindowsCommandLineArgument).join(' ');
  return [
    '$ErrorActionPreference = \'Stop\'',
    '$startInfo = [System.Diagnostics.ProcessStartInfo]::new()',
    `$startInfo.FileName = ${quotePowerShellLiteral(executable)}`,
    `$startInfo.Arguments = ${quotePowerShellLiteral(nativeArguments)}`,
    `$startInfo.WorkingDirectory = ${quotePowerShellLiteral(workingDirectory || path.dirname(executable))}`,
    '$startInfo.UseShellExecute = $true',
    '$startInfo.Verb = \'runas\'',
    '$startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden',
    '$process = [System.Diagnostics.Process]::Start($startInfo)',
    'if ($null -eq $process) { exit 2 }',
    'exit 0',
  ].join('; ');
}

export function launchElevatedProcess({
  executable,
  args = [],
  workingDirectory = null,
  spawnImpl = spawn,
  env = process.env,
} = {}) {
  if (process.platform !== 'win32') throw new Error('Windows administrator access is only available on Windows');
  if (!executable) throw new Error('The elevated executable path is missing');
  const encoded = Buffer.from(
    createElevationScript(executable, args, workingDirectory),
    'utf16le',
  ).toString('base64');

  return new Promise((resolve, reject) => {
    const child = spawnImpl(windowsPowerShellPath(env), [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded,
    ], {
      windowsHide: true,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve({ started: true });
        return;
      }
      reject(new Error(code === 2
        ? '管理员硬件读取器没有成功启动'
        : 'Windows 管理员确认已取消或启动失败'));
    });
  });
}
