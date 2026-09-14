-- 内訳の提案に、AIDE経由で読んだZaim Web版の明細（自動連携明細）を加える（Issue #420）。
-- 既存の提案はすべて公式APIから読んだものなので、既定値の API で埋まってよい。

-- AlterTable
ALTER TABLE `ZaimGenreSuggestion`
    ADD COLUMN `origin` ENUM('API', 'WEB') NOT NULL DEFAULT 'API';
