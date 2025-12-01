import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'

// Constants
const MAX_IMAGE_WIDTH = 500
const MIN_DOT_DISTANCE = 0.12
const EDGE_PADDING = 0.08
const POSITION_RANGE = 1 - (EDGE_PADDING * 2)
const MAX_POSITION_ATTEMPTS = 50
const STATUS_TIMEOUT_MS = 5000
const HIGHLIGHT_DURATION_MS = 1500

interface Area {
  id: string
  name: string
}

interface Light {
  entity_id: string
  name: string
  supports_color: boolean
}

interface HAState {
  entity_id: string
  attributes: {
    friendly_name?: string
    supported_color_modes?: string[]
    is_hue_group?: boolean
  }
}

interface SamplePoint {
  id: string
  x: number
  y: number
  r: number
  g: number
  b: number
  lightName: string
}

function getErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// Convert RGB to HSL
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }
  return [h * 360, s * 100, l * 100]
}

// Convert HSL to RGB
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360; s /= 100; l /= 100
  let r, g, b

  if (s === 0) {
    r = g = b = l
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1/6) return p + (q - p) * 6 * t
      if (t < 1/2) return q
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
      return p
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1/3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1/3)
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

// Normalize color for smart bulbs - moderate boost to saturation and lightness
function normalizeColor(r: number, g: number, b: number): [number, number, number] {
  let [h, s, l] = rgbToHsl(r, g, b)

  // Moderate saturation boost for desaturated colors
  if (s < 40) {
    s = Math.min(100, s * 1.4 + 12)
  }

  // Lift dark colors (< 25% lightness)
  if (l < 25) {
    l = 25 + (l / 25) * 10 // Map 0-25 to 25-35
  }

  return hslToRgb(h, s, l)
}

