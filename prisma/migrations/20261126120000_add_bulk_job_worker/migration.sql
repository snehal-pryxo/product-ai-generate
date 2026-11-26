-- Database-backed bulk job worker (replaces Inngest for new jobs).
-- Additive only: existing rows keep runner = 'inngest' and are never claimed by the worker.

-- completedItemIds exists in production (added outside migrations) but not in a
-- database built purely from migrations, so add it only when missing (MariaDB syntax).
ALTER TABLE `bulk_jobs` ADD COLUMN IF NOT EXISTS `completedItemIds` LONGTEXT NULL;

ALTER TABLE `bulk_jobs`
  ADD COLUMN `runner` VARCHAR(32) NOT NULL DEFAULT 'inngest',
  ADD COLUMN `startedAt` DATETIME(3) NULL,
  ADD COLUMN `lastError` TEXT NULL,
  ADD COLUMN `cancelRequestedAt` DATETIME(3) NULL,
  ADD COLUMN `lockedBy` VARCHAR(191) NULL,
  ADD COLUMN `lockedUntil` DATETIME(3) NULL,
  ADD COLUMN `heartbeatAt` DATETIME(3) NULL,
  ADD COLUMN `creditsRefunded` INT NOT NULL DEFAULT 0,
  ADD COLUMN `refundedAt` DATETIME(3) NULL,
  ADD COLUMN `writeBackFailedItems` INT NOT NULL DEFAULT 0;

CREATE INDEX `bulk_jobs_runner_status_lockedUntil_idx` ON `bulk_jobs`(`runner`, `status`, `lockedUntil`);

CREATE TABLE `bulk_job_items` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `jobId` VARCHAR(191) NOT NULL,
  `position` INT NOT NULL,
  `resourceId` VARCHAR(191) NOT NULL,
  `collectionId` VARCHAR(191) NULL,
  `collectionTitle` VARCHAR(512) NULL,
  `title` VARCHAR(512) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `attempts` INT NOT NULL DEFAULT 0,
  `error` TEXT NULL,
  `creditsCharged` INT NOT NULL DEFAULT 0,
  `processedAt` DATETIME(3) NULL,
  `firstPickedUpAt` DATETIME(3) NULL,
  `writeBackStatus` VARCHAR(32) NULL,
  `writeBackError` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `bulk_job_items_jobId_position_key`(`jobId`, `position`),
  INDEX `bulk_job_items_jobId_status_position_idx`(`jobId`, `status`, `position`),
  INDEX `bulk_job_items_jobId_writeBackStatus_idx`(`jobId`, `writeBackStatus`),
  PRIMARY KEY (`id`),
  CONSTRAINT `bulk_job_items_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `bulk_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
