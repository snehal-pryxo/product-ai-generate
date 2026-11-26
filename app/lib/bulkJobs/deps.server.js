// Production dependencies for the bulk job processor.
//
// Shopify access goes through the app's own session storage via
// `unauthenticated.admin(shop)`, which loads the shop's offline session and
// refreshes an expiring offline token near expiry. The worker never reads the
// `shop.accessToken` column. Loading/refreshing happens under a per-shop lock
// shared with every process using this database (Shopify's guidance is to
// serialize refreshes per shop).

import db from "../../db.server";
import { unauthenticated } from "../../shopify.server";
import {
  addProductsToCollectionStrict,
  generateCollectionItem,
  generateCollectionProductItem,
  generateProductItem,
  getApiKeys,
  writeCollectionContentToShopify,
  writeCollectionProductContentToShopify,
  writeProductContentToShopify,
} from "../generateContent.server";
import { generateBulkFaq, generateProductSchemaForBulk } from "../aiVisibility.server";
import { withShopTokenLock } from "../shopifySessionCoordination.server";
import { defaultSleep } from "./errors.server";
import { getSavedContentTimestamps } from "./savedContent.server";

export function createProductionDeps() {
  return {
    getAdminContext: (shop) => withShopTokenLock(db, shop, () => unauthenticated.admin(shop)),
    getApiKeys,
    getSavedContentTimestamps,
    generateProductItem,
    generateCollectionItem,
    generateCollectionProductItem,
    generateProductSchemaForBulk,
    generateBulkFaq,
    writeProductContentToShopify,
    writeCollectionContentToShopify,
    writeCollectionProductContentToShopify,
    addProductsToCollection: addProductsToCollectionStrict,
    sleep: defaultSleep,
  };
}
