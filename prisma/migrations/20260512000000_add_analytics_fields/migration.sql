ALTER TABLE `generated_content_logs`
  ADD COLUMN `aiProvider` VARCHAR(32) NULL,
  ADD COLUMN `inputTokens` INT NOT NULL DEFAULT 0,
  ADD COLUMN `outputTokens` INT NOT NULL DEFAULT 0,
  ADD COLUMN `generationMs` INT NULL;

ALTER TABLE `blog_generated_contents`
  ADD COLUMN `aiModel` VARCHAR(100) NULL,
  ADD COLUMN `aiProvider` VARCHAR(32) NULL,
  ADD COLUMN `contextKeywords` TEXT NULL,
  ADD COLUMN `formatOption` VARCHAR(64) NULL,
  ADD COLUMN `inputTokens` INT NOT NULL DEFAULT 0,
  ADD COLUMN `outputTokens` INT NOT NULL DEFAULT 0,
  ADD COLUMN `generationMs` INT NULL;

ALTER TABLE `product_generated_contents`
  ADD COLUMN `aiProvider` VARCHAR(32) NULL,
  ADD COLUMN `inputTokens` INT NOT NULL DEFAULT 0,
  ADD COLUMN `outputTokens` INT NOT NULL DEFAULT 0,
  ADD COLUMN `generationMs` INT NULL;

ALTER TABLE `collection_generated_contents`
  ADD COLUMN `aiProvider` VARCHAR(32) NULL,
  ADD COLUMN `inputTokens` INT NOT NULL DEFAULT 0,
  ADD COLUMN `outputTokens` INT NOT NULL DEFAULT 0,
  ADD COLUMN `generationMs` INT NULL;

ALTER TABLE `collection_product_generated_contents`
  ADD COLUMN `aiProvider` VARCHAR(32) NULL,
  ADD COLUMN `inputTokens` INT NOT NULL DEFAULT 0,
  ADD COLUMN `outputTokens` INT NOT NULL DEFAULT 0,
  ADD COLUMN `generationMs` INT NULL;

ALTER TABLE `page_generated_contents`
  ADD COLUMN `aiProvider` VARCHAR(32) NULL,
  ADD COLUMN `inputTokens` INT NOT NULL DEFAULT 0,
  ADD COLUMN `outputTokens` INT NOT NULL DEFAULT 0,
  ADD COLUMN `generationMs` INT NULL;
