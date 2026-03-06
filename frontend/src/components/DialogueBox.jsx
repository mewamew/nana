import { useState, useEffect, useRef, useCallback } from 'react'

function TypewriterText({ text, speed = 40, onComplete }) {
  const [displayed, setDisplayed] = useState('')
  const indexRef = useRef(0)
  const completedRef = useRef(false)

  useEffect(() => {
    setDisplayed('')
    indexRef.current = 0
    completedRef.current = false
  }, [text])

  useEffect(() => {
    if (!text || completedRef.current) return
    const timer = setInterval(() => {
      indexRef.current++
      if (indexRef.current >= text.length) {
        setDisplayed(text)
        completedRef.current = true
        clearInterval(timer)
        onComplete?.()
      } else {
        setDisplayed(text.slice(0, indexRef.current))
      }
    }, speed)
    return () => clearInterval(timer)
  }, [text, speed, onComplete])

  const skip = useCallback(() => {
    if (!completedRef.current && text) {
      completedRef.current = true
      setDisplayed(text)
      onComplete?.()
    }
  }, [text, onComplete])

  return (
    <span onClick={skip}>
      {displayed}
      {!completedRef.current && text && <span className="typewriter-cursor">|</span>}
    </span>
  )
}

export default function DialogueBox({ text, textVisible, isTypewriter, children }) {
  return (
    <>
      <div className={`dialogue-text-area ${textVisible && text ? 'visible' : 'hidden'}`}>
        <div className="dialogue-text">
          {isTypewriter ? <TypewriterText text={text} /> : text}
        </div>
      </div>
      <div className="dialogue-input-bar">
        {children}
      </div>
    </>
  )
}
