import Link from "next/link"
import { ChevronRight, Database, History, LogOut, Settings, User, type LucideIcon } from "lucide-react"
import { signOutAction } from "@/app/actions/auth"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const ITEMS: { title: string; description: string; url: string; icon: LucideIcon }[] = [
    { title: "プロフィール", description: "アカウント情報を確認します。", url: "/profile", icon: User },
    {
        title: "データ連携",
        description: "データ取得状況、Zaim連携、積立の自動登録を確認します。",
        url: "/data-fetch",
        icon: History,
    },
    {
        title: "データ管理",
        description: "カテゴリ・タグなどのデータを管理します。",
        url: "/data-management",
        icon: Database,
    },
    {
        title: "各種設定",
        description: "外観、評価額アラート、給料日、ヘルプを設定します。",
        url: "/settings/general",
        icon: Settings,
    },
]

export default function SettingsPage() {
    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-1 py-2 md:px-2 md:py-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {ITEMS.map((item) => (
                    <Link key={item.url} href={item.url} className="min-w-0">
                        <Card className="h-full transition-colors hover:bg-muted/50">
                            <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                                <item.icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                                <div className="min-w-0 flex-1">
                                    <CardTitle className="text-base">{item.title}</CardTitle>
                                    <CardDescription className="mt-1">{item.description}</CardDescription>
                                </div>
                                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                            </CardHeader>
                        </Card>
                    </Link>
                ))}
            </div>

            <form action={signOutAction}>
                <Button
                    type="submit"
                    variant="outline"
                    className="h-11 w-full gap-2 border-red-500/50 text-red-500 hover:bg-red-500/10 hover:text-red-600"
                >
                    <LogOut className="h-4 w-4" />
                    ログアウト
                </Button>
            </form>
        </div>
    )
}
