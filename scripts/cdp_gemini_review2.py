#!/usr/bin/env python3
"""Improved Gemini CDP review - better response extraction."""
import json, asyncio, time

TAB_ID = "9D1035735C2D49EC44CF2B971165DAED"
WS_URL = f"ws://127.0.0.1:9222/devtools/page/{TAB_ID}"

REVIEW_PROMPT = """请审核以下 Electron+PixiJS 桌面宠物应用的「标记区域」和「自动表情生成」代码。用中文回复，按 🔴严重/🟡中等/🟢低 分级。只报告重大问题。

## 背景
自定义模式皮肤转换器：用户上传图片，标记眼睛/嘴巴区域，自动生成6种表情。

## 代码段1：scaleRegion（像素区域缩放）
```javascript
function scaleRegion(grid, size, region, factor) {
    const { x, y, w, h } = region;
    const nw = Math.max(1, Math.round(w * factor));
    const nh = Math.max(1, Math.round(h * factor));
    const ox = x + Math.floor((w - nw) / 2);
    const oy = y + Math.floor((h - nh) / 2);
    const src = document.createElement('canvas'); src.width = w; src.height = h;
    const sctx = src.getContext('2d');
    for (let sy = 0; sy < h; sy++) for (let sx = 0; sx < w; sx++) {
      const c = grid[y + sy]?.[x + sx];
      if (c) { sctx.fillStyle = c; sctx.fillRect(sx, sy, 1, 1); }
    }
    const dst = document.createElement('canvas'); dst.width = nw; dst.height = nh;
    const dctx = dst.getContext('2d'); dctx.imageSmoothingEnabled = false;
    dctx.drawImage(src, 0, 0, nw, nh);
    for (let sy = 0; sy < h; sy++) for (let sx = 0; sx < w; sx++) {
      const gy = y + sy, gx = x + sx;
      if (gy >= 0 && gy < size && gx >= 0 && gx < size) grid[gy][gx] = null;
    }
    const img = dctx.getImageData(0, 0, nw, nh);
    for (let dy = 0; dy < nh; dy++) for (let dx = 0; dx < nw; dx++) {
      const i = (dy * nw + dx) * 4;
      if (img.data[i+3] > 128) {
        const gx = ox + dx, gy = oy + dy;
        if (gx >= 0 && gx < size && gy >= 0 && gy < size)
          grid[gy][gx] = 'rgb('+img.data[i]+','+img.data[i+1]+','+img.data[i+2]+')';
      }
    }
}
```

## 代码段2：curveRegion + shiftColumn
```javascript
function shiftColumn(grid, size, x, yStart, h, shift) {
    const col = [];
    for (let dy = 0; dy < h; dy++) {
      const gy = yStart + dy;
      col.push((gy >= 0 && gy < size) ? grid[gy][x] : null);
    }
    for (let dy = 0; dy < h; dy++) {
      const gy = yStart + dy;
      if (gy >= 0 && gy < size) grid[gy][x] = null;
    }
    for (let dy = 0; dy < h; dy++) {
      const srcIdx = dy + shift;
      const gy = yStart + dy;
      if (srcIdx >= 0 && srcIdx < h && gy >= 0 && gy < size) grid[gy][x] = col[srcIdx];
    }
}
function curveRegion(grid, size, region, dir) {
    const { x, y, w, h } = region;
    for (let dx = 0; dx < w; dx++) {
      const dist = Math.abs(dx - w / 2) / (w / 2);
      const shift = Math.round(dist * dir);
      if (shift !== 0) shiftColumn(grid, size, x + dx, y, h, shift);
    }
}
```

## 代码段3：replaceWithPainEyes
```javascript
function replaceWithPainEyes(grid, size, region) {
    const { x, y, w, h } = region;
    const half = Math.floor(w / 2);
    const eyeColor = grid[y]?.[x] || 'rgb(0,0,0)';
    clearRegion(grid, region);
    for (let dy = 0; dy < h; dy++) {
      const t = h > 1 ? dy / (h - 1) : 0.5;
      const indent = Math.round(t * half * 0.6);
      const gx1 = x + half - 1 - indent;
      const gx2 = x + half - 1 - indent + 1;
      if (gx1 >= x && gx1 < x + half && y + dy >= 0 && y + dy < size) grid[y + dy][gx1] = eyeColor;
      if (gx2 >= x && gx2 < x + half && y + dy >= 0 && y + dy < size) grid[y + dy][gx2] = eyeColor;
      const gx3 = x + half + indent;
      const gx4 = x + half + indent - 1;
      if (gx3 >= x + half && gx3 < x + w && y + dy >= 0 && y + dy < size) grid[y + dy][gx3] = eyeColor;
      if (gx4 >= x + half && gx4 < x + w && y + dy >= 0 && y + dy < size) grid[y + dy][gx4] = eyeColor;
    }
}
```

## 代码段4：坐标映射
```javascript
const scaleX = img.width / originalCanvas.clientWidth;
const scaleY = img.height / originalCanvas.clientHeight;
const eyes = { x: Math.round(autoExpr.eyes.x * scaleX), y: Math.round(autoExpr.eyes.y * scaleY),
               w: Math.round(autoExpr.eyes.w * scaleX), h: Math.round(autoExpr.eyes.h * scaleY) };
```

请特别关注：
1. scaleRegion 放大时扩展区域是否正确清除
2. curveRegion 的 shift 计算是否能产生可见的弯曲效果
3. replaceWithPainEyes 的 > < 形状是否正确
4. 坐标映射是否有双重缩放问题
"""

