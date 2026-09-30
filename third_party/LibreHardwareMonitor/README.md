# LibreHardwareMonitor attribution

`HardwareSensorHost` uses `LibreHardwareMonitorLib` 0.9.6 to read sensors that
Windows CIM and performance counters do not expose consistently. The library is
licensed under MPL-2.0; bundled third-party components retain their respective
licenses. The binary payload in `resources/hardware-sensor` is reproducible with
`npm run build:sensor-host`.

Upstream: https://github.com/LibreHardwareMonitor/LibreHardwareMonitor
