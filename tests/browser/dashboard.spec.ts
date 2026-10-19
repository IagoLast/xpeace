import { test, expect } from "@playwright/test";

test("disconnected users can only connect X and receive no sample account data", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Tu tranquilidad empieza aquí" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Iniciar sesión con X", exact: true }),
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
    page.getByRole("link", { name: "Iniciar sesión con X", exact: true }),
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
    page.getByRole("link", { name: "Iniciar sesión con X", exact: true }),
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

test("theme follows the system, persists a choice and works on the public BPN page", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.getByRole("button", { name: "Activar modo oscuro" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("link", { name: "Qué es BPN" }).click();
  await expect(page).toHaveURL(/\/bpn$/);
  await expect(
    page.getByRole("heading", { name: "Block por nabo" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Quiero xpeace" }),
  ).toHaveAttribute("href", "/");
  await page.getByRole("button", { name: "Activar modo claro" }).click();
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/bpn-light-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
