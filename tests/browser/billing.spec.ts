import { build } from "esbuild";
import { test, expect, type Page } from "@playwright/test";
import type { Billing } from "../../src/lib/domain";

// Exercise the production billing panel and real HTTP client in a browser.
// The authenticated server/Stripe/SQL boundary is covered in billing.test.ts;
// this fixture avoids connecting browser tests to the developer's live database.
let script: string;
const base: Billing = {
  configured: true,
  active: false,
  hasCustomer: false,
  status: "none",
  periodEnd: null,
  cancelAtPeriodEnd: false,
  used: { analyses: 0, cleanup: 0, xRequests: 0, xCredits: 0 },
  limits: { analyses: 100, cleanup: 50, xRequests: 2000, xCredits: 200 },
};

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import React, { useCallback, useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { BillingPanel } from './src/components/billing-panel';
        function Fixture() {
          const [billing, setBilling] = useState(window.fixture.billing);
          const refresh = useCallback(async () => {
            const response = await fetch('/api/state');
            setBilling((await response.json()).billing);
          }, []);
          return <main className="workspace"><BillingPanel billing={billing}
            returnState={window.fixture.returnState} refresh={refresh} /></main>;
        }
        createRoot(document.getElementById('root')).render(<Fixture />);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  script = result.outputFiles[0].text;
});

async function mount(
  page: Page,
  billing: Billing = base,
  returnState?: string,
) {
  await page.goto("/");
  const rootClass = await page.locator("html").getAttribute("class");
  const styles = await page
    .locator('link[rel="stylesheet"]')
    .evaluateAll((links) =>
      links.map((link) => (link as HTMLLinkElement).href),
    );
  await page.route("**/__billing-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="es" class="${rootClass ?? ""}"><head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      ${styles.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}
      </head><body><div id="root"></div><script>window.fixture=${JSON.stringify({ billing, returnState })};</script>
      <script>${script.replaceAll("</script", "<\\/script")}</script></body></html>`,
    }),
  );
  await page.goto("/__billing-test");
  await expect(
    page.getByRole("heading", { name: "Tu suscripción" }),
  ).toBeVisible();
}

test("subscribing opens hosted Checkout and a failed request can be retried", async ({
  page,
}) => {
  let attempt = 0;
  await page.route("**/api/billing/checkout", (route) => {
    expect(route.request().method()).toBe("POST");
    return route.fulfill(
      ++attempt === 1
        ? {
            status: 503,
            json: { error: "Stripe no está disponible. Vuelve a intentarlo." },
          }
        : { json: { url: "https://checkout.stripe.com/c/pay/test" } },
    );
  });
  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({ body: "Checkout de prueba" }),
  );
  await mount(page);
  await page.getByRole("button", { name: "Suscribirme" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Stripe no está disponible. Vuelve a intentarlo.",
  );
  await page.getByRole("button", { name: "Suscribirme" }).click();
  await expect(page).toHaveURL("https://checkout.stripe.com/c/pay/test");
});

test("a success return remains unpaid until server reconciliation confirms payment", async ({
  page,
}) => {
  let paid = false;
  const pending = { ...base, hasCustomer: true };
  const state = () => ({
    ...pending,
    active: paid,
    status: paid ? "active" : "none",
  });
  await page.route("**/api/billing/refresh", (route) =>
    route.fulfill({ json: state() }),
  );
  await page.route("**/api/state", (route) =>
    route.fulfill({ json: { billing: state() } }),
  );
  await mount(page, pending, "success");
  await expect(page.getByRole("status")).toContainText(
    "Todavía no hay un período pagado activo",
  );
  await expect(page.getByRole("button", { name: "Suscribirme" })).toBeVisible();
  paid = true;
  await page.getByRole("button", { name: "Comprobar pago" }).click();
  await expect(
    page.getByText("Suscripción activa", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Suscribirme" })).toHaveCount(
    0,
  );
});

test("mobile subscribers see exhausted quota and can manage a scheduled cancellation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/billing/portal", (route) =>
    route.fulfill({
      json: { url: "https://billing.stripe.com/p/session/test" },
    }),
  );
  await page.route("https://billing.stripe.com/**", (route) =>
    route.fulfill({ body: "Portal de prueba" }),
  );
  await mount(page, {
    ...base,
    active: true,
    hasCustomer: true,
    status: "active",
    cancelAtPeriodEnd: true,
    periodEnd: "2026-11-19T12:00:00Z",
    used: { ...base.used, analyses: 100 },
  });
  await expect(
    page.getByText("Baja programada", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Acceso hasta el/)).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Has agotado un cupo");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: "test-results/mobile-billing.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Gestionar suscripción" }).click();
  await expect(page).toHaveURL("https://billing.stripe.com/p/session/test");
});

test("billing remains unavailable until the server is configured", async ({
  page,
}) => {
  await mount(page, { ...base, configured: false });
  await expect(
    page.getByRole("button", { name: "Suscribirme" }),
  ).toBeDisabled();
  await expect(page.getByText("Suscripciones próximamente")).toBeVisible();
});

test("an active subscriber can go directly to cancellation", async ({
  page,
}) => {
  await page.route("**/api/billing/cancel", (route) => {
    expect(route.request().method()).toBe("POST");
    return route.fulfill({
      json: { url: "https://billing.stripe.com/p/session/cancel" },
    });
  });
  await page.route("https://billing.stripe.com/**", (route) =>
    route.fulfill({ body: "Cancelar suscripción" }),
  );
  await mount(page, {
    ...base,
    active: true,
    hasCustomer: true,
    status: "active",
  });
  await expect(page.getByRole("progressbar").first()).toBeHidden();
  await page
    .getByRole("button", { name: "Cancelar suscripción", exact: true })
    .click();
  await expect(page).toHaveURL("https://billing.stripe.com/p/session/cancel");
});
