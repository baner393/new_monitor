"""Capture multiple frames to see rope animation."""
from PIL import Image
import subprocess
import time

subprocess.run([
    "powershell", "-ExecutionPolicy", "Bypass", "-File",
    r"D:\all\lightframe\new_monitor\screenshot.ps1"
], capture_output=True)

img = Image.open(r"D:\all\lightframe\new_monitor\screenshot.png")
cx = img.width // 2

# Crop turtle window area (centered, 200x400 + margin)
left = cx - 120
right = cx + 120
top = 0
bottom = 500

crop = img.crop((left, top, right, bottom))
crop.save(r"D:\all\lightframe\new_monitor\frame_0.png")
print(f"Frame 0 saved: {crop.size}")
print(f"Turtle should be in this region around ({cx}, 200)")
