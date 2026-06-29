"""
录制左键下拉回弹全流程
"""
import subprocess
import time

# ── 启动 ffmpeg 录屏 ──
print("Starting ffmpeg recording...")
ffmpeg_cmd = [
    r"D:\all\anaconda3\Library\bin\ffmpeg.exe",
    "-f", "gdigrab",
    "-framerate", "20",
    "-offset_x", "0",
    "-offset_y", "0",
    "-video_size", "2560x1600",
    "-i", "desktop",
    "-t", "10",           # 录10秒
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "28",
    "-pix_fmt", "yuv420p",
    "-y",
    r"D:\all\lightframe\new_monitor\test_crops\drag_test.mp4"
]

ffmpeg_proc = subprocess.Popen(ffmpeg_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print(f"ffmpeg started (PID: {ffmpeg_proc.pid})")
time.sleep(1)  # 等ffmpeg初始化

# ── 执行拖拽测试 ──
import pyautogui
pyautogui.FAILSAFE = True

DPR = 1.5
TURTLE_CSS_X = 854
TURTLE_CSS_Y = 150
WIN_CSS_X = -2
WIN_CSS_Y = -50

turtle_x = int((TURTLE_CSS_X + WIN_CSS_X) * DPR)
turtle_y = int((TURTLE_CSS_Y + WIN_CSS_Y) * DPR)
drag_distance = 300  # 物理像素

print(f"\nTurtle: ({turtle_x}, {turtle_y})")
print(f"Drag: {turtle_x}, {turtle_y} → {turtle_x}, {turtle_y + drag_distance}")

# Phase 1: 移到乌龟
print("1. Moving to turtle...")
pyautogui.moveTo(turtle_x, turtle_y, duration=0.5)
time.sleep(0.8)

# Phase 2: 鼠标按下
print("2. Mouse down...")
pyautogui.mouseDown(button='left')
time.sleep(0.15)

# Phase 3: 拖拽
print("3. Dragging down...")
steps = 40
for i in range(1, steps + 1):
    progress = i / steps
    current_y = int(turtle_y + progress * drag_distance)
    pyautogui.moveTo(turtle_x, current_y, duration=0.015)
    time.sleep(0.008)

time.sleep(0.3)

# Phase 4: 释放
print("4. Release!")
pyautogui.mouseUp(button='left')

# 等回弹动画
print("5. Waiting for bounce...")
time.sleep(2.5)

# ── 停止录屏 ──
print("Stopping recording...")
ffmpeg_proc.terminate()
try:
    ffmpeg_proc.wait(timeout=5)
except:
    ffmpeg_proc.kill()

print("\nDone! Video saved to D:\\all\\lightframe\\new_monitor\\test_crops\\drag_test.mp4")