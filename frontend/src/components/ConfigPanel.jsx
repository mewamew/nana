import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import './ConfigPanel.css'

const TABS = ['llm', 'tts', 'stt', 'embedding']
const TAB_LABELS = { llm: 'LLM 语言模型', tts: 'TTS 语音合成', stt: 'STT 语音识别', embedding: 'Embedding 向量化' }

export default function ConfigPanel({ onClose }) {
  const [config, setConfig] = useState(null)
  const [activeTab, setActiveTab] = useState('llm')
  const [saving, setSaving] = useState(false)
  const [expandedProviders, setExpandedProviders] = useState(new Set())
  const originalRef = useRef(null)
  const dirtyRef = useRef(new Set())

  useEffect(() => {
    let mounted = true
    api.getConfig()
      .then(cfg => {
        if (!mounted) return
        setConfig(cfg)
        originalRef.current = cfg
        dirtyRef.current = new Set()
      })
      .catch(err => console.error('[ConfigPanel] 加载失败:', err))
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!config) return
    const active = config[activeTab]?.active
    setExpandedProviders(new Set(active ? [active] : []))
  }, [activeTab, config])

  const markDirty = (path, value) => {
    if (!originalRef.current) {
      return
    }
    const originalValue = getPathValue(originalRef.current, path)
    if (originalValue === value) {
      dirtyRef.current.delete(path)
    } else {
      dirtyRef.current.add(path)
    }
  }

  const setActiveProvider = (section, value) => {
    setConfig(c => {
      if (!c) return c
      return {
        ...c,
        [section]: { ...c[section], active: value },
      }
    })
    markDirty(`${section}.active`, value)
    setExpandedProviders(prev => {
      const next = new Set(prev)
      next.add(value)
      return next
    })
  }

  const setField = (section, provider, field, value) => {
    setConfig(c => {
      if (!c) return c
      return {
        ...c,
        [section]: {
          ...c[section],
          providers: {
            ...c[section].providers,
            [provider]: { ...c[section].providers[provider], [field]: value },
          },
        },
      }
    })
    markDirty(`${section}.providers.${provider}.${field}`, value)
  }

  const toggleProvider = (provider) => {
    setExpandedProviders(prev => {
      const next = new Set(prev)
      if (next.has(provider)) {
        next.delete(provider)
      } else {
        next.add(provider)
      }
      return next
    })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const partial = buildPartialUpdate(config, dirtyRef.current)
      await api.updateConfig(partial)
      onClose()
    } catch (err) {
      console.error('[ConfigPanel] 保存失败:', err)
    } finally {
      setSaving(false)
    }
  }

  if (!config) {
    return (
      <div className="config-overlay">
        <div className="config-card">
          <p className="config-loading">加载中...</p>
        </div>
      </div>
    )
  }

  const section = config[activeTab]
  const activeProvider = section?.active
  const providers = Object.entries(section?.providers || {})

  return (
    <div className="config-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="config-card">
        <div className="config-header">
          <h2>设置</h2>
          <button className="config-close" onClick={onClose}>×</button>
        </div>

        <div className="config-tabs">
          {TABS.map(tab => (
            <button
              key={tab}
              className={`config-tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        <div className="config-body">
          {/* Provider 选择 */}
          <div className="config-field">
            <label>当前 Provider</label>
            <select
              value={activeProvider}
              onChange={e => setActiveProvider(activeTab, e.target.value)}
            >
              {providers.map(([name]) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>

          {/* Provider 配置（折叠展示） */}
          <div className="provider-list">
            {providers.map(([providerName, providerCfg]) => {
              const expanded = expandedProviders.has(providerName)
              const showWarn = hasApiKey(providerCfg) && !providerCfg.api_key
              return (
                <div
                  key={providerName}
                  className={`provider-card ${providerName === activeProvider ? 'active' : ''}`}
                >
                  <button
                    type="button"
                    className="provider-toggle"
                    onClick={() => toggleProvider(providerName)}
                  >
                    <span className="provider-title">
                      <span className="provider-name">{providerName}</span>
                      {providerName === activeProvider && (
                        <span className="provider-active">当前</span>
                      )}
                    </span>
                    <span className="provider-meta">
                      {showWarn && (
                        <span className="provider-warn" title="未配置">!</span>
                      )}
                      <span className={`provider-arrow ${expanded ? 'expanded' : ''}`}>▾</span>
                    </span>
                  </button>

                  {expanded && (
                    <div className="provider-fields">
                      {Object.entries(providerCfg || {}).map(([field, value]) => (
                        <div className="config-field" key={field}>
                          <label>{field}</label>
                          <input
                            type={field === 'api_key' ? 'password' : 'text'}
                            value={value || ''}
                            onChange={e => setField(activeTab, providerName, field, e.target.value)}
                            placeholder={field === 'api_key' ? '输入 API Key' : ''}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="config-footer">
          <button className="config-save" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function buildPartialUpdate(config, dirtyPaths) {
  const partial = {}
  for (const path of dirtyPaths) {
    const value = getPathValue(config, path)
    if (value === undefined) continue
    if (path.endsWith('.api_key') && value === '***') continue
    setPathValue(partial, path, value)
  }
  return partial
}

function getPathValue(obj, path) {
  return path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), obj)
}

function setPathValue(obj, path, value) {
  const keys = path.split('.')
  let cursor = obj
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i]
    if (!cursor[key] || typeof cursor[key] !== 'object') {
      cursor[key] = {}
    }
    cursor = cursor[key]
  }
  cursor[keys[keys.length - 1]] = value
}

function hasApiKey(providerCfg) {
  return providerCfg && Object.prototype.hasOwnProperty.call(providerCfg, 'api_key')
}
