-- CreateTable: collection_product_generated_contents
CREATE TABLE IF NOT EXISTS `collection_product_generated_contents` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `shop` VARCHAR(191) NOT NULL,
    `collectionId` VARCHAR(191) NOT NULL,
    `collectionTitle` VARCHAR(191) NULL,
    `productId` VARCHAR(191) NOT NULL,
    `productTitle` VARCHAR(191) NULL,
    `language` VARCHAR(191) NULL,
    `tone` VARCHAR(191) NULL,
    `lengthOption` VARCHAR(191) NULL,
    `formatOption` VARCHAR(191) NULL,
    `contextKeywords` TEXT NULL,
    `descriptionPromptTemplate` LONGTEXT NULL,
    `metaTitlePromptTemplate` TEXT NULL,
    `metaDescriptionPromptTemplate` TEXT NULL,
    `aiModel` VARCHAR(191) NULL,
    `descriptionHtml` LONGTEXT NULL,
    `seoTitle` VARCHAR(191) NULL,
    `seoDescription` TEXT NULL,
    `creditsUsed` INTEGER NOT NULL DEFAULT 0,
    `appliedToProduct` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `CollectionProductGeneratedContent_shop_collection_product_key`
  ON `collection_product_generated_contents`(`shop`, `collectionId`, `productId`);

-- CreateIndex
CREATE INDEX `CollectionProductGeneratedContent_shop_collection_updatedAt_idx`
  ON `collection_product_generated_contents`(`shop`, `collectionId`, `updatedAt`);
