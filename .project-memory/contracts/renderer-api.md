# Renderer API contract

Status: Confirmed. Evidence: `src/main/preload.js` and IPC registrations in `src/main/index.js`.

The isolated renderer receives `window.electronAPI` through Electron `contextBridge`.

| Group | Operations |
|---|---|
| Window/input | initialize renderer generation, mark input ready, set click-through, get cursor, set bounds, open context menu |
| Monitor stream | subscribe to system snapshots, request a snapshot, report panel visibility, receive/complete soft refresh |
| Monitor config | get/save V2 config, legacy visibility compatibility, request hardware-reader elevation |
| Codex | get/save config, select data home, get status, page messages (default limit 50), refresh, mark read/notified, connect/disconnect task, reply, respond to request, open exact task, subscribe to status |
| Settings/skins | get/set/save/reset settings, get/set selected skin, get merged skin list, receive changes/reloads |

Security invariant: renderer code does not receive direct Node, filesystem, process-spawn, or unrestricted IPC access.

Lifecycle invariant: every event subscription returns an unsubscribe callback.
