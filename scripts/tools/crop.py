from PIL import Image
img = Image.open(r"D:\all\lightframe\new_monitor\screenshot.png")
print(f"Size: {img.size}")
# Crop center area (where the turtle window should be, around 200x400 at center)
cx, cy = img.width // 2, img.height // 2
crop = img.crop((cx - 200, cy - 300, cx + 200, cy + 300))
crop.save(r"D:\all\lightframe\new_monitor\screenshot_crop.png")
print(f"Crop saved: {crop.size}")
