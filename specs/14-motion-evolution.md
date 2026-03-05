# 14-motion-evolution — 动作自进化系统

**Status: ❌ Removed — 已被 spec 17 取代**

## 尝试了什么

LLM 驱动的动作生成：LLM 回复时从库中选动作，库中不存在时调 LLM 生成关键帧（简化 JSON 格式），前端 `requestAnimationFrame` 线性插值播放。预置 10 个种子动作，库随对话积累增长（"自进化"）。

## 为什么失败

LLM 无法理解 Live2D 参数与视觉效果的映射关系，生成的关键帧值域不准确，动作效果僵硬、不自然。本质上是 LLM 对连续参数空间没有视觉感知。

## 替代方案

见 **spec 17**：用摄像头捕捉真人动作（MediaPipe），录制为 Live2D 原生 motion3.json，直接回放。真人动作天然自然，Live2D SDK 内置插值和过渡。
