"""Crop turtle window area from test screenshots."""
from PIL import Image
import os

output_dir = r"D:\all\lightframe\new_monitor\test_crops"
os.makedirs(output_dir, exist_ok=True)

# Screen is 2560x1600, turtle window is 200x400 centered
# Window center: (1280, 800)
# Window area: (1180, 600) to (1380, 1000)
left = 1130
top = 550
right = 1430
bottom = 1050

files = [
    ("test_before.png", "01_before"),
    ("test_dragging.png", "02_dragging"),
    ("test_after.png", "03_after_left"),
    ("test_final.png", "04_after_right"),
]

for src_name, dst_name in files:
    src = os.path.join(r"D:\all\lightframe\new_monitor", src_name)
    if os.path.exists(src):
        img = Image.open(src)
        crop = img.crop((left, top, right, bottom))
        dst = os.path.join(output_dir, f"{dst_name}.png")
        crop.save(dst)
        print(f"{dst_name}: {crop.size}")
    else:
        print(f"{src_name}: not found")

print("Done!")
