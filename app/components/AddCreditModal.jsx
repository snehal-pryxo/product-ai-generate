import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { BlockStack, Box, Button, InlineStack, Link, Modal, Text, TextField } from "@shopify/polaris";
import {
  getCreditPurchasePrice,
  normalizeCreditPurchaseAmount,
} from "../lib/creditPurchaseOptions";
import { useInAppNavigation } from "./useInAppNavigation";

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

function formatCurrencyFixed(value) {
  return `$${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function AddCreditModal() {
  const fetcher = useFetcher();
  const { appHref, navigateInApp } = useInAppNavigation();
  const [open, setOpen] = useState(false);
  const [credits, setCredits] = useState("100");
  const normalizedCredits = useMemo(() => normalizeCreditPurchaseAmount(credits), [credits]);
  const price = getCreditPurchasePrice(normalizedCredits);
  const isSubmitting = fetcher.state !== "idle";
  const primaryButtonLabel = `Get ${normalizedCredits.toLocaleString("en-US")} Credits at ${formatCurrency(price)}`;
  const quickSelectOptions = [1000, 10000, 100000];

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
    fetcher.submit(payload, { method: "post", action: appHref("/app/pricing") });
  }

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="One time purchase"
      primaryAction={{
        content: primaryButtonLabel,
        onAction: handleSubmit,
        loading: isSubmitting,
        disabled: isSubmitting,
      }}
      secondaryActions={[
        {
          content: "Upgrade Plan",
          onAction: () => {
            setOpen(false);
            navigateInApp("/app/pricing");
          },
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="500">
          <Text as="p" variant="bodyMd" tone="subdued">
            Get credits as per your usage. Purchase credits one time and use them whenever you need to generate AI-powered product content.
          </Text>

          <Text as="h3" variant="headingMd">
            Choose Your Credit Package
          </Text>

          <TextField
            label="Number of credits to purchase"
            type="number"
            value={credits}
            min={100}
            step={100}
            onChange={setCredits}
            onBlur={() => setCredits(String(normalizedCredits))}
            autoComplete="off"
            requiredIndicator
            helpText="Each credit generates one product description"
          />

          <InlineStack align="start">
            <Button variant="primary" onClick={handleSubmit} loading={isSubmitting} disabled={isSubmitting}>
              {primaryButtonLabel}
            </Button>
          </InlineStack>

          <InlineStack align="start" blockAlign="center" gap="300" wrap>
            <Text as="span" variant="bodyMd" tone="subdued">
              Quick Select:
            </Text>
            {quickSelectOptions.map((option) => (
              <Button key={option} onClick={() => setCredits(String(option))}>
                {option.toLocaleString("en-US")}
              </Button>
            ))}
          </InlineStack>

          <BlockStack gap="300">
            <Text as="h3" variant="headingMd">
              Order Summary
            </Text>
            <Box background="bg-surface-secondary" padding="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" variant="bodyMd" fontWeight="semibold" tone="subdued">
                  Credits
                </Text>
                <Text as="span" variant="bodyMd" fontWeight="semibold" tone="subdued">
                  Price
                </Text>
              </InlineStack>
            </Box>
            <Box paddingInline="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" variant="bodyMd">
                  {normalizedCredits.toLocaleString("en-US")}
                </Text>
                <Text as="span" variant="bodyMd" fontWeight="semibold">
                  {formatCurrencyFixed(price)}
                </Text>
              </InlineStack>
            </Box>
          </BlockStack>

          <InlineStack align="end">
            <Text as="p" variant="bodySm" tone="subdued">
              Need a monthly plan? <Link url={appHref("/app/pricing")}>View pricing plans</Link>
            </Text>
          </InlineStack>

          {fetcher.data?.message && !fetcher.data?.success ? (
            <Text as="p" variant="bodySm" tone="critical">
              {fetcher.data.message}
            </Text>
          ) : null}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