async function haFetch(endpoint: string, token: string, options: RequestInit = {}, asText = false) {
  const resp = await fetch(`/ha-api${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  })
  if (!resp.ok) throw new Error(`API error: ${resp.status}`)
  return asText ? resp.text() : resp.json()
}

const PRESETS = [
  { name: 'Gradient', file: '/presets/gradient.jpg' },
  { name: 'Ocean', file: '/presets/ocean.jpg' },
  { name: 'Mountain Lake', file: '/presets/mountain-lake.jpg' },
  { name: 'Beach', file: '/presets/beach.jpg' },
  { name: 'Golden Hour', file: '/presets/golden-hour.jpg' },
  { name: 'Neon Hallway', file: '/presets/neon-hallway.jpg' },
  { name: 'Galaxy', file: '/presets/galaxy.jpg' },
  { name: 'Fireplace', file: '/presets/fireplace.jpg' },
  { name: 'Forest Sunbeam', file: '/presets/forest-sunbeam.jpg' },
  { name: 'Cherry Blossoms', file: '/presets/cherry-blossoms.jpg' },
  { name: 'Coral Reef', file: '/presets/coral-reef.jpg' },
  { name: 'Neon City', file: '/presets/neon-city.jpg' },
  { name: 'Aurora', file: '/presets/aurora.jpg' },
  { name: 'Autumn', file: '/presets/autumn.jpg' },
  { name: 'Stained Glass', file: '/presets/stained-glass.jpg' },
]

function App() {
  const [token, setToken] = useState(localStorage.getItem('ha-token') || '')
  const [connected, setConnected] = useState(false)
  const [areas, setAreas] = useState<Area[]>([])
  const [selectedArea, setSelectedArea] = useState('')
  const [lights, setLights] = useState<Light[]>([])
  const [selectedLights, setSelectedLights] = useState<Set<string>>(new Set())
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [samples, setSamples] = useState<SamplePoint[]>([])
  const [sceneName, setSceneName] = useState('Image Scene')
  const [brightness, setBrightness] = useState(255)
  const [status, setStatus] = useState<{ msg: string; type: 'success' | 'error'; key: number } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageDataRef = useRef<ImageData | null>(null)

  const connect = async () => {
    try {
      await haFetch('/', token)

      const areaResult = await haFetch('/template', token, {
        method: 'POST',
        body: JSON.stringify({ template: '{{ areas() | list | tojson }}' })
      }, true) as string
      const areaIds: string[] = JSON.parse(areaResult)

      const areasData: Area[] = []
      for (const areaId of areaIds) {
        const name = await haFetch('/template', token, {
          method: 'POST',
          body: JSON.stringify({ template: `{{ area_name('${areaId}') }}` })
        }, true) as string
        areasData.push({ id: areaId, name })
      }

      setAreas(areasData)
      setConnected(true)
      localStorage.setItem('ha-token', token)
      setStatus({ msg: 'Connected to Home Assistant', type: 'success', key: Date.now() })
    } catch (e) {
      setStatus({ msg: `Connection failed: ${getErrorMessage(e)}`, type: 'error', key: Date.now() })
    }
  }

  const loadLights = async (areaId: string) => {
    if (!areaId) {
      setLights([])
      return
    }

    try {
      const result = await haFetch('/template', token, {
        method: 'POST',
        body: JSON.stringify({
          template: `{{ area_entities('${areaId}') | select('match', 'light\\\\.') | list | tojson }}`
        })
      }, true) as string
      const lightIds: string[] = JSON.parse(result)

      const states: HAState[] = await haFetch('/states', token)
      const lightsData = lightIds.map(id => {
        const state = states.find(s => s.entity_id === id)
        return {
          entity_id: id,
          name: state?.attributes?.friendly_name || id,
          supports_color: state?.attributes?.supported_color_modes?.some(m =>
            ['rgb', 'rgbw', 'rgbww', 'hs', 'xy'].includes(m)
          ) || false,
          is_hue_group: state?.attributes?.is_hue_group === true
        }
      }).filter(l => l.supports_color && !l.is_hue_group)

      setLights(lightsData)
      setSelectedLights(new Set(lightsData.map(l => l.entity_id)))
    } catch (e) {
      setStatus({ msg: `Failed to load lights: ${getErrorMessage(e)}`, type: 'error', key: Date.now() })
    }
  }

  const loadImageFromSrc = (src: string) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return

      const scale = Math.min(1, MAX_IMAGE_WIDTH / img.width)
      canvas.width = img.width * scale
      canvas.height = img.height * scale

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      imageDataRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height)
      setImageUrl(src)
      setSamples([])
    }
    img.src = src
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedPreset(null)
    loadFile(file)
  }

  const loadFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = (ev) => {
      loadImageFromSrc(ev.target?.result as string)
    }
    reader.readAsDataURL(file)
    // Auto-generate scene name from filename
    const baseName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ')
    const capitalized = baseName.charAt(0).toUpperCase() + baseName.slice(1)
    setSceneName(capitalized)
  }

  const loadPreset = (presetFile: string) => {
    setSelectedPreset(presetFile)
    loadImageFromSrc(presetFile)
    // Auto-generate scene name from preset
    const preset = PRESETS.find(p => p.file === presetFile)
    if (preset) {
      setSceneName(preset.name)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) {
      setSelectedPreset(null)
      loadFile(file)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
  }

  const getColorAt = (x: number, y: number): [number, number, number] => {
    const data = imageDataRef.current
    if (!data) return [128, 128, 128]

    const px = Math.floor(x * data.width)
    const py = Math.floor(y * data.height)
    const idx = (py * data.width + px) * 4
    return [data.data[idx], data.data[idx + 1], data.data[idx + 2]]
  }

  const randomizeSamples = () => {
    const selected = lights.filter(l => selectedLights.has(l.entity_id))
    if (selected.length === 0 || !imageDataRef.current) {
      setStatus({ msg: 'Select lights and upload an image first', type: 'error', key: Date.now() })
      return
    }

    const positions: { x: number; y: number }[] = []

    const getValidPosition = (): { x: number; y: number } => {
      for (let attempts = 0; attempts < MAX_POSITION_ATTEMPTS; attempts++) {
        const x = EDGE_PADDING + Math.random() * POSITION_RANGE
        const y = EDGE_PADDING + Math.random() * POSITION_RANGE
        const tooClose = positions.some(
          p => Math.hypot(p.x - x, p.y - y) < MIN_DOT_DISTANCE
        )
        if (!tooClose) return { x, y }
      }
      return { x: EDGE_PADDING + Math.random() * POSITION_RANGE, y: EDGE_PADDING + Math.random() * POSITION_RANGE }
    }

    const newSamples: SamplePoint[] = selected.map(light => {
      const pos = getValidPosition()
      positions.push(pos)
      const [r, g, b] = getColorAt(pos.x, pos.y)
      return {
        id: light.entity_id,
        x: pos.x,
        y: pos.y,
        r,
        g,
        b,
        lightName: light.name
      }
    })

    setSamples(newSamples)
    setStatus({ msg: `Sampled ${newSamples.length} colors`, type: 'success', key: Date.now() })
  }

  const handleMouseDown = (sampleId: string) => {
    setDragging(sampleId)
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging || !containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    const [r, g, b] = getColorAt(x, y)

    setSamples(prev => prev.map(s =>
      s.id === dragging ? { ...s, x, y, r, g, b } : s
    ))
  }, [dragging])

  const handleMouseUp = useCallback(() => {
    setDragging(null)
  }, [])

  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [dragging, handleMouseMove, handleMouseUp])

  // Auto-connect if token exists (run once on mount)
  useEffect(() => {
    const savedToken = localStorage.getItem('ha-token')
    if (savedToken) {
      connect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-dismiss status
  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => setStatus(null), STATUS_TIMEOUT_MS)
      return () => clearTimeout(timer)
    }
  }, [status])

  const toggleLight = (entityId: string) => {
    setSelectedLights(prev => {
      const next = new Set(prev)
      if (next.has(entityId)) {
        next.delete(entityId)
      } else {
        next.add(entityId)
      }
      return next
    })
  }

  const createScene = async () => {
    const sceneId = sceneName.toLowerCase().replace(/[^a-z0-9]+/g, '_')

    interface SceneEntity {
      state: string
      rgb_color: [number, number, number]
      brightness: number
    }

    try {
      const entities: Record<string, SceneEntity> = {}
      for (const s of samples) {
        const [nr, ng, nb] = normalizeColor(s.r, s.g, s.b)
        entities[s.id] = {
          state: 'on',
          rgb_color: [nr, ng, nb],
          brightness
        }
      }

      await haFetch('/services/scene/create', token, {
        method: 'POST',
        body: JSON.stringify({
          scene_id: sceneId,
          snapshot_entities: [],
          entities
        })
      })

      await haFetch('/services/scene/turn_on', token, {
        method: 'POST',
        body: JSON.stringify({
          entity_id: `scene.${sceneId}`
        })
      })

      setStatus({ msg: `Scene "${sceneName}" created and activated! (scene.${sceneId})`, type: 'success', key: Date.now() })
    } catch (e) {
      setStatus({ msg: `Failed to create scene: ${getErrorMessage(e)}`, type: 'error', key: Date.now() })
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>HA Scene Generator</h1>
        <p className="subtitle">Create light scenes from image colors</p>
      </header>

      {!connected ? (
        <div className="connect-section">
          <label>Long-Lived Access Token</label>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="Your HA access token"
          />
          <button onClick={connect}>Connect</button>
        </div>
      ) : (
        <div className="main-grid">
          {/* Left Column - Controls */}
          <div className="left-column">
            <div className="section">
              <label>Select Area</label>
              <select
                value={selectedArea}
                onChange={e => {
                  setSelectedArea(e.target.value)
                  loadLights(e.target.value)
                }}
              >
                <option value="">-- Select an area --</option>
                {areas.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>

            {lights.length > 0 && (
              <div className="section">
                <label>Lights ({selectedLights.size}/{lights.length} selected)</label>
                <div className="lights-list">
                  {lights.map(l => (
                    <label key={l.entity_id} className="light-item">
                      <input
                        type="checkbox"
                        checked={selectedLights.has(l.entity_id)}
                        onChange={() => toggleLight(l.entity_id)}
                      />
                      <span className="light-name">{l.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="section">
              <label>Scene Name</label>
              <input
                type="text"
                value={sceneName}
                onChange={e => setSceneName(e.target.value)}
                placeholder="My Image Scene"
              />

              <label className="brightness-label">Brightness ({Math.round(brightness / 255 * 100)}%)</label>
              <input
                type="range"
                className="brightness-slider"
                min="1"
                max="255"
                value={brightness}
                onChange={e => setBrightness(Number(e.target.value))}
              />

              <button
                className="create-btn"
                onClick={createScene}
                disabled={samples.length === 0}
              >
                Create Scene
              </button>
            </div>
          </div>

          {/* Right Column - Visuals */}
          <div className="right-column">
            <div className="section">
              <label>Presets</label>
              <div className="presets">
                {PRESETS.map(p => (
                  <button
                    key={p.file}
                    className={`preset-btn ${selectedPreset === p.file ? 'active' : ''}`}
                    onClick={() => loadPreset(p.file)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="section">
              <div
                className={`drop-zone ${isDragOver ? 'drag-over' : ''} ${imageUrl ? 'has-image' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                {!imageUrl && (
                  <div className="drop-zone-content">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                    </svg>
                    <span>Drop image here or click to browse</span>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  style={{ display: 'none' }}
                />
              </div>

              <div
                className="preview-wrapper"
                style={{ display: imageUrl ? 'flex' : 'none' }}
              >
                <div
                  className="preview-container"
                  ref={containerRef}
                >
                  <canvas ref={canvasRef} className="preview" />
                  {samples.map(s => (
                    <div
                      key={s.id}
                      className={`sample-dot ${dragging === s.id ? 'dragging' : ''} ${highlighted === s.id ? 'highlighted' : ''}`}
                      style={{
                        left: `${s.x * 100}%`,
                        top: `${s.y * 100}%`,
                        backgroundColor: `rgb(${s.r},${s.g},${s.b})`
                      }}
                      onMouseDown={() => handleMouseDown(s.id)}
                      title={s.lightName}
                    />
                  ))}
                </div>
              </div>

              {samples.length > 0 && (
                <div className="swatches">
                  {samples.map(s => (
                    <div
                      key={s.id}
                      className="swatch-wrapper"
                      title={s.lightName}
                      onClick={() => {
                        setHighlighted(s.id)
                        setTimeout(() => setHighlighted(null), HIGHLIGHT_DURATION_MS)
                      }}
                    >
                      <div
                        className="swatch"
                        style={{ backgroundColor: `rgb(${s.r},${s.g},${s.b})` }}
                      />
                      <span className="swatch-label">{s.lightName}</span>
                    </div>
                  ))}
                </div>
              )}

              <button className="randomize-btn" onClick={randomizeSamples}>
                Randomize Samples
              </button>
            </div>
          </div>
        </div>
      )}

      {status && (
        <div key={status.key} className={`status ${status.type}`}>
          <div className="status-progress" />
          <span>{status.msg}</span>
        </div>
      )}
    </div>
  )
}

export default App
