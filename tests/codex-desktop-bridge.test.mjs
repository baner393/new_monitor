import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import {
  submitCodexDesktopUIA,
  waitForCodexDesktopUserMessage,
  windowsPowerShellPath,
} from '../src/main/codex-desktop-bridge.js';

class FakeWebSocket {
  static last;
  static executeExpression;
  static suppressOpen = false;
  listeners = new Map();
  sent = [];

  constructor(url) {
    this.url = url;
    FakeWebSocket.last = this;
    if (!FakeWebSocket.suppressOpen) queueMicrotask(() => this.emit('open', {}));
  }

  addEventListener(type, callback) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(callback);
    this.listeners.set(type, handlers);
  }

  emit(type, event) {
    for (const handler of this.listeners.get(type) || []) handler(event);
  }

  send(data) {
    const packet = JSON.parse(data);
    this.sent.push(packet);
    queueMicrotask(async () => {
      let value;
      let exceptionDetails;
      try {
        value = FakeWebSocket.executeExpression
          ? await FakeWebSocket.executeExpression(packet.params.expression)
          : {
            attempted: true,
            inputConfirmed: true,
            threadId: 'thread-123',
            url: 'app://-/index.html',
            attemptedAtMs: 1234,
          };
      } catch (error) {
        exceptionDetails = { text: error.message };
      }
      this.emit('message', {
        data: JSON.stringify({
          id: packet.id,
          result: {
            exceptionDetails,
            result: { value },
          },
        }),
      });
    });
  }

  close() { this.closed = true; }
}

class MockElement {
  constructor({ attrs = {}, visible = true, hiddenAncestor = false, text = '', disabled = false, click } = {}) {
    this.attrs = { ...attrs };
    this.visible = visible;
    this.hiddenAncestor = hiddenAncestor;
    this.textContent = text;
    this.disabled = disabled;
    this.clickImpl = click;
    this.clickCount = 0;
    this.events = [];
  }

