"""Capture turtle window region for vision analysis."""
from PIL import Image
import subprocess

subprocess.run([
    "powershell", "-ExecutionPolicy", "Bypass", "-File",
    r"D:\all\lightframe\new_monitor\screenshot.ps1"
], capture_output=True)

img = Image.open(r"D:\all\lightframe\new_monitor\screenshot.png")
print(f"Screen: {img.size}")

# Window is 200x400, always-on-top, likely at default position
# Let's crop center-top area where the window should be
# Window anchor point is at center-top of window (physics.screenAnchorX = 0.5)
# So window center x = screen_width/2 = 853
# Window left = 853 - 100 = 753, right = 953
# Window top = 0, bottom = 400
# But rope hangs from top, so let's get more area above

# Try center of screen with some margin
cx = img.width // 2
left = cx - 120
right = cx + 120
top = 0
bottom = 500

crop = img.crop((left, top, right, bottom))
crop.save(r"D:\all\lightframe\new_monitor\turtle_window.png")
print(f"Turtle window crop: {crop.size}, region: ({left},{top})-({right},{bottom})")
