import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import {
  getUninstallFeedbackByToken,
  submitUninstallFeedback,
} from "../lib/uninstallFeedback.server";

const APP_NAME = "Product AI Generate";

export const loader = async ({ params }) => {
  const feedback = await getUninstallFeedbackByToken(params.token);

  if (!feedback) {
    return {
      found: false,
      submitted: false,
      shop: "",
      ownerName: "",
    };
  }

  return {
    found: true,
    submitted: Boolean(feedback.feedbackSubmittedAt),
    shop: feedback.shop,
    ownerName: feedback.ownerName || "",
  };
};

export const action = async ({ request, params }) => {
  const formData = await request.formData();
  return submitUninstallFeedback({
    token: params.token,
    feedbackText: formData.get("feedbackText"),
  });
};

export default function UninstallFeedbackPage() {
  const data = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const submitted = data.submitted || actionData?.success;

  return (
    <main className="feedback-page">
      <section className="feedback-card">
        <p className="feedback-kicker">{APP_NAME}</p>
        <h1>Help us improve</h1>

        {!data.found ? (
          <p className="feedback-message feedback-message--error">
            This feedback link is invalid or no longer available.
          </p>
        ) : submitted ? (
          <div className="feedback-message feedback-message--success">
            <h2>Thank you for your feedback.</h2>
            <p>Your message has been saved. We use this feedback to improve the app experience for Shopify merchants.</p>
          </div>
        ) : (
          <>
            <p className="feedback-copy">
              {data.ownerName ? `Hi ${data.ownerName}, ` : ""}
              sorry to see you leave. Please tell us what did not work for {data.shop || "your store"}.
            </p>

            {actionData?.error ? (
              <p className="feedback-message feedback-message--error">{actionData.error}</p>
            ) : null}

            <Form method="post" className="feedback-form">
              <label htmlFor="feedbackText">Your feedback</label>
              <textarea
                id="feedbackText"
                name="feedbackText"
                rows={8}
                maxLength={5000}
                placeholder="Example: pricing was too high, content quality did not match my brand, a feature was missing, or setup was confusing."
                required
              />
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Submitting..." : "Submit feedback"}
              </button>
            </Form>
          </>
        )}
      </section>

      <style>{`
        :root {
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #111827;
          background: #f3f4f6;
        }

        body {
          margin: 0;
          background: #f3f4f6;
        }

        .feedback-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px 16px;
          box-sizing: border-box;
        }

        .feedback-card {
          width: min(100%, 640px);
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 32px;
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
        }

        .feedback-kicker {
          margin: 0 0 8px;
          color: #4f46e5;
          font-size: 13px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        h1 {
          margin: 0 0 12px;
          font-size: 30px;
          line-height: 1.2;
          letter-spacing: 0;
        }

        h2 {
          margin: 0 0 8px;
          font-size: 20px;
          line-height: 1.3;
        }

        .feedback-copy {
          margin: 0 0 24px;
          color: #4b5563;
          font-size: 16px;
          line-height: 1.55;
        }

        .feedback-form {
          display: grid;
          gap: 12px;
        }

        label {
          font-size: 14px;
          font-weight: 700;
          color: #1f2937;
        }

        textarea {
          width: 100%;
          box-sizing: border-box;
          resize: vertical;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          padding: 12px;
          font: inherit;
          line-height: 1.5;
          color: #111827;
          background: #ffffff;
        }

        textarea:focus {
          outline: 2px solid #c7d2fe;
          border-color: #4f46e5;
        }

        button {
          justify-self: start;
          border: 0;
          border-radius: 6px;
          background: #4f46e5;
          color: #ffffff;
          padding: 12px 18px;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
        }

        button:disabled {
          opacity: 0.7;
          cursor: wait;
        }

        .feedback-message {
          margin: 16px 0 24px;
          padding: 14px 16px;
          border-radius: 6px;
          font-size: 15px;
          line-height: 1.5;
        }

        .feedback-message--error {
          color: #991b1b;
          background: #fef2f2;
          border: 1px solid #fecaca;
        }

        .feedback-message--success {
          color: #065f46;
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
        }

        .feedback-message--success p {
          margin: 0;
        }

        @media (max-width: 520px) {
          .feedback-card {
            padding: 24px;
          }

          h1 {
            font-size: 26px;
          }

          button {
            width: 100%;
          }
        }
      `}</style>
    </main>
  );
}
