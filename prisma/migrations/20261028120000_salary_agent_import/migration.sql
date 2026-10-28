-- Issue #791: AIDEなどから代理登録した給与明細と、取り込み元のメールの対応。同じメールの二重登録を防ぐ。
CREATE TABLE `SalaryAgentImport` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `sourceKey` VARCHAR(64) NOT NULL,
    `salaryId` VARCHAR(191) NOT NULL,
    `contentHash` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SalaryAgentImport_salaryId_key`(`salaryId`),
    UNIQUE INDEX `SalaryAgentImport_userId_sourceKey_key`(`userId`, `sourceKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
