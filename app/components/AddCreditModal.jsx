import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { BlockStack, Button, InlineStack, Modal, Text, TextField } from "@shopify/polaris";
import {
  getCreditPurchasePrice,
  normalizeCreditPurchaseAmount,
} from "../lib/creditPurchaseOptions";

export const ADD_CREDIT_MODAL_EVENT = "content-ai:add-credit-modal";

export function openAddCreditModal() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ADD_CREDIT_MODAL_EVENT));
}

function formatCurrency(value) {
  return `$${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export function AddCreditModal() {
  const fetcher = useFetcher();
  const [open, setOpen] = useState(false);
  const [credits, setCredits] = useState("1000");
  const normalizedCredits = useMemo(() => normalizeCreditPurchaseAmount(credits), [credits]);
  const price = getCreditPurchasePrice(normalizedCredits);
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    function handleOpen() {
      setOpen(true);
    }

    window.addEventListener(ADD_CREDIT_MODAL_EVENT, handleOpen);
    return () => window.removeEventListener(ADD_CREDIT_MODAL_EVENT, handleOpen);
  }, []);

  useEffect(() => {
    if (!fetcher.data?.confirmationUrl) return;
    window.open(fetcher.data.confirmationUrl, "_top");
  }, [fetcher.data?.confirmationUrl]);

  function handleSubmit() {
    const payload = new FormData();
    payload.append("intent", "buy_custom_credits");
    payload.append("credits", String(normalizedCredits));
    fetcher.submit(payload, { method: "post", action: "/app/pricing" });
  }

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Add credits"
    >
      <Modal.Section>
        <BlockStack gap="400">
          <TextField
            label="Credits"
            type="number"
            value={credits}
            min={1000}
            max={10000}
            step={1000}
            onChange={setCredits}
            onBlur={() => setCredits(String(normalizedCredits))}
            autoComplete="off"
            helpText="Enter 1,000 to 10,000 credits. Values are rounded to the nearest 1,000."
          />
          <InlineStack align="space-between" blockAlign="center">
            <Text as="span" variant="bodyMd" tone="subdued">
              Price
            </Text>
            <Text as="span" variant="headingLg">
              {formatCurrency(price)}
            </Text>
          </InlineStack>
          {normalizedCredits === 10000 ? (
            <Text as="p" variant="bodySm" tone="success">
              Best value: 10,000 credits for $80.
            </Text>
          ) : null}
          {fetcher.data?.message && !fetcher.data?.success ? (
            <Text as="p" variant="bodySm" tone="critical">
              {fetcher.data.message}
            </Text>
          ) : null}
          <Button fullWidth variant="primary" onClick={handleSubmit} loading={isSubmitting} disabled={isSubmitting}>
            Buy {normalizedCredits.toLocaleString("en-US")} credits
          </Button>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
