# Repository working rules

- 一切改动优先参考现有开源项目，优先复用或借鉴成熟实现；实施前查找相关方案并确认其适用性与许可证。
- Do not build installers or run `npm run dist`, `dist:free`, or `dist:sponsor` unless the user explicitly asks for packaging in the current request.
- For ordinary fixes, validate with `npm test`, `npm run verify`, syntax checks, and source-mode startup as appropriate.
- 不要做多余的复核。只执行与本次改动直接相关的必要验证；验证通过后结束，仅在新增改动、检查失败或存在未解决问题时追加检查。
- Keep the two editions distinct: the sponsor edition contains the custom/developer entry; the free edition does not.
- Preserve the authenticated HTTPS remote URL: `https://baner393@github.com/baner393/new_monitor.git`.
- Do not commit generated `.vite/`, `out/`, logs, screenshots, or local `.codegraph/` data.
