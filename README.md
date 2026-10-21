# cfu_count平板菌落计数；
https://unplage.github.io/cfu_count
count CFU
基于YOLO模型构建：通用识别模型；微调计数菌落模型；
菌落识别模型基于102张真实世界菌落平板（黑底），精度满足日常实验，后期可增加训练图片张数来提高精度；
可手动调节置信区间和loU值；
首次使用需联网下载模型与 ONNX Runtime 运行库，之后由浏览器缓存（IndexedDB + Service Worker）加载，可离线使用；建议首次加载完成后刷新一次，以启用完整的离线缓存；
