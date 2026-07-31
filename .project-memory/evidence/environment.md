# Reference environment

Status: Confirmed. Evidence: `package.json`, `package-lock.json`, `native/HardwareSensorHost/HardwareSensorHost.csproj`.

- Target OS: Windows 10/11 x64.
- Node.js compatibility floor: 22.
- Electron: 43.2.0; Electron Forge: 7.11.2; Vite: 6.4.3; PixiJS: 7.4.3.
- Dependency installation: `npm ci`; exact dependency graph is owned by `package-lock.json`.
- Bundled sensor host: x64 .NET Framework 4.7.2 with LibreHardwareMonitor 0.9.6.

These are the captured baseline and declared compatibility floor, not proof that every future toolchain substitution is compatible.
