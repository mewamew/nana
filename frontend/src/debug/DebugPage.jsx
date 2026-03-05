import { useLayoutEffect, useRef, useState, useCallback, useMemo, useEffect } from 'react'
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import './DebugPage.css'

window.PIXI = PIXI

const STORAGE_KEY = 'debug-param-annotations'
const DEFAULT_EXPANDED = new Set([
  'ParamGroup6',  // 控制
  'ParamGroup10', // 面部参数
  'ParamGroup9',  // VB
  'ParamGroup5',  // 身体部件物理
])

function loadAnnotations() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}
  } catch { return {} }
}

export default function DebugPage() {
  const pixiContainerRef = useRef(null)
  const appRef = useRef(null)
  const modelRef = useRef(null)
  const paramValuesRef = useRef({})

  const [params, setParams] = useState([])
  const [groups, setGroups] = useState([])
  const [values, setValues] = useState({})
  const [collapsed, setCollapsed] = useState({})
  const [search, setSearch] = useState('')
  const [modelReady, setModelReady] = useState(false)
  // annotations: { [paramId]: { note: string, starred: bool } }
  const [annotations, setAnnotations] = useState(loadAnnotations)
  const [filterMode, setFilterMode] = useState('all') // 'all' | 'starred' | 'noted'

  // 持久化 annotations
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(annotations))
  }, [annotations])

  // 加载模型
  useLayoutEffect(() => {
    if (!pixiContainerRef.current) return

    const app = new PIXI.Application({
      width: 800,
      height: window.innerHeight,
      backgroundColor: 0x1a1a2e,
      antialias: true,
    })
    appRef.current = app
    pixiContainerRef.current.appendChild(app.view)

    let destroyed = false

    ;(async () => {
      try {
        const model = await Live2DModel.from('/models/PinkFox/PinkFox.model3.json')
        if (destroyed) return

        modelRef.current = model
        const mm = model.internalModel.motionManager
        mm.stopAllMotions()
        mm.state.shouldRequestIdleMotion = () => false
        model.autoInteract = false

        const scale = Math.min(
          app.view.width / model.width * 1.6,
          app.view.height / model.height * 1.6
        )
        model.scale.set(scale)
        model.x = app.view.width / 2
        model.y = app.view.height * 0.85
        model.anchor.set(0.5, 0.5)
        app.stage.addChild(model)

        const coreModel = model.internalModel.coreModel
        const count = coreModel._model.parameters.count
        const ids = coreModel._model.parameters.ids
        const mins = coreModel._model.parameters.minimumValues
        const maxs = coreModel._model.parameters.maximumValues
        const defaults = coreModel._model.parameters.defaultValues

        const paramList = []
        const defaultValues = {}
        for (let i = 0; i < count; i++) {
          paramList.push({ id: ids[i], min: mins[i], max: maxs[i], default: defaults[i] })
          defaultValues[ids[i]] = defaults[i]
        }

        const cdiRes = await fetch('/models/PinkFox/PinkFox.cdi3.json')
        const cdi = await cdiRes.json()

        const nameMap = {}
        const groupMap = {}
        for (const p of cdi.Parameters) {
          nameMap[p.Id] = p.Name
          groupMap[p.Id] = p.GroupId
        }

        const merged = paramList.map(p => ({
          ...p,
          name: nameMap[p.id] || '',
          groupId: groupMap[p.id] || 'ParamGroup7',
        }))

        const initCollapsed = {}
        for (const g of cdi.ParameterGroups) {
          initCollapsed[g.Id] = !DEFAULT_EXPANDED.has(g.Id)
        }

        setParams(merged)
        setGroups(cdi.ParameterGroups)
        setValues(defaultValues)
        paramValuesRef.current = defaultValues
        setCollapsed(initCollapsed)
        setModelReady(true)

        app.ticker.add(() => {
          if (!modelRef.current) return
          const cm = modelRef.current.internalModel.coreModel
          const vals = paramValuesRef.current
          for (const id in vals) {
            cm.setParameterValueById(id, vals[id])
          }
        })
      } catch (err) {
        console.error('Debug: model load error', err)
      }
    })()

    return () => {
      destroyed = true
      if (modelRef.current) { modelRef.current.destroy(); modelRef.current = null }
      if (appRef.current) { appRef.current.destroy(true); appRef.current = null }
    }
  }, [])

  const handleChange = useCallback((id, val) => {
    const v = Number(val)
    setValues(prev => {
      const next = { ...prev, [id]: v }
      paramValuesRef.current = next
      return next
    })
  }, [])

  const handleReset = useCallback((id, defaultVal) => {
    setValues(prev => {
      const next = { ...prev, [id]: defaultVal }
      paramValuesRef.current = next
      return next
    })
  }, [])

  const handleResetAll = useCallback(() => {
    const defaults = {}
    for (const p of params) defaults[p.id] = p.default
    setValues(defaults)
    paramValuesRef.current = defaults
  }, [params])

  const toggleGroup = useCallback((groupId) => {
    setCollapsed(prev => ({ ...prev, [groupId]: !prev[groupId] }))
  }, [])

  // 标注操作
  const toggleStar = useCallback((id) => {
    setAnnotations(prev => {
      const cur = prev[id] || {}
      return { ...prev, [id]: { ...cur, starred: !cur.starred } }
    })
  }, [])

  const setNote = useCallback((id, note) => {
    setAnnotations(prev => {
      const cur = prev[id] || {}
      return { ...prev, [id]: { ...cur, note } }
    })
  }, [])

  // 导出
  const handleExport = useCallback(() => {
    const groupNameMap = {}
    for (const g of groups) groupNameMap[g.Id] = g.Name

    const result = params
      .filter(p => {
        const a = annotations[p.id]
        return a && (a.starred || a.note)
      })
      .map(p => {
        const a = annotations[p.id]
        return {
          id: p.id,
          name: p.name,
          group: groupNameMap[p.groupId] || p.groupId,
          starred: !!a.starred,
          note: a.note || '',
          min: p.min,
          max: p.max,
          default: p.default,
        }
      })

    const blob = new Blob(
      [JSON.stringify(result, null, 2)],
      { type: 'application/json' }
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'param-annotations.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [params, groups, annotations])

  // 统计
  const stats = useMemo(() => {
    let starred = 0, noted = 0
    for (const a of Object.values(annotations)) {
      if (a.starred) starred++
      if (a.note) noted++
    }
    return { starred, noted }
  }, [annotations])

  const groupedParams = useMemo(() => {
    const map = {}
    for (const p of params) {
      if (!map[p.groupId]) map[p.groupId] = []
      map[p.groupId].push(p)
    }
    return map
  }, [params])

  // 搜索 + 过滤
  const filteredGroups = useMemo(() => {
    const hasSearch = search.trim().length > 0
    const hasFilter = filterMode !== 'all'
    if (!hasSearch && !hasFilter) return null

    const q = search.trim().toLowerCase()
    const result = {}
    for (const [gid, plist] of Object.entries(groupedParams)) {
      const filtered = plist.filter(p => {
        // 搜索过滤
        if (hasSearch) {
          if (!p.name.toLowerCase().includes(q) && !p.id.toLowerCase().includes(q)) return false
        }
        // 标注过滤
        if (hasFilter) {
          const a = annotations[p.id]
          if (filterMode === 'starred' && (!a || !a.starred)) return false
          if (filterMode === 'noted' && (!a || !a.note)) return false
        }
        return true
      })
      if (filtered.length > 0) result[gid] = filtered
    }
    return result
  }, [search, filterMode, groupedParams, annotations])

  return (
    <div className="debug-page">
      <div className="debug-model" ref={pixiContainerRef} />
      <div className="debug-panel">
        <div className="debug-panel-header">
          <div className="debug-title-row">
            <h2>Live2D 参数调试</h2>
            <span className="debug-stats">
              {stats.starred > 0 && <span className="debug-stat-star">{stats.starred} starred</span>}
              {stats.noted > 0 && <span className="debug-stat-note">{stats.noted} noted</span>}
            </span>
          </div>
          <div className="debug-toolbar">
            <input
              type="text"
              className="debug-search"
              placeholder="搜索参数名 / ID..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select
              className="debug-filter"
              value={filterMode}
              onChange={e => setFilterMode(e.target.value)}
            >
              <option value="all">全部</option>
              <option value="starred">仅星标</option>
              <option value="noted">仅有备注</option>
            </select>
          </div>
          <div className="debug-toolbar" style={{ marginTop: 6 }}>
            <button className="debug-btn debug-btn-export" onClick={handleExport}>
              导出标注
            </button>
            <button className="debug-btn debug-btn-reset" onClick={handleResetAll}>
              全部重置
            </button>
          </div>
        </div>
        <div className="debug-panel-body">
          {!modelReady && <div className="debug-loading">模型加载中...</div>}
          {modelReady && groups.map(g => {
            const displayParams = filteredGroups
              ? filteredGroups[g.Id]
              : groupedParams[g.Id]
            if (!displayParams || displayParams.length === 0) return null
            const isCollapsed = !filteredGroups && collapsed[g.Id]
            return (
              <div className="debug-group" key={g.Id}>
                <div className="debug-group-header" onClick={() => toggleGroup(g.Id)}>
                  <span className="debug-group-arrow">{isCollapsed ? '▶' : '▼'}</span>
                  <span className="debug-group-name">{g.Name}</span>
                  <span className="debug-group-count">{displayParams.length}</span>
                </div>
                {!isCollapsed && (
                  <div className="debug-group-body">
                    {displayParams.map(p => {
                      const a = annotations[p.id] || {}
                      return (
                        <div className={`debug-param ${a.starred ? 'debug-param--starred' : ''}`} key={p.id}>
                          <div className="debug-param-label">
                            <button
                              className={`debug-star ${a.starred ? 'debug-star--active' : ''}`}
                              onClick={() => toggleStar(p.id)}
                              title="星标"
                            >
                              {a.starred ? '\u2605' : '\u2606'}
                            </button>
                            <span className="debug-param-name">{p.name || p.id}</span>
                            <span className="debug-param-id">{p.id}</span>
                          </div>
                          <div className="debug-param-control">
                            <input
                              type="range"
                              min={p.min}
                              max={p.max}
                              step={(p.max - p.min) / 200}
                              value={values[p.id] ?? p.default}
                              onChange={e => handleChange(p.id, e.target.value)}
                            />
                            <span className="debug-param-value">
                              {(values[p.id] ?? p.default).toFixed(2)}
                            </span>
                            <button
                              className="debug-param-reset"
                              onClick={() => handleReset(p.id, p.default)}
                              title="重置"
                            >
                              ↺
                            </button>
                          </div>
                          <input
                            type="text"
                            className="debug-note"
                            placeholder="备注..."
                            value={a.note || ''}
                            onChange={e => setNote(p.id, e.target.value)}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
