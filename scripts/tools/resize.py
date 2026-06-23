from PIL import Image
img = Image.open(r"D:\all\lightframe\new_monitor\screenshot.png")
print(f"Size: {img.size}")
img_resized = img.resize((img.width // 2, img.height // 2), Image.NEAREST)
img_resized.save(r"D:\all\lightframe\new_monitor\screenshot_small.png")
print("Resized saved")
