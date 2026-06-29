# Turtle Monitor 发布与保护方案

> 零成本、零服务器、双版本编译 + RSA 授权

---

## 一、整体架构

同一套源码，通过编译参数 `BUILD_EDITION` 区分两个版本：

| | 基础版（Free） | 赞助版（Sponsor） |
|---|---|---|
| 代码 | 编译期 tree-shaking 移除赞助代码 | 完整功能 |
| 授权 | 无，不识别 license | RSA 签名 license，绑定设备 |
| 分发 | GitHub / 网盘 / 社区公开 | 一对一私发，不上传任何平台 |
| SHA256 | 公开 | 私密，一用户一发放 |

**核心安全**：基础版完全没有赞助功能代码，永远无法破解解锁。

---

## 二、双版本编译方案（Vite define + tree-shaking）

### vite 配置

```js
// vite.main.config.js / vite.renderer.config.js
define: {
  __SPONSOR_ONLY__: process.env.BUILD_EDITION === 'sponsor'
}
```

### npm scripts

```json
{
  "scripts": {
    "package:free": "cross-env BUILD_EDITION=free electron-forge package",
    "package:sponsor": "cross-env BUILD_EDITION=sponsor electron-forge package"
  }
}
```

### 代码中使用

```js
if (__SPONSOR_ONLY__) {
  // 赞助功能 —— 编译为 false 后 Rollup 直接从 bundle 移除
}
```

> 不要用 `if (process.env.BUILD_EDITION === 'sponsor')`——那是运行时判断，代码还在 ASAR 里。

---

## 三、授权机制（RSA 离线签名）

### 密钥生成

```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

- 作者持有私钥（不外泄）
- 赞助版内置公钥

### License 字段

```json
{
  "deviceId": "CPU序列号/硬盘序列号哈希",
  "expiresAt": "2026-12-31T23:59:59Z",
  "edition": "sponsor"
}
```

### 签发流程

1. 用户提供设备唯一码
2. 作者用私钥签发 license
3. 程序内置公钥校验签名（Node.js crypto）

```js
const crypto = require('crypto');
const verify = crypto.createVerify('SHA256');
verify.update(JSON.stringify(licenseData));
const valid = verify.verify(publicKey, signature, 'base64');
```

---

## 四、打包与分发

### 打包配置

```js
// forge.config.js
packagerConfig: {
  asar: true,  // 启用 ASAR 归档
  // ...
}
```

### 基础版分发

- GitHub Releases、网盘、社区
- 附带公开 SHA256 校验码

### 赞助版分发（核心防泄露）

永远不上传任何公开平台：

1. 赞助版安装包（与用户设备对应的版本）
2. 该包专属私密 SHA256
3. 该设备专属 license 证书
4. 禁止转发/泄露协议说明

### 溯源台账

记录每份发出包的哈希与接收人对应关系，用于泄露时溯源。

---

## 五、保护能力分析

| 攻击者类型 | 基础版 | 赞助版 |
|---|---|---|
| 普通用户想解锁付费功能 | ✅ 代码都不在，解不了 | — |
| 拿到包直接复制给朋友 | — | ✅ License 绑设备 |
| 解 ASAR 改代码绕过校验 | — | ⚠️ 可破解（约 5 分钟） |
| 改包后冒充作者分发 | ❌ 无代码签名证书 | ❌ 无代码签名证书 |

> 破解毒副作用：破解者能自用，但无法传播给其他人用（设备绑定）。
> 破解者本来就不会付费，无经济损失。

---

## 六、方案成本

| 项目 | 成本 |
|------|------|
| 双版本编译 | ¥0 |
| RSA 密钥 | ¥0 |
| License 工具 | ¥0 |
| ASAR 打包 | ¥0 |
| 代码签名证书（不选） | ¥300-500/年 |
