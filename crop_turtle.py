from PIL import Image
img = Image.open(r"D:\all\lightframe\new_monitor\screenshot.png")
print(f"Size: {img.size}")
# Crop center area - the turtle should be around the center of the screen
# Window is 200x400, so turtle is around center
cx, cy = img.width // 2, img.height // 2
# Crop a 300x500 area around center to capture rope and turtle
crop = img.crop((cx - 150, cy - 350, cx + 150, cy + 150))
crop.save(r"D:\all\lightframe\new_monitor\screenshot_turtle.png")
print(f"Turtle crop saved: {crop.size}")
