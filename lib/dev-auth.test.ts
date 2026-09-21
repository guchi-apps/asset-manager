import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { hasSupabaseAuthConfig, isDevAuthEnabled, isDevAuthRequest, isDevAuthSecret } from "./dev-auth"

describe("development auth bypass", () => {
    it("is disabled in production even when a secret is configured", () => {
        const env = { NODE_ENV: "production", CI_LOGIN_BYPASS_SECRET: "secret" }
        assert.equal(isDevAuthEnabled(env), false)
        assert.equal(isDevAuthRequest("secret", env), false)
    })

    it("is disabled when the secret is missing", () => {
        const env = { NODE_ENV: "development" }
        assert.equal(isDevAuthEnabled(env), false)
        assert.equal(isDevAuthRequest("secret", env), false)
    })

    it("accepts only the matching cookie in development", () => {
        const env = { NODE_ENV: "development", CI_LOGIN_BYPASS_SECRET: "local-secret" }
        assert.equal(isDevAuthRequest("different", env), false)
        assert.equal(isDevAuthRequest(undefined, env), false)
        assert.equal(isDevAuthRequest("local-secret", env), true)
    })

    it("requires the secret before issuing a development login cookie", () => {
        const env = { NODE_ENV: "development", CI_LOGIN_BYPASS_SECRET: "local-secret" }
        assert.equal(isDevAuthSecret(undefined, env), false)
        assert.equal(isDevAuthSecret("different", env), false)
        assert.equal(isDevAuthSecret("local-secret", env), true)
    })

    it("distinguishes real Supabase settings from empty values and local placeholders", () => {
        assert.equal(hasSupabaseAuthConfig({}), false)
        assert.equal(hasSupabaseAuthConfig({
            NEXT_PUBLIC_SUPABASE_URL: "https://local-placeholder.supabase.co",
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-placeholder",
        }), false)
        assert.equal(hasSupabaseAuthConfig({
            NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
        }), true)
    })
})
