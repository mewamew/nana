from config_manager import ConfigManager
from providers.llm.base import BaseLLMProvider
from providers.tts.base import BaseTTSProvider
from providers.stt.base import BaseSTTProvider
from providers.embedding.base import BaseEmbeddingProvider


def get_llm() -> BaseLLMProvider:
    cfg = ConfigManager.get_llm_config()
    active = cfg["active"]
    provider_cfg = cfg["providers"].get(active, {})

    from providers.llm.openai_compatible import OpenAICompatibleProvider
    return OpenAICompatibleProvider(active, provider_cfg)


def get_tts() -> BaseTTSProvider:
    cfg = ConfigManager.get_tts_config()
    active = cfg["active"]
    provider_cfg = cfg["providers"].get(active, {})

    if active == "fish_audio":
        from providers.tts.fish_audio import FishAudioProvider
        return FishAudioProvider(provider_cfg)
    elif active == "qwen3_tts":
        from providers.tts.qwen3_tts import Qwen3TTSProvider
        return Qwen3TTSProvider(provider_cfg)
    else:
        raise NotImplementedError(f"TTS provider '{active}' not supported.")


def get_stt() -> BaseSTTProvider:
    cfg = ConfigManager.get_stt_config()
    active = cfg["active"]
    provider_cfg = cfg["providers"].get(active, {})

    if active == "whisper_local":
        from providers.stt.whisper_local import WhisperLocalProvider
        return WhisperLocalProvider(provider_cfg)
    elif active == "qwen3_asr":
        from providers.stt.qwen3_asr import Qwen3ASRProvider
        return Qwen3ASRProvider(provider_cfg)
    else:
        raise NotImplementedError(f"STT provider '{active}' not supported.")


def get_embedding() -> BaseEmbeddingProvider | None:
    """返回 Embedding provider，未配置或无 api_key 时返回 None（降级为关键词匹配）"""
    cfg = ConfigManager.load()
    embedding_cfg = cfg.get("embedding")
    if not embedding_cfg:
        return None

    active = embedding_cfg.get("active", "")
    provider_cfg = embedding_cfg.get("providers", {}).get(active, {})
    if not provider_cfg:
        return None

    # 非本地服务（非 localhost）时需要 api_key
    base_url = provider_cfg.get("base_url", "")
    is_local = "localhost" in base_url or "127.0.0.1" in base_url
    if not is_local and not provider_cfg.get("api_key"):
        return None

    from providers.embedding.openai_compatible import OpenAICompatibleEmbedding
    provider = OpenAICompatibleEmbedding(provider_cfg)
    if not provider.is_configured():
        return None
    return provider
