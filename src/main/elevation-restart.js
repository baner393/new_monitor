import { spawn } from 'child_process';
import path from 'path';

function quotePowerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function createElevationScript(executable, args = [], workingDirectory = null) {
  const argumentList = args.length
    ? ` -ArgumentList @(${args.map(quotePowerShellLiteral).join(', ')})`
    : '';
  const directory = workingDirectory
    ? ` -WorkingDirectory ${quotePowerShellLiteral(workingDirectory)}`
    : '';
  return [
    '$ErrorActionPreference = \'Stop\'',
    `$process = Start-Process -FilePath ${quotePowerShellLiteral(executable)}${argumentList}${directory} -WindowStyle Hidden -Verb RunAs -PassThru`,
    'if ($null -eq $process) { exit 1 }',
  ].join('; ');
}

export function launchElevatedRestart({
  executable = process.execPath,
  args = process.argv.slice(1),
  workingDirectory = null,
  spawnImpl = spawn,
} = {}) {
  if (process.platform !== 'win32') throw new Error('Elevation restart is only available on Windows');
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const encoded = Buffer.from(createElevationScript(executable, args, workingDirectory), 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = spawnImpl(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded,
    ], {
      windowsHide: true,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(true);
      else reject(new Error('Windows elevation request was cancelled or failed'));
    });
  });
}
