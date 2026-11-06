import { Logo } from "@/components/Logo"
import { Wallet, History, Sparkles } from "lucide-react"

export type TutorialStep = {
    title: string
    description: string
    icon: React.ReactNode
}

export const TUTORIAL_STEPS: TutorialStep[] = [
    {
        title: "ようこそ",
        description: "資産の推移や構成を管理できるよう、サンプルのデモデータを用意しました。このデータを使って基本的な使いかたをご案内します。",
        icon: <Logo className="h-16 w-16 text-primary" />,
    },
    {
        title: "資産を確認する",
        description: "「銀行預金」「S&P500」「個別株」といったカテゴリを作成済みです。カテゴリは親子の階層構造でも管理できます。",
        icon: <Wallet className="h-12 w-12 text-blue-500" />,
    },
    {
        title: "履歴で推移を追う",
        description: "元本や評価額の変動を記録すると、「投資資産」の画面に資産推移グラフが表示されます。",
        icon: <History className="h-12 w-12 text-purple-500" />,
    },
    {
        title: "タグで分類する",
        description: "「現金」「株式」などの分類タグを設定済みです。資産のバランスを一目で把握できます。",
        icon: <Sparkles className="h-12 w-12 text-emerald-500" />,
    },
]
