CREATE TABLE IF NOT EXISTS `collection_generated_contents` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `shop` VARCHAR(191) NOT NULL,
    `collectionId` VARCHAR(191) NOT NULL,
    `collectionTitle` VARCHAR(191) NULL,
    `language` VARCHAR(191) NULL,
    `tone` VARCHAR(191) NULL,
    `lengthOption` VARCHAR(191) NULL,
    `formatOption` VARCHAR(191) NULL,
    `contextKeywords` TEXT NULL,
    `aiModel` VARCHAR(191) NULL,
    `descriptionHtml` LONGTEXT NULL,
    `seoTitle` VARCHAR(191) NULL,
    `seoDescription` TEXT NULL,
    `appliedToCollection` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX IF NOT EXISTS `CollectionGeneratedContent_shop_collectionId_key`
  ON `collection_generated_contents`(`shop`, `collectionId`);

CREATE INDEX IF NOT EXISTS `CollectionGeneratedContent_shop_updatedAt_idx`
  ON `collection_generated_contents`(`shop`, `updatedAt`);
