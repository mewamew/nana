请分析以下对话记录，提取信息：

## 对话记录
{conversation_text}

## 要求
请严格按以下 JSON 格式返回（不要包含其他文字）：
{{
  "summary": "对话摘要，100字以内，保留关键信息和重要细节",
  "topics": "话题关键词，逗号分隔，如：美食,旅行,工作",
  "emotional_valence": -1到1的浮点数，表示对话的情感色彩（-1很负面，0中性，1很正面），
  "emotional_tags": ["情绪标签数组，如：开心, 害羞"],
  "importance": 0到1的浮点数（日常闲聊0.2，重要事件0.8+），
  "user_facts": {{
    "basic_info": {{}},
    "preferences": [],
    "interests": [],
    "life_events": [],
    "relationships": [],
    "other_facts": []
  }}
}}

注意：
- summary 必须简洁，概括对话的核心内容
- emotional_valence 反映整段对话的情感倾向
- emotional_tags 记录对话中出现的主要情绪
- importance 反映对话内容的重要程度
- user_facts 中只填写本次对话中**新发现**的用户信息，没有则留空数组/空对象
- basic_info 只填写明确提到的字段（name/gender/location/occupation/birthday）
- 不要编造信息，只提取用户明确说过的内容