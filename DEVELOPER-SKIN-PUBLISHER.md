# 开发者皮肤发布器

这是独立于 Turtle Monitor 安装包的开发工具。主应用的 `dist:free` 和 `dist:sponsor` 不包含发布器入口、发布 IPC 或 Wrangler 发布逻辑。

## Agent 快速启动

在仓库根目录执行：

```powershell
npm ci
Copy-Item subscription-service/wrangler.toml.example subscription-service/wrangler.toml
```

只在本机的 `subscription-service/wrangler.toml` 中补齐真实的 D1 数据库 ID、R2 桶绑定和服务变量；该文件已被 Git 忽略，不要提交。然后登录本机 Wrangler：

```powershell
npx wrangler login
npx wrangler whoami
```

启动工具：

```powershell
npm run skin-publisher
```

工具会自动把仓库根目录识别为项目目录。若工具被复制到其他位置，指定项目目录：

```powershell
$env:TURTLE_SKIN_REPOSITORY = 'D:\path\to\new_monitor'
npm run skin-publisher
```

## 发布流程

1. 选择包含 `idle.png` 的皮肤图片目录。
2. 填写安全的皮肤 ID、显示名称、版本号、作者、描述和更新说明。
3. 点击“校验资源”。
4. 需要写入下一版安装包时，点击“写入默认皮肤”。
5. 需要发布到线上皮肤库时，点击“发布到皮肤库”。

发布动作会通过本机 Wrangler 上传 manifest、预览图和 `.skinpack` 到 R2，并幂等更新远端 D1 的 `skin_releases` 记录。凭据来自本机 Wrangler 登录状态，不会写入应用或仓库。

发布后检查：

```powershell
Invoke-RestMethod https://licensemonitor.b100.top/api/v1/skins/catalog
```

## 独立便携工具

需要给没有源码启动环境的开发电脑时，在仓库根目录执行：

```powershell
npm run dist:skin-publisher
```

将生成的便携工具与一个已配置 `TURTLE_SKIN_REPOSITORY` 的项目目录配合使用。首次发布前仍需在该电脑登录 Wrangler，并准备本机未提交的 `subscription-service/wrangler.toml`。

## 常见问题

- 找不到 `wrangler.toml`：确认当前目录是仓库根目录，或设置 `TURTLE_SKIN_REPOSITORY`。
- Wrangler 未登录：执行 `npx wrangler login` 后重试。
- 发布成功但目录为空：确认 D1 中的 `skin_releases.status` 为 `published`，并检查 Worker 是否已部署最新迁移。
- 普通用户看不到发布器：这是预期行为；发布器不在主应用包中。
