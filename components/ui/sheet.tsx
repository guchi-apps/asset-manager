"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { ignoreAmountKeypad } from "@/lib/amount-keypad"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  onPointerDownOutside,
  onFocusOutside,
  onInteractOutside,
  swipeToClose = false,
  style,
  onPointerDown: onPointerDownProp,
  onPointerMove: onPointerMoveProp,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
  /**
   * side="bottom" のとき、`data-sheet-drag-handle` を付けた領域を下へ引くと、シートが指に追従して閉じる。
   * 暗幕の濃さも引いた量に連動する。
   */
  swipeToClose?: boolean
}) {
  const swipe = swipeToClose && side === "bottom"
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const drag = React.useRef<{ id: number; startY: number; lastY: number; lastT: number; v: number; height: number } | null>(null)
  const [dragY, setDragY] = React.useState(0)
  const [dragging, setDragging] = React.useState(false)
  const [dismissing, setDismissing] = React.useState(false)
  const moved = dragY > 0 || dismissing

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerDownProp?.(event)
    if (!swipe || dismissing || (event.pointerType === "mouse" && event.button !== 0)) return
    if (!(event.target instanceof Element) || !event.target.closest("[data-sheet-drag-handle]")) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { id: event.pointerId, startY: event.clientY, lastY: event.clientY, lastT: event.timeStamp, v: 0, height: event.currentTarget.offsetHeight }
    setDragging(true)
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerMoveProp?.(event)
    const d = drag.current
    if (!d || d.id !== event.pointerId) return
    const dt = event.timeStamp - d.lastT
    if (dt > 0) d.v = (event.clientY - d.lastY) / dt
    d.lastY = event.clientY
    d.lastT = event.timeStamp
    // 上へは動かさない
    setDragY(Math.max(0, event.clientY - d.startY))
  }
  const endDrag = (event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current
    if (!d || d.id !== event.pointerId) return
    drag.current = null
    setDragging(false)
    const dy = Math.max(0, event.clientY - d.startY)
    if (!cancelled && (dy > Math.min(120, d.height * 0.3) || (d.v > 0.6 && dy > 24))) {
      // 下まで送りきってから閉じる。Radixの閉じるアニメは0位置から始まるため、このときは無効にする
      setDismissing(true)
      setDragY(d.height)
      window.setTimeout(() => {
        closeRef.current?.click()
        window.setTimeout(() => {
          setDismissing(false)
          setDragY(0)
        }, 100)
      }, 200)
    } else {
      setDragY(0)
    }
  }

  return (
    <SheetPortal>
      <SheetOverlay
        className={cn(dismissing && "!animate-none")}
        style={moved ? { opacity: dismissing ? 0 : Math.max(0, 1 - dragY / 400), transition: dragging ? "none" : "opacity 200ms ease-out" } : undefined}
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        style={{
          ...style,
          ...(moved ? { transform: `translateY(${dragY}px)`, transition: dragging ? "none" : "transform 200ms ease-out" } : null),
        }}
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
          side === "right" &&
            "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
          side === "left" &&
            "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
          side === "top" &&
            "data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto border-b",
          side === "bottom" &&
            "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t",
          dismissing && "!animate-none",
          className
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endDrag(event, false)}
        onPointerCancel={(event) => endDrag(event, true)}
        onPointerDownOutside={(event) => {
          ignoreAmountKeypad(event)
          onPointerDownOutside?.(event)
        }}
        onFocusOutside={(event) => {
          ignoreAmountKeypad(event)
          onFocusOutside?.(event)
        }}
        onInteractOutside={(event) => {
          ignoreAmountKeypad(event)
          onInteractOutside?.(event)
        }}
        {...props}
      >
        {children}
        {swipe && <SheetPrimitive.Close ref={closeRef} tabIndex={-1} aria-hidden className="hidden" />}
        {showCloseButton && (
          <SheetPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-foreground font-semibold", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
