import { test, expect } from "@playwright/test";

test("disconnected users can only connect X and receive no sample account data", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Empieza por conectar tu cuenta" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Conectar X", exact: true }),
  ).toHaveAttribute("href", "/api/auth/x");
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /demo|simular|limpieza|guardar/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Actividad reciente" }),
  ).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("@tu_cuenta");
  await expect(page.locator("body")).not.toContainText("@ruido_online");
});

test("mobile connection and authorization errors render without overflow or hydration errors", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Conectar X", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/mobile-connect.png",
    fullPage: true,
  });
  await page.goto("/?auth_error=not_allowed");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Esta cuenta no está autorizada para este despliegue.",
  );
  await expect(
    page.getByRole("link", { name: "Conectar X", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});

test("unauthenticated writes, JEV calls and cron runs are rejected", async ({
  request,
}) => {
  expect((await request.get("/api/state")).status()).toBe(401);
  const action = await request.post("/api/actions", {
    headers: { Origin: "https://attacker.example" },
    data: { action: "test", text: "test" },
  });
  expect(action.status()).toBe(401);
  expect((await request.get("/api/cron")).status()).toBe(401);
  for (const route of ["checkout", "portal", "refresh"])
    expect((await request.post(`/api/billing/${route}`)).status()).toBe(401);
  expect(
    (await request.post("/api/billing/webhook", { data: {} })).status(),
  ).toBe(400);
});
