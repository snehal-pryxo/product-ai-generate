ALTER TABLE `blog_article_generated_contents`
    ADD COLUMN IF NOT EXISTS `scheduleStartAt` DATETIME(3) NULL,
    ADD COLUMN IF NOT EXISTS `scheduleEndAt` DATETIME(3) NULL;
