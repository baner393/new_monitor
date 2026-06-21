"""Capture DevTools window and turtle area."""
from PIL import Image
import subprocess

subprocess.run([
    "powershell", "-ExecutionPolicy", "Bypass", "-File",
    r"D:\all\lightframe\new_monitor\screenshot.ps1"
], capture_output=True)

img = Image.open(r"D:\all\lightframe\new_monitor\screenshot.png")
print(f"Screen: {img.size}")

# Save full screenshot
img.save(r"D:\all\lightframe\new_monitor\full_screenshot.png")
print("Full screenshot saved")

# The DevTools window should be separate, let's capture the right side
# where DevTools typically appears
crop_right = img.crop((800, 0, 1707, 1067))
crop_right.save(r"D:\all\lightframe\new_monitor\devtools_area.png")
print(f"DevTools area saved: {crop_right.size}")
