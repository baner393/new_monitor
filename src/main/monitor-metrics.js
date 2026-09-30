function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function present(value) {
  return value !== null && value !== undefined && value !== '';
}

function sensorUnit(type) {
  return {
    Temperature: '°C',
    Fan: 'RPM',
    Voltage: 'V',
    Current: 'A',
    Power: 'W',
    Clock: 'MHz',
    Load: '%',
    Control: '%',
    Level: '%',
    Data: 'GB',
    SmallData: 'MB',
    Throughput: 'B/s',
    Energy: 'mWh',
    Frequency: 'Hz',
  }[type] || '';
}

function sensorKind(type) {
  return {
    Temperature: 'temperature',
    Fan: 'fan',
    Voltage: 'voltage',
    Current: 'current',
    Power: 'power',
    Clock: 'clock',
    Load: 'percent',
    Control: 'percent',
    Level: 'percent',
    Data: 'capacity-gb',
    SmallData: 'capacity-mb',
    Throughput: 'bytes-per-second',
    Energy: 'energy',
    Frequency: 'frequency',
  }[type] || 'number';
}

function cardForHardware(type, sensorType) {
  if (/^Cpu$/i.test(type)) return 'cpu';
  if (/^Gpu/i.test(type)) return 'gpu';
  if (/^Memory$/i.test(type)) return 'memory';
  if (/^Storage$/i.test(type)) return 'storage';
  if (/^Network$/i.test(type)) return 'network';
  if (/^Battery$/i.test(type)) return 'battery';
  if (['Fan', 'Control'].includes(sensorType)) return 'cooling';
  if (['Power', 'Voltage', 'Current', 'Energy'].includes(sensorType)) return 'power';
  return 'system';
}

