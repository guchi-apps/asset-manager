-- AlterTable
ALTER TABLE `User` ADD COLUMN `supabaseUserId` VARCHAR(191) NULL;

-- DropTable
DROP TABLE `Account`;

-- DropTable
DROP TABLE `Session`;

-- CreateIndex
CREATE UNIQUE INDEX `User_supabaseUserId_key` ON `User`(`supabaseUserId`);

