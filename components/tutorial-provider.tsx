"use client"

import React from "react"
import { useCurrentUser } from "@/components/providers/user-provider"
import { completeTutorial } from "@/app/actions/user-actions"
import { TUTORIAL_STEPS } from "@/components/tutorial-steps"

type TutorialContextValue = {
    open: boolean
    currentStep: number
    totalSteps: number
    isLastStep: boolean
    onOpenChange: (open: boolean) => void
    next: () => void
    back: () => void
    skip: () => void
    /** 完了済みでも、設定画面などから改めてチュートリアルを開く */
    openTutorial: () => void
}

const TutorialContext = React.createContext<TutorialContextValue | null>(null)

export function useTutorial() {
    const ctx = React.useContext(TutorialContext)
    if (!ctx) {
        throw new Error("useTutorial は TutorialProvider の内側で使用してください")
    }
    return ctx
}

export function TutorialProvider({ children }: { children: React.ReactNode }) {
    const { user, updateUser } = useCurrentUser()
    const [open, setOpen] = React.useState(false)
    const [currentStep, setCurrentStep] = React.useState(0)

    // 初回ログイン時（チュートリアル未完了）は自動的に開く
    React.useEffect(() => {
        if (user && !user.hasCompletedTutorial) {
            setOpen(true)
        }
    }, [user])

    const complete = React.useCallback(async () => {
        setOpen(false)
        // 再表示のみのときは、完了済みフラグの再更新をスキップする
        if (user && !user.hasCompletedTutorial) {
            await completeTutorial()
            updateUser({ hasCompletedTutorial: true })
        }
    }, [user, updateUser])

    const next = React.useCallback(() => {
        if (currentStep < TUTORIAL_STEPS.length - 1) {
            setCurrentStep(step => step + 1)
        } else {
            complete()
        }
    }, [currentStep, complete])

    const back = React.useCallback(() => {
        setCurrentStep(step => Math.max(0, step - 1))
    }, [])

    const openTutorial = React.useCallback(() => {
        setCurrentStep(0)
        setOpen(true)
    }, [])

    // Escape・オーバーレイクリック・閉じるボタンでの離脱は、完了扱いにせず単に閉じるだけにする
    // （完了扱いは「はじめる」「スキップ」など明示的な操作のみで行う）
    const onOpenChange = React.useCallback((nextOpen: boolean) => {
        setOpen(nextOpen)
    }, [])

    const value = React.useMemo<TutorialContextValue>(() => ({
        open,
        currentStep,
        totalSteps: TUTORIAL_STEPS.length,
        isLastStep: currentStep === TUTORIAL_STEPS.length - 1,
        onOpenChange,
        next,
        back,
        skip: complete,
        openTutorial,
    }), [open, currentStep, onOpenChange, next, back, complete, openTutorial])

    return (
        <TutorialContext.Provider value={value}>
            {children}
        </TutorialContext.Provider>
    )
}
