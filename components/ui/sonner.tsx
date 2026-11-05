"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  const pathname = usePathname() ?? ""
  // レシート詳細は画面下に固定の操作バー（高さ約69px）がある（#853）
  const hasActionBar = /^\/receipts\/\d+/.test(pathname)
  const navHeight = "var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px)"
  // スマホ幅（md未満）は下部タブの上、レシート詳細ではさらに操作バーの上へ出す
  const mobileBottom = `calc(${navHeight} + ${hasActionBar ? "88px" : "16px"})`

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // sonnerのモバイル判定（600px）とTailwindのmdブレークポイント（768px）がずれているため、
      // 600〜767px幅でも同じ位置に出るよう offset（デスクトップ用）にも同じ値を設定し、
      // md以上だけ CSS で下部タブぶんを 0 に戻す（--bottom-nav-height を md で 0 にする）
      offset={{ bottom: mobileBottom }}
      mobileOffset={{ bottom: mobileBottom }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
