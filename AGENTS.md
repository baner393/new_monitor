# Repository working rules

- Do not build installers or run `npm run dist`, `dist:free`, or `dist:sponsor` unless the user explicitly asks for packaging in the current request.
- For ordinary fixes, validate with `npm test`, `npm run verify`, syntax checks, and source-mode startup as appropriate.
- Keep the two editions distinct: the sponsor edition contains the custom/developer entry; the free edition does not.
- Preserve the authenticated HTTPS remote URL: `https://baner393@github.com/baner393/new_monitor.git`.
- Do not commit generated `.vite/`, `out/`, logs, screenshots, or local `.codegraph/` data.
