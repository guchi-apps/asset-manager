import { seedDummyData } from "../lib/db/seed"
import { DEV_AUTH_EMAIL, DEV_AUTH_SUPABASE_USER_ID } from "../lib/dev-auth"
import { prisma } from "../lib/prisma"

async function main() {
    const user = await prisma.user.upsert({
        where: { supabaseUserId: DEV_AUTH_SUPABASE_USER_ID },
        update: {},
        create: {
            name: "開発用ユーザー",
            email: DEV_AUTH_EMAIL,
            supabaseUserId: DEV_AUTH_SUPABASE_USER_ID,
            hasCompletedTutorial: true,
        },
    })

    const categoryCount = await prisma.category.count({ where: { userId: user.id } })
    if (categoryCount > 0) {
        console.log("開発用ダミーデータはすでに投入済みです")
        return
    }

    await seedDummyData(user.id)
}

main()
    .catch((error) => {
        console.error("開発用ダミーデータの投入に失敗しました", error)
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
