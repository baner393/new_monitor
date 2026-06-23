"""Automated drag test for Turtle Monitor."""
import sys
import io
import time
import subprocess

# Fix Windows encoding
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import pyautogui
from PIL import ImageGrab

# Screen center (where turtle should be)
screen_w, screen_h = pyautogui.size()
center_x = screen_w // 2
center_y = screen_h // 2

print(f"Screen: {screen_w}x{screen_h}")
print(f"Turtle should be near: ({center_x}, {center_y})")

# Take initial screenshot
img = ImageGrab.grab()
img.save(r"D:\all\lightframe\new_monitor\test_before.png")
print("Saved test_before.png")

# Simulate drag: click at center, drag down-left, release
print("\n--- Test 1: Drag down-left ---")
start_x = center_x
start_y = center_y - 50  # Slightly above center (turtle position)
end_x = center_x - 100   # Drag left
end_y = center_y + 150   # Drag down

print(f"Click at ({start_x}, {start_y})")
pyautogui.moveTo(start_x, start_y, duration=0.3)
time.sleep(0.2)

print(f"Drag to ({end_x}, {end_y})")
pyautogui.mouseDown()
time.sleep(0.1)
pyautogui.moveTo(end_x, end_y, duration=0.5)
time.sleep(0.3)

# Take screenshot during drag
img_drag = ImageGrab.grab()
img_drag.save(r"D:\all\lightframe\new_monitor\test_dragging.png")
print("Saved test_dragging.png")

print("Release")
pyautogui.mouseUp()
time.sleep(0.5)

# Take screenshot after release
img_after = ImageGrab.grab()
img_after.save(r"D:\all\lightframe\new_monitor\test_after.png")
print("Saved test_after.png")

print("\n--- Test 2: Drag down-right ---")
start_x = center_x
start_y = center_y - 50
end_x = center_x + 100   # Drag right
end_y = center_y + 150   # Drag down

print(f"Click at ({start_x}, {start_y})")
pyautogui.moveTo(start_x, start_y, duration=0.3)
time.sleep(0.2)

print(f"Drag to ({end_x}, {end_y})")
pyautogui.mouseDown()
time.sleep(0.1)
pyautogui.moveTo(end_x, end_y, duration=0.5)
time.sleep(0.3)

print("Release")
pyautogui.mouseUp()
time.sleep(0.5)

# Take final screenshot
img_final = ImageGrab.grab()
img_final.save(r"D:\all\lightframe\new_monitor\test_final.png")
print("Saved test_final.png")

print("\n[DONE] All tests completed. Check screenshots.")
