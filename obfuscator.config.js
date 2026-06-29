module.exports = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  debugProtection: false,          // 必须关闭，与 Electron 主进程冲突
  selfDefending: false,            // 必须关闭，与 Electron 主进程冲突
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.8,
  renameGlobals: false,
  transformObjectKeys: true,
}