async def main():
    try:
        import websockets
    except ImportError:
        print("ERROR: pip install websockets")
        return

    async with websockets.connect(WS_URL, max_size=10*1024*1024) as ws:
        msg_id = 0

        async def send_cmd(method, params=None):
            nonlocal msg_id
            msg_id += 1
            cmd = {"id": msg_id, "method": method}
            if params:
                cmd["params"] = params
            await ws.send(json.dumps(cmd))
            while True:
                resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
                if resp.get("id") == msg_id:
                    return resp

        # 1. Wait for page
        print("Waiting for Gemini page to load...")
        await asyncio.sleep(10)

        # 2. Check page state and find input
        r = await send_cmd("Runtime.evaluate", {"expression": """
            (function(){
                // Check various input selectors
                var selectors = [
                    'textarea[placeholder*="Gemini"]',
                    'textarea[placeholder*="问问"]',
                    '.ql-editor[contenteditable="true"]',
                    'div[contenteditable="true"][role="textbox"]',
                    'textarea',
                    '[contenteditable="true"]'
                ];
                var found = [];
                for(var s of selectors) {
                    var el = document.querySelector(s);
                    if(el) found.push({selector: s, tag: el.tagName, visible: el.offsetParent !== null});
                }
                return JSON.stringify({
                    url: location.href,
                    title: document.title,
                    inputs: found,
                    mainExists: !!document.querySelector('main')
                });
            })()
        """})
        state = json.loads(r.get('result', {}).get('result', {}).get('value', '{}'))
        print(f"Page state: {json.dumps(state, indent=2, ensure_ascii=False)}")

        # Find the best input
        input_info = None
        for inp in state.get('inputs', []):
            if inp.get('visible'):
                input_info = inp
                break
        if not input_info and state.get('inputs'):
            input_info = state['inputs'][0]

        if not input_info:
            print("ERROR: No input found. Waiting 15s more...")
            await asyncio.sleep(15)
            r = await send_cmd("Runtime.evaluate", {"expression": """
                (function(){
                    var el = document.querySelector('textarea, [contenteditable="true"]');
                    return el ? el.tagName : 'NONE';
                })()
            """})
            tag = r.get('result', {}).get('result', {}).get('value', 'NONE')
            if tag == 'NONE':
                print("FATAL: Still no input found")
                return
            input_info = {'selector': 'textarea, [contenteditable="true"]', 'tag': tag}

        print(f"Using input: {input_info}")

        # 3. Focus and insert text
        selector = input_info['selector']
        r = await send_cmd("Runtime.evaluate", {"expression": f"""
            (function(){{
                var el = document.querySelector('{selector}');
                if(!el) return 'NO_EL';
                el.focus();
                return 'FOCUSED';
            }})()
        """})
        print(f"Focus result: {r.get('result', {}).get('result', {}).get('value')}")

        await asyncio.sleep(0.5)

        # Use Input.insertText
        r = await send_cmd("Input.insertText", {"text": REVIEW_PROMPT})
        print(f"Text inserted: {r}")
        await asyncio.sleep(2)

        # 4. Press Enter
        for evt in ["keyDown", "keyUp"]:
            await send_cmd("Input.dispatchKeyEvent", {
                "type": evt, "key": "Enter", "code": "Enter",
                "windowsVirtualKeyCode": 13, "nativeVirtualKeyCode": 13
            })
            if evt == "keyDown":
                await asyncio.sleep(0.1)

        print("Message sent! Waiting for response...")

        # 5. Wait for response - check multiple selectors
        prev_len = 0
        stable_count = 0
        for i in range(60):
            await asyncio.sleep(3)
            r = await send_cmd("Runtime.evaluate", {"expression": """
                (function(){
                    // Try multiple response selectors
                    var selectors = [
                        'message-content',
                        '.model-response-text',
                        '[data-message-author-role="model"]',
                        '.response-container',
                        'main .markdown'
                    ];
                    var allText = '';
                    for(var s of selectors) {
                        var els = document.querySelectorAll(s);
                        if(els.length > 0) {
                            allText = Array.from(els).map(e => e.innerText).join('\\n');
                            break;
                        }
                    }
                    if(!allText) {
                        // Fallback: get all main content
                        var main = document.querySelector('main');
                        allText = main ? main.innerText : '';
                    }
                    var spinner = document.querySelector('.loading-indicator, .thinking-indicator, [data-is-streaming="true"]');
                    var isGenerating = spinner && spinner.offsetParent !== null;
                    return JSON.stringify({len: allText.length, generating: isGenerating, preview: allText.substring(allText.length-200)});
                })()
            """})
            data_str = r.get('result', {}).get('result', {}).get('value', '{"len":0}')
            data = json.loads(data_str)

            if data.get('generating'):
                stable_count = 0
                if i % 5 == 0:
                    print(f"  Generating... ({data['len']} chars)")
            elif data['len'] > prev_len + 50:
                stable_count = 0
                prev_len = data['len']
                if i % 5 == 0:
                    print(f"  Growing... ({data['len']} chars)")
            else:
                stable_count += 1
                if stable_count >= 3:
                    print(f"Response stable at {data['len']} chars")
                    break

        # 6. Extract full response
        await asyncio.sleep(2)
        r = await send_cmd("Runtime.evaluate", {"expression": """
            (function(){
                // Get all model responses
                var selectors = [
                    'message-content',
                    '.model-response-text',
                    '[data-message-author-role="model"]',
                    '.response-container',
                    'main .markdown'
                ];
                for(var s of selectors) {
                    var els = document.querySelectorAll(s);
                    if(els.length > 0) {
                        var last = els[els.length - 1];
                        return last.innerText || last.textContent || '';
                    }
                }
                // Fallback: get last large text block from main
                var main = document.querySelector('main');
                if(!main) return 'NO_MAIN';
                var text = main.innerText;
                // Find the last substantial paragraph
                var lines = text.split('\\n').filter(l => l.length > 50);
                return lines.slice(-10).join('\\n');
            })()
        """})
        response = r.get('result', {}).get('result', {}).get('value', 'NO_RESPONSE')

        print("\\n" + "="*60)
        print("GEMINI 审核结果:")
        print("="*60)
        print(response[:8000])

        # Save to file
        with open("/mnt/d/all/lightframe/new_monitor/GEMINI_REVIEW.md", "w", encoding="utf-8") as f:
            f.write("# Gemini 代码审核结果\\n\\n")
            f.write(response)
        print("\\n\\nResults saved to GEMINI_REVIEW.md")

if __name__ == "__main__":
    asyncio.run(main())
