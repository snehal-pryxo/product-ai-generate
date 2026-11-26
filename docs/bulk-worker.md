# Bulk generation worker

Bulk AI generation runs in a separate worker process that reads jobs from the
database. It replaces the Inngest function for new jobs when
`BULK_JOB_RUNNER=worker`.

## How it works

1. The Products and Collections pages create a `bulk_jobs` row and one
   `bulk_job_items` row per selected product or collection. Item rows hold IDs
   only. The credit reservation, the job row and the item rows are written in
   one transaction.
2. The worker (`npm run worker:start`) claims the oldest available job with a
   conditional UPDATE. Only one worker can win the claim.
3. For each batch (default 10 items), the worker:
   - loads the shop's offline session with `unauthenticated.admin(shop)`, which
     refreshes an expiring token when needed;
   - fetches that batch's products from Shopify;
   - runs the existing AI generation;
   - saves the content and writes it back to Shopify;
   - marks each item done and charges it in a single transaction.
4. When no items are pending, the worker settles the job (`completed`,
   `partial`, `failed` or `cancelled`) and refunds unused credits in the same
   transaction. The refund happens exactly once.

Generation and saving to Shopify are tracked separately:

- An item is charged once its content has been generated and saved in the app.
- Saving the content to Shopify is retried on temporary errors. The result is
  recorded on the item as `writeBackStatus` (`applied` / `failed` / `skipped`).
- A failed save never re-runs generation. The job ends as `partial`, and the
  Jobs page lists the item as "generated but not saved to Shopify". The content
  stays in the app.
- Each generation step (standard content, schema, FAQ) is retried on its own.
  When an item is resumed after a crash, any step whose content was already
  saved during this job is skipped. This avoids paying the AI provider twice
  and writing duplicate generation logs.

Token renewal: the session store never lets an older offline token pair
overwrite a newer one. The worker loads or refreshes a shop's token under a
per-shop database lock, which follows Shopify's guidance to serialize refreshes
per shop.

The worker keeps a lease on each job and renews it every batch and on a timer.
If the worker crashes or the VPS restarts, the lease expires (2 minutes by
default) and the next worker resumes from the first unprocessed item. Writes
from a worker whose lease expired are rejected.

## Coolify setup (second application)

Create a second Coolify application from the same repository and Dockerfile:

| Setting            | Value                                                  |
| ------------------ | ------------------------------------------------------ |
| Start command      | `npm run worker:start`                                 |
| Ports / domain     | none (the worker serves no HTTP)                       |
| Health check       | disabled                                               |
| Restart policy     | `unless-stopped` / always                              |
| Environment        | same as the main app (`DATABASE_URL`, `SHOPIFY_*`, `SCOPES`, AI keys); the worker defaults `DB_CONNECTION_LIMIT` to 15 |

The main app container runs `prisma migrate deploy` at startup. The worker does
not run migrations, so deploy the main app first.

## Switching from Inngest

1. Deploy the main app (it applies the migration). Leave `BULK_JOB_RUNNER` unset,
   so new jobs still go to Inngest.
2. Deploy the worker application. It only claims jobs with `runner = 'worker'`,
   so at this point it is idle.
3. Set `BULK_JOB_RUNNER=worker` on the main app and redeploy. New jobs now go to
   the worker.
4. Jobs created before the switch keep `runner = 'inngest'` and finish (or fail
   and refund) on Inngest. Keep the Inngest endpoint deployed until no
   `runner = 'inngest'` job is `pending` or `processing`. Then remove the
   Inngest code in a separate change.

To roll back, unset `BULK_JOB_RUNNER` on the main app. Worker jobs already
queued still finish on the worker.

## Tests

```sh
npm run test:db:up        # throwaway MariaDB 10.11 on 127.0.0.1:3317
TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/nexai_test npm test
npm run test:db:down
```

Tests refuse any database that is not on localhost, whose name does not contain
`test`, or that matches the app's configured `DATABASE_URL`.
