function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstFinite(...values) {
  for (const value of values) {
    const number = finite(value);
    if (number !== null) return number;
  }
  return null;
}

function usableSensors(data, hardwarePattern, sensorType) {
  return (data?.hardwareSensors?.sensors || []).filter((sensor) => (
    hardwarePattern.test(sensor.hardwareType || '')
    && sensor.sensorType === sensorType
    && finite(sensor.value) !== null
    && sensor.status !== 'unavailable'
  ));
}

function preferredSensor(sensors, preferredNames = [], excludedNames = null) {
  const candidates = sensors.filter((sensor) => !excludedNames?.test(sensor.name || ''));
  for (const pattern of preferredNames) {
    const match = candidates.find((sensor) => pattern.test(sensor.name || ''));
    if (match) return match;
  }
  return [...candidates].sort((left, right) => finite(right.value) - finite(left.value))[0] || null;
}

function preferredSensorValue(sensors, preferredNames = [], excludedNames = null) {
  return finite(preferredSensor(sensors, preferredNames, excludedNames)?.value);
}

const TEMPERATURE_METADATA = /critical|warning|limit|threshold|tj\s?max|maximum/i;

export function deriveDashboardReadings(data = {}) {
  const hardware = data.hardwareSensors || {};
  const cpuTemperatureSensor = preferredSensor(
    usableSensors(data, /^Cpu$/i, 'Temperature'),
    [/package/i, /core average/i, /core max/i, /core/i],
    TEMPERATURE_METADATA,
  );
  const gpuTemperatureSensor = preferredSensor(
    usableSensors(data, /^Gpu/i, 'Temperature'),
    [/gpu core/i, /temperature/i, /hot\s?spot|junction/i],
    TEMPERATURE_METADATA,
  );
  const gpuUsage = preferredSensorValue(
    usableSensors(data, /^Gpu/i, 'Load'),
    [/gpu core/i, /gpu total/i, /^3d$/i, /d3d 3d/i, /core/i],
    /memory|controller|bus|video engine|compute/i,
  );
  const storageTemperatureSensors = usableSensors(data, /^Storage$/i, 'Temperature')
    .filter((sensor) => !TEMPERATURE_METADATA.test(sensor.name || ''));
  const hottestStorageSensor = [...storageTemperatureSensors]
    .sort((left, right) => finite(right.value) - finite(left.value))[0] || null;
  const hottestStorageDevice = [...(hardware.storage || [])]
    .filter((device) => finite(device.temperatureC) !== null)
    .sort((left, right) => finite(right.temperatureC) - finite(left.temperatureC))[0] || null;
  const storageValues = [
    ...(hardware.storage || []).map((device) => finite(device.temperatureC)),
    ...storageTemperatureSensors.map((sensor) => finite(sensor.value)),
  ].filter(Number.isFinite);
  const networkThroughput = usableSensors(data, /^Network$/i, 'Throughput');
  const networkDownloadSensors = networkThroughput.filter((sensor) => /download|receive/i.test(sensor.name || ''));
  const networkUploadSensors = networkThroughput.filter((sensor) => /upload|send/i.test(sensor.name || ''));
  const busiestNetworkSensor = [...networkThroughput].sort((left, right) => finite(right.value) - finite(left.value))[0];
  const storageThroughput = usableSensors(data, /^Storage$/i, 'Throughput');
  const storageLoads = usableSensors(data, /^Storage$/i, 'Load');
  const sumValues = (sensors) => sensors.reduce((sum, sensor) => sum + finite(sensor.value), 0);
  const maximumValue = (sensors) => sensors.length ? Math.max(...sensors.map((sensor) => finite(sensor.value))) : null;
  const rawNetworkDownload = maximumValue(networkDownloadSensors);
  const rawNetworkUpload = maximumValue(networkUploadSensors);
  const rawDiskRead = sumValues(storageThroughput.filter((sensor) => /read/i.test(sensor.name || '')));
  const rawDiskWrite = sumValues(storageThroughput.filter((sensor) => /write/i.test(sensor.name || '')));
  const rawDiskActivity = maximumValue(storageLoads.filter((sensor) => /total activity|disk activity/i.test(sensor.name || '')));

  return {
    cpuTemperatureC: firstFinite(data.cpu?.temperatureC, hardware.cpu?.temperatureC, cpuTemperatureSensor?.value),
    cpuTemperatureIdentifier: hardware.cpu?.hardwareIdentifier || cpuTemperatureSensor?.hardwareIdentifier || null,
    gpuTemperatureC: firstFinite(data.gpu?.temperatureC, hardware.gpu?.temperatureC, gpuTemperatureSensor?.value),
    gpuTemperatureIdentifier: hardware.gpu?.hardwareIdentifier || gpuTemperatureSensor?.hardwareIdentifier || null,
    gpuUsage: firstFinite(data.gpu?.usage, gpuUsage),
    cpuPowerWatts: firstFinite(data.cpu?.powerWatts, hardware.cpu?.powerWatts),
    gpuPowerWatts: firstFinite(data.gpu?.powerWatts, hardware.gpu?.powerWatts),
    storageTemperatureC: storageValues.length ? Math.max(...storageValues) : null,
    storageTemperatureIdentifier: hottestStorageDevice?.hardwareIdentifier || hottestStorageSensor?.hardwareIdentifier || null,
    networkDownloadBytesPerSec: firstFinite(data.network?.downloadBytesPerSec, rawNetworkDownload),
    networkUploadBytesPerSec: firstFinite(data.network?.uploadBytesPerSec, rawNetworkUpload),
    networkInterfaceName: busiestNetworkSensor?.hardwareName || null,
    diskReadBytesPerSec: firstFinite(data.diskIo?.readBytesPerSec, rawDiskRead || null),
    diskWriteBytesPerSec: firstFinite(data.diskIo?.writeBytesPerSec, rawDiskWrite || null),
    diskActivity: firstFinite(data.diskIo?.usage, rawDiskActivity),
  };
}

