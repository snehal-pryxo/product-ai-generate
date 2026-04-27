UPDATE `shop`
SET `globalSettingsJson` = JSON_REMOVE(
  `globalSettingsJson`,
  '$.tone',
  '$.contextKeywords'
)
WHERE `globalSettingsJson` IS NOT NULL
  AND JSON_VALID(`globalSettingsJson`);
