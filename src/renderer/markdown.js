const TOKEN_OPEN = '\uE000';
const TOKEN_CLOSE = '\uE001';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function normalizeMarkdownLink(value) {
  const raw = String(value || '').trim();
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return '';
  try {
    const parsed = new URL(raw);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function renderInline(value) {
  const tokens = [];
  const stash = (html) => {
    const token = `${TOKEN_OPEN}${tokens.length}${TOKEN_CLOSE}`;
    tokens.push(html);
    return token;
  };
  let source = String(value ?? '').replaceAll(TOKEN_OPEN, '\uFFFD').replaceAll(TOKEN_CLOSE, '\uFFFD');

  source = source.replace(/(`+)([\s\S]*?)\1/g, (_match, _ticks, code) => stash(`<code>${escapeHtml(code)}</code>`));
  source = source.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g, (_match, label, href) => {
    const safe = normalizeMarkdownLink(href);
    return safe
      ? stash(`<a class="codex-markdown-link codex-markdown-image-link" href="#" data-href="${escapeHtml(safe)}">${escapeHtml(label || href)}</a>`)
      : escapeHtml(label || href);
  });
  source = source.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g, (_match, label, href) => {
    const safe = normalizeMarkdownLink(href);
    return safe
      ? stash(`<a class="codex-markdown-link" href="#" data-href="${escapeHtml(safe)}">${escapeHtml(label)}</a>`)
      : escapeHtml(label);
  });
  source = source.replace(/<((?:https?:\/\/|mailto:)[^>]+)>/gi, (_match, href) => {
    const safe = normalizeMarkdownLink(href);
    return safe ? stash(`<a class="codex-markdown-link" href="#" data-href="${escapeHtml(safe)}">${escapeHtml(href)}</a>`) : escapeHtml(href);
  });

  source = escapeHtml(source)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');

  return source.replace(new RegExp(`${TOKEN_OPEN}(\\d+)${TOKEN_CLOSE}`, 'g'), (_match, index) => tokens[Number(index)] || '');
}

function isTableDivider(line) {
  const cells = String(line).trim().replace(/^\||\|$/g, '').split('|');
  return cells.length > 0 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
}

function tableCells(line) {
  return String(line).trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

function startsBlock(lines, index) {
  const line = lines[index] || '';
  return /^\s*$/.test(line)
    || /^\s*```/.test(line)
    || /^\s{0,3}#{1,6}\s+/.test(line)
    || /^\s{0,3}(?:[-+*]|\d+[.)])\s+/.test(line)
    || /^\s{0,3}>\s?/.test(line)
    || /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)
    || (index + 1 < lines.length && line.includes('|') && isTableDivider(lines[index + 1]));
}

export function renderMarkdown(value) {
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*```\s*([\w.+-]*)\s*$/);
    if (fence) {
      const body = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) body.push(lines[index++]);
      if (index < lines.length) index += 1;
      const language = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : '';
      output.push(`<pre><code${language}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      output.push('<hr>');
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && line.includes('|') && isTableDivider(lines[index + 1])) {
      const headers = tableCells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) rows.push(tableCells(lines[index++]));
      output.push(`<div class="codex-markdown-table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_header, cellIndex) => `<td>${renderInline(row[cellIndex] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^\s{0,3}>\s?/, ''));
      output.push(`<blockquote>${quote.map(renderInline).join('<br>')}</blockquote>`);
      continue;
    }

    const list = line.match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/);
    if (list) {
      const ordered = /^\d/.test(list[1]);
      const tag = ordered ? 'ol' : 'ul';
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        let content = item[2];
        const task = content.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) content = `<input type="checkbox" disabled${task[1].toLowerCase() === 'x' ? ' checked' : ''}> ${renderInline(task[2])}`;
        else content = renderInline(content);
        items.push(`<li>${content}</li>`);
        index += 1;
      }
      output.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && !startsBlock(lines, index)) paragraph.push(lines[index++].trim());
    output.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
  }
  return output.join('');
}
