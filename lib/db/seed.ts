import { prisma } from "@/lib/prisma"

function daysAgo(n: number): Date {
    return new Date(new Date().setDate(new Date().getDate() - n))
}

/**
 * start〜end の間を intervalDays 間隔で刻んだ日付配列を生成する(end は必ず含める)
 */
function generateDateSteps(start: Date, end: Date, intervalDays: number): Date[] {
    const dates: Date[] = []
    const cursor = new Date(start)
    while (cursor < end) {
        dates.push(new Date(cursor))
        cursor.setDate(cursor.getDate() + intervalDays)
    }
    dates.push(new Date(end))
    return dates
}

/**
 * startValue から endValue へ、ランダムなブレを加えながら推移する評価額の配列を生成する
 */
function generateWalkValues(steps: number, startValue: number, endValue: number, volatility: number): number[] {
    const values: number[] = []
    for (let i = 0; i < steps; i++) {
        const progress = steps === 1 ? 1 : i / (steps - 1)
        const base = startValue + (endValue - startValue) * progress
        const noise = base * volatility * (Math.random() - 0.5)
        values.push(Math.max(0, Math.round(base + noise)))
    }
    values[0] = startValue
    values[values.length - 1] = endValue
    return values
}

async function createAssetSeries(userId: string, categoryId: number, dates: Date[], values: number[]) {
    await prisma.asset.createMany({
        data: dates.map((d, i) => ({
            categoryId,
            currentValue: values[i],
            recordedAt: d,
            userId,
        })),
    })
}

/**
 * Seeds initial dummy data for a new user.
 */
export async function seedDummyData(userId: string) {
    try {
        console.log(`[seedDummyData] Seeding for user: ${userId}`);

        const periodStart = daysAgo(180);
        const today = daysAgo(0);

        // 1. 固定の分類「資産クラス」（`lib/fixed-tag-groups.ts`。#1617）に選択肢を入れる
        const tagGroup = await prisma.tagGroup.upsert({
            where: { userId_key: { userId, key: "ASSET_CLASS" } },
            create: { key: "ASSET_CLASS", name: "資産クラス", order: 0, userId },
            update: {},
        });
        const cashOption = await prisma.tagOption.create({ data: { tagGroupId: tagGroup.id, name: "現金", order: 0 } });
        const stockOption = await prisma.tagOption.create({ data: { tagGroupId: tagGroup.id, name: "株式", order: 1 } });

        // 2. 銀行預金 (現金) - 月1回の積立を半年分
        const bank = await prisma.category.create({
            data: {
                name: "銀行預金",
                color: "#94a3b8",
                isCash: true,
                order: 0,
                userId,
                tags: {
                    create: {
                        tagGroupId: tagGroup.id,
                        tagOptionId: cashOption.id
                    }
                }
            }
        });
        {
            const monthlyDeposit = 150000;
            const depositDates = generateDateSteps(periodStart, today, 30);
            let cumulative = 0;
            for (const d of depositDates) {
                cumulative += monthlyDeposit;
                await prisma.transaction.create({
                    data: { categoryId: bank.id, amount: monthlyDeposit, type: 'DEPOSIT', transactedAt: d, userId }
                });
                await prisma.asset.create({
                    data: { categoryId: bank.id, currentValue: cumulative, recordedAt: d, userId }
                });
            }
        }

        // 3. S&P500 (株式分類) - 半年分の値動きを再現
        const sp500 = await prisma.category.create({
            data: {
                name: "S&P500",
                color: "#60a5fa",
                isCash: false,
                order: 1,
                userId,
                tags: {
                    create: {
                        tagGroupId: tagGroup.id,
                        tagOptionId: stockOption.id
                    }
                }
            }
        });
        await prisma.transaction.create({
            data: { categoryId: sp500.id, amount: 500000, type: 'DEPOSIT', transactedAt: periodStart, userId }
        });
        {
            const dates = generateDateSteps(periodStart, today, 5);
            const values = generateWalkValues(dates.length, 500000, 680000, 0.06);
            await createAssetSeries(userId, sp500.id, dates, values);
        }

        // 4. 個別株 (親アセット)
        const stockRoot = await prisma.category.create({
            data: {
                name: "個別株",
                color: "#10b981",
                isCash: false,
                order: 2,
                userId,
                tags: {
                    create: {
                        tagGroupId: tagGroup.id,
                        tagOptionId: stockOption.id
                    }
                }
            }
        });

        // 5. A社株式 (個別株の子) - 序盤に一部利確、その後も値動きが続く
        const stockA = await prisma.category.create({
            data: {
                name: "A社株式",
                color: "#34d399",
                isCash: false,
                parentId: stockRoot.id,
                order: 0,
                userId,
                tags: {
                    create: {
                        tagGroupId: tagGroup.id,
                        tagOptionId: stockOption.id
                    }
                }
            }
        });
        {
            const buyDate = daysAgo(150);
            const sellDate = daysAgo(90);
            await prisma.transaction.create({
                data: { categoryId: stockA.id, amount: 300000, type: 'DEPOSIT', transactedAt: buyDate, userId }
            });

            const firstLegDates = generateDateSteps(buyDate, sellDate, 5);
            const firstLegValues = generateWalkValues(firstLegDates.length, 300000, 400000, 0.08);
            await createAssetSeries(userId, stockA.id, firstLegDates, firstLegValues);

            await prisma.transaction.create({
                data: { categoryId: stockA.id, amount: 150000, type: 'WITHDRAW', realizedGain: 50000, transactedAt: sellDate, userId }
            });

            const secondLegDates = generateDateSteps(sellDate, today, 5);
            const secondLegValues = generateWalkValues(secondLegDates.length, 250000, 330000, 0.08);
            // sellDate 時点の評価額はすでに firstLeg 側で記録済みなので、重複しないよう先頭を除いて登録する
            await createAssetSeries(userId, stockA.id, secondLegDates.slice(1), secondLegValues.slice(1));
        }

        // 6. B社株式 (個別株の子) - 途中で追加購入
        const stockB = await prisma.category.create({
            data: {
                name: "B社株式",
                color: "#fbbf24",
                isCash: false,
                parentId: stockRoot.id,
                order: 1,
                userId,
                tags: {
                    create: {
                        tagGroupId: tagGroup.id,
                        tagOptionId: stockOption.id
                    }
                }
            }
        });
        {
            const firstBuyDate = daysAgo(140);
            const secondBuyDate = daysAgo(60);
            await prisma.transaction.create({
                data: { categoryId: stockB.id, amount: 200000, type: 'DEPOSIT', transactedAt: firstBuyDate, userId }
            });

            const firstLegDates = generateDateSteps(firstBuyDate, secondBuyDate, 5);
            const firstLegValues = generateWalkValues(firstLegDates.length, 200000, 260000, 0.07);
            await createAssetSeries(userId, stockB.id, firstLegDates, firstLegValues);

            await prisma.transaction.create({
                data: { categoryId: stockB.id, amount: 100000, type: 'DEPOSIT', transactedAt: secondBuyDate, userId }
            });

            const secondLegDates = generateDateSteps(secondBuyDate, today, 5);
            const secondLegValues = generateWalkValues(secondLegDates.length, 360000, 420000, 0.07);
            await createAssetSeries(userId, stockB.id, secondLegDates.slice(1), secondLegValues.slice(1));
        }

        console.log("[seedDummyData] Successfully seeded detailed dummy data with tags and stock hierarchy.");
    } catch (error) {
        console.error("[seedDummyData] Failed to seed data", error);
    }
}
