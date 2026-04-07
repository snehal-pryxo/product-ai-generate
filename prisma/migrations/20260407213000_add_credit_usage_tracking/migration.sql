ALTER TABLE `shop`
    ADD COLUMN IF NOT EXISTS `creditsUsedTotal` INT NOT NULL DEFAULT 0;

ALTER TABLE `generated_content_logs`
    ADD COLUMN IF NOT EXISTS `resourceType` VARCHAR(32) NULL,
    ADD COLUMN IF NOT EXISTS `creditsUsed` INT NOT NULL DEFAULT 0;

ALTER TABLE `product_generated_contents`
    ADD COLUMN IF NOT EXISTS `creditsUsed` INT NOT NULL DEFAULT 0;

ALTER TABLE `collection_generated_contents`
    ADD COLUMN IF NOT EXISTS `creditsUsed` INT NOT NULL DEFAULT 0;

ALTER TABLE `page_generated_contents`
    ADD COLUMN IF NOT EXISTS `creditsUsed` INT NOT NULL DEFAULT 0;

ALTER TABLE `blog_article_generated_contents`
    ADD COLUMN IF NOT EXISTS `creditsUsed` INT NOT NULL DEFAULT 0;
