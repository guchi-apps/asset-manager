import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { signOutLocal } from "./sign-out"

describe("signOutLocal", () => {
    it("scopeにlocalを渡し、他アプリ・他端末のセッションを失効させない", async () => {
        const calls: unknown[] = []
        const supabase = {
            auth: {
                async signOut(options: { scope: "local" }) {
                    calls.push(options)
                    return { error: null }
                },
            },
        }

        await signOutLocal(supabase)

        assert.deepEqual(calls, [{ scope: "local" }])
    })

    it("signOutが失敗した場合はそのまま伝える", async () => {
        const supabase = {
            auth: {
                async signOut(): Promise<never> {
                    throw new Error("network")
                },
            },
        }

        await assert.rejects(() => signOutLocal(supabase), /network/)
    })
})
