CREATE TABLE `ai_visibility_schemas` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `shop` VARCHAR(191) NOT NULL,
  `resourceType` VARCHAR(32) NOT NULL,
  `resourceId` VARCHAR(255) NOT NULL,
  `schemaType` VARCHAR(64) NOT NULL,
  `schemaJson` LONGTEXT NOT NULL,
  `metafieldId` VARCHAR(255) NULL,
  `aiModel` VARCHAR(100) NULL,
  `aiProvider` VARCHAR(32) NULL,
  `inputTokens` INT NOT NULL DEFAULT 0,
  `outputTokens` INT NOT NULL DEFAULT 0,
  `creditsUsed` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `AiVisibilitySchema_shop_type_resource_key`(`shop`, `resourceType`, `resourceId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_visibility_faqs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `shop` VARCHAR(191) NOT NULL,
  `resourceType` VARCHAR(32) NOT NULL,
  `resourceId` VARCHAR(255) NOT NULL,
  `faqJson` LONGTEXT NOT NULL,
  `metafieldId` VARCHAR(255) NULL,
  `aiModel` VARCHAR(100) NULL,
  `aiProvider` VARCHAR(32) NULL,
  `inputTokens` INT NOT NULL DEFAULT 0,
  `outputTokens` INT NOT NULL DEFAULT 0,
  `creditsUsed` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `AiVisibilityFaq_shop_type_resource_key`(`shop`, `resourceType`, `resourceId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_visibility_llms_txt` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `shop` VARCHAR(191) NOT NULL,
  `content` LONGTEXT NOT NULL,
  `itemCount` INT NULL,
  `aiModel` VARCHAR(100) NULL,
  `aiProvider` VARCHAR(32) NULL,
  `inputTokens` INT NOT NULL DEFAULT 0,
  `outputTokens` INT NOT NULL DEFAULT 0,
  `creditsUsed` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `AiVisibilityLlmsTxt_shop_key`(`shop`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
