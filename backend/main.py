import asyncio
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import AsyncGenerator, Optional

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from chat_service import ChatService
from config_manager import ConfigManager
from heartbeat import HeartbeatSystem
from persona import load_persona
from providers import get_llm, get_stt

chat_service = ChatService()
heartbeat: HeartbeatSystem | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global heartbeat
    heartbeat = HeartbeatSystem(chat_service.emotional_state, chat_service.conversation_history)
    task = asyncio.create_task(heartbeat.start())
    yield
    # shutdown
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    # 生成日记
    try:
        state = chat_service.emotional_state
        if state.state["daily"]["interactions_today"] > 0:
            from diary import NanaDiary
            diary = NanaDiary(get_llm(), state)
            log_dir = os.path.join(os.path.dirname(__file__), "..", "save", "log")
            log_path = os.path.join(log_dir, f"{datetime.now().strftime('%Y%m%d')}.txt")
            if os.path.exists(log_path):
                with open(log_path, "r", encoding="utf-8") as f:
                    await diary.write_daily_entry(f.read())
    except Exception as e:
        print(f"[Diary] 关闭时生成日记失败: {e}")


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = "default"
    tts_enabled: Optional[bool] = True


@app.post("/api/chat")
async def chat(request: ChatRequest) -> StreamingResponse:
    async def event_stream() -> AsyncGenerator[str, None]:
        try:
            async for event in chat_service.generate_reply_stream(request.message, request.session_id or "default", tts_enabled=request.tts_enabled):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            error_event = {"type": "error", "content": str(e)}
            yield f"data: {json.dumps(error_event, ensure_ascii=False)}\n\n"
        finally:
            yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/status")
async def get_status() -> JSONResponse:
    persona = load_persona()
    return JSONResponse(content={
        "initialized": persona is not None,
        "persona": {
            "char_name": persona["char_name"],
            "user_name": persona["user_name"],
        } if persona else None,
    })


@app.get("/api/proactive")
async def get_proactive() -> JSONResponse:
    msg = heartbeat.pop_pending_message() if heartbeat else None
    if msg:
        return JSONResponse(content=msg)
    return JSONResponse(content={"message": None})



@app.post("/api/stt")
async def speech_to_text(
    file: UploadFile = File(...), format: str = Form("webm")
) -> JSONResponse:
    audio_data = await file.read()
    stt = get_stt()
    text = await stt.transcribe(audio_data, format=format)
    return JSONResponse(content={"text": text})


@app.get("/api/history")
async def get_history(session_id: str = "default", limit: int = 50) -> JSONResponse:
    messages = chat_service.db.get_history_for_frontend(limit=limit, session_id=session_id)
    return JSONResponse(content=messages)


@app.get("/api/config")
async def get_config() -> JSONResponse:
    return JSONResponse(content=ConfigManager.get_masked())


@app.post("/api/config")
async def update_config(body: dict) -> JSONResponse:
    ConfigManager.update(body)
    return JSONResponse(content=ConfigManager.get_masked())
