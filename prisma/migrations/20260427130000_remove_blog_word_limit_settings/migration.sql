UPDATE `shop`
SET `globalSettingsJson` = JSON_REMOVE(
  `globalSettingsJson`,
  '$.blogContentWords',
  '$.blogMetaTitleWords',
  '$.blogMetaDescWords'
)
WHERE `globalSettingsJson` IS NOT NULL
  AND JSON_VALID(`globalSettingsJson`);
