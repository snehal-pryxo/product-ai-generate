CREATE TABLE IF NOT EXISTS `blog_generated_contents` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `shop` VARCHAR(191) NOT NULL,
    `blogId` VARCHAR(191) NULL,
    `articleId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `summary` TEXT NULL,
    `bodyHtml` LONGTEXT NULL,
    `status` VARCHAR(32) NULL,
    `language` VARCHAR(191) NULL,
    `tone` VARCHAR(191) NULL,
    `lengthOption` VARCHAR(191) NULL,
    `targetAudience` VARCHAR(191) NULL,
    `tabType` VARCHAR(64) NULL,
    `topic` VARCHAR(255) NULL,
    `promotion` VARCHAR(191) NULL,
    `holiday` VARCHAR(191) NULL,
    `productUrl` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @blog_unique_idx_exists = (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'blog_generated_contents'
    AND index_name = 'BlogGeneratedContent_shop_articleId_key'
);
SET @blog_unique_idx_sql = IF(
  @blog_unique_idx_exists = 0,
  'CREATE UNIQUE INDEX `BlogGeneratedContent_shop_articleId_key` ON `blog_generated_contents`(`shop`, `articleId`)',
  'SELECT 1'
);
PREPARE blog_unique_idx_stmt FROM @blog_unique_idx_sql;
EXECUTE blog_unique_idx_stmt;
DEALLOCATE PREPARE blog_unique_idx_stmt;

SET @blog_updated_idx_exists = (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'blog_generated_contents'
    AND index_name = 'BlogGeneratedContent_shop_updatedAt_idx'
);
SET @blog_updated_idx_sql = IF(
  @blog_updated_idx_exists = 0,
  'CREATE INDEX `BlogGeneratedContent_shop_updatedAt_idx` ON `blog_generated_contents`(`shop`, `updatedAt`)',
  'SELECT 1'
);
PREPARE blog_updated_idx_stmt FROM @blog_updated_idx_sql;
EXECUTE blog_updated_idx_stmt;
DEALLOCATE PREPARE blog_updated_idx_stmt;
