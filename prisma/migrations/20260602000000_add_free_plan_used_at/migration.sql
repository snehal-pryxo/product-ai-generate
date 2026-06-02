ALTER TABLE `shop` ADD COLUMN `freePlanUsedAt` DATETIME(3) NULL;

UPDATE `shop`
SET `freePlanUsedAt` = COALESCE(`freePlanUsedAt`, NOW(3))
WHERE `billingPlanKey` = 'free' OR `billingPlanKey` IS NULL;
