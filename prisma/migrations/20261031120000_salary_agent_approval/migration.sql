-- Issue #798: 給与明細の代理登録で、プレビューに紐付く本人承認を画面で記録する。
-- summary は承認画面に出す明細の値（金額を含む）で、期限切れ・消費・却下のときに NULL へ戻す。
CREATE TABLE `SalaryAgentApproval` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `sourceKey` VARCHAR(64) NOT NULL,
    `contentHash` VARCHAR(64) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `salaryDate` VARCHAR(10) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `summary` JSON NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SalaryAgentApproval_expiresAt_idx`(`expiresAt`),
    UNIQUE INDEX `SalaryAgentApproval_userId_sourceKey_key`(`userId`, `sourceKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
