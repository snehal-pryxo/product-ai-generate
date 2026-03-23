-- CreateTable
CREATE TABLE `generated_content_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `shop` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `productTitle` VARCHAR(191) NULL,
    `intent` VARCHAR(191) NOT NULL,
    `language` VARCHAR(191) NULL,
    `tone` VARCHAR(191) NULL,
    `lengthOption` VARCHAR(191) NULL,
    `formatOption` VARCHAR(191) NULL,
    `contextKeywords` TEXT NULL,
    `aiModel` VARCHAR(191) NULL,
    `generatedDescription` LONGTEXT NULL,
    `generatedSeoTitle` VARCHAR(191) NULL,
    `generatedSeoDescription` TEXT NULL,
    `appliedToProduct` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `GeneratedContentLog_shop_product_createdAt_idx`
  ON `generated_content_logs`(`shop`, `productId`, `createdAt`);
