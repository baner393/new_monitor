"""Capture multiple frames of the turtle window."""
from PIL import Image
import subprocess
import time
import os

output_dir = r"D:\all\lightframe\new_monitor\frames"
os.makedirs(output_dir, exist_ok=True)

cx = 853  # Screen center x (1707/2)
left = cx - 120
right = cx + 120
top = 0
bottom = 500

for i in range(5):
    subprocess.run([
        "powershell", "-ExecutionPolicy", "Bypass", "-File",
        r"D:\all\lightframe\new_monitor\screenshot.ps1"
    ], capture_output=True)
    
    img = Image.open(r"D:\all\lightframe\new_monitor\screenshot.png")
    crop = img.crop((left, top, right, bottom))
    path = os.path.join(output_dir, f"frame_{i}.png")
    crop.save(path)
    print(f"Frame {i}: {crop.size} saved to {path}")
    
    if i < 4:
        time.sleep(1)

print("Done! 5 frames captured.")
