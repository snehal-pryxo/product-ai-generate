SET @blog_offer_text_column_exists = (
  SELECT COUNT(1)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'blog_generated_contents'
    AND column_name = 'offerText'
);
SET @blog_offer_text_sql = IF(
  @blog_offer_text_column_exists = 0,
  'ALTER TABLE `blog_generated_contents` ADD COLUMN `offerText` VARCHAR(255) NULL',
  'SELECT 1'
);
PREPARE blog_offer_text_stmt FROM @blog_offer_text_sql;
EXECUTE blog_offer_text_stmt;
DEALLOCATE PREPARE blog_offer_text_stmt;
