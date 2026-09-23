CREATE TABLE IF NOT EXISTS `shop_daily_activity` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `shop` VARCHAR(255) NOT NULL,
  `activityDate` DATE NOT NULL,
  `appOpens` INT NOT NULL DEFAULT 0,
  `generations` INT NOT NULL DEFAULT 0,
  `creditsUsed` INT NOT NULL DEFAULT 0,
  `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `shop_daily_activity_shop_date_key`(`shop`, `activityDate`),
  INDEX `shop_daily_activity_date_idx`(`activityDate`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `shop` ADD COLUMN `lastActiveAt` DATETIME(3) NULL;

-- Backfill history from generated_content_logs so existing shops have activity from day one.
-- Historical rows have no app-open data, and `generations` counts log rows (one per generated item),
-- whereas new rows count one per generation request.
INSERT INTO `shop_daily_activity` (`shop`, `activityDate`, `generations`, `creditsUsed`, `firstSeenAt`, `lastSeenAt`)
SELECT `shop`, DATE(`createdAt`), COUNT(*), COALESCE(SUM(`creditsUsed`), 0), MIN(`createdAt`), MAX(`createdAt`)
FROM `generated_content_logs`
GROUP BY `shop`, DATE(`createdAt`)
ON DUPLICATE KEY UPDATE `generations` = VALUES(`generations`);

UPDATE `shop` s
JOIN (
  SELECT `shop`, MAX(`lastSeenAt`) AS lastSeen
  FROM `shop_daily_activity`
  GROUP BY `shop`
) a ON a.`shop` = s.`shop`
SET s.`lastActiveAt` = a.lastSeen
WHERE s.`lastActiveAt` IS NULL;
