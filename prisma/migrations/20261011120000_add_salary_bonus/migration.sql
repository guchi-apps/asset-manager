-- CreateTable
CREATE TABLE `Salary` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `salaryDate` DATETIME(3) NOT NULL,
    `grossSalary` DECIMAL(10, 2) NOT NULL,
    `netSalary` DECIMAL(10, 2) NOT NULL,
    `data` JSON NOT NULL,
    `memo` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `Salary_userId_deletedAt_idx`(`userId`, `deletedAt`),
    UNIQUE INDEX `Salary_userId_salaryDate_key`(`userId`, `salaryDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Bonus` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `bonusDate` DATETIME(3) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `data` JSON NOT NULL,
    `memo` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `Bonus_userId_deletedAt_idx`(`userId`, `deletedAt`),
    UNIQUE INDEX `Bonus_userId_bonusDate_key`(`userId`, `bonusDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PayItem` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `itemType` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(191) NOT NULL DEFAULT 'both',
    `isTaxable` BOOLEAN NOT NULL DEFAULT true,
    `displayOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PayItem_userId_itemName_key`(`userId`, `itemName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaxSetting` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `healthInsuranceRate` DECIMAL(7, 4) NOT NULL DEFAULT 9.15,
    `pensionRate` DECIMAL(7, 4) NOT NULL DEFAULT 9.15,
    `employmentInsuranceRate` DECIMAL(7, 4) NOT NULL DEFAULT 0.60,
    `incomeRateTaxFormula` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TaxSetting_userId_effectiveFrom_key`(`userId`, `effectiveFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

