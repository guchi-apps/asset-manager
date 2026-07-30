"use client"

import * as React from "react"

export type CurrentUser = {
    id: string
    name: string | null
    email: string | null
    image: string | null
    hasCompletedTutorial: boolean
}

type CurrentUserContextValue = {
    user: CurrentUser | null
    updateUser: (patch: Partial<CurrentUser>) => void
}

const CurrentUserContext = React.createContext<CurrentUserContextValue | null>(null)

export function useCurrentUser() {
    const ctx = React.useContext(CurrentUserContext)
    if (!ctx) {
        throw new Error("useCurrentUser は UserProvider の内側で使用してください")
    }
    return ctx
}

export function UserProvider({
    initialUser,
    children,
}: {
    initialUser: CurrentUser | null
    children: React.ReactNode
}) {
    const [user, setUser] = React.useState(initialUser)

    const updateUser = React.useCallback((patch: Partial<CurrentUser>) => {
        setUser((prev) => (prev ? { ...prev, ...patch } : prev))
    }, [])

    const value = React.useMemo(() => ({ user, updateUser }), [user, updateUser])

    return (
        <CurrentUserContext.Provider value={value}>
            {children}
        </CurrentUserContext.Provider>
    )
}