function compactKey(value) {
  return String(value || 'unknown').trim().toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function providerState(id, label, success, error, extra = {}) {
  const state = success && error ? 'stale' : success ? 'available' : error ? 'failed' : 'not_detected';
  return {
    id,
    label,
    state,
    error: error || null,
    ...extra,
  };
}

export function buildProviderStates(snapshot = {}) {
  const providers = new Set(snapshot.providers || []);
  const diagnostics = snapshot.diagnostics || {};
  const gpuNames = [snapshot.gpu?.name, ...(snapshot.gpu?.adapters || []).map((gpu) => gpu?.name)]
    .filter(Boolean).join(' ');
  const nvidiaRelevant = /nvidia/i.test(gpuNames) || providers.has('nvidia-smi');
  const result = [
    providerState('node-os', '系统基础信息', providers.has('node-os'), null),
    providerState('windows-cim', 'Windows 系统与性能统计', providers.has('windows-cim'), diagnostics.windowsError, {
      sampledAt: snapshot.providerDetails?.windows?.sampledAt || null,
      issues: snapshot.providerDetails?.windows?.probeErrors || [],
    }),
    providerState(
      'librehardwaremonitor',
      '硬件传感器',
      providers.has('librehardwaremonitor'),
      diagnostics.hardwareSensorError,
      {
        elevated: Boolean(snapshot.hardwareSensors?.access?.elevated),
        sampledAt: snapshot.providerDetails?.hardware?.sampledAt || null,
      },
    ),
  ];
  if (nvidiaRelevant) {
    result.push(providerState('nvidia-smi', 'NVIDIA 显卡工具', providers.has('nvidia-smi'), diagnostics.nvidiaError, {
      sampledAt: snapshot.providerDetails?.nvidia?.sampledAt || null,
    }));
  }
  return result;
}

function providerFailure(snapshot, providerId) {
  const status = (snapshot.providerStates || buildProviderStates(snapshot)).find((item) => item.id === providerId);
  return ['failed', 'stale'].includes(status?.state) ? status : null;
}

function missingReason(snapshot, {
  deviceExists = true,
  providerId = null,
  probeIds = [],
  sensorType = null,
  hardwarePattern = null,
  firstSample = false,
  reasonCode = null,
  reason = null,
  evidence = null,
} = {}) {
  if (!deviceExists) {
    return { reasonCode: 'device_absent', reason: '本机没有检测到对应设备', evidence: '设备枚举结果中不存在该类硬件' };
  }
  if (firstSample) {
    return { reasonCode: 'first_sample_pending', reason: '第一次采样还不能计算速度，下一次刷新后会自动出现', evidence: '当前来源提供的是累计计数' };
  }
  if (reason) {
    return { reasonCode: reasonCode || 'interface_not_exposed', reason, evidence };
  }
  const hardware = snapshot.hardwareSensors || {};
  const explicitPermission = hardware.issues?.find((issue) => issue.code === 'permission_required');
  if (explicitPermission && (!hardwarePattern || hardware.hardware?.some((item) => hardwarePattern.test(item.hardwareType || '')))) {
    return {
      reasonCode: 'permission_required',
      reason: '硬件接口明确拒绝了当前权限，可尝试管理员模式',
      evidence: explicitPermission.message,
      action: 'request_elevation',
    };
  }
  const probeFailure = (snapshot.providerDetails?.windows?.probeErrors || [])
    .find((issue) => probeIds.includes(issue.probe));
  if (probeFailure) {
    const permissionRequired = probeFailure.code === 'permission_required';
    return {
      reasonCode: permissionRequired ? 'permission_required' : 'provider_query_failed',
      reason: permissionRequired ? 'Windows 接口明确拒绝了当前权限，可尝试管理员模式' : '负责这项数据的 Windows 查询失败',
      evidence: probeFailure.message,
      ...(permissionRequired ? { action: 'request_elevation' } : {}),
    };
  }
  const failed = providerId ? providerFailure(snapshot, providerId) : null;
  if (failed) {
    return {
      reasonCode: 'provider_failed',
      reason: `${failed.label}本次读取失败`,
      evidence: failed.error,
    };
  }
  if (sensorType && hardwarePattern) {
    const emptySensor = (hardware.sensors || []).find((sensor) => (
      hardwarePattern.test(sensor.hardwareType || '')
      && sensor.sensorType === sensorType
      && (sensor.status === 'unavailable' || finite(sensor.value) === null)
    ));
    if (emptySensor) {
      return {
        reasonCode: emptySensor.reasonCode || 'sensor_returned_no_value',
        reason: emptySensor.reason || '传感器已被枚举，但本次没有返回数值',
        evidence: `${emptySensor.hardwareName} · ${emptySensor.name}`,
      };
    }
  }
  return {
    reasonCode: 'interface_not_exposed',
    reason: '设备存在，但当前驱动或固件接口没有公开这项数据',
    evidence: providerId ? `已检查 ${providerId}` : '现有采集来源均未返回该指标',
  };
}

export function buildMonitorMetricInventory(snapshot = {}) {
  const metrics = [];
  const availability = [];
  const seenMetrics = new Set();
  const seenMissing = new Set();
  const sampledAt = finite(snapshot.timestamp) || Date.now();
  const fieldSources = snapshot.fieldSources || {};

  const addMetric = (metric) => {
    if (!metric?.key || seenMetrics.has(metric.key)) return;
    const numeric = finite(metric.value);
    if (numeric === null && !present(metric.value)) return;
    seenMetrics.add(metric.key);
    metrics.push({ sampledAt, ...metric, value: numeric ?? metric.value });
  };
  const addNumber = (key, cardId, device, label, value, unit, kind, provider) => {
    if (finite(value) === null) return;
    addMetric({ key, cardId, device, label, value, unit, kind, provider });
  };
  const addMissing = (key, cardId, device, label, options) => {
    if (seenMetrics.has(key) || seenMissing.has(key)) return;
    seenMissing.add(key);
    availability.push({ key, cardId, device, label, sensorType: options?.sensorType || null, ...missingReason(snapshot, options) });
  };

  const system = snapshot.system || {};
  addMetric({ key: 'system:os', cardId: 'system', device: '系统', label: '操作系统', value: [system.osName || system.platform, system.osVersion || system.release].filter(Boolean).join(' '), unit: '', kind: 'text', provider: fieldSources.system?.osName || 'node-os' });
  addNumber('system:uptime', 'system', '系统', '运行时间', system.uptimeSec, 's', 'duration', 'node-os');
  addNumber('system:processes', 'system', '系统', '进程数', system.processCount, '', 'integer', fieldSources.system?.processCount || 'windows-cim');
  addNumber('system:threads', 'system', '系统', '线程数', system.threadCount, '', 'integer', fieldSources.system?.threadCount || 'windows-cim');
  addNumber('system:cpu-queue', 'system', '系统', '处理器队列', system.cpuQueueLength, '', 'number', fieldSources.system?.cpuQueueLength || 'windows-cim');

  const cpu = snapshot.cpu || {};
  addMetric({ key: 'cpu:model', cardId: 'cpu', device: 'CPU', label: '型号', value: cpu.model, unit: '', kind: 'text', provider: fieldSources.cpu?.model || 'node-os' });
  addNumber('cpu:usage', 'cpu', 'CPU', '总占用', cpu.usage, '%', 'percent', fieldSources.cpu?.usage || 'node-os');
  addNumber('cpu:clock-current', 'cpu', 'CPU', '当前频率', cpu.currentClockMHz, 'MHz', 'clock', fieldSources.cpu?.currentClockMHz || 'node-os');
  addNumber('cpu:clock-max', 'cpu', 'CPU', '最高频率', cpu.maxClockMHz, 'MHz', 'clock', fieldSources.cpu?.maxClockMHz || 'node-os');
  addNumber('cpu:physical-cores', 'cpu', 'CPU', '物理核心', cpu.physicalCores, '', 'integer', fieldSources.cpu?.physicalCores || 'windows-cim');
  addNumber('cpu:logical-cores', 'cpu', 'CPU', '逻辑处理器', cpu.logicalCores, '', 'integer', fieldSources.cpu?.logicalCores || 'node-os');
  addNumber('cpu:temperature', 'cpu', 'CPU', '封装温度', cpu.temperatureC, '°C', 'temperature', fieldSources.cpu?.temperatureC || 'librehardwaremonitor');
  addNumber('cpu:power', 'cpu', 'CPU', '封装功耗', cpu.powerWatts, 'W', 'power', fieldSources.cpu?.powerWatts || 'librehardwaremonitor');
  addNumber('cpu:voltage', 'cpu', 'CPU', '核心电压', cpu.voltageVolts, 'V', 'voltage', fieldSources.cpu?.voltageVolts || 'librehardwaremonitor');
  const detailedCpuLoadSensors = (snapshot.hardwareSensors?.sensors || []).filter((sensor) => (
    /^Cpu$/i.test(sensor.hardwareType || '') && sensor.sensorType === 'Load'
    && /core #\d+|thread #\d+/i.test(sensor.name || '') && finite(sensor.value) !== null
  ));
  if (!detailedCpuLoadSensors.length) {
    (cpu.perCoreUsage || []).forEach((value, index) => addNumber(`cpu:core:${index}:usage`, 'cpu', `CPU 核心 ${index + 1}`, '占用', value, '%', 'percent', fieldSources.cpu?.perCoreUsage || 'node-os'));
  }

  const memory = snapshot.memory || {};
  addNumber('memory:total', 'memory', '物理内存', '总容量', memory.totalBytes, 'B', 'bytes', fieldSources.memory?.totalBytes || 'node-os');
  addNumber('memory:used', 'memory', '物理内存', '已使用', memory.usedBytes, 'B', 'bytes', fieldSources.memory?.usedBytes || 'node-os');
  addNumber('memory:available', 'memory', '物理内存', '可用', memory.availableBytes, 'B', 'bytes', fieldSources.memory?.availableBytes || 'node-os');
  addNumber('memory:usage', 'memory', '物理内存', '使用率', memory.usage, '%', 'percent', fieldSources.memory?.usage || 'node-os');
  addNumber('memory:page-total', 'memory', '页面文件', '总容量', memory.pageFileTotalBytes, 'B', 'bytes', fieldSources.memory?.pageFileTotalBytes || 'windows-cim');
  addNumber('memory:page-available', 'memory', '页面文件', '可用', memory.pageFileAvailableBytes, 'B', 'bytes', fieldSources.memory?.pageFileAvailableBytes || 'windows-cim');
  if (finite(memory.pageFileTotalBytes) !== null && finite(memory.pageFileAvailableBytes) !== null) {
    addNumber('memory:page-used', 'memory', '页面文件', '已使用', memory.pageFileTotalBytes - memory.pageFileAvailableBytes, 'B', 'bytes', 'windows-cim');
  }

  for (const disk of snapshot.disks || []) {
    const id = compactKey(disk.name);
    const device = [disk.name, disk.volumeName].filter(Boolean).join(' ');
    addNumber(`storage:${id}:total`, 'storage', device, '总容量', disk.sizeBytes, 'B', 'bytes', disk.provider || 'windows-cim');
    addNumber(`storage:${id}:used`, 'storage', device, '已使用', disk.usedBytes, 'B', 'bytes', disk.provider || 'windows-cim');
    addNumber(`storage:${id}:free`, 'storage', device, '可用', disk.freeBytes, 'B', 'bytes', disk.provider || 'windows-cim');
    addNumber(`storage:${id}:usage`, 'storage', device, '容量使用率', disk.usage, '%', 'percent', disk.provider || 'windows-cim');
  }
  const hardwareStorageNames = (snapshot.hardwareSensors?.storage || []).map((item) => compactKey(item.name));
  for (const disk of snapshot.physicalDisks || []) {
    const id = compactKey(disk.name);
    const device = disk.name || '物理磁盘';
    addMetric({ key: `storage:physical:${id}:media`, cardId: 'storage', device, label: '介质与总线', value: [disk.mediaType, disk.busType].filter(Boolean).join(' · '), unit: '', kind: 'text', provider: 'windows-storage' });
    addMetric({ key: `storage:physical:${id}:health`, cardId: 'storage', device, label: '健康状态', value: disk.healthStatus, unit: '', kind: 'text', provider: 'windows-storage' });
    addMetric({ key: `storage:physical:${id}:operation`, cardId: 'storage', device, label: '运行状态', value: disk.operationalStatus, unit: '', kind: 'text', provider: 'windows-storage' });
    addNumber(`storage:physical:${id}:size`, 'storage', device, '物理容量', disk.sizeBytes, 'B', 'bytes', 'windows-storage');
    if (!hardwareStorageNames.some((name) => name && (name.includes(id) || id.includes(name)))) {
      addNumber(`storage:physical:${id}:temperature`, 'storage', device, '温度', disk.temperatureC, '°C', 'temperature', 'windows-storage');
    }
    addNumber(`storage:physical:${id}:temperature-max`, 'storage', device, '记录最高温度', disk.temperatureMaxC, '°C', 'temperature', 'windows-storage');
    addNumber(`storage:physical:${id}:read-errors`, 'storage', device, '累计读取错误', disk.readErrorsTotal, '', 'integer', 'windows-storage');
    addNumber(`storage:physical:${id}:write-errors`, 'storage', device, '累计写入错误', disk.writeErrorsTotal, '', 'integer', 'windows-storage');
    addNumber(`storage:physical:${id}:wear`, 'storage', device, '磨损程度', disk.wearPercent, '%', 'percent', 'windows-storage');
    addNumber(`storage:physical:${id}:hours`, 'storage', device, '通电时间', disk.powerOnHours, '小时', 'number', 'windows-storage');
  }
  addNumber('storage:activity', 'storage', '全部磁盘', '忙碌率', snapshot.diskIo?.usage, '%', 'percent', snapshot.diskIo?.fieldSources?.usage || snapshot.diskIo?.provider || 'windows-cim');
  addNumber('storage:read', 'storage', '全部磁盘', '读取速度', snapshot.diskIo?.readBytesPerSec, 'B/s', 'bytes-per-second', snapshot.diskIo?.fieldSources?.readBytesPerSec || snapshot.diskIo?.provider || 'windows-cim');
  addNumber('storage:write', 'storage', '全部磁盘', '写入速度', snapshot.diskIo?.writeBytesPerSec, 'B/s', 'bytes-per-second', snapshot.diskIo?.fieldSources?.writeBytesPerSec || snapshot.diskIo?.provider || 'windows-cim');
  addNumber('storage:transfers', 'storage', '全部磁盘', '每秒操作', snapshot.diskIo?.transfersPerSec, '次/秒', 'number', snapshot.diskIo?.provider || 'windows-cim');
  addNumber('storage:queue', 'storage', '全部磁盘', '队列长度', snapshot.diskIo?.queueLength, '', 'number', snapshot.diskIo?.provider || 'windows-cim');

  const network = snapshot.network || {};
  addNumber('network:download', 'network', '全部网卡', '下载速度', network.downloadBytesPerSec, 'B/s', 'bytes-per-second', network.fieldSources?.downloadBytesPerSec || 'windows-cim');
  addNumber('network:upload', 'network', '全部网卡', '上传速度', network.uploadBytesPerSec, 'B/s', 'bytes-per-second', network.fieldSources?.uploadBytesPerSec || 'windows-cim');
  for (const item of network.interfaces || []) {
    const id = compactKey(item.name);
    const provider = item.provider || 'windows-cim';
    addNumber(`network:${id}:download`, 'network', item.name, '下载速度', item.downloadBytesPerSec, 'B/s', 'bytes-per-second', provider);
    addNumber(`network:${id}:upload`, 'network', item.name, '上传速度', item.uploadBytesPerSec, 'B/s', 'bytes-per-second', provider);
    addNumber(`network:${id}:link`, 'network', item.name, '连接速度', item.linkSpeedBits, 'bit/s', 'bits-per-second', provider);
    addNumber(`network:${id}:packets-in`, 'network', item.name, '接收数据包', item.packetsReceivedPerSec, '包/秒', 'number', provider);
    addNumber(`network:${id}:packets-out`, 'network', item.name, '发送数据包', item.packetsSentPerSec, '包/秒', 'number', provider);
  }

  const gpu = snapshot.gpu;
  if (gpu) {
    const gpuSources = gpu.fieldSources || {};
    addNumber('gpu:usage', 'gpu', gpu.name || 'GPU', '核心占用', gpu.usage, '%', 'percent', gpuSources.usage || gpu.provider || 'windows-cim');
    addNumber('gpu:memory-used', 'gpu', gpu.name || 'GPU', '显存已使用', gpu.memoryUsedBytes, 'B', 'bytes', gpu.provider || 'windows-cim');
    addNumber('gpu:memory-total', 'gpu', gpu.name || 'GPU', '显存总容量', gpu.memoryTotalBytes, 'B', 'bytes', gpu.provider || 'windows-cim');
    addNumber('gpu:temperature', 'gpu', gpu.name || 'GPU', '核心温度', gpu.temperatureC, '°C', 'temperature', gpuSources.temperatureC || gpu.provider || 'librehardwaremonitor');
    addNumber('gpu:power', 'gpu', gpu.name || 'GPU', '功耗', gpu.powerWatts, 'W', 'power', gpuSources.powerWatts || gpu.provider || 'librehardwaremonitor');
    addNumber('gpu:fan', 'gpu', gpu.name || 'GPU', '风扇转速', gpu.fanRpm, 'RPM', 'fan', gpuSources.fanRpm || gpu.provider || 'librehardwaremonitor');
    addNumber('gpu:fan-percent', 'gpu', gpu.name || 'GPU', '风扇占比', gpu.fanPercent, '%', 'percent', gpuSources.fanPercent || gpu.provider || 'nvidia-smi');
    addNumber('gpu:clock', 'gpu', gpu.name || 'GPU', '核心频率', gpu.clockMHz, 'MHz', 'clock', gpuSources.clockMHz || gpu.provider || 'librehardwaremonitor');
    addNumber('gpu:memory-clock', 'gpu', gpu.name || 'GPU', '显存频率', gpu.memoryClockMHz, 'MHz', 'clock', gpuSources.memoryClockMHz || gpu.provider || 'librehardwaremonitor');
    addNumber('gpu:encoder', 'gpu', gpu.name || 'GPU', '编码器占用', gpu.encoderUsage, '%', 'percent', gpu.provider || 'nvidia-smi');
    addNumber('gpu:decoder', 'gpu', gpu.name || 'GPU', '解码器占用', gpu.decoderUsage, '%', 'percent', gpu.provider || 'nvidia-smi');
    addNumber('gpu:power-limit', 'gpu', gpu.name || 'GPU', '功耗上限', gpu.powerLimitWatts, 'W', 'power', gpu.provider || 'nvidia-smi');
    addMetric({ key: 'gpu:performance-state', cardId: 'gpu', device: gpu.name || 'GPU', label: '性能状态', value: gpu.performanceState, unit: '', kind: 'text', provider: gpu.provider || 'nvidia-smi' });
    const adapters = gpu.adapters?.length ? gpu.adapters : [gpu];
    adapters.forEach((adapter, index) => {
      if (adapters.length === 1 || adapter === gpu || (adapter.name && adapter.name === gpu.name)) return;
      const id = compactKey(adapter.name || `gpu-${index}`);
      const device = adapter.name || `GPU ${index + 1}`;
      addNumber(`gpu:${id}:usage`, 'gpu', device, '核心占用', adapter.usage, '%', 'percent', adapter.provider || gpu.provider || 'windows-cim');
      addNumber(`gpu:${id}:memory-used`, 'gpu', device, '显存已使用', adapter.memoryUsedBytes, 'B', 'bytes', adapter.provider || gpu.provider || 'windows-cim');
      addNumber(`gpu:${id}:memory-total`, 'gpu', device, '显存总容量', adapter.memoryTotalBytes, 'B', 'bytes', adapter.provider || gpu.provider || 'windows-cim');
      addNumber(`gpu:${id}:memory-usage`, 'gpu', device, '显存使用率', adapter.memoryUsage, '%', 'percent', adapter.provider || gpu.provider || 'windows-cim');
      addNumber(`gpu:${id}:temperature`, 'gpu', device, '核心温度', adapter.temperatureC, '°C', 'temperature', adapter.provider || gpu.provider || 'windows-cim');
      addNumber(`gpu:${id}:power`, 'gpu', device, '功耗', adapter.powerWatts, 'W', 'power', adapter.provider || gpu.provider || 'windows-cim');
      addNumber(`gpu:${id}:fan`, 'gpu', device, '风扇转速', adapter.fanRpm, 'RPM', 'fan', adapter.provider || gpu.provider || 'windows-cim');
      addNumber(`gpu:${id}:fan-percent`, 'gpu', device, '风扇占比', adapter.fanPercent, '%', 'percent', adapter.provider || gpu.provider || 'windows-cim');
      addNumber(`gpu:${id}:clock`, 'gpu', device, '核心频率', adapter.clockMHz, 'MHz', 'clock', adapter.provider || gpu.provider || 'windows-cim');
      addNumber(`gpu:${id}:memory-clock`, 'gpu', device, '显存频率', adapter.memoryClockMHz, 'MHz', 'clock', adapter.provider || gpu.provider || 'windows-cim');
      addNumber(`gpu:${id}:encoder`, 'gpu', device, '编码器占用', adapter.encoderUsage, '%', 'percent', adapter.provider || gpu.provider || 'windows-cim');
      addNumber(`gpu:${id}:decoder`, 'gpu', device, '解码器占用', adapter.decoderUsage, '%', 'percent', adapter.provider || gpu.provider || 'windows-cim');
      addNumber(`gpu:${id}:power-limit`, 'gpu', device, '功耗上限', adapter.powerLimitWatts, 'W', 'power', adapter.provider || gpu.provider || 'windows-cim');
    });
  }

  for (const zone of snapshot.thermalZones || []) {
    addNumber(`system:thermal:${compactKey(zone.name)}`, 'system', zone.name, '温度', zone.temperatureC, '°C', 'temperature', 'windows-cim');
  }

  const hottestStorage = [...(snapshot.hardwareSensors?.storage || [])]
    .filter((item) => finite(item.temperatureC) !== null)
    .sort((left, right) => finite(right.temperatureC) - finite(left.temperatureC))[0];
  addNumber('storage:temperature', 'storage', hottestStorage?.name || '物理磁盘', '最高温度', hottestStorage?.temperatureC, '°C', 'temperature', 'librehardwaremonitor');

  if (snapshot.battery) {
    addNumber('battery:percent', 'battery', '电池', '剩余电量', snapshot.battery.percent, '%', 'percent', 'windows-cim');
    addNumber('battery:estimated-time', 'battery', '电池', '预计可用时间', snapshot.battery.estimatedMinutes, '分钟', 'duration-minutes', 'windows-cim');
    addNumber('battery:status', 'battery', '电池', '状态代码', snapshot.battery.statusCode, '', 'integer', 'windows-cim');
    addNumber('battery:design-capacity', 'battery', '电池', '设计容量', snapshot.battery.designCapacityMWh, 'mWh', 'energy', 'windows-cim');
    addNumber('battery:full-capacity', 'battery', '电池', '当前满充容量', snapshot.battery.fullChargeCapacityMWh, 'mWh', 'energy', 'windows-cim');
    addNumber('battery:remaining-capacity', 'battery', '电池', '当前剩余容量', snapshot.battery.remainingCapacityMWh, 'mWh', 'energy', 'windows-cim');
    addNumber('battery:voltage', 'battery', '电池', '电压', snapshot.battery.voltageMv, 'mV', 'number', 'windows-cim');
    addNumber('battery:charge-rate', 'battery', '电池', '充电功率', snapshot.battery.chargeRateMw, 'mW', 'power-mw', 'windows-cim');
    addNumber('battery:discharge-rate', 'battery', '电池', '放电功率', snapshot.battery.dischargeRateMw, 'mW', 'power-mw', 'windows-cim');
    addNumber('battery:cycles', 'battery', '电池', '循环次数', snapshot.battery.cycleCount, '', 'integer', 'windows-cim');
    if (finite(snapshot.battery.fullChargeCapacityMWh) !== null && finite(snapshot.battery.designCapacityMWh) > 0) {
      addNumber('battery:health', 'battery', '电池', '健康度', 100 * snapshot.battery.fullChargeCapacityMWh / snapshot.battery.designCapacityMWh, '%', 'percent', 'windows-cim');
    }
  }

  for (const sensor of snapshot.hardwareSensors?.sensors || []) {
    const primaryGpuSensor = !/^Gpu/i.test(sensor.hardwareType || '')
      || (gpu?.hardwareIdentifier && sensor.hardwareIdentifier === gpu.hardwareIdentifier)
      || (!gpu?.hardwareIdentifier && (snapshot.hardwareSensors?.gpus || []).length <= 1);
    let key = `sensor:${compactKey(sensor.identifier || `${sensor.hardwareIdentifier}-${sensor.sensorType}-${sensor.name}-${sensor.index}`)}`;
    if (/^Cpu$/i.test(sensor.hardwareType || '') && sensor.sensorType === 'Temperature' && /package|tdie|tctl|core average/i.test(sensor.name || '')) key = 'cpu:temperature';
    if (/^Cpu$/i.test(sensor.hardwareType || '') && sensor.sensorType === 'Power' && /package|total/i.test(sensor.name || '')) key = 'cpu:power';
    if (primaryGpuSensor && /^Gpu/i.test(sensor.hardwareType || '') && sensor.sensorType === 'Temperature' && /gpu core|temperature/i.test(sensor.name || '')) key = 'gpu:temperature';
    if (primaryGpuSensor && /^Gpu/i.test(sensor.hardwareType || '') && sensor.sensorType === 'Power' && /gpu package|total/i.test(sensor.name || '')) key = 'gpu:power';
    if (primaryGpuSensor && /^Gpu/i.test(sensor.hardwareType || '') && sensor.sensorType === 'Load' && /gpu core|gpu total|^3d$/i.test(sensor.name || '')) key = 'gpu:usage';
    const cardId = cardForHardware(sensor.hardwareType, sensor.sensorType);
    const duplicatesSummary = sensor.status !== 'unavailable' && (
      (/^Cpu$/i.test(sensor.hardwareType || '') && sensor.sensorType === 'Temperature'
        && /package|tdie|tctl|core average/i.test(sensor.name || '') && finite(sensor.value) === finite(cpu.temperatureC))
      || (/^Cpu$/i.test(sensor.hardwareType || '') && sensor.sensorType === 'Power'
        && /package|total/i.test(sensor.name || '') && finite(sensor.value) === finite(cpu.powerWatts))
      || (/^Cpu$/i.test(sensor.hardwareType || '') && sensor.sensorType === 'Load'
        && /cpu total/i.test(sensor.name || '') && finite(sensor.value) === finite(cpu.usage))
      || (/^Gpu/i.test(sensor.hardwareType || '') && sensor.sensorType === 'Temperature'
        && primaryGpuSensor && /gpu core|temperature/i.test(sensor.name || '') && finite(sensor.value) === finite(gpu?.temperatureC))
      || (/^Gpu/i.test(sensor.hardwareType || '') && sensor.sensorType === 'Power'
        && primaryGpuSensor && /gpu package|total/i.test(sensor.name || '') && finite(sensor.value) === finite(gpu?.powerWatts))
      || (/^Gpu/i.test(sensor.hardwareType || '') && sensor.sensorType === 'Load'
        && primaryGpuSensor && /gpu core|gpu total|^3d$/i.test(sensor.name || '') && finite(sensor.value) === finite(gpu?.usage))
    );
    if (duplicatesSummary) continue;
    if (sensor.status !== 'unavailable' && finite(sensor.value) !== null) {
      addMetric({
        key,
        cardId,
        device: sensor.hardwareName,
        label: sensor.name,
        value: sensor.value,
        unit: sensorUnit(sensor.sensorType),
        kind: sensorKind(sensor.sensorType),
        provider: sensor.provider || 'librehardwaremonitor',
        sensorType: sensor.sensorType,
        sensorIdentifier: sensor.identifier,
        hardwareIdentifier: sensor.hardwareIdentifier,
      });
    } else {
      addMissing(key, cardId, sensor.hardwareName, sensor.name, {
        sensorType: sensor.sensorType,
        hardwarePattern: new RegExp(`^${String(sensor.hardwareType || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        reasonCode: sensor.reasonCode,
        reason: sensor.reason,
        evidence: `${sensor.hardwareName} · ${sensor.name} · 原始值 ${sensor.value ?? '空'}`,
      });
    }
  }

  const hasGpu = Boolean(snapshot.gpu || snapshot.hardwareSensors?.hardware?.some((item) => /^Gpu/i.test(item.hardwareType || '')));
  const hasStorage = Boolean(snapshot.disks?.length || snapshot.hardwareSensors?.hardware?.some((item) => /^Storage$/i.test(item.hardwareType || '')));
  const hasNetwork = Boolean(snapshot.network?.interfaces?.length || snapshot.hardwareSensors?.hardware?.some((item) => /^Network$/i.test(item.hardwareType || '')));
  const cumulativeNetworkWaiting = (snapshot.network?.interfaces || []).some((item) => item.mode === 'cumulative')
    && finite(snapshot.network?.downloadBytesPerSec) === null;
  const cumulativeDiskWaiting = snapshot.diskIo?.provider === 'process-io-delta'
    && finite(snapshot.diskIo?.readBytesPerSec) === null;

  addMissing('system:os', 'system', '系统', '操作系统', { providerId: 'windows-cim', probeIds: ['operating-system-cim'] });
  addMissing('system:processes', 'system', '系统', '进程数', { providerId: 'windows-cim', probeIds: ['system-counter', 'process-list', 'operating-system-cim'] });
  addMissing('system:threads', 'system', '系统', '线程数', { providerId: 'windows-cim', probeIds: ['system-counter', 'process-list'] });
  addMissing('system:cpu-queue', 'system', '系统', '处理器队列', { providerId: 'windows-cim', probeIds: ['system-counter'] });
  addMissing('cpu:model', 'cpu', 'CPU', '型号', { providerId: 'node-os', probeIds: ['cpu-cim'] });
  addMissing('cpu:usage', 'cpu', 'CPU', '总占用', { providerId: 'windows-cim', probeIds: ['cpu-counter', 'cpu-cim'] });
  addMissing('cpu:clock-current', 'cpu', 'CPU', '当前频率', { providerId: 'windows-cim', probeIds: ['cpu-cim'] });
  addMissing('cpu:physical-cores', 'cpu', 'CPU', '物理核心', { providerId: 'windows-cim', probeIds: ['cpu-cim'] });
  addMissing('cpu:temperature', 'cpu', 'CPU', '温度', { providerId: 'librehardwaremonitor', sensorType: 'Temperature', hardwarePattern: /^Cpu$/i });
  addMissing('cpu:power', 'cpu', 'CPU', '功耗', { providerId: 'librehardwaremonitor', sensorType: 'Power', hardwarePattern: /^Cpu$/i });
  addMissing('memory:page-total', 'memory', '页面文件', '容量', { providerId: 'windows-cim', probeIds: ['page-file-cim'] });
  if (!snapshot.disks?.length) addMissing('storage:devices', 'storage', '磁盘', '容量与分区', { deviceExists: false });
  addMissing('gpu:usage', 'gpu', 'GPU', '核心占用', { deviceExists: hasGpu, providerId: 'windows-cim', probeIds: ['gpu-counter'], sensorType: 'Load', hardwarePattern: /^Gpu/i });
  addMissing('gpu:memory-total', 'gpu', 'GPU', '显存总容量', { deviceExists: hasGpu, providerId: 'windows-cim', probeIds: ['gpu-memory-registry', 'video-controller-cim'] });
  addMissing('gpu:memory-used', 'gpu', 'GPU', '显存已使用', { deviceExists: hasGpu, providerId: 'windows-cim', probeIds: ['gpu-counter'] });
  addMissing('gpu:temperature', 'gpu', 'GPU', '温度', { deviceExists: hasGpu, providerId: 'librehardwaremonitor', sensorType: 'Temperature', hardwarePattern: /^Gpu/i });
  addMissing('gpu:power', 'gpu', 'GPU', '功耗', { deviceExists: hasGpu, providerId: 'librehardwaremonitor', sensorType: 'Power', hardwarePattern: /^Gpu/i });
  addMissing('storage:read', 'storage', '全部磁盘', '读取速度', { deviceExists: hasStorage, providerId: 'windows-cim', probeIds: ['disk-counter', 'disk-process-io-fallback'], firstSample: cumulativeDiskWaiting });
  addMissing('storage:write', 'storage', '全部磁盘', '写入速度', { deviceExists: hasStorage, providerId: 'windows-cim', probeIds: ['disk-counter', 'disk-process-io-fallback'], firstSample: cumulativeDiskWaiting });
  addMissing('storage:temperature', 'storage', '物理磁盘', '温度', { deviceExists: hasStorage, providerId: 'librehardwaremonitor', sensorType: 'Temperature', hardwarePattern: /^Storage$/i });
  addMissing('network:download', 'network', '全部网卡', '下载速度', { deviceExists: hasNetwork, providerId: 'windows-cim', probeIds: ['network-counter', 'network-adapter-fallback'], firstSample: cumulativeNetworkWaiting });
  addMissing('network:upload', 'network', '全部网卡', '上传速度', { deviceExists: hasNetwork, providerId: 'windows-cim', probeIds: ['network-counter', 'network-adapter-fallback'], firstSample: cumulativeNetworkWaiting });
  if (!snapshot.battery) addMissing('battery:device', 'battery', '电池', '电池信息', { deviceExists: false });

  return {
    metrics: metrics.sort((left, right) => left.cardId.localeCompare(right.cardId) || left.device.localeCompare(right.device, 'zh-CN') || left.label.localeCompare(right.label, 'zh-CN')),
    availability: availability.sort((left, right) => left.cardId.localeCompare(right.cardId) || left.device.localeCompare(right.device, 'zh-CN') || left.label.localeCompare(right.label, 'zh-CN')),
    providerStates: buildProviderStates(snapshot),
  };
}
