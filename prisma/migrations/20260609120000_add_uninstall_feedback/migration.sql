CREATE TABLE IF NOT EXISTS `uninstallfeedback` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `shop` VARCHAR(255) NOT NULL,
  `ownerName` VARCHAR(255) NULL,
  `email` VARCHAR(320) NULL,
  `contactEmail` VARCHAR(320) NULL,
  `feedbackText` TEXT NULL,
  `feedbackToken` VARCHAR(128) NULL,
  `feedbackSubmittedAt` DATETIME(3) NULL,
  `uninstalledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);

CREATE UNIQUE INDEX `uninstallfeedback_feedbackToken_key`
  ON `uninstallfeedback`(`feedbackToken`);

CREATE INDEX `UninstallFeedback_shop_idx`
  ON `uninstallfeedback`(`shop`);
