"use client"

import * as React from "react"
import { User, LogOut, Mail, ShieldCheck, Edit2, AlertCircle, Trash2 } from "lucide-react"
import { useCurrentUser } from "@/components/providers/user-provider"
import { signOutAction } from "@/app/actions/auth"
import Image from "next/image"

import { Button } from "@/components/ui/button"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    CardFooter,
} from "@/components/ui/card"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { updateName, deleteAccount } from "@/app/actions/user-actions"
import { toast } from "sonner"

export default function ProfilePage() {
    const { user, updateUser } = useCurrentUser()
    const [isLoading, setIsLoading] = React.useState<string | null>(null)
    const [isEditingName, setIsEditingName] = React.useState(false)
    const [newName, setNewName] = React.useState("")
    const [isDialogOpen, setIsDialogOpen] = React.useState(false)

    React.useEffect(() => {
        if (user?.name) setNewName(user.name)
    }, [user])

    const handleLogout = () => {
        signOutAction()
    }

    const handleUpdateName = async () => {
        if (!newName || newName === user?.name) {
            setIsEditingName(false)
            return
        }
        setIsLoading("name")
        const res = await updateName(newName)
        if (res.success) {
            toast.success(res.success)
            updateUser({ name: newName })
            setIsEditingName(false)
        } else {
            toast.error(res.error)
        }
        setIsLoading(null)
    }

    const handleDeleteAccount = async () => {
        setIsLoading("delete")
        const res = await deleteAccount()
        if (res.success) {
            toast.success(res.success)
            signOutAction()
        } else {
            toast.error(res.error)
            setIsLoading(null)
            setIsDialogOpen(false)
        }
    }

    return (
        <div className="flex flex-col gap-6 px-2 py-4 md:px-4 md:py-8 max-w-4xl mx-auto animate-in fade-in duration-500">
            <div className="grid gap-8">
                {/* User Info Card */}
                <Card className="overflow-hidden border-none shadow-xl bg-card/50 backdrop-blur-xl transition-all duration-300">
                    <CardHeader className="pb-4">
                        <CardTitle className="flex items-center gap-2 text-xl">
                            <User className="h-5 w-5 text-primary" />
                            基本情報
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-8">
                        {/* Profile Header */}
                        <div className="flex flex-col md:flex-row items-center gap-6 p-6 rounded-2xl bg-muted/30 border border-border shadow-inner">
                            {user?.image ? (
                                <div className="h-24 w-24 rounded-full overflow-hidden border-4 border-background shadow-xl relative group">
                                    <Image
                                        src={user!.image}
                                        alt={user!.name || "User"}
                                        fill
                                        className="object-cover transition-transform duration-500 group-hover:scale-110"
                                    />
                                </div>
                            ) : (
                                <div className="h-24 w-24 rounded-full bg-primary/5 flex items-center justify-center border-4 border-background shadow-xl text-primary">
                                    <User className="h-12 w-12" />
                                </div>
                            )}
                            <div className="flex-1 text-center md:text-left space-y-2">
                                <h3 className="text-2xl font-bold tracking-tight">{user?.name || "ユーザー"}</h3>
                                <div className="flex items-center justify-center md:justify-start gap-2 text-muted-foreground">
                                    <Mail className="h-4 w-4" />
                                    <span className="text-sm">{user?.email}</span>
                                </div>
                                <div className="flex items-center justify-center md:justify-start gap-2 text-[10px] font-bold tracking-wider uppercase text-emerald-600 dark:text-emerald-400 mt-3 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full w-fit">
                                    <ShieldCheck className="h-3 w-3" />
                                    <span>認証済み</span>
                                </div>
                            </div>
                            <Button
                                variant="outline"
                                onClick={handleLogout}
                                className="group gap-2 border-destructive/20 hover:bg-destructive hover:text-white transition-all duration-300"
                            >
                                <LogOut className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
                                ログアウト
                            </Button>
                        </div>

                        {/* Settings Sections */}
                        <div className="space-y-6">
                            {/* Name Edit */}
                            <div className="rounded-xl border border-border bg-background/50 p-6 space-y-4 transition-all hover:bg-muted/10">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                        <h4 className="font-semibold text-sm">ユーザー名</h4>
                                        <p className="text-xs text-muted-foreground">アプリ内で表示される名前です。</p>
                                    </div>
                                    {!isEditingName && (
                                        <Button variant="ghost" size="sm" onClick={() => setIsEditingName(true)} className="text-primary hover:text-primary hover:bg-primary/10">
                                            <Edit2 className="h-4 w-4 mr-2" /> 編集
                                        </Button>
                                    )}
                                </div>

                                {isEditingName ? (
                                    <div className="flex gap-2 animate-in slide-in-from-top-2 duration-300">
                                        <Input
                                            value={newName}
                                            onChange={(e) => setNewName(e.target.value)}
                                            className="max-w-md h-10"
                                            autoFocus
                                        />
                                        <Button size="sm" onClick={handleUpdateName} disabled={isLoading === "name"} className="h-10">
                                            {isLoading === "name" ? "保存中..." : "保存"}
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => {
                                            setIsEditingName(false)
                                            setNewName(user?.name || "")
                                        }} className="h-10">
                                            キャンセル
                                        </Button>
                                    </div>
                                ) : (
                                    <p className="text-sm font-medium pl-1">{user?.name || "未設定"}</p>
                                )}
                            </div>

                            <div className="p-4 rounded-xl bg-primary/5 border border-primary/10 flex items-start gap-3">
                                <AlertCircle className="h-5 w-5 text-primary mt-0.5" />
                                <div className="space-y-1">
                                    <p className="text-sm font-medium text-primary">ソーシャルログイン</p>
                                    <p className="text-xs text-muted-foreground">
                                        このアカウントはGoogleで認証されています。
                                        メールアドレスやパスワードの変更は、Googleの管理画面から行ってください。
                                    </p>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                    <CardFooter className="bg-muted/20 border-t border-border p-4 flex justify-center">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]">Security Protocol Active</p>
                    </CardFooter>
                </Card>

                {/* Danger Zone */}
                <Card className="border-destructive/20 bg-destructive/5 backdrop-blur-xl">
                    <CardHeader>
                        <CardTitle className="text-destructive flex items-center gap-2">
                            <AlertCircle className="h-5 w-5" />
                            危険な操作
                        </CardTitle>
                        <CardDescription>
                            アカウントの削除を行うと、すべてのデータが完全に失われ、復元することはできません。
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="pb-6">
                        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                            <Button
                                variant="destructive"
                                className="w-full md:w-auto font-semibold"
                                onClick={() => setIsDialogOpen(true)}
                                disabled={isLoading === "delete"}
                            >
                                <Trash2 className="h-4 w-4 mr-2" />
                                アカウントを削除する
                            </Button>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>退会の確認</DialogTitle>
                                    <DialogDescription>
                                        本当にアカウントを削除しますか？<br />
                                        この操作は取り消せません。資産データ、トランザクション、設定など、すべてのデータが完全に失われます。
                                    </DialogDescription>
                                </DialogHeader>

                                <DialogFooter className="gap-2 sm:gap-0">
                                    <Button
                                        variant="destructive"
                                        onClick={handleDeleteAccount}
                                        disabled={isLoading === "delete"}
                                    >
                                        {isLoading === "delete" ? "削除中..." : "すべてを削除して退会する"}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        onClick={() => setIsDialogOpen(false)}
                                        disabled={isLoading === "delete"}
                                    >
                                        キャンセル
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
