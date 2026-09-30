import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeMarkdownLink, renderMarkdown } from '../src/renderer/markdown.js';

test('Codex Markdown renders common blocks and inline formatting', () => {
  const html = renderMarkdown('# Title\n\n- **bold**\n- `code`\n\n> quote');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<ul><li><strong>bold<\/strong><\/li><li><code>code<\/code><\/li><\/ul>/);
  assert.match(html, /<blockquote>quote<\/blockquote>/);
});

test('Codex Markdown renders fenced code and tables', () => {
  const html = renderMarkdown('```js\nconst x = 1 < 2;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |');
  assert.match(html, /<pre><code class="language-js">const x = 1 &lt; 2;<\/code><\/pre>/);
  assert.match(html, /<table>.*<th>A<\/th>.*<td>2<\/td>.*<\/table>/);
});

test('Codex Markdown escapes raw HTML and rejects active link schemes', () => {
  const html = renderMarkdown('<script>alert(1)</script> [bad](javascript:alert(1)) [good](https://example.com/a)');
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /data-href="https:\/\/example\.com\/a"/);
  assert.equal(normalizeMarkdownLink('file:///C:/secret.txt'), '');
  assert.equal(normalizeMarkdownLink('https://openai.com/docs'), 'https://openai.com/docs');
});