export function detectDashboardCardAvailability(data = {}) {
  const hardware = data.hardwareSensors || {};
  const readings = deriveDashboardReadings(data);
  const hardwareDevices = hardware.hardware || [];
  const hasGpu = Boolean(
    data.gpu?.name
    || data.gpu?.adapters?.length
    || hardwareDevices.some((device) => /^Gpu/i.test(device.hardwareType || ''))
    || readings.gpuTemperatureC !== null
    || readings.gpuUsage !== null
  );
  const hasCooling = (hardware.fans || []).some((sensor) => finite(sensor.value) !== null)
    || (hardware.sensors || []).some((sensor) => ['Fan', 'Control'].includes(sensor.sensorType) && finite(sensor.value) !== null);
  const hasPower = readings.cpuPowerWatts !== null
    || readings.gpuPowerWatts !== null
    || (hardware.sensors || []).some((sensor) => ['Power', 'Voltage', 'Current'].includes(sensor.sensorType) && finite(sensor.value) !== null);
  return {
    cpu: true,
    memory: true,
    gpu: hasGpu,
    network: true,
    storage: true,
    cooling: hasCooling,
    power: hasPower,
    battery: Boolean(data.battery),
  };
}

export function effectiveDashboardCardIds(config, data) {
  const availability = detectDashboardCardAvailability(data);
  return config.layout.order.filter((id) => config.layout.enabled[id] && availability[id]);
}

export function reorderDashboardCards(order, sourceId, targetId) {
  const next = [...order];
  const from = next.indexOf(sourceId);
  const to = next.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return next;
  next.splice(from, 1);
  next.splice(to, 0, sourceId);
  return next;
}

export function normalizeBatteryState(battery = {}) {
  const source = battery || {};
  const statusCode = finite(source.statusCode);
  const labels = {
    1: '电池供电',
    2: '外接电源',
    3: '已充满',
    4: '电量低',
    5: '电量危急',
    6: '充电中',
    7: '充电中',
    8: '充电中',
    9: '充电中',
    10: '状态未知',
    11: '部分充电',
  };
  const rawMinutes = finite(source.estimatedMinutes);
  const estimatedMinutes = rawMinutes !== null && rawMinutes >= 0 && rawMinutes <= 7 * 24 * 60
    ? rawMinutes
    : null;
  return {
    label: labels[statusCode] || '状态未知',
    charging: [6, 7, 8, 9].includes(statusCode),
    estimatedMinutes,
  };
}
