import { useRef, useCallback } from "react"
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from "react"

// Pointer-aware activation (local copy; consolidate into @ui on next @kubuno/ui
// bump). Touch UIs have no double-click nor right-click: a single tap "opens",
// and a sustained press fires the context-menu handler.

export function isCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    (window.matchMedia("(pointer: coarse)").matches ||
      window.matchMedia("(hover: none)").matches)
  )
}

type AnyMouseEvent = { stopPropagation(): void; preventDefault(): void }

export function openable<E extends AnyMouseEvent>(opts: {
  open: (e: E) => void
  select?: (e: E) => void
}): { onClick: (e: E) => void; onDoubleClick: (e: E) => void } {
  return {
    onClick: (e) => {
      if (isCoarsePointer()) opts.open(e)
      else opts.select?.(e)
    },
    onDoubleClick: (e) => {
      if (!isCoarsePointer()) opts.open(e)
    },
  }
}

export function useLongPress(
  handler: (e: ReactMouseEvent) => void,
  opts: { ms?: number; moveTolerance?: number } = {},
) {
  const { ms = 500, moveTolerance = 12 } = opts
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)

  const cancel = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    origin.current = null
  }, [])

  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    if (e.touches.length !== 1) { cancel(); return }
    const t = e.touches[0]
    origin.current = { x: t.clientX, y: t.clientY }
    timer.current = setTimeout(() => {
      timer.current = null
      const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault() }
      window.addEventListener("click", swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true } as EventListenerOptions), 700)
      handler({
        clientX: t.clientX, clientY: t.clientY,
        preventDefault() {}, stopPropagation() {},
      } as unknown as ReactMouseEvent)
    }, ms)
  }, [handler, ms, cancel])

  const onTouchMove = useCallback((e: ReactTouchEvent) => {
    if (!origin.current) return
    const t = e.touches[0]
    if (Math.abs(t.clientX - origin.current.x) > moveTolerance ||
        Math.abs(t.clientY - origin.current.y) > moveTolerance) cancel()
  }, [cancel, moveTolerance])

  return { onTouchStart, onTouchMove, onTouchEnd: cancel, onTouchCancel: cancel }
}
