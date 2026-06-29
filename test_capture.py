import pyautogui
from PIL import Image

print("Screen size:", pyautogui.size())

# Take a screenshot of the whole screen
screenshot = pyautogui.screenshot()
screenshot.save(r"D:\all\lightframe\new_monitor\test_crops\fullscreen_check.png")
print("Full screen screenshot saved")

# Calculate turtle position
# Window at logical (-2, -50), inner size (1708x1068), DPR=1.5
# Turtle container at logical (854, 150) within window
# Physical coordinates:
#   window_origin_physical_x = -2 * 1.5 = -3
#   window_origin_physical_y = -50 * 1.5 = -75
#   turtle_physical_x = -3 + 854 * 1.5 = -3 + 1281 = 1278
#   turtle_physical_y = -75 + 150 * 1.5 = -75 + 225 = 150

dpr = 1.5
turtle_logical_x = 854
turtle_logical_y = 150
win_logical_x = -2
win_logical_y = -50

turtle_phys_x = int((turtle_logical_x + win_logical_x) * dpr)
turtle_phys_y = int((turtle_logical_y + win_logical_y) * dpr)

print(f"Turtle physical position: ({turtle_phys_x}, {turtle_phys_y})")

# Crop around the expected turtle area for verification
crop = screenshot.crop((
    max(0, turtle_phys_x - 100), 
    max(0, turtle_phys_y - 100), 
    min(pyautogui.size()[0], turtle_phys_x + 300), 
    min(pyautogui.size()[1], turtle_phys_y + 300)
))
crop.save(r"D:\all\lightframe\new_monitor\test_crops\turtle_area.png")
print("Turtle area crop saved")
