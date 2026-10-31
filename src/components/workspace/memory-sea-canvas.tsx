/** Canvas scene adapted from asdfd3/3d-memory-sea, MIT. See memory-sea.LICENSE. */
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  DEFAULT_SEA_CAMERA,
  SEA_FOCAL,
  layoutSea,
  projectSea,
  seaHash,
  visibleSeaEdges,
  type SeaCamera,
  type SeaEdge,
  type SeaPoint,
} from "@/lib/memory-sea-scene"
import "./memory-sea.css"

interface Props {
  points: SeaPoint[]
  edges: SeaEdge[]
  selected: string | null
  onSelect: (id: string | null) => void
}
export function MemorySeaCanvas({ points, edges, selected, onSelect }: Props) {
  const { t } = useTranslation()
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const camera = useRef<SeaCamera>({ ...DEFAULT_SEA_CAMERA })
  const [labels, setLabels] = useState(true)
  const [focus, setFocus] = useState(false)
  const [motion, setMotion] = useState(false)
  const [reset, setReset] = useState(0)
  const [canvasError, setCanvasError] = useState(false)
  const select = useRef(onSelect)
  useEffect(() => {
    select.current = onSelect
  }, [onSelect])
  useEffect(() => {
    const element = canvas.current
    const container = root.current
    if (!element || !container) return
    const context = element.getContext("2d")
    if (!context) {
      setCanvasError(true)
      return
    }
    const positions = layoutSea(points)
    const links = visibleSeaEdges(points, edges)
    const focusIds = new Set(selected ? [selected] : [])
    for (const edge of links) {
      if (edge.source === selected) focusIds.add(edge.target)
      if (edge.target === selected) focusIds.add(edge.source)
    }
    let width = 1,
      height = 1,
      frameId = 0
    let hovered: string | null = null
    let last = new Map<string, ReturnType<typeof projectSea>>()
    let drag: {
      x: number
      y: number
      camera: SeaCamera
      mode: "pan" | "orbit"
      moved: boolean
    } | null = null
    let active = true
    let lastFrame = -Infinity
    const draw = (time: number) => {
      frameId = 0
      if (!active) return
      if (motion && time - lastFrame < 32) {
        frameId = requestAnimationFrame(draw)
        return
      }
      lastFrame = time
      context.clearRect(0, 0, width, height)
      for (let i = 0; i < 140; i++) {
        context.fillStyle = `rgba(150,180,255,${0.07 + (seaHash(`alpha${i}`) % 100) / 1000})`
        context.fillRect(
          ((seaHash(`bg${i}`) % 1000) / 1000) * width,
          ((seaHash(`bgy${i}`) % 1000) / 1000) * height,
          1,
          1,
        )
      }
      last = new Map(
        positions.map((point) => {
          const drift = motion ? Math.sin(time / 3200 + seaHash(point.id)) * 5 : 0
          return [
            point.id,
            projectSea({ ...point, y: point.y + drift }, camera.current, width, height),
          ]
        }),
      )
      for (const edge of links) {
        const a = last.get(edge.source)!,
          b = last.get(edge.target)!
        if (a.depth < 140 || b.depth < 140) continue
        const hot =
          edge.source === selected ||
          edge.target === selected ||
          edge.source === hovered ||
          edge.target === hovered
        context.globalAlpha =
          focus && selected && !hot
            ? 0.04
            : Math.min(0.6, ((hot ? 0.45 : 0.12) * (a.scale + b.scale)) / 2)
        context.strokeStyle = hot ? "#9fc1ff" : "#7b99cb"
        context.lineWidth = hot ? 1.2 : 0.65
        context.beginPath()
        context.moveTo(a.x, a.y)
        context.lineTo(b.x, b.y)
        context.stroke()
      }
      const sorted = [...positions].sort((a, b) => last.get(b.id)!.depth - last.get(a.id)!.depth)
      for (const point of sorted) {
        const p = last.get(point.id)!
        if (p.depth < 140 || p.x < -80 || p.y < -80 || p.x > width + 80 || p.y > height + 80)
          continue
        const hot = point.id === selected || point.id === hovered
        const dim = focus && selected && !focusIds.has(point.id)
        const size = Math.max(0.8, point.radius * p.scale * (hot ? 2.2 : 1.75))
        context.globalAlpha = dim ? 0.1 : Math.min(1, 0.22 + p.scale)
        if (hot || (!dim && point.weight > 2)) {
          const glow = context.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 6)
          glow.addColorStop(0, `${point.color}66`)
          glow.addColorStop(1, `${point.color}00`)
          context.fillStyle = glow
          context.beginPath()
          context.arc(p.x, p.y, size * 6, 0, Math.PI * 2)
          context.fill()
        }
        if (hot) {
          context.strokeStyle = point.color
          context.lineWidth = 1
          context.beginPath()
          context.arc(p.x, p.y, size * 2.4, 0, Math.PI * 2)
          context.stroke()
        }
        context.fillStyle = point.color
        context.beginPath()
        context.arc(p.x, p.y, size, 0, Math.PI * 2)
        context.fill()
      }
      context.globalAlpha = 1
      const groups = new Map<string, { x: number; y: number; count: number }>()
      for (const point of positions) {
        const p = last.get(point.id)!
        if (p.depth < 140) continue
        const group = groups.get(point.group) ?? { x: 0, y: 0, count: 0 }
        group.x += p.x
        group.y += p.y
        group.count++
        groups.set(point.group, group)
      }
      context.font = '600 13px system-ui, "Microsoft YaHei", sans-serif'
      context.textAlign = "center"
      context.fillStyle = "#94a9cb"
      for (const [label, group] of groups)
        if (group.count >= 6)
          context.fillText(
            `${label} · ${group.count}`,
            group.x / group.count,
            group.y / group.count - 20,
          )
      context.textAlign = "left"
      if (labels) {
        const occupied = new Set<string>()
        const ranked = [...positions].sort(
          (a, b) =>
            (b.id === selected || b.id === hovered ? 100 : b.weight) -
            (a.id === selected || a.id === hovered ? 100 : a.weight),
        )
        context.font = '11px system-ui, "Microsoft YaHei", sans-serif'
        let count = 0
        for (const point of ranked) {
          const p = last.get(point.id)!
          if (
            p.depth < 140 ||
            p.scale < 0.55 ||
            count >= 160 ||
            (focus && selected && !focusIds.has(point.id))
          )
            continue
          const cell = `${Math.floor(p.x / 110)}:${Math.floor(p.y / 18)}`
          if (occupied.has(cell)) continue
          const title =
            [...point.title].slice(0, 18).join("") + ([...point.title].length > 18 ? "…" : "")
          if (
            p.x < 0 ||
            p.y < 0 ||
            p.x + context.measureText(title).width + 12 > width ||
            p.y > height
          )
            continue
          occupied.add(cell)
          count++
          context.fillStyle = point.id === selected || point.id === hovered ? "#edf3ff" : "#8799bb"
          context.fillText(title, p.x + 9, p.y - 5)
        }
      }
      if (motion && !document.hidden) frameId = requestAnimationFrame(draw)
    }
    const invalidate = () => {
      if (!frameId && active) frameId = requestAnimationFrame(draw)
    }
    const resize = () => {
      const rect = container.getBoundingClientRect()
      width = Math.max(1, rect.width)
      height = Math.max(1, rect.height)
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      element.width = Math.floor(width * ratio)
      element.height = Math.floor(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      invalidate()
    }
    const local = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }
    const pick = (x: number, y: number) => {
      let id: string | null = null,
        nearest = 16
      for (const point of positions) {
        const p = last.get(point.id)
        if (!p || p.depth < 140) continue
        const distance = Math.hypot(p.x - x, p.y - y)
        if (distance < nearest) {
          nearest = distance
          id = point.id
        }
      }
      return id
    }
    const down = (event: PointerEvent) => {
      if (event.button !== 0 && event.button !== 2) return
      event.preventDefault()
      const point = local(event)
      drag = {
        ...point,
        camera: { ...camera.current },
        mode: event.button === 2 || event.shiftKey ? "pan" : "orbit",
        moved: false,
      }
      element.setPointerCapture(event.pointerId)
      element.style.cursor = "grabbing"
    }
    const move = (event: PointerEvent) => {
      const p = local(event)
      if (drag) {
        const dx = p.x - drag.x,
          dy = p.y - drag.y
        drag.moved ||= Math.hypot(dx, dy) > 4
        if (drag.mode === "orbit") {
          camera.current.yaw = drag.camera.yaw + dx * 0.006
          camera.current.pitch = Math.max(-1.35, Math.min(1.35, drag.camera.pitch - dy * 0.006))
        } else {
          camera.current.panX = drag.camera.panX + (dx * camera.current.distance) / SEA_FOCAL
          camera.current.panY = drag.camera.panY + (dy * camera.current.distance) / SEA_FOCAL
        }
      } else {
        hovered = pick(p.x, p.y)
        element.style.cursor = hovered ? "pointer" : "grab"
      }
      invalidate()
    }
    const up = (event: PointerEvent) => {
      if (!drag) return
      if (!drag.moved && event.button === 0) {
        const p = local(event)
        select.current(pick(p.x, p.y))
      }
      drag = null
      element.style.cursor = "grab"
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
    }
    const cancel = () => {
      drag = null
      element.style.cursor = "grab"
    }
    const leave = () => {
      if (!drag) {
        hovered = null
        invalidate()
      }
    }
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      camera.current.distance = Math.min(
        3200,
        Math.max(380, camera.current.distance * (event.deltaY > 0 ? 1.08 : 0.92)),
      )
      invalidate()
    }
    const menu = (event: MouseEvent) => event.preventDefault()
    const visibility = () => {
      if (document.hidden && frameId) {
        cancelAnimationFrame(frameId)
        frameId = 0
      } else invalidate()
    }
    element.addEventListener("pointerdown", down)
    element.addEventListener("pointermove", move)
    element.addEventListener("pointerup", up)
    element.addEventListener("pointercancel", cancel)
    element.addEventListener("pointerleave", leave)
    element.addEventListener("wheel", wheel, { passive: false })
    element.addEventListener("contextmenu", menu)
    document.addEventListener("visibilitychange", visibility)
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()
    return () => {
      active = false
      cancelAnimationFrame(frameId)
      observer.disconnect()
      element.removeEventListener("pointerdown", down)
      element.removeEventListener("pointermove", move)
      element.removeEventListener("pointerup", up)
      element.removeEventListener("pointercancel", cancel)
      element.removeEventListener("pointerleave", leave)
      element.removeEventListener("wheel", wheel)
      element.removeEventListener("contextmenu", menu)
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [points, edges, selected, focus, labels, motion, reset])
  return (
    <div ref={root} className="memory-sea-canvas">
      <canvas ref={canvas} aria-label={t("workspace.seaCanvas")} />
      {canvasError && (
        <p role="alert" className="memory-sea-fallback">
          {t("workspace.canvasUnavailable")}
        </p>
      )}
      <div className="memory-sea-tools" role="toolbar" aria-label={t("workspace.starMap")}>
        <button aria-pressed={focus} onClick={() => setFocus((v) => !v)}>
          {t("workspace.focus")}
        </button>
        <button aria-pressed={labels} onClick={() => setLabels((v) => !v)}>
          {t("workspace.labels")}
        </button>
        <button aria-pressed={motion} onClick={() => setMotion((v) => !v)}>
          {t("workspace.motion")}
        </button>
        <button
          onClick={() => {
            camera.current = { ...DEFAULT_SEA_CAMERA }
            setReset((v) => v + 1)
          }}
        >
          {t("workspace.resetView")}
        </button>
      </div>
      <p className="memory-sea-hint">{t("workspace.seaHint")}</p>
    </div>
  )
}
