CREATE TABLE `bulk_jobs` (
  `id` VARCHAR(191) NOT NULL,
  `shop` VARCHAR(191) NOT NULL,
  `jobType` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
  `totalItems` INT NOT NULL,
  `completedItems` INT NOT NULL DEFAULT 0,
  `failedItems` INT NOT NULL DEFAULT 0,
  `contentTypes` TEXT NOT NULL,
  `settings` LONGTEXT NOT NULL,
  `itemsData` LONGTEXT NOT NULL,
  `creditsAllocated` INT NOT NULL,
  `creditsUsed` INT NOT NULL DEFAULT 0,
  `failedItemIds` LONGTEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `completedAt` DATETIME(3) NULL,

  INDEX `bulk_jobs_shop_createdAt_idx`(`shop`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
