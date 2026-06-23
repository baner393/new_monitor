"""Capture a region around the turtle for vision analysis."""
from PIL import Image
import subprocess
import sys

# First take screenshot
subprocess.run([
    "powershell", "-ExecutionPolicy", "Bypass", "-File",
    r"D:\all\lightframe\new_monitor\screenshot.ps1"
], capture_output=True)

img = Image.open(r"D:\all\lightframe\new_monitor\screenshot.png")
print(f"Screen: {img.size}")

# The turtle window is 200x400, centered on screen
# Screen is 1707x1067, so window center is roughly (853, 533)
# Window top-left is roughly (753, 333)
# Rope connects from top of window to turtle

# Crop region: window area + some margin for rope
# x: 700-950, y: 100-700 (to capture rope from top)
crop = img.crop((700, 100, 950, 700))
crop.save(r"D:\all\lightframe\new_monitor\debug_crop.png")
print(f"Debug crop saved: {crop.size}")

# Also save a larger region for context
crop2 = img.crop((500, 0, 1200, 800))
crop2.save(r"D:\all\lightframe\new_monitor\debug_large.png")
print(f"Large crop saved: {crop2.size}")
