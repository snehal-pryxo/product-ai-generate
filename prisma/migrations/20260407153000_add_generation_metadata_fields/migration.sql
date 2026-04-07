ALTER TABLE `product_generated_contents`
    ADD COLUMN IF NOT EXISTS `descriptionPromptTemplate` LONGTEXT NULL,
    ADD COLUMN IF NOT EXISTS `metaTitlePromptTemplate` TEXT NULL,
    ADD COLUMN IF NOT EXISTS `metaDescriptionPromptTemplate` TEXT NULL;

ALTER TABLE `collection_generated_contents`
    ADD COLUMN IF NOT EXISTS `descriptionPromptTemplate` LONGTEXT NULL,
    ADD COLUMN IF NOT EXISTS `metaTitlePromptTemplate` TEXT NULL,
    ADD COLUMN IF NOT EXISTS `metaDescriptionPromptTemplate` TEXT NULL;

ALTER TABLE `page_generated_contents`
    ADD COLUMN IF NOT EXISTS `bodyPromptTemplate` LONGTEXT NULL,
    ADD COLUMN IF NOT EXISTS `metaTitlePromptTemplate` TEXT NULL,
    ADD COLUMN IF NOT EXISTS `metaDescriptionPromptTemplate` TEXT NULL;

ALTER TABLE `blog_article_generated_contents`
    ADD COLUMN IF NOT EXISTS `bodyPromptTemplate` LONGTEXT NULL,
    ADD COLUMN IF NOT EXISTS `metaTitlePromptTemplate` TEXT NULL,
    ADD COLUMN IF NOT EXISTS `metaDescriptionPromptTemplate` TEXT NULL,
    ADD COLUMN IF NOT EXISTS `scheduleRequested` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS `scheduledFor` DATETIME(3) NULL,
    ADD COLUMN IF NOT EXISTS `scheduleStatus` VARCHAR(64) NULL,
    ADD COLUMN IF NOT EXISTS `imageAltText` VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS `hasInlineImage` BOOLEAN NOT NULL DEFAULT false;
