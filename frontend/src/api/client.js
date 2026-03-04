const BASE_URL = "http://localhost:8000"

export const api = {
  /**
   * SSE 流式对话
   * callbacks: { onText, onExpression, onAudio, onDone, onError }
   */
  chatStream(message, callbacks = {}, options = {}) {
    const { onText, onExpression, onAudio, onDone, onError, onGenerationId } = callbacks
    const { signal } = options

    const run = async () => {
      const response = await fetch(`${BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, session_id: "default" }),
        signal,
      })

      if (!response.ok) {
        throw new Error(await readError(response))
      }

      if (!response.body) {
        throw new Error("Empty response body")
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // 按 \n\n 分割 SSE 事件
        let boundary = buffer.indexOf("\n\n")
        while (boundary !== -1) {
          const event = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)

          for (const line of event.split("\n")) {
            if (!line.startsWith("data:")) continue
            const data = line.slice(5).trim()
            try {
              const parsed = JSON.parse(data)
              switch (parsed.type) {
                case "generation_id":
                  onGenerationId?.(parsed.content)
                  break
                case "text":
                  onText?.(parsed.content)
                  break
                case "expression":
                  onExpression?.(parsed.content)
                  break
                case "audio":
                  onAudio?.(parsed.content)
                  break
                case "done":
                  onDone?.()
                  return
                case "error":
                  onError?.(parsed.content)
                  return
              }
            } catch {
              // 忽略解析失败的行
            }
          }

          boundary = buffer.indexOf("\n\n")
        }
      }
    }

    run().catch((err) => {
      if (err.name === "AbortError") return
      onError?.(err.message)
    })
  },

  async transcribe(audioBlob, format = "webm") {
    const formData = new FormData()
    formData.append("file", audioBlob, `audio.${format}`)
    formData.append("format", format)
    const res = await fetch(`${BASE_URL}/api/stt`, { method: "POST", body: formData })
    if (!res.ok) {
      throw new Error(await readError(res))
    }
    return res.json() // { text: "..." }
  },

  async getConfig() {
    const res = await fetch(`${BASE_URL}/api/config`)
    if (!res.ok) {
      throw new Error(await readError(res))
    }
    return res.json()
  },

  async getHistory(sessionId = "default", limit = 50) {
    const res = await fetch(`${BASE_URL}/api/history?session_id=${sessionId}&limit=${limit}`)
    if (!res.ok) {
      throw new Error(await readError(res))
    }
    return res.json() // [{ type, content }, ...]
  },

  async updateConfig(partial) {
    const res = await fetch(`${BASE_URL}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    })
    if (!res.ok) {
      throw new Error(await readError(res))
    }
    return res.json()
  },

  async getProactive() {
    const res = await fetch(`${BASE_URL}/api/proactive`)
    if (!res.ok) return { message: null }
    return res.json()
  },
}

async function readError(response) {
  try {
    const text = await response.text()
    return text || `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}
