#!/usr/bin/env python3
"""Send code review request to Gemini via CDP and extract response."""
import json, asyncio, time

TAB_ID = "9D1035735C2D49EC44CF2B971165DAED"
WS_URL = f"ws://127.0.0.1:9222/devtools/page/{TAB_ID}"

REVIEW_PROMPT = """请审核以下 Electron+PixiJS 桌面宠物应用的「标记区域」和「自动表情生成」代码。用中文回复，按 🔴严重/🟡中等/🟢低 分级。只报告重大问题。

## 背景
这是自定义模式（赞助者专属）的皮肤转换器功能。用户上传一张皮肤图片，标记眼睛和嘴巴区域，然后自动生成6种表情（idle/hover/pull/happy/pain/blink）。

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
    // Clear original region
    for (let sy = 0; sy < h; sy++) for (let sx = 0; sx < w; sx++) {
      const gy = y + sy, gx = x + sx;
      if (gy >= 0 && gy < size && gx >= 0 && gx < size) grid[gy][gx] = null;
    }
    // Write scaled pixels
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

## 代码段2：curveRegion + shiftColumn（弯曲变换）
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

## 代码段3：replaceWithPainEyes（痛苦表情眼睛）
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
// autoExpr.eyes 来自 selOverlay mouseup 事件，坐标已经通过 selOverlay.width / getBoundingClientRect().width 映射到 canvas 像素
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
5. 任何会导致功能不正常或崩溃的逻辑问题
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

        # 1. Wait for Gemini page to load
        print("Waiting for Gemini to load...")
        await asyncio.sleep(8)

        # 2. Focus input and insert text
        print("Inserting review request...")

        # Try textarea first, then ql-editor
        r = await send_cmd("Runtime.evaluate", {"expression": """
            (function(){
                var ta = document.querySelector('textarea[placeholder*="Gemini"]');
                var ql = document.querySelector('.ql-editor[contenteditable="true"]');
                var input = ta || ql;
                if (!input) return 'NO_INPUT';
                input.focus();
                return ta ? 'TEXTAREA' : 'QL_EDITOR';
            })()
        """})
        input_type = r.get('result', {}).get('result', {}).get('value', 'UNKNOWN')
        print(f"Input type: {input_type}")

        if input_type == 'NO_INPUT':
            print("ERROR: No input found, page may still be loading. Waiting 10s...")
            await asyncio.sleep(10)
            r = await send_cmd("Runtime.evaluate", {"expression": """
                (function(){
                    var ta = document.querySelector('textarea[placeholder*="Gemini"]');
                    var ql = document.querySelector('.ql-editor[contenteditable="true"]');
                    var input = ta || ql;
                    if (!input) return 'NO_INPUT';
                    input.focus();
                    return ta ? 'TEXTAREA' : 'QL_EDITOR';
                })()
            """})
            input_type = r.get('result', {}).get('result', {}).get('value', 'UNKNOWN')
            print(f"Input type (retry): {input_type}")

        if input_type == 'NO_INPUT':
            print("FATAL: Cannot find Gemini input box")
            return

        # Insert text using Input.insertText
        r = await send_cmd("Input.insertText", {"text": REVIEW_PROMPT})
        print(f"Text inserted: {r}")
        await asyncio.sleep(2)

        # 3. Scroll input into view and press Enter
        await send_cmd("Runtime.evaluate", {"expression": """
            (function(){
                var e = document.querySelector('.ql-editor') || document.querySelector('textarea');
                if(e) e.scrollIntoView({block:'center',behavior:'instant'});
                return 'done';
            })()
        """})
        await asyncio.sleep(0.5)

        # Press Enter to send
        for evt_type in ["keyDown", "keyUp"]:
            await send_cmd("Input.dispatchKeyEvent", {
                "type": evt_type,
                "key": "Enter",
                "code": "Enter",
                "windowsVirtualKeyCode": 13,
                "nativeVirtualKeyCode": 13
            })
            if evt_type == "keyDown":
                await asyncio.sleep(0.1)

        print("Message sent! Waiting for response...")

        # 4. Wait for response (content growth polling)
        prev_len = 0
        stable_count = 0
        for i in range(60):  # Up to 3 minutes
            await asyncio.sleep(3)
            r = await send_cmd("Runtime.evaluate", {"expression": """
                (function(){
                    var main = document.querySelector('main');
                    if(!main) return JSON.stringify({len:0, generating:false});
                    var text = main.innerText;
                    var spinner = document.querySelector('.loading-indicator, .thinking-indicator');
                    var isGenerating = spinner && spinner.offsetParent !== null;
                    return JSON.stringify({len: text.length, generating: isGenerating});
                })()
            """})
            data_str = r.get('result', {}).get('result', {}).get('value', '{"len":0}')
            data = json.loads(data_str)

            if data.get('generating'):
                stable_count = 0
                if i % 5 == 0:
                    print(f"  Generating... ({data['len']} chars)")
            elif data['len'] > prev_len + 20:
                stable_count = 0
                prev_len = data['len']
            else:
                stable_count += 1
                if stable_count >= 3:
                    print(f"Response complete! ({data['len']} chars)")
                    break

        # 5. Extract response
        await asyncio.sleep(2)
        r = await send_cmd("Runtime.evaluate", {"expression": """
            (function(){
                var main = document.querySelector('main');
                if(!main) return 'NO_MAIN';
                var text = main.innerText;
                var parts = text.split('Gemini 说');
                if(parts.length < 2) return text.substring(0,15000);
                var resp = parts[parts.length-1].trim();
                var markers = ['Pro 目前','Flash\\n扩展','Gemini 是一款','\\n\\n\\nPro '];
                for(var m of markers){
                    var idx = resp.indexOf(m);
                    if(idx > 0) resp = resp.substring(0, idx).trim();
                }
                return resp;
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