  get innerText() { return this.textContent; }
  set innerText(value) { this.textContent = value; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
  getClientRects() { return this.visible ? [{}] : []; }
  closest(selector) {
    if (this.closestImpl) return this.closestImpl(selector);
    if (this.hiddenAncestor && selector.includes('aria-hidden')) return this;
    return null;
  }
  dispatchEvent(event) { this.events.push(event); return true; }
  click() {
    this.clickCount += 1;
    if (this.clickImpl) this.clickImpl();
  }
}

function makePageHarness({
  activeThread = false,
  activeThreadId = 'thread-123',
  hiddenStaleThread = false,
  targetSidebar = false,
  sidebarThreadId = 'thread-123',
  sidebarClickThreadId = '',
  pageUrl = 'app://-/index.html',
  buttons = 'one',
  clickThrows = false,
  actionLabel = 'Send message',
  bodyText = '',
  existingMessageText = '',
  queueAccepted = true,
  unrelatedAction = false,
} = {}) {
  const threadMarkers = [];
  if (activeThread) {
    threadMarkers.push(new MockElement({
      attrs: { 'data-thread-id': activeThreadId, 'data-active': 'true' },
    }));
  }
  if (hiddenStaleThread) {
    threadMarkers.push(new MockElement({
      attrs: { 'data-thread-id': 'thread-123', 'data-active': 'true' },
      visible: false,
    }));
  }
  const composer = new MockElement({ attrs: { contenteditable: 'true', class: 'ProseMirror' } });
  let historyText = bodyText;
  const body = {};
  Object.defineProperty(body, 'innerText', {
    get: () => [historyText, existingMessageText, composer.textContent].filter(Boolean).join('\n'),
    set: (value) => { historyText = String(value || ''); },
  });
  const queueItems = [];
  const messageBubbles = existingMessageText
    ? [new MockElement({ attrs: { 'data-user-message-bubble': '' }, text: existingMessageText })]
    : [];
  const sidebarTarget = targetSidebar ? new MockElement({
    attrs: { 'data-app-action-sidebar-thread-id': sidebarThreadId },
    click: () => {
      if (sidebarClickThreadId) {
        threadMarkers.push(new MockElement({
          attrs: { 'data-thread-id': sidebarClickThreadId, 'data-active': 'true' },
        }));
      }
    },
  }) : null;
  const sendButton = new MockElement({
    attrs: { 'aria-label': actionLabel },
    click: clickThrows ? () => { throw new Error('simulated click failure'); } : () => {
      if (/^(queue|queue message|queue prompt|加入队列|排队)$/i.test(actionLabel)) {
        if (queueAccepted) {
          historyText = [historyText, composer.textContent].filter(Boolean).join('\n');
          queueItems.push(new MockElement({ attrs: { 'data-composer-rail-item': '' }, text: composer.textContent }));
        }
        composer.textContent = '';
      }
    },
  });
  const secondButton = buttons === 'two' ? new MockElement({ attrs: { 'aria-label': 'Send message' } }) : null;
  const container = { contains: (element) => element === sendButton || element === secondButton };
  const composerBody = { parentElement: container };
  composer.closestImpl = (selector) => selector === '[data-composer-body]' ? composerBody : null;
  composer.parentElement = container;
  const unrelatedButton = unrelatedAction ? new MockElement({ attrs: { 'aria-label': actionLabel } }) : null;
  const buttonList = buttons === 'none' ? [] : secondButton ? [sendButton, secondButton] : [sendButton];
  if (unrelatedButton) buttonList.push(unrelatedButton);
  const document = {
    body,
    querySelectorAll(selector) {
      if (selector === 'main [data-thread-id], main [data-conversation-id]') return threadMarkers;
      if (selector === '[data-app-action-sidebar-thread-id]') return sidebarTarget ? [sidebarTarget] : [];
      if (selector === '[contenteditable="true"].ProseMirror') return [composer];
      if (selector === 'main [data-composer-rail-item]') return queueItems;
      if (selector === 'main [data-user-message-bubble]') return messageBubbles;
      if (selector === 'button,[role="button"]') return buttonList;
      return [];
    },
  };
  return {
    composer,
    sendButton,
    unrelatedButton,
    sidebarTarget,
    executeExpression: (expression) => runInNewContext(expression, {
      document,
      location: { href: pageUrl },
      URL,
      InputEvent: class InputEvent { constructor(type, init) { this.type = type; Object.assign(this, init); } },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
      setTimeout,
      clearTimeout,
      Date,
    }),
  };
}

const target = {
  type: 'page',
  title: 'Codex',
  url: 'app://-/index.html',
  webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/test',
};

test('desktop bridge resolves Windows PowerShell without machine-specific paths', () => {
  assert.equal(
    windowsPowerShellPath({ SystemRoot: 'D:\\Windows' }),
    'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  );
});

test('desktop bridge attaches only to loopback CDP and sends through an identity-checked DOM route', async () => {
  let endpoint;
  const result = await submitCodexDesktopUIA({
    text: '客户端消息',
    threadId: 'thread-123',
    env: { MONITOR_CODEX_CDP_PORT: '9222' },
    fetchImpl: async (url) => {
      endpoint = url;
      return { ok: true, json: async () => [
        { ...target, url: 'https://chatgpt.com/codex/threads/thread-123' },
        { ...target, type: 'background_page' },
        target,
      ] };
    },
    WebSocketImpl: FakeWebSocket,
  });

  assert.equal(endpoint, 'http://127.0.0.1:9222/json/list');
  assert.equal(result.attempted, true);
  assert.equal(result.inputConfirmed, true);
  assert.equal(result.submitMethod, 'cdp-dom');
  assert.equal(result.threadId, 'thread-123');
  assert.equal(FakeWebSocket.last.url, target.webSocketDebuggerUrl);
  assert.equal(FakeWebSocket.last.closed, true);
  assert.equal(FakeWebSocket.last.sent.length, 1);
  assert.equal(FakeWebSocket.last.sent[0].method, 'Runtime.evaluate');
  const expression = FakeWebSocket.last.sent[0].params.expression;
  assert.match(expression, /data-app-action-sidebar-thread-id/);
  assert.match(expression, /aria-current/);
  assert.match(expression, /aria-selected/);
  assert.match(expression, /data-active/);
  assert.match(expression, /main \[data-thread-id\], main \[data-conversation-id\]/);
  assert.match(expression, /decodeURIComponent/);
  assert.match(expression, /contenteditable/);
  assert.match(expression, /InputEvent/);
  assert.match(expression, /\.click\(\)/);
  assert.match(expression, /thread-123/);
  assert.match(expression, /客户端消息/);
  const identityGuardAt = expression.indexOf('if (!identityMatches())');
  const composerQueryAt = expression.indexOf('[contenteditable="true"].ProseMirror');
  const sendAt = expression.indexOf('buttons[0].click()');
  assert.ok(identityGuardAt >= 0 && identityGuardAt < composerQueryAt && composerQueryAt < sendAt);
  assert.doesNotMatch(expression, /focus\(|Input\.dispatchKeyEvent|SetForegroundWindow/);
  assert.doesNotMatch(expression, /bringToFront|Page\.activate|ShowWindow|AppActivate/i);
});

test('executed DOM guard rejects an old hidden main-thread marker without sending', async () => {
  const page = makePageHarness({ hiddenStaleThread: true });
  FakeWebSocket.executeExpression = page.executeExpression;
  try {
    await assert.rejects(submitCodexDesktopUIA({
      text: '不应发送',
      threadId: 'thread-123',
      fetchImpl: async () => ({ ok: true, json: async () => [target] }),
      WebSocketImpl: FakeWebSocket,
    }), /exact target thread ID/);
  } finally {
    FakeWebSocket.executeExpression = undefined;
  }
  assert.equal(page.composer.textContent, '');
  assert.equal(page.sendButton.clickCount, 0);
});

test('target URL with a different visible active conversation is rejected without clicking the sidebar', async () => {
  const page = makePageHarness({
    pageUrl: 'app://-/index.html#/threads/thread-123',
    activeThread: true,
    activeThreadId: 'thread-old',
    targetSidebar: true,
  });
  FakeWebSocket.executeExpression = page.executeExpression;
  try {
    await assert.rejects(submitCodexDesktopUIA({
      text: '不同活动会话不能发送',
      threadId: 'thread-123',
      fetchImpl: async () => ({ ok: true, json: async () => [target] }),
      WebSocketImpl: FakeWebSocket,
    }), /visible active conversation does not/);
  } finally {
    FakeWebSocket.executeExpression = undefined;
  }
  assert.equal(page.sidebarTarget.clickCount, 0);
  assert.equal(page.composer.textContent, '');
  assert.equal(page.sendButton.clickCount, 0);
});

test('desktop bridge matches Codex local-prefixed sidebar IDs to rollout thread IDs', async () => {
  const page = makePageHarness({
    targetSidebar: true,
    sidebarThreadId: 'local:thread-123',
    sidebarClickThreadId: 'local:thread-123',
  });
  FakeWebSocket.executeExpression = page.executeExpression;
  try {
    const result = await submitCodexDesktopUIA({
      text: '本地 Codex 会话消息',
      threadId: 'thread-123',
      fetchImpl: async () => ({ ok: true, json: async () => [target] }),
      WebSocketImpl: FakeWebSocket,
    });
    assert.equal(result.attempted, true);
    assert.equal(result.threadId, 'thread-123');
  } finally {
    FakeWebSocket.executeExpression = undefined;
  }
  assert.equal(page.sidebarTarget.clickCount, 1);
  assert.equal(page.sendButton.clickCount, 1);
  assert.equal(page.composer.textContent, '本地 Codex 会话消息');
});

test('executed DOM flow attempts a send only for a visible explicitly active target', async () => {
  const page = makePageHarness({ activeThread: true });
  FakeWebSocket.executeExpression = page.executeExpression;
  try {
    const result = await submitCodexDesktopUIA({
      text: '目标会话消息',
      threadId: 'thread-123',
      fetchImpl: async () => ({ ok: true, json: async () => [target] }),
      WebSocketImpl: FakeWebSocket,
    });
    assert.equal(result.attempted, true);
    assert.equal(result.submitAction, 'send');
    assert.equal(result.submitted, undefined);
    assert.equal(page.composer.textContent, '目标会话消息');
    assert.equal(page.sendButton.clickCount, 1);
  } finally {
    FakeWebSocket.executeExpression = undefined;
  }
});

test('executed DOM flow accepts the composer queue action and ignores an unrelated page queue control', async () => {
  const page = makePageHarness({ activeThread: true, actionLabel: '排队', unrelatedAction: true });
  FakeWebSocket.executeExpression = page.executeExpression;
  try {
    const result = await submitCodexDesktopUIA({
      text: '排队中的对话消息',
      threadId: 'thread-123',
      fetchImpl: async () => ({ ok: true, json: async () => [target] }),
      WebSocketImpl: FakeWebSocket,
    });
    assert.equal(result.attempted, true);
    assert.equal(result.submitAction, 'queue');
    assert.equal(result.queueConfirmed, true);
    assert.equal(page.composer.textContent, '');
    assert.match(page.executeExpression('document.body.innerText'), /排队中的对话消息/);
    assert.equal(page.sendButton.clickCount, 1);
    assert.equal(page.unrelatedButton.clickCount, 0);
  } finally {
    FakeWebSocket.executeExpression = undefined;
  }
});

test('executed DOM flow rejects queue confirmation when the same text already exists in history', async () => {
  const duplicate = '历史中已存在的排队消息';
  const page = makePageHarness({
    activeThread: true,
    actionLabel: '排队',
    existingMessageText: duplicate,
    queueAccepted: false,
  });
  FakeWebSocket.executeExpression = page.executeExpression;
  try {
    await assert.rejects(submitCodexDesktopUIA({
      text: duplicate,
      threadId: 'thread-123',
      fetchImpl: async () => ({ ok: true, json: async () => [target] }),
      WebSocketImpl: FakeWebSocket,
    }), /did not confirm that the queued message entered the conversation/);
  } finally {
    FakeWebSocket.executeExpression = undefined;
  }
  assert.equal(page.composer.textContent, '');
  assert.equal(page.sendButton.clickCount, 1);
});

test('executed DOM flow ignores matching page text outside queued or submitted message items', async () => {
  const duplicate = '侧栏预览中已有的相同文字';
  const page = makePageHarness({
    activeThread: true,
    actionLabel: '排队',
    bodyText: duplicate,
    queueAccepted: false,
  });
  FakeWebSocket.executeExpression = page.executeExpression;
  try {
    await assert.rejects(submitCodexDesktopUIA({
      text: duplicate,
      threadId: 'thread-123',
      fetchImpl: async () => ({ ok: true, json: async () => [target] }),
      WebSocketImpl: FakeWebSocket,
    }), /did not confirm that the queued message entered the conversation/);
  } finally {
    FakeWebSocket.executeExpression = undefined;
  }
  assert.equal(page.composer.textContent, '');
  assert.equal(page.sendButton.clickCount, 1);
});

test('executed DOM flow does not report an attempt when the button is missing, ambiguous, or click fails', async () => {
  for (const options of [
    { activeThread: true, buttons: 'none' },
    { activeThread: true, buttons: 'two' },
    { activeThread: true, clickThrows: true },
  ]) {
    const page = makePageHarness(options);
    FakeWebSocket.executeExpression = page.executeExpression;
    try {
      await assert.rejects(submitCodexDesktopUIA({
        text: '需要拒绝',
        threadId: 'thread-123',
        fetchImpl: async () => ({ ok: true, json: async () => [target] }),
        WebSocketImpl: FakeWebSocket,
      }), options.clickThrows ? /simulated click failure/ : /one unambiguous enabled send button/);
    } finally {
      FakeWebSocket.executeExpression = undefined;
    }
    assert.equal(page.sendButton.clickCount, options.clickThrows ? 1 : 0);
  }
});

test('desktop bridge closes a CDP socket when its handshake times out', async () => {
  FakeWebSocket.suppressOpen = true;
  try {
    await assert.rejects(submitCodexDesktopUIA({
      text: 'not sent',
      threadId: 'thread-123',
      fetchImpl: async () => ({ ok: true, json: async () => [target] }),
      WebSocketImpl: FakeWebSocket,
      connectTimeoutMs: 10,
    }), /Timed out connecting to Codex CDP/);
    assert.equal(FakeWebSocket.last.closed, true);
  } finally {
    FakeWebSocket.suppressOpen = false;
  }
});

test('desktop submit timeout also bounds the CDP handshake', async () => {
  FakeWebSocket.suppressOpen = true;
  const startedAt = Date.now();
  try {
    await assert.rejects(submitCodexDesktopUIA({
      text: 'not sent',
      threadId: 'thread-123',
      timeoutMs: 25,
      targetDiscoveryTimeoutMs: 0,
      connectTimeoutMs: 2000,
      fetchImpl: async () => ({ ok: true, json: async () => [target] }),
      WebSocketImpl: FakeWebSocket,
    }), /Timed out connecting to Codex CDP/);
  } finally {
    FakeWebSocket.suppressOpen = false;
  }
  assert.ok(Date.now() - startedAt < 1200);
  assert.equal(FakeWebSocket.last.closed, true);
});

test('desktop bridge refuses a non-loopback debugger socket', async () => {
  await assert.rejects(
    submitCodexDesktopUIA({
      text: 'do not send',
      threadId: 'thread-123',
      fetchImpl: async () => ({
        ok: true,
        json: async () => [{ ...target, webSocketDebuggerUrl: 'ws://192.168.1.8:9222/devtools/page/test' }],
      }),
      WebSocketImpl: FakeWebSocket,
    }),
    /non-loopback CDP WebSocket/,
  );
});

test('desktop bridge selects the main shell when avatar, dictation, and detached windows precede it', async () => {
  const detached = {
    type: 'page',
    title: 'Codex detached window',
    url: 'app://-/index.html?window=detached',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/detached',
  };
  const mainShell = {
    type: 'page',
    title: 'Codex',
    url: 'app://-/index.html',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/main',
  };
  const hashAuxiliary = {
    ...mainShell,
    url: 'app://-/index.html#/avatar-overlay',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/avatar-hash',
  };
  const browserTab = {
    type: 'page',
    title: 'ChatGPT',
    url: 'https://chatgpt.com/codex/threads/thread-123',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/browser-tab',
  };
  const auxiliaryTargets = ['avatar-overlay', 'global-dictation', 'detached-window'].map((route) => ({
    ...mainShell,
    title: route,
    url: `app://-/index.html?initialRoute=${encodeURIComponent(`/${route}`)}`,
    webSocketDebuggerUrl: `ws://127.0.0.1:9222/devtools/page/${route}`,
  }));
  await submitCodexDesktopUIA({
    text: '客户端消息',
    threadId: 'thread-123',
    fetchImpl: async () => ({ ok: true, json: async () => [...auxiliaryTargets, browserTab, detached, hashAuxiliary, mainShell] }),
    WebSocketImpl: FakeWebSocket,
  });
  assert.equal(FakeWebSocket.last.url, mainShell.webSocketDebuggerUrl);
});

test('desktop bridge refuses an endpoint containing only auxiliary app windows', async () => {
  const previousSocket = FakeWebSocket.last;
  await assert.rejects(submitCodexDesktopUIA({
    text: 'not sent',
    threadId: 'thread-123',
    targetDiscoveryTimeoutMs: 10,
    fetchImpl: async () => ({ ok: true, json: async () => [
      { ...target, url: 'app://-/index.html?initialRoute=%2Favatar-overlay' },
      { ...target, url: 'app://-/index.html?initialRoute=%2Fglobal-dictation' },
      { ...target, url: 'app://-/index.html?mode=detached' },
    ] }),
    WebSocketImpl: FakeWebSocket,
  }), /No ChatGPT\/Codex page/);
  assert.equal(FakeWebSocket.last, previousSocket);
});

test('desktop bridge waits for the main shell when it appears after the CDP endpoint is ready', async () => {
  let fetchCount = 0;
  const auxiliary = {
    ...target,
    title: 'avatar-overlay',
    url: 'app://-/index.html?initialRoute=%2Favatar-overlay',
  };
  const mainShell = {
    ...target,
    url: 'app://-/index.html#/threads/thread-123',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/main-after-startup',
  };
  await submitCodexDesktopUIA({
    text: '主页面就绪后发送',
    threadId: 'thread-123',
    fetchImpl: async () => ({
      ok: true,
      json: async () => (++fetchCount === 1 ? [auxiliary] : [auxiliary, mainShell]),
    }),
    WebSocketImpl: FakeWebSocket,
  });
  assert.ok(fetchCount >= 2);
  assert.equal(FakeWebSocket.last.url, mainShell.webSocketDebuggerUrl);
});

test('desktop bridge explains when the local Codex debugging endpoint is unavailable', async () => {
  await assert.rejects(
    submitCodexDesktopUIA({
      text: 'not sent',
      threadId: 'thread-123',
      fetchImpl: async () => { throw new Error('connection refused'); },
      WebSocketImpl: FakeWebSocket,
    }),
    /start Codex with --remote-debugging-port=9222/,
  );
});

test('desktop submit confirmation requires a new matching user message', async () => {
  let reads = 0;
  const confirmed = await waitForCodexDesktopUserMessage({
    text: '客户端消息',
    sinceMs: 10_000,
    intervalMs: 0,
    delayImpl: async () => {},
    readMessages: async () => {
      reads += 1;
      return reads < 2
        ? [{ role: 'user', message: '客户端消息', createdAtMs: 1000 }]
        : [{ role: 'user', message: '客户端消息', createdAtMs: 10_100 }];
    },
  });
  assert.equal(confirmed, true);
  assert.equal(reads, 2);

  const missing = await waitForCodexDesktopUserMessage({
    text: '未记录消息',
    sinceMs: 10_000,
    attempts: 2,
    intervalMs: 0,
    delayImpl: async () => {},
    readMessages: async () => [{ role: 'assistant', message: '未记录消息', createdAtMs: 10_100 }],
  });
  assert.equal(missing, false);
});
