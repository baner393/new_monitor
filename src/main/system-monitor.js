import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { queryNvidiaGpus, selectPrimaryGpu } from './gpu-monitor.js';
import { HardwareSensorClient } from './hardware-sensor-monitor.js';

const WINDOWS_SNAPSHOT_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function As-Double($value) {
  if ($null -eq $value) { return $null }
  try { return [double]$value } catch { return $null }
}

$sources = [System.Collections.Generic.List[string]]::new()
$requestedCounterGroups = @($env:TURTLE_MONITOR_COUNTER_GROUPS -split ',' | Where-Object { $_ })
function Wants-CounterGroup([string]$name) {
  return -not $requestedCounterGroups.Count -or $requestedCounterGroups -contains 'ALL' -or $requestedCounterGroups -contains $name
}

# Performance counter names are localized by Windows. Translate the stable
# English names through their numeric Perflib indexes instead of hard-coding a
# language-specific path.
$englishCounters = @{}
$localCounters = @{}
try {
  $englishValues = @((Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Perflib\009' -ErrorAction Stop).Counter)
  $localValues = @((Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Perflib\CurrentLanguage' -ErrorAction Stop).Counter)
  for ($index = 0; $index -lt $englishValues.Count - 1; $index += 2) {
    $englishCounters[[string]$englishValues[$index + 1]] = [string]$englishValues[$index]
  }
  for ($index = 0; $index -lt $localValues.Count - 1; $index += 2) {
    $localCounters[[string]$localValues[$index]] = [string]$localValues[$index + 1]
  }
} catch {}

function Local-CounterName([string]$englishName) {
  $counterIndex = $englishCounters[$englishName]
  if ($counterIndex -and $localCounters[$counterIndex]) { return $localCounters[$counterIndex] }
  return $englishName
}

function Counter-Path([string]$objectName, [string]$counterName, [string]$instanceName = '') {
  $localObject = Local-CounterName $objectName
  $localCounter = Local-CounterName $counterName
  if ($instanceName) { return "\$localObject($instanceName)\$localCounter" }
  return "\$localObject\$localCounter"
}

function Counter-Value($samples, [string]$counterName) {
  $localCounter = Local-CounterName $counterName
  $sample = @($samples | Where-Object { $_.Path -like "*\$localCounter" } | Select-Object -First 1)
  if ($sample.Count) { return As-Double $sample[0].CookedValue }
  return $null
}

$processors = @()
try {
  $processors = @(Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop)
  if ($processors.Count) { $sources.Add('Win32_Processor') }
} catch {}

$operatingSystem = $null
try {
  $operatingSystem = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop | Select-Object -First 1
  if ($operatingSystem) { $sources.Add('Win32_OperatingSystem') }
} catch {}

$computerSystem = $null
try { $computerSystem = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop | Select-Object -First 1 } catch {}

$coreLoads = @()
$systemProcessCount = $null
$systemThreadCount = $null
$cpuQueueLength = $null
if (Wants-CounterGroup 'CPU') { try {
  $cpuSamples = @(Get-Counter -Counter @(
    (Counter-Path 'Processor' '% Processor Time' '_Total'),
    (Counter-Path 'Processor' '% Processor Time' '*')
  ) -MaxSamples 1 -ErrorAction Stop).CounterSamples
  $coreLoads = @($cpuSamples |
    Where-Object { $_.InstanceName -ne '_Total' } |
    Sort-Object { try { [int]$_.InstanceName } catch { 9999 } } |
    ForEach-Object { As-Double $_.CookedValue })
  if ($cpuSamples.Count) { $sources.Add('Get-Counter:CPU') }
} catch {} }

if (Wants-CounterGroup 'System') { try {
  $systemSamples = @(Get-Counter -Counter @(
    (Counter-Path 'System' 'Processes'),
    (Counter-Path 'System' 'Threads'),
    (Counter-Path 'System' 'Processor Queue Length')
  ) -MaxSamples 1 -ErrorAction Stop).CounterSamples
  $systemProcessCount = Counter-Value $systemSamples 'Processes'
  $systemThreadCount = Counter-Value $systemSamples 'Threads'
  $cpuQueueLength = Counter-Value $systemSamples 'Processor Queue Length'
  if ($systemSamples.Count) { $sources.Add('Get-Counter:System') }
} catch {} }

if ($null -eq $systemProcessCount -or $null -eq $systemThreadCount) {
  try {
    $runningProcesses = @(Get-Process -ErrorAction Stop)
    if ($null -eq $systemProcessCount) { $systemProcessCount = $runningProcesses.Count }
    if ($null -eq $systemThreadCount) {
      $systemThreadCount = As-Double (($runningProcesses | ForEach-Object { $_.Threads.Count } | Measure-Object -Sum).Sum)
    }
    $sources.Add('Get-Process')
  } catch {}
}

$logicalDisks = @()
try {
  $logicalDisks = @(Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType=3' -ErrorAction Stop |
    ForEach-Object {
      [pscustomobject]@{
        name = [string]$_.DeviceID
        volumeName = [string]$_.VolumeName
        fileSystem = [string]$_.FileSystem
        sizeBytes = As-Double $_.Size
        freeBytes = As-Double $_.FreeSpace
      }
    })
  if ($logicalDisks.Count) { $sources.Add('Win32_LogicalDisk') }
} catch {
  try {
    $logicalDisks = @(Get-PSDrive -PSProvider FileSystem -ErrorAction Stop |
      Where-Object { $_.Used -ne $null -and $_.Free -ne $null } |
      ForEach-Object {
        [pscustomobject]@{
          name = "$($_.Name):"
          volumeName = ''
          fileSystem = ''
          sizeBytes = As-Double ($_.Used + $_.Free)
          freeBytes = As-Double $_.Free
        }
      })
    if ($logicalDisks.Count) { $sources.Add('Get-PSDrive') }
  } catch {}
}

$diskIo = $null
if (Wants-CounterGroup 'Disk') { try {
  $diskSamples = @(Get-Counter -Counter @(
    (Counter-Path 'PhysicalDisk' '% Disk Time' '_Total'),
    (Counter-Path 'PhysicalDisk' 'Disk Read Bytes/sec' '_Total'),
    (Counter-Path 'PhysicalDisk' 'Disk Write Bytes/sec' '_Total'),
    (Counter-Path 'PhysicalDisk' 'Disk Transfers/sec' '_Total'),
    (Counter-Path 'PhysicalDisk' 'Current Disk Queue Length' '_Total')
  ) -MaxSamples 1 -ErrorAction Stop).CounterSamples
  if ($diskSamples.Count) {
    $diskIo = [pscustomobject]@{
      mode = 'rate'
      usage = Counter-Value $diskSamples '% Disk Time'
      readBytesPerSec = Counter-Value $diskSamples 'Disk Read Bytes/sec'
      writeBytesPerSec = Counter-Value $diskSamples 'Disk Write Bytes/sec'
      transfersPerSec = Counter-Value $diskSamples 'Disk Transfers/sec'
      queueLength = Counter-Value $diskSamples 'Current Disk Queue Length'
    }
    $sources.Add('Get-Counter:Disk')
  }
} catch {} }

if (-not $diskIo) {
  try {
    $processIo = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
    if ($processIo.Count) {
      $diskIo = [pscustomobject]@{
        mode = 'cumulative'
        usage = $null
        readBytesPerSec = As-Double (($processIo | Measure-Object -Property ReadTransferCount -Sum).Sum)
        writeBytesPerSec = As-Double (($processIo | Measure-Object -Property WriteTransferCount -Sum).Sum)
        transfersPerSec = As-Double ((($processIo | Measure-Object -Property ReadOperationCount -Sum).Sum) + (($processIo | Measure-Object -Property WriteOperationCount -Sum).Sum))
        queueLength = $null
      }
      $sources.Add('Win32_Process:IO')
    }
  } catch {}
}

$networkInterfaces = @()
if (Wants-CounterGroup 'Network') { try {
  $networkCounterNames = @(
    'Bytes Received/sec', 'Bytes Sent/sec', 'Bytes Total/sec',
    'Current Bandwidth', 'Packets Received/sec', 'Packets Sent/sec'
  )
  $networkPaths = @($networkCounterNames | ForEach-Object { Counter-Path 'Network Interface' $_ '*' })
  $networkSamples = @(Get-Counter -Counter $networkPaths -MaxSamples 1 -ErrorAction Stop).CounterSamples
  $networkGroups = @($networkSamples | Where-Object { $_.InstanceName -and $_.InstanceName -notmatch 'Loopback|isatap|Teredo' } | Group-Object InstanceName)
  $networkInterfaces = @($networkGroups | ForEach-Object {
    $samples = @($_.Group)
    [pscustomobject]@{
      name = [string]$_.Name
      mode = 'rate'
      download = Counter-Value $samples 'Bytes Received/sec'
      upload = Counter-Value $samples 'Bytes Sent/sec'
      total = Counter-Value $samples 'Bytes Total/sec'
      linkSpeedBits = Counter-Value $samples 'Current Bandwidth'
      packetsReceivedPerSec = Counter-Value $samples 'Packets Received/sec'
      packetsSentPerSec = Counter-Value $samples 'Packets Sent/sec'
    }
  })
  if ($networkInterfaces.Count) { $sources.Add('Get-Counter:Network') }
} catch {} }

if (-not $networkInterfaces.Count) {
  try {
    $adapterStats = @(Get-NetAdapterStatistics -ErrorAction Stop)
    $adapterInfo = @{}
    @(Get-NetAdapter -ErrorAction SilentlyContinue) | ForEach-Object { $adapterInfo[$_.Name] = $_ }
    $networkInterfaces = @($adapterStats | ForEach-Object {
      $adapter = $adapterInfo[$_.Name]
      [pscustomobject]@{
        name = [string]$_.Name
        mode = 'cumulative'
        download = As-Double $_.ReceivedBytes
        upload = As-Double $_.SentBytes
        total = $null
        linkSpeedBits = $(if ($adapter) { As-Double $adapter.ReceiveLinkSpeed } else { $null })
        packetsReceivedPerSec = $null
        packetsSentPerSec = $null
      }
    })
    if ($networkInterfaces.Count) { $sources.Add('Get-NetAdapterStatistics') }
  } catch {}
}

$videoControllers = @()
try {
  $allControllers = @(Get-CimInstance -ClassName Win32_VideoController -ErrorAction Stop)
  $videoControllers = @($allControllers | ForEach-Object {
    [pscustomobject]@{
      name = [string]$_.Name
      driverVersion = [string]$_.DriverVersion
      adapterRamBytes = As-Double $_.AdapterRAM
      pnpDeviceId = [string]$_.PNPDeviceID
    }
  })
  if ($videoControllers.Count) { $sources.Add('Win32_VideoController') }
} catch {}

$gpuUsage = $null
$gpuMemoryUsed = $null
if (Wants-CounterGroup 'GPU') { try {
  $gpuSamples = @(Get-Counter -Counter @(
    (Counter-Path 'GPU Engine' 'Utilization Percentage' '*engtype_3D'),
    (Counter-Path 'GPU Adapter Memory' 'Dedicated Usage' '*')
  ) -MaxSamples 1 -ErrorAction Stop).CounterSamples
  $gpuUtilName = Local-CounterName 'Utilization Percentage'
  $gpuMemoryName = Local-CounterName 'Dedicated Usage'
  $gpuUtilSamples = @($gpuSamples | Where-Object { $_.Path -like "*\$gpuUtilName" })
  $gpuMemorySamples = @($gpuSamples | Where-Object { $_.Path -like "*\$gpuMemoryName" })
  if ($gpuUtilSamples.Count) { $gpuUsage = As-Double (($gpuUtilSamples | Measure-Object -Property CookedValue -Maximum).Maximum) }
  if ($gpuMemorySamples.Count) { $gpuMemoryUsed = As-Double (($gpuMemorySamples | Measure-Object -Property CookedValue -Sum).Sum) }
  if ($gpuSamples.Count) { $sources.Add('Get-Counter:GPU') }
} catch {} }

$registryGpuMemory = $null
try {
  $memoryCandidates = @()
  Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Control\Video' -ErrorAction Stop | ForEach-Object {
    $adapterKey = Join-Path $_.PSPath '0000'
    $properties = Get-ItemProperty $adapterKey -ErrorAction SilentlyContinue
    if ($properties) {
      $value = $properties.'HardwareInformation.qwMemorySize'
      if ($value -is [byte[]] -and $value.Length -ge 8) {
        $memoryCandidates += [BitConverter]::ToUInt64($value, 0)
      } elseif ($null -ne $value) {
        $memoryCandidates += [double]$value
      }
      $legacyValue = $properties.'HardwareInformation.MemorySize'
      if ($null -ne $legacyValue) { $memoryCandidates += [double]([uint32]$legacyValue) }
    }
  }
  if ($memoryCandidates.Count) { $registryGpuMemory = As-Double (($memoryCandidates | Measure-Object -Maximum).Maximum) }
} catch {}

$thermalZones = @()
try {
  $thermalZones = @(Get-CimInstance -Namespace 'root/wmi' -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop |
    ForEach-Object {
      $celsius = ((As-Double $_.CurrentTemperature) / 10) - 273.15
      if ($celsius -gt -20 -and $celsius -lt 150) {
        [pscustomobject]@{ name = [string]$_.InstanceName; temperatureC = $celsius }
      }
    } | Where-Object { $_ })
  if ($thermalZones.Count) { $sources.Add('MSAcpi_ThermalZoneTemperature') }
} catch {}

$battery = $null
try {
  $batteryDevice = Get-CimInstance -ClassName Win32_Battery -ErrorAction Stop | Select-Object -First 1
  if ($batteryDevice) {
    $battery = [pscustomobject]@{
      percent = As-Double $batteryDevice.EstimatedChargeRemaining
      statusCode = As-Double $batteryDevice.BatteryStatus
      estimatedMinutes = As-Double $batteryDevice.EstimatedRunTime
    }
    $sources.Add('Win32_Battery')
  }
} catch {}

$cpuUsage = $null
if ($coreLoads.Count) { $cpuUsage = As-Double (($coreLoads | Measure-Object -Average).Average) }
if ($processors.Count) {
  $validCpuLoads = @($processors | Where-Object { $null -ne $_.LoadPercentage })
  if ($null -eq $cpuUsage -and $validCpuLoads.Count) { $cpuUsage = As-Double (($validCpuLoads | Measure-Object -Property LoadPercentage -Average).Average) }
}

$gpuMemoryTotal = $registryGpuMemory
if ($null -eq $gpuMemoryTotal -and $videoControllers.Count) {
  $gpuMemoryTotal = As-Double (($videoControllers | Measure-Object -Property adapterRamBytes -Maximum).Maximum)
}

$result = [pscustomobject]@{
  provider = 'windows-cim'
  sources = @($sources)
  system = [pscustomobject]@{
    osName = $(if ($operatingSystem) { [string]$operatingSystem.Caption } else { $null })
    osVersion = $(if ($operatingSystem) { [string]$operatingSystem.Version } else { $null })
    manufacturer = $(if ($computerSystem) { [string]$computerSystem.Manufacturer } else { $null })
    model = $(if ($computerSystem) { [string]$computerSystem.Model } else { $null })
    processCount = $(if ($null -ne $systemProcessCount) { As-Double $systemProcessCount } elseif ($operatingSystem) { As-Double $operatingSystem.NumberOfProcesses } else { $null })
    threadCount = As-Double $systemThreadCount
    cpuQueueLength = As-Double $cpuQueueLength
  }
  cpu = [pscustomobject]@{
    model = $(if ($processors.Count) { [string]$processors[0].Name } else { $null })
    usage = $cpuUsage
    physicalCores = $(if ($processors.Count) { As-Double (($processors | Measure-Object -Property NumberOfCores -Sum).Sum) } else { $null })
    logicalCores = $(if ($processors.Count) { As-Double (($processors | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum) } else { $null })
    currentClockMHz = $(if ($processors.Count) { As-Double (($processors | Measure-Object -Property CurrentClockSpeed -Average).Average) } else { $null })
    maxClockMHz = $(if ($processors.Count) { As-Double (($processors | Measure-Object -Property MaxClockSpeed -Maximum).Maximum) } else { $null })
    perCoreUsage = @($coreLoads)
  }
  memory = [pscustomobject]@{
    totalBytes = $(if ($operatingSystem) { (As-Double $operatingSystem.TotalVisibleMemorySize) * 1KB } else { $null })
    availableBytes = $(if ($operatingSystem) { (As-Double $operatingSystem.FreePhysicalMemory) * 1KB } else { $null })
    pageFileTotalBytes = $(if ($operatingSystem) { (As-Double $operatingSystem.TotalVirtualMemorySize) * 1KB } else { $null })
    pageFileAvailableBytes = $(if ($operatingSystem) { (As-Double $operatingSystem.FreeVirtualMemory) * 1KB } else { $null })
  }
  disks = @($logicalDisks)
  diskIo = $diskIo
  networkInterfaces = @($networkInterfaces)
  gpu = [pscustomobject]@{
    adapters = @($videoControllers)
    usage = $gpuUsage
    memoryUsedBytes = $gpuMemoryUsed
    memoryTotalBytes = $gpuMemoryTotal
    temperatureC = $null
    powerWatts = $null
    provider = 'windows-cim'
  }
  thermalZones = @($thermalZones)
  battery = $battery
}

$result | ConvertTo-Json -Depth 7 -Compress
`;

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampPercent(value) {
  const number = finiteOrNull(value);
  return number === null ? null : Math.max(0, Math.min(100, number));
}

function asArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function calculateUsage(used, total) {
  return Number.isFinite(used) && Number.isFinite(total) && total > 0
    ? clampPercent(100 * used / total)
    : null;
}

export function readCpuTimes(cpus = os.cpus()) {
  const perCore = cpus.map((cpu) => {
    const times = cpu.times || {};
    const idle = finiteOrNull(times.idle) ?? 0;
    const total = Object.values(times).reduce((sum, value) => sum + (finiteOrNull(value) ?? 0), 0);
    return { idle, total };
  });
  return {
    perCore,
    idle: perCore.reduce((sum, item) => sum + item.idle, 0),
    total: perCore.reduce((sum, item) => sum + item.total, 0),
  };
}

export function calculateCpuUsage(previous, current) {
  if (!previous || !current) return { usage: null, perCoreUsage: [] };

  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  const usage = totalDelta > 0 ? clampPercent(100 * (totalDelta - idleDelta) / totalDelta) : null;
  const perCoreUsage = current.perCore.map((sample, index) => {
    const old = previous.perCore[index];
    if (!old) return null;
    const coreTotalDelta = sample.total - old.total;
    const coreIdleDelta = sample.idle - old.idle;
    return coreTotalDelta > 0
      ? clampPercent(100 * (coreTotalDelta - coreIdleDelta) / coreTotalDelta)
      : null;
  });
  return { usage, perCoreUsage };
}

function getPortableDisk() {
  try {
    const root = process.platform === 'win32' ? path.parse(process.cwd()).root : '/';
    const stats = fs.statfsSync(root, { bigint: true });
    const sizeBytes = Number(stats.bsize * stats.blocks);
    const freeBytes = Number(stats.bsize * stats.bavail);
    return [{
      name: root.replace(/[\\/]$/, '') || root,
      volumeName: '',
      fileSystem: '',
      sizeBytes,
      freeBytes,
      usedBytes: sizeBytes - freeBytes,
      usage: calculateUsage(sizeBytes - freeBytes, sizeBytes),
      provider: 'node-statfs',
    }];
  } catch {
    return [];
  }
}

export function collectPortableSnapshot({ previousCpuTimes = null, cpus = os.cpus() } = {}) {
  const currentCpuTimes = readCpuTimes(cpus);
  const cpuUsage = calculateCpuUsage(previousCpuTimes, currentCpuTimes);
  const totalBytes = os.totalmem();
  const availableBytes = os.freemem();
  const usedBytes = totalBytes - availableBytes;
  const speeds = cpus.map((cpu) => finiteOrNull(cpu.speed)).filter(Number.isFinite);

  return {
    cpuTimes: currentCpuTimes,
    snapshot: {
      timestamp: Date.now(),
      providers: ['node-os'],
      system: {
        hostname: os.hostname(),
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        uptimeSec: os.uptime(),
        osName: null,
        osVersion: null,
        manufacturer: null,
        model: null,
        processCount: null,
        threadCount: null,
        cpuQueueLength: null,
      },
      cpu: {
        model: cpus[0]?.model?.trim() || null,
        usage: cpuUsage.usage,
        physicalCores: null,
        logicalCores: cpus.length || null,
        currentClockMHz: speeds.length ? speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length : null,
        maxClockMHz: speeds.length ? Math.max(...speeds) : null,
        perCoreUsage: cpuUsage.perCoreUsage,
      },
      memory: {
        totalBytes,
        availableBytes,
        usedBytes,
        usage: calculateUsage(usedBytes, totalBytes),
        pageFileTotalBytes: null,
        pageFileAvailableBytes: null,
      },
      disks: getPortableDisk(),
      diskIo: {
        usage: null,
        readBytesPerSec: null,
        writeBytesPerSec: null,
        transfersPerSec: null,
        queueLength: null,
      },
      network: {
        downloadBytesPerSec: null,
        uploadBytesPerSec: null,
        totalBytesPerSec: null,
        interfaces: Object.entries(os.networkInterfaces()).flatMap(([name, addresses]) => {
          const ipv4 = (addresses || []).find((address) => address.family === 'IPv4' && !address.internal);
          return ipv4 ? [{ name, ipv4: ipv4.address, downloadBytesPerSec: null, uploadBytesPerSec: null }] : [];
        }),
      },
      gpu: null,
      thermalZones: [],
      battery: null,
      diagnostics: { windowsError: null, nvidiaError: null },
    },
  };
}

function extractJson(stdout) {
  const text = String(stdout || '').replace(/^\uFEFF/, '').trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last < first) throw new Error('PowerShell returned no JSON object');
  return text.slice(first, last + 1);
}

export function parseWindowsSystemOutput(stdout, {
  previousNetwork = new Map(),
  previousDisk = null,
  elapsedSec = null,
} = {}) {
  const raw = JSON.parse(extractJson(stdout));
  const nextNetwork = new Map();

  const interfaces = asArray(raw.networkInterfaces).map((item) => {
    const name = String(item?.name || 'Network');
    const mode = item?.mode === 'cumulative' ? 'cumulative' : 'rate';
    let downloadBytesPerSec = finiteOrNull(item?.download);
    let uploadBytesPerSec = finiteOrNull(item?.upload);

    if (mode === 'cumulative') {
      const current = { download: downloadBytesPerSec, upload: uploadBytesPerSec };
      const previous = previousNetwork.get(name);
      nextNetwork.set(name, current);
      if (previous && elapsedSec > 0) {
        downloadBytesPerSec = current.download >= previous.download
          ? (current.download - previous.download) / elapsedSec
          : null;
        uploadBytesPerSec = current.upload >= previous.upload
          ? (current.upload - previous.upload) / elapsedSec
          : null;
      } else {
        downloadBytesPerSec = null;
        uploadBytesPerSec = null;
      }
    }

    return {
      name,
      mode,
      downloadBytesPerSec,
      uploadBytesPerSec,
      totalBytesPerSec: finiteOrNull(item?.total) ?? (
        Number.isFinite(downloadBytesPerSec) && Number.isFinite(uploadBytesPerSec)
          ? downloadBytesPerSec + uploadBytesPerSec
          : null
      ),
      linkSpeedBits: finiteOrNull(item?.linkSpeedBits),
      packetsReceivedPerSec: finiteOrNull(item?.packetsReceivedPerSec),
      packetsSentPerSec: finiteOrNull(item?.packetsSentPerSec),
    };
  });

  const disks = asArray(raw.disks).map((disk) => {
    const sizeBytes = finiteOrNull(disk?.sizeBytes);
    const freeBytes = finiteOrNull(disk?.freeBytes);
    const usedBytes = sizeBytes !== null && freeBytes !== null ? Math.max(0, sizeBytes - freeBytes) : null;
    return {
      name: String(disk?.name || '?'),
      volumeName: String(disk?.volumeName || ''),
      fileSystem: String(disk?.fileSystem || ''),
      sizeBytes,
      freeBytes,
      usedBytes,
      usage: calculateUsage(usedBytes, sizeBytes),
      provider: raw.provider || 'windows-cim',
    };
  }).filter((disk) => disk.sizeBytes !== null);

  const memoryTotal = finiteOrNull(raw.memory?.totalBytes);
  const memoryAvailable = finiteOrNull(raw.memory?.availableBytes);
  const memoryUsed = memoryTotal !== null && memoryAvailable !== null
    ? Math.max(0, memoryTotal - memoryAvailable)
    : null;

  const allAdapters = asArray(raw.gpu?.adapters).map((adapter) => ({
    name: String(adapter?.name || 'Display adapter'),
    driverVersion: adapter?.driverVersion ? String(adapter.driverVersion) : null,
    memoryTotalBytes: finiteOrNull(adapter?.adapterRamBytes),
    pnpDeviceId: adapter?.pnpDeviceId ? String(adapter.pnpDeviceId) : null,
    usage: null,
    memoryUsedBytes: null,
    memoryUsage: null,
    temperatureC: null,
    powerWatts: null,
    provider: 'windows-cim',
  }));
  const hardwareAdapters = allAdapters.filter((adapter) => (
    !/virtual|remote|oray|todesk|idd|basic display/i.test(adapter.name || '')
  ));
  const adapters = hardwareAdapters.length ? hardwareAdapters : allAdapters;
  const primary = selectPrimaryGpu(adapters);
  const gpuMemoryUsed = finiteOrNull(raw.gpu?.memoryUsedBytes);
  const gpuMemoryTotal = finiteOrNull(raw.gpu?.memoryTotalBytes) ?? primary?.memoryTotalBytes ?? null;
  const gpu = primary ? {
    ...primary,
    usage: clampPercent(raw.gpu?.usage),
    memoryUsedBytes: gpuMemoryUsed,
    memoryTotalBytes: gpuMemoryTotal,
    memoryUsage: calculateUsage(gpuMemoryUsed, gpuMemoryTotal),
    temperatureC: finiteOrNull(raw.gpu?.temperatureC),
    powerWatts: finiteOrNull(raw.gpu?.powerWatts),
    adapters,
    provider: raw.gpu?.provider || 'windows-cim',
  } : null;

  const downloadBytesPerSec = interfaces.reduce((sum, item) => sum + (item.downloadBytesPerSec ?? 0), 0);
  const uploadBytesPerSec = interfaces.reduce((sum, item) => sum + (item.uploadBytesPerSec ?? 0), 0);
  const hasNetworkRates = interfaces.some((item) => Number.isFinite(item.downloadBytesPerSec) || Number.isFinite(item.uploadBytesPerSec));
  const diskMode = raw.diskIo?.mode === 'cumulative' ? 'cumulative' : 'rate';
  const currentDiskCounters = raw.diskIo ? {
    read: finiteOrNull(raw.diskIo.readBytesPerSec),
    write: finiteOrNull(raw.diskIo.writeBytesPerSec),
    transfers: finiteOrNull(raw.diskIo.transfersPerSec),
  } : null;
  let diskReadRate = currentDiskCounters?.read ?? null;
  let diskWriteRate = currentDiskCounters?.write ?? null;
  let diskTransferRate = currentDiskCounters?.transfers ?? null;
  if (diskMode === 'cumulative') {
    if (previousDisk && elapsedSec > 0) {
      diskReadRate = Number.isFinite(currentDiskCounters.read) && Number.isFinite(previousDisk.read) && currentDiskCounters.read >= previousDisk.read
        ? (currentDiskCounters.read - previousDisk.read) / elapsedSec
        : null;
      diskWriteRate = Number.isFinite(currentDiskCounters.write) && Number.isFinite(previousDisk.write) && currentDiskCounters.write >= previousDisk.write
        ? (currentDiskCounters.write - previousDisk.write) / elapsedSec
        : null;
      diskTransferRate = Number.isFinite(currentDiskCounters.transfers) && Number.isFinite(previousDisk.transfers) && currentDiskCounters.transfers >= previousDisk.transfers
        ? (currentDiskCounters.transfers - previousDisk.transfers) / elapsedSec
        : null;
    } else {
      diskReadRate = null;
      diskWriteRate = null;
      diskTransferRate = null;
    }
  }

  return {
    nextNetwork,
    nextDisk: diskMode === 'cumulative' ? currentDiskCounters : null,
    snapshot: {
      providers: [raw.provider || 'windows-cim', ...asArray(raw.sources).map(String)],
      system: {
        osName: raw.system?.osName || null,
        osVersion: raw.system?.osVersion || null,
        manufacturer: raw.system?.manufacturer || null,
        model: raw.system?.model || null,
        processCount: finiteOrNull(raw.system?.processCount),
        threadCount: finiteOrNull(raw.system?.threadCount),
        cpuQueueLength: finiteOrNull(raw.system?.cpuQueueLength),
      },
      cpu: {
        model: raw.cpu?.model || null,
        usage: clampPercent(raw.cpu?.usage),
        physicalCores: finiteOrNull(raw.cpu?.physicalCores),
        logicalCores: finiteOrNull(raw.cpu?.logicalCores),
        currentClockMHz: finiteOrNull(raw.cpu?.currentClockMHz),
        maxClockMHz: finiteOrNull(raw.cpu?.maxClockMHz),
        perCoreUsage: asArray(raw.cpu?.perCoreUsage).map(clampPercent),
      },
      memory: {
        totalBytes: memoryTotal,
        availableBytes: memoryAvailable,
        usedBytes: memoryUsed,
        usage: calculateUsage(memoryUsed, memoryTotal),
        pageFileTotalBytes: finiteOrNull(raw.memory?.pageFileTotalBytes),
        pageFileAvailableBytes: finiteOrNull(raw.memory?.pageFileAvailableBytes),
      },
      disks,
      diskIo: {
        usage: clampPercent(raw.diskIo?.usage),
        readBytesPerSec: diskReadRate,
        writeBytesPerSec: diskWriteRate,
        transfersPerSec: diskTransferRate,
        queueLength: finiteOrNull(raw.diskIo?.queueLength),
        provider: diskMode === 'cumulative' ? 'process-io-delta' : 'performance-counter',
      },
      network: {
        downloadBytesPerSec: hasNetworkRates ? downloadBytesPerSec : null,
        uploadBytesPerSec: hasNetworkRates ? uploadBytesPerSec : null,
        totalBytesPerSec: hasNetworkRates ? downloadBytesPerSec + uploadBytesPerSec : null,
        interfaces,
      },
      gpu,
      thermalZones: asArray(raw.thermalZones).map((zone) => ({
        name: String(zone?.name || 'Thermal zone'),
        temperatureC: finiteOrNull(zone?.temperatureC),
      })).filter((zone) => zone.temperatureC !== null),
      battery: raw.battery ? {
        percent: clampPercent(raw.battery.percent),
        statusCode: finiteOrNull(raw.battery.statusCode),
        estimatedMinutes: finiteOrNull(raw.battery.estimatedMinutes),
      } : null,
    },
  };
}

function mergeObject(portable, enriched) {
  const result = { ...(portable || {}) };
  for (const [key, value] of Object.entries(enriched || {})) {
    if (value !== null && value !== undefined && value !== '' && (!Array.isArray(value) || value.length)) {
      result[key] = value;
    }
  }
  return result;
}

export function mergeSnapshots(
  portable,
  windowsSnapshot = null,
  nvidiaAdapters = null,
  diagnostics = {},
  hardwareSensors = null,
) {
  const snapshot = {
    ...portable,
    timestamp: Date.now(),
    providers: [...new Set([...(portable.providers || []), ...(windowsSnapshot?.providers || [])])],
    system: mergeObject(portable.system, windowsSnapshot?.system),
    cpu: mergeObject(portable.cpu, windowsSnapshot?.cpu),
    memory: mergeObject(portable.memory, windowsSnapshot?.memory),
    disks: windowsSnapshot?.disks?.length ? windowsSnapshot.disks : portable.disks,
    diskIo: mergeObject(portable.diskIo, windowsSnapshot?.diskIo),
    network: windowsSnapshot?.network?.interfaces?.length
      ? mergeObject(portable.network, windowsSnapshot.network)
      : portable.network,
    gpu: windowsSnapshot?.gpu || portable.gpu,
    thermalZones: windowsSnapshot?.thermalZones?.length ? windowsSnapshot.thermalZones : portable.thermalZones,
    battery: windowsSnapshot?.battery ?? portable.battery,
    hardwareSensors,
    diagnostics: { ...portable.diagnostics, ...diagnostics },
  };

  if (Array.isArray(nvidiaAdapters) && nvidiaAdapters.length) {
    const primary = selectPrimaryGpu(nvidiaAdapters);
    snapshot.gpu = { ...primary, adapters: nvidiaAdapters, provider: 'nvidia-smi' };
    snapshot.providers.push('nvidia-smi');
  }

  if (hardwareSensors) {
    snapshot.providers.push(hardwareSensors.provider);
    snapshot.cpu = mergeObject(snapshot.cpu, {
      temperatureC: hardwareSensors.cpu?.temperatureC,
      powerWatts: hardwareSensors.cpu?.powerWatts,
      voltageVolts: hardwareSensors.cpu?.voltageVolts,
      sensorClockMHz: hardwareSensors.cpu?.clockMHz,
    });
    if (snapshot.gpu || hardwareSensors.gpu) {
      snapshot.gpu = mergeObject(snapshot.gpu, {
        temperatureC: hardwareSensors.gpu?.temperatureC,
        hotspotTemperatureC: hardwareSensors.gpu?.hotspotTemperatureC,
        powerWatts: hardwareSensors.gpu?.powerWatts,
        voltageVolts: hardwareSensors.gpu?.voltageVolts,
        fanRpm: hardwareSensors.gpu?.fanRpm,
        fanPercent: hardwareSensors.gpu?.fanPercent,
        clockMHz: hardwareSensors.gpu?.clockMHz,
        memoryClockMHz: hardwareSensors.gpu?.memoryClockMHz,
      });
    }
  }

  snapshot.providers = [...new Set(snapshot.providers)];

  return snapshot;
}

function powershellCandidates() {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  return [
    path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    'powershell.exe',
    'pwsh.exe',
  ];
}

function runPowerShellScript(file, script, { timeoutMs, maxBuffer, counterGroups, spawnImpl = spawn }) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(file, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-',
    ], {
      windowsHide: true,
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TURTLE_MONITOR_COUNTER_GROUPS: counterGroups?.length ? counterGroups.join(',') : 'ALL',
      },
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };

    child.on('error', (error) => finish(error));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > maxBuffer) {
        child.kill();
        finish(new Error('PowerShell output exceeded the buffer limit'));
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code, signal) => {
      if (code === 0) finish(null, stdout);
      else finish(new Error(stderr.trim() || `PowerShell exited with ${code ?? signal}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(script);
  });
}

export async function queryWindowsSystem({ spawnImpl = spawn, timeoutMs = 12000, counterGroups = null } = {}) {
  if (process.platform !== 'win32') return null;
  let lastError = null;

  for (const candidate of powershellCandidates()) {
    try {
      return await runPowerShellScript(candidate, WINDOWS_SNAPSHOT_SCRIPT, {
        timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        counterGroups,
        spawnImpl,
      });
    } catch (error) {
      lastError = error;
      if (!/ENOENT|not recognized|not found/i.test(error.message)) break;
    }
  }
  throw lastError || new Error('No PowerShell runtime found');
}

export class SystemMonitor {
  constructor(win, intervalMs = 2000, dependencies = {}) {
    this.win = win;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.lastData = null;
    this.lastPortable = null;
    this.windowsSnapshot = null;
    this.nvidiaAdapters = null;
    this.hardwareSensors = null;
    this.diagnostics = { windowsError: null, nvidiaError: null, hardwareSensorError: null };
    this.previousCpuTimes = null;
    this.previousNetwork = new Map();
    this.previousDisk = null;
    this.previousWindowsAt = null;
    this.windowsCounterGroups = null;
    this.windowsInFlight = false;
    this.nvidiaInFlight = false;
    this.hardwareInFlight = false;
    this.pollCount = 0;
    this.nvidiaAvailable = null;
    this.hardwareAvailable = null;
    this.queryWindows = dependencies.queryWindows || queryWindowsSystem;
    this.queryNvidia = dependencies.queryNvidia || queryNvidiaGpus;
    this.hardwareClient = dependencies.hardwareClient || new HardwareSensorClient(dependencies.sensorHostPath);
  }

  start() {
    this._tick();
    this.timer = setInterval(() => this._tick(), this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.hardwareClient?.stop();
  }

  requestSnapshot() {
    if (this.lastData) this._send(this.lastData);
    this._tick();
  }

  _tick() {
    this.pollCount += 1;

    const portableResult = collectPortableSnapshot({ previousCpuTimes: this.previousCpuTimes });
    this.previousCpuTimes = portableResult.cpuTimes;
    this.lastPortable = portableResult.snapshot;
    this._publishMerged();

    if (this.pollCount % 150 === 0) this.windowsCounterGroups = null;
    if (!this.windowsInFlight) this._pollWindows();
    if (!this.nvidiaInFlight && (this.nvidiaAvailable !== false || this.pollCount % 150 === 0)) {
      this._pollNvidia();
    }
    if (!this.hardwareInFlight && (this.hardwareAvailable !== false || this.pollCount % 150 === 0)) {
      this._pollHardware();
    }
  }

  async _pollWindows() {
    this.windowsInFlight = true;
    try {
      const output = await this.queryWindows({ counterGroups: this.windowsCounterGroups });
      if (output) {
        const now = Date.now();
        const elapsedSec = this.previousWindowsAt ? (now - this.previousWindowsAt) / 1000 : null;
        const parsed = parseWindowsSystemOutput(output, {
          previousNetwork: this.previousNetwork,
          previousDisk: this.previousDisk,
          elapsedSec,
        });
        this.windowsSnapshot = parsed.snapshot;
        const counterSources = new Set(this.windowsSnapshot.providers || []);
        this.windowsCounterGroups = [
          ['CPU', 'Get-Counter:CPU'],
          ['System', 'Get-Counter:System'],
          ['Disk', 'Get-Counter:Disk'],
          ['Network', 'Get-Counter:Network'],
          ['GPU', 'Get-Counter:GPU'],
        ].filter(([, source]) => counterSources.has(source)).map(([group]) => group);
        if (!this.windowsCounterGroups.length) this.windowsCounterGroups = ['None'];
        if (parsed.nextNetwork.size) this.previousNetwork = parsed.nextNetwork;
        if (parsed.nextDisk) this.previousDisk = parsed.nextDisk;
        this.previousWindowsAt = now;
        this.diagnostics.windowsError = null;
      }
    } catch (error) {
      this.diagnostics.windowsError = error.message;
    } finally {
      this.windowsInFlight = false;
      this._publishMerged();
    }
  }

  async _pollNvidia() {
    this.nvidiaInFlight = true;
    try {
      const adapters = await this.queryNvidia();
      if (Array.isArray(adapters) && adapters.length) {
        this.nvidiaAdapters = adapters;
        this.nvidiaAvailable = true;
        this.diagnostics.nvidiaError = null;
      }
    } catch (error) {
      this.nvidiaAvailable = false;
      this.diagnostics.nvidiaError = error.message;
    } finally {
      this.nvidiaInFlight = false;
      this._publishMerged();
    }
  }

  async _pollHardware() {
    this.hardwareInFlight = true;
    try {
      const snapshot = await this.hardwareClient.query();
      if (snapshot) {
        this.hardwareSensors = snapshot;
        this.hardwareAvailable = true;
        this.diagnostics.hardwareSensorError = null;
      }
    } catch (error) {
      this.hardwareAvailable = false;
      this.diagnostics.hardwareSensorError = error.message;
    } finally {
      this.hardwareInFlight = false;
      this._publishMerged();
    }
  }

  _publishMerged() {
    if (!this.lastPortable) return;
    this.lastData = mergeSnapshots(
      this.lastPortable,
      this.windowsSnapshot,
      this.nvidiaAdapters,
      this.diagnostics,
      this.hardwareSensors,
    );
    this._send(this.lastData);
  }

  _send(data) {
    if (this.win && !this.win.isDestroyed() && !this.win.webContents.isDestroyed()) {
      if (this.win.webContents.isLoadingMainFrame?.()) return;
      this.win.webContents.send('system-data', data);
    }
  }
}
