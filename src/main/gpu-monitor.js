import { execFile } from 'child_process';
import path from 'path';

const NVIDIA_ARGS = [
  '--query-gpu=name,temperature.gpu,utilization.gpu,utilization.memory,memory.used,memory.total,power.draw',
  '--format=csv,noheader,nounits',
];

const WINDOWS_GPU_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$allAdapters = @(Get-CimInstance Win32_VideoController)
$physical = @($allAdapters | Where-Object {
  $_.PNPDeviceID -like 'PCI*' -and
  $_.Name -notmatch 'Virtual|Remote|Oray|Todesk|IDD|Basic Display'
})
$gpu = @($physical + $allAdapters) | Where-Object { $_ } | Select-Object -First 1
if (-not $gpu) { throw 'No display adapter found' }
$util = $null
$memoryUsed = $null
try {
  $samples = @(Get-Counter @(
    '\GPU Engine(*engtype_3D)\Utilization Percentage',
    '\GPU Adapter Memory(*)\Dedicated Usage'
  ) -ErrorAction Stop).CounterSamples
  $engineSamples = @($samples | Where-Object { $_.Path -like '*GPU Engine*' })
  if ($engineSamples.Count -gt 0) {
    $util = [Math]::Min(100, [Math]::Max(0, ($engineSamples | Measure-Object CookedValue -Sum).Sum))
  }
  $memorySamples = @($samples | Where-Object { $_.Path -like '*GPU Adapter Memory*' })
  if ($memorySamples.Count -gt 0) {
    $memoryUsed = ($memorySamples | Measure-Object CookedValue -Sum).Sum / 1MB
  }
} catch {}
$memoryTotal = if ($gpu.AdapterRAM) { [double]$gpu.AdapterRAM / 1MB } else { $null }
[pscustomobject]@{
  name = [string]$gpu.Name
  driverVersion = [string]$gpu.DriverVersion
  gpuUtilization = $util
  memoryUsed = $memoryUsed
  memoryTotal = $memoryTotal
  memoryUtilization = $(if ($memoryUsed -ne $null -and $memoryTotal) { [Math]::Min(100, 100 * $memoryUsed / $memoryTotal) } else { $null })
  temperature = $null
  powerDraw = $null
  provider = 'windows'
} | ConvertTo-Json -Compress
`;

function toNumber(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}

export function parseNvidiaOutput(stdout) {
  const firstLine = String(stdout || '').trim().split(/\r?\n/)[0];
  const parts = firstLine.split(/,\s*/);
  if (parts.length < 7) throw new Error('Unexpected nvidia-smi output');
  return {
    name: parts[0],
    temperature: toNumber(parts[1]),
    gpuUtilization: toNumber(parts[2]),
    memoryUtilization: toNumber(parts[3]),
    memoryUsed: toNumber(parts[4]),
    memoryTotal: toNumber(parts[5]),
    powerDraw: toNumber(parts[6]),
    provider: 'nvidia-smi',
  };
}

export function parseWindowsGpuOutput(stdout) {
  const data = JSON.parse(String(stdout || '').replace(/^\uFEFF/, '').trim());
  if (!data?.name) throw new Error('Windows GPU query returned no adapter');
  for (const key of ['temperature', 'gpuUtilization', 'memoryUtilization', 'memoryUsed', 'memoryTotal', 'powerDraw']) {
    data[key] = toNumber(data[key]);
  }
  return data;
}

export class GPUMonitor {
  constructor(win, intervalMs = 2000) {
    this.win = win;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.provider = 'auto';
    this.inFlight = false;
    this.lastData = null;
    this.reportedProvider = null;
  }

  start() {
    this._poll();
    this.timer = setInterval(() => this._poll(), this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  requestSnapshot() {
    if (this.lastData) this._send(this.lastData);
    this._poll();
  }

  _poll() {
    if (this.inFlight) return;
    this.inFlight = true;
    if (this.provider === 'windows') this._pollWindows();
    else this._pollNvidia();
  }

  _pollNvidia() {
    execFile('nvidia-smi.exe', NVIDIA_ARGS, { timeout: 5000, windowsHide: true }, (error, stdout) => {
      if (error) {
        this.provider = 'windows';
        this._pollWindows();
        return;
      }
      try {
        this.provider = 'nvidia';
        this._publish(parseNvidiaOutput(stdout));
      } catch (parseError) {
        this.provider = 'windows';
        this._pollWindows(parseError);
      }
    });
  }

  _pollWindows(nvidiaError = null) {
    const powershell = process.platform === 'win32'
      ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell';
    execFile(
      powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_GPU_SCRIPT],
      { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || '').trim() || error.message;
          this._publish({
            error: `GPU information unavailable: ${detail}`,
            nvidiaError: nvidiaError?.message,
          });
          return;
        }
        try {
          this._publish(parseWindowsGpuOutput(stdout));
        } catch (parseError) {
          this._publish({ error: `GPU information parse failed: ${parseError.message}` });
        }
      },
    );
  }

  _publish(data) {
    this.inFlight = false;
    this.lastData = data;
    if (data.provider && data.provider !== this.reportedProvider) {
      this.reportedProvider = data.provider;
      console.log(`[GPU] Provider: ${data.provider}; adapter: ${data.name}`);
    }
    this._send(data);
  }

  _send(data) {
    if (this.win && !this.win.isDestroyed() && !this.win.webContents.isDestroyed()) {
      this.win.webContents.send('gpu-data', data);
    }
  }
}
