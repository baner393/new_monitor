import path from 'path';

const DEFAULT_CDP_PORT = 9222;
const CDP_TIMEOUT_MS = 15000;
const CDP_TARGET_DISCOVERY_TIMEOUT_MS = 5000;
const CDP_TARGET_DISCOVERY_POLL_MS = 150;
const CDP_EVALUATE_TIMEOUT_MS = 14000;
const CDP_CONNECT_TIMEOUT_MS = 5000;

export function windowsPowerShellPath(env = process.env) {
  const systemRoot = String(env.SystemRoot || env.WINDIR || 'C:\\Windows');
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function resolveCdpPort(value, env) {
  const port = Number(value ?? env.MONITOR_CODEX_CDP_PORT ?? DEFAULT_CDP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Codex CDP port must be a valid TCP port');
  }
  return port;
}

function isCodexPageUrl(value) {
  try {
    const url = new URL(value);
    const hashRoute = decodeURIComponent(url.hash.slice(1)).replace(/^\/+/, '');
    return url.protocol === 'app:'
      && url.hostname === '-'
      && url.pathname === '/index.html'
      && url.search === ''
      && !/^(?:avatar-overlay|global-dictation|detached(?:-window)?)(?:[/?#]|$)/i.test(hashRoute);
  } catch {
    return false;
  }
}

async function fetchCodexPage({ port, fetchImpl, signal, targetDiscoveryTimeoutMs }) {
  const endpoint = `http://127.0.0.1:${port}/json/list`;
  const deadline = Date.now() + Math.max(0, Number(targetDiscoveryTimeoutMs) || 0);
  while (!signal?.aborted) {
    let response;
    try {
      response = await fetchImpl(endpoint, { signal });
    } catch (error) {
      if (signal?.aborted) break;
      throw new Error(`Codex local debugging endpoint is unavailable on 127.0.0.1:${port}; start Codex with --remote-debugging-port=${port}. ${error?.message || error}`);
    }
    if (!response.ok) throw new Error(`Codex local debugging endpoint returned HTTP ${response.status}`);
    const targets = await response.json();
    const target = (Array.isArray(targets) ? targets : []).find((item) => item?.type === 'page'
      && isCodexPageUrl(item.url)
      && !/\bdetached(?:\s+window)?\b/i.test(String(item.title || ''))
      && typeof item.webSocketDebuggerUrl === 'string');
    if (target) return target;

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(CDP_TARGET_DISCOVERY_POLL_MS, remainingMs)));
  }
  throw new Error(`No ChatGPT/Codex page was found at the local debugging endpoint within ${targetDiscoveryTimeoutMs} ms`);
}

function createCdpClient(socket, timeoutMs = CDP_TIMEOUT_MS) {
  let nextId = 0;
  const pending = new Map();
  const failAll = (error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };
  socket.addEventListener('message', (event) => {
    let packet;
    try { packet = JSON.parse(String(event.data)); } catch { return; }
    if (!packet.id || !pending.has(packet.id)) return;
    const entry = pending.get(packet.id);
    pending.delete(packet.id);
    clearTimeout(entry.timer);
    if (packet.error) entry.reject(new Error(packet.error.message || 'Codex CDP command failed'));
    else entry.resolve(packet.result || {});
  });
  socket.addEventListener('close', () => failAll(new Error('Codex CDP connection closed')));
  socket.addEventListener('error', () => failAll(new Error('Codex CDP connection failed')));
  return {
    command(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Codex CDP command timed out: ${method}`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });
    },
    close() {
      failAll(new Error('Codex CDP session ended'));
      try { socket.close(); } catch {}
    },
  };
}

async function evaluate(cdp, expression, timeoutMs) {
  const packet = await cdp.command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: false,
    timeout: Math.min(CDP_EVALUATE_TIMEOUT_MS, timeoutMs),
  });
  if (packet.exceptionDetails) {
    const message = packet.exceptionDetails.exception?.description
      || packet.exceptionDetails.text
      || 'Codex page evaluation failed';
    throw new Error(message);
  }
  const result = packet.result?.value;
  if (result?.attempted !== true) throw new Error(result?.error || 'Codex desktop submit was not attempted');
  return result;
}

async function cdpSubmitInPage({ threadId, text }) {
    const exactThreadId = String(threadId);
    const unprefixedThreadId = exactThreadId.startsWith('local:') ? exactThreadId.slice('local:'.length) : exactThreadId;
    const targetThreadIds = new Set([exactThreadId, unprefixedThreadId, `local:${unprefixedThreadId}`]);
    const isTargetThreadId = (value) => targetThreadIds.has(String(value || ''));
    const expectedText = String(text);
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const routeMatches = () => {
      try {
        const current = new URL(location.href);
        return `${current.pathname}${current.search}${current.hash}`
          .split(/[\/?#=&]/)
          .some((part) => {
            try { return isTargetThreadId(decodeURIComponent(part)); }
            catch { return isTargetThreadId(part); }
          });
      }
      catch { return false; }
    };
    const visible = (node) => {
      if (!node || !node.getClientRects().length || node.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
      const style = getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
    };
    const explicitlyActive = (node) => node.getAttribute('aria-current') === 'page'
      || node.getAttribute('aria-selected') === 'true'
      || node.getAttribute('data-active') === 'true';
    const activeIdentityIds = () => {
      const ids = [];
      for (const node of document.querySelectorAll('main [data-thread-id], main [data-conversation-id]')) {
        if (!visible(node) || !explicitlyActive(node)) continue;
        const id = node.getAttribute('data-thread-id') || node.getAttribute('data-conversation-id');
        if (id) ids.push(id);
      }
      for (const node of document.querySelectorAll('[data-app-action-sidebar-thread-id]')) {
        if (!visible(node) || !explicitlyActive(node)) continue;
        const id = node.getAttribute('data-app-action-sidebar-thread-id');
        if (id) ids.push(id);
      }
      return ids;
    };
    const identityMatches = () => {
      const activeIds = activeIdentityIds();
      return activeIds.length > 0
        ? activeIds.every(isTargetThreadId)
        : routeMatches();
    };
    const waitForStableIdentity = async (timeoutMs = 8000) => {
      const deadline = Date.now() + timeoutMs;
      let consecutiveMatches = 0;
      while (Date.now() < deadline) {
        if (identityMatches()) {
          consecutiveMatches += 1;
          if (consecutiveMatches === 2) return true;
        } else consecutiveMatches = 0;
        await sleep(100);
      }
      return false;
    };
    if (!identityMatches()) {
      if (routeMatches()) {
        if (!await waitForStableIdentity(1500)) {
          return { ok: false, error: 'Codex URL identifies the target but the visible active conversation does not; message was not sent' };
        }
      } else {
      const target = Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-id]')).find((node) =>
        visible(node) && isTargetThreadId(node.getAttribute('data-app-action-sidebar-thread-id')));
      if (!target) return { ok: false, error: 'Codex page does not expose the exact target thread ID in its URL or sidebar; message was not sent' };
      target.click();
      if (!await waitForStableIdentity()) return { ok: false, error: 'Codex did not confirm stable navigation to the exact target thread; message was not sent' };
      }
    }
    if (!await waitForStableIdentity()) return { ok: false, error: 'Codex target identity did not remain stable; message was not sent' };
    const composers = Array.from(document.querySelectorAll('[contenteditable="true"].ProseMirror'))
      .filter((node) => visible(node) && !node.hasAttribute('disabled') && node.getAttribute('aria-disabled') !== 'true');
    if (composers.length !== 1) return { ok: false, error: 'Codex page did not expose exactly one visible message composer; message was not sent' };
    const composer = composers[0];
    if (!identityMatches()) return { ok: false, error: 'Codex active conversation could not be confirmed before filling the composer; message was not sent' };
    const existing = String(composer.innerText || composer.textContent || '').trim();
    if (existing && existing !== expectedText.trim()) return { ok: false, error: 'Codex composer already contains a different draft; message was not replaced or sent' };
    if (!existing) {
      composer.textContent = expectedText;
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: expectedText }));
    }
    await sleep(120);
    const confirmedText = String(composer.innerText || composer.textContent || '').trim();
    if (confirmedText !== expectedText.trim()) return { ok: false, error: 'Codex composer did not accept the complete message; message was not sent' };
    if (!identityMatches()) return { ok: false, error: 'Codex active conversation changed before submit; message was not sent' };
    const labels = /^(send|send message|send prompt|submit|queue|queue message|queue prompt|加入队列|排队|发送|提交|发送消息|发送提示)$/i;
    const queueLabels = /^(queue|queue message|queue prompt|加入队列|排队|queue-button|composer-queue-button)$/i;
    const sendControls = Array.from(document.querySelectorAll('button,[role="button"]')).filter((button) => {
      const label = String(button.getAttribute('aria-label') || button.getAttribute('data-testid') || button.innerText || '').trim();
      const named = labels.test(label) || /^(send-button|composer-send-button|queue-button|composer-queue-button)$/i.test(label);
      return named && visible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
    });
    const composerActionScope = composer.closest('[data-composer-body]')?.parentElement;
    if (!composerActionScope) return { ok: false, error: 'Codex composer did not expose its dedicated action area; message was not sent' };
    const buttons = sendControls.filter((button) => composerActionScope.contains?.(button));
    if (buttons.length !== 1) return { ok: false, error: 'Codex composer did not expose one unambiguous enabled send button; message was not sent' };
    if (!await waitForStableIdentity(1500)
        || !identityMatches()
        || String(composer.innerText || composer.textContent || '').trim() !== expectedText.trim()) {
      return { ok: false, error: 'Codex conversation or draft changed before submit; message was not sent' };
    }
    const submitLabel = String(buttons[0].getAttribute('aria-label') || buttons[0].getAttribute('data-testid') || buttons[0].innerText || '').trim();
    const submitAction = queueLabels.test(submitLabel) ? 'queue' : 'send';
    const normalizeText = (value) => String(value || '').trim().replace(/\s+/g, ' ');
    const countOccurrences = (value, needle) => value.split(needle).length - 1;
    let normalizedExpected = '';
    let existingConversationOccurrences = 0;
    const countConversationOccurrences = (needle) => [
      'main [data-composer-rail-item]',
      'main [data-user-message-bubble]',
    ].reduce((total, selector) => total + Array.from(document.querySelectorAll(selector))
      .reduce((itemTotal, node) => itemTotal + countOccurrences(
        normalizeText(node.innerText || node.textContent || ''), needle,
      ), 0), 0);
    if (submitAction === 'queue') {
      normalizedExpected = normalizeText(expectedText);
      existingConversationOccurrences = countConversationOccurrences(normalizedExpected);
    }
    buttons[0].click();
    let queueConfirmed = false;
    if (submitAction === 'queue') {
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline) {
        const composerText = normalizeText(composer.innerText || composer.textContent || '');
        if (!composerText
            && countConversationOccurrences(normalizedExpected) > existingConversationOccurrences) {
          queueConfirmed = true;
          break;
        }
        await sleep(50);
      }
      if (!queueConfirmed) return { ok: false, error: 'Codex did not confirm that the queued message entered the conversation' };
    }
    return {
      attempted: true,
      inputConfirmed: true,
      submitAction,
      queueConfirmed,
      threadId: exactThreadId,
      url: location.href,
      attemptedAtMs: Date.now(),
    };
}

function makeSubmitExpression(threadId, text) {
  return `(${cdpSubmitInPage.toString()})(${JSON.stringify({ threadId, text })})`;
}

export async function submitCodexDesktopUIA({
  text,
  threadId,
  env = process.env,
  cdpPort,
  fetchImpl = globalThis.fetch,
  WebSocketImpl = globalThis.WebSocket,
  timeoutMs = 15000,
  targetDiscoveryTimeoutMs = CDP_TARGET_DISCOVERY_TIMEOUT_MS,
  connectTimeoutMs = CDP_CONNECT_TIMEOUT_MS,
} = {}) {
  const expectedText = String(text || '');
  const targetThreadId = String(threadId || '').trim();
  if (!targetThreadId) throw new Error('Codex target thread id is required');
  if (!expectedText.trim()) throw new Error('Codex desktop message text was empty');
  if (typeof fetchImpl !== 'function') throw new Error('This runtime does not provide fetch for Codex CDP');
  if (typeof WebSocketImpl !== 'function') throw new Error('This runtime does not provide WebSocket for Codex CDP');
  const port = resolveCdpPort(cdpPort, env);
  const totalTimeoutMs = Math.max(0, Number(timeoutMs) || 0);
  const deadline = Date.now() + totalTimeoutMs;
  const remainingMs = () => Math.max(0, deadline - Date.now());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), totalTimeoutMs);
  let cdp;
  try {
    const target = await fetchCodexPage({
      port,
      fetchImpl,
      signal: controller.signal,
      targetDiscoveryTimeoutMs: Math.min(
        Math.max(0, Number(targetDiscoveryTimeoutMs) || 0),
        remainingMs(),
      ),
    });
    const connectionTimeoutMs = Math.min(
      Math.max(0, Number(connectTimeoutMs) || 0),
      remainingMs(),
    );
    if (connectionTimeoutMs <= 0) throw new Error('Timed out waiting to connect to Codex CDP');
    if (!target.webSocketDebuggerUrl.startsWith(`ws://127.0.0.1:${port}/`)
        && !target.webSocketDebuggerUrl.startsWith(`ws://localhost:${port}/`)) {
      throw new Error('Codex exposed a non-loopback CDP WebSocket; refusing to connect');
    }
    const socket = new WebSocketImpl(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const openTimer = setTimeout(() => {
        try { socket.close(); } catch {}
        reject(new Error('Timed out connecting to Codex CDP'));
      }, connectionTimeoutMs);
      socket.addEventListener('open', () => { clearTimeout(openTimer); resolve(); }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(openTimer);
        try { socket.close(); } catch {}
        reject(new Error('Could not connect to Codex CDP'));
      }, { once: true });
    });
    const commandTimeoutMs = Math.min(CDP_TIMEOUT_MS, remainingMs());
    if (commandTimeoutMs <= 0) throw new Error('Timed out before submitting to Codex');
    cdp = createCdpClient(socket, commandTimeoutMs);
    const evaluationTimeoutMs = Math.min(CDP_EVALUATE_TIMEOUT_MS, remainingMs());
    if (evaluationTimeoutMs <= 0) throw new Error('Timed out before submitting to Codex');
    const result = await evaluate(
      cdp,
      makeSubmitExpression(targetThreadId, expectedText),
      evaluationTimeoutMs,
    );
    return {
      ...result,
      processId: null,
      submitMethod: 'cdp-dom',
    };
  } finally {
    clearTimeout(timeout);
    cdp?.close();
  }
}

export async function waitForCodexDesktopUserMessage({
  readMessages,
  text,
  sinceMs,
  attempts = 40,
  intervalMs = 500,
  delayImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const expected = String(text || '').trim();
  const lowerBound = Number(sinceMs || Date.now()) - 2000;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await delayImpl(intervalMs);
    const messages = await readMessages();
    const found = (messages || []).some((message) => message?.role === 'user'
      && String(message.message || '').trim() === expected
      && Number(message.createdAtMs || 0) >= lowerBound);
    if (found) return true;
  }
  return false;
}
