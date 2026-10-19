import { build } from "esbuild";
import { test, expect, type Page } from "@playwright/test";
import { defaultSettings, type Snapshot } from "../../src/lib/domain";

let script: string;
const initial: Snapshot = {
  mode: "live",
  billing: {
    configured: true,
    active: true,
    hasCustomer: true,
    status: "active",
    periodEnd: "2026-11-19T12:00:00Z",
    cancelAtPeriodEnd: false,
    used: { analyses: 3, xRequests: 4, xCredits: 50 },
    limits: { analyses: 100, xRequests: 2000, xCredits: 200 },
  },
  account: { id: "1", username: "cuenta_de_prueba", name: "Cuenta" },
  settings: { ...defaultSettings, enabled: true },
  muteAccess: { read: true, write: true },
  interactions: [
    {
      id: "100",
      author_id: "2",
      username: "otra_cuenta",
      name: "Otra cuenta",
      text: "Un mensaje que BPN ya ha evaluado.",
      created_at: "2026-10-19T10:00:00Z",
      direct_reply: false,
      status: "blocked",
      reply_id: "999",
      reply_text: null,
      error: null,
      decision: {
        abuse: 0.99,
        insult: 0.99,
        optOut: 0,
        label: "insult",
        latency: 4,
        model: "test",
      },
    },
  ],
  stats: { analyzed: 3, flagged: 1, blocked: 1, muted: 0 },
  lastSync: "2026-10-19T10:00:00Z",
  lastError: null,
};

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { Dashboard } from './src/components/dashboard';
        import { ThemeProvider } from './src/components/theme-provider';
        import { Toaster } from './src/components/ui/sonner';
        createRoot(document.getElementById('root')).render(
          <ThemeProvider><Dashboard initial={window.fixture.data} missing={[]} /><Toaster /></ThemeProvider>
        );`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
    banner: {
      js: 'var process = { env: { NODE_ENV: "production" }, browser: true };',
    },
  });
  script = result.outputFiles[0].text;
});

async function mount(page: Page, seed = initial) {
  const state = structuredClone(seed);
  await page.route("**/api/state", (route) => route.fulfill({ json: state }));
  await page.route("**/api/actions", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "settings") state.settings = body.settings;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  const styles = await page
    .locator('link[rel="stylesheet"]')
    .evaluateAll((links) =>
      links.map((link) => (link as HTMLLinkElement).href),
    );
  await page.route("**/__account-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1">
      ${styles.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}</head><body><div id="root"></div>
      <script>window.fixture=${JSON.stringify({ data: state })};</script><script>${script.replaceAll("</script", "<\\/script")}</script></body></html>`,
    }),
  );
  await page.goto("/__account-test");
  await expect(
    page.getByRole("button", { name: "Cerrar sesión" }),
  ).toBeVisible();
}

test("BPN saves immediately, history is visible and logout returns to sign-in", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mount(page);
  await expect(page.getByRole("switch")).toHaveCount(1);
  await expect(page.getByRole("switch", { name: "Activar BPN" })).toBeChecked();
  await page.getByRole("switch", { name: "Activar BPN" }).click();
  await expect(
    page.getByRole("switch", { name: "Activar BPN" }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("heading", { name: "Actividad reciente" }),
  ).toBeVisible();
  await expect(
    page.getByText("Respondida y bloqueada", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Opciones avanzadas|Probar una frase|Por revisar|aprobación previa/,
    ),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Utilidades", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Activar modo oscuro" }).click();
  await page.screenshot({
    path: "test-results/account-dark-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Activar modo claro" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/account-light-mobile.png",
    fullPage: true,
  });
  const logout = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/actions") &&
      request.postDataJSON().action === "logout",
  );
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await logout;
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("link", { name: "Iniciar sesión con X" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("shows why a possible insult was not blocked and saves the threshold without rewriting history", async ({
  page,
}) => {
  const seed = structuredClone(initial);
  seed.settings.allowlist = ["amigo"];
  seed.interactions = [
    {
      ...seed.interactions[0],
      status: "allowed",
      reply_id: null,
      decision: {
        ...seed.interactions[0].decision!,
        abuse: 0.89,
        insult: 0.61,
        threshold: 0.9,
      },
    },
    {
      ...seed.interactions[0],
      id: "101",
      status: "allowed",
      reply_id: null,
      decision: {
        ...seed.interactions[0].decision!,
        abuse: 0.54,
        insult: 0.28,
        label: "rude",
      },
    },
  ];
  await mount(page, seed);
  const threshold = page.getByRole("slider", {
    name: "Sensibilidad de BPN",
  });
  const save = page.getByRole("button", { name: "Guardar sensibilidad" });
  await expect(threshold).toHaveValue("9");
  await expect(save).toBeDisabled();
  await expect(
    page.getByText("Por debajo del umbral", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Posible insulto", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Probabilidad de abuso: 89\s*%.*Umbral aplicado: 90\s*%/),
  ).toBeVisible();
  await expect(
    page.getByText(/Probabilidad de abuso: 54\s*%.*Umbral actual: 90\s*%/),
  ).toBeVisible();
  await expect(page.getByText("Sin problema", { exact: true })).toHaveCount(0);
  await threshold.focus();
  await threshold.press("Home");
  await expect(threshold).toHaveAttribute(
    "aria-valuetext",
    "Baja; umbral de silenciado 99 %",
  );
  await threshold.press("End");
  await expect(threshold).toHaveAttribute(
    "aria-valuetext",
    "Alta; umbral de silenciado 60 %",
  );
  await threshold.press("Home");
  for (let i = 0; i < 14; i++) await threshold.press("ArrowRight");
  await expect(threshold).toHaveAttribute(
    "aria-valuetext",
    "Media; umbral de silenciado 85 %",
  );
  const request = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/actions") &&
      request.postDataJSON().action === "settings",
  );
  await save.click();
  expect((await request).postDataJSON()).toEqual({
    action: "settings",
    settings: { ...seed.settings, threshold: 0.85 },
  });
  await expect(
    page.getByText("Sensibilidad guardada", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(threshold).toHaveValue("14");
  await expect(save).toBeDisabled();
  await expect(
    page.getByText(/Probabilidad de abuso: 89\s*%.*Umbral aplicado: 90\s*%/),
  ).toBeVisible();
  await expect(
    page.getByText(/Probabilidad de abuso: 54\s*%.*Umbral actual: 85\s*%/),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(threshold).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/bpn-threshold-mobile.png",
    fullPage: true,
  });
});

test("keeps the saved threshold when a settings update fails", async ({
  page,
}) => {
  await mount(page);
  await page.route("**/api/actions", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "No se pudo guardar el umbral." },
    }),
  );
  await page.getByRole("slider", { name: "Sensibilidad de BPN" }).press("End");
  await page.getByRole("button", { name: "Guardar sensibilidad" }).click();
  await expect(
    page.getByText("No se pudo guardar el umbral.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Sensibilidad guardada", { exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("slider", { name: "Sensibilidad de BPN" }),
  ).toHaveValue("9");
});

test("requires reconnection for mute permissions and preserves historical block labels", async ({
  page,
}) => {
  const seed = structuredClone(initial);
  seed.muteAccess = { read: false, write: false };
  await mount(page, seed);
  await expect(
    page.getByText("Pendiente de permisos", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Reconectar X" }),
  ).toHaveAttribute("href", "/api/auth/x");
  await expect(
    page.getByRole("button", { name: "Ver silenciados" }),
  ).toHaveCount(0);
  const historical = page.locator("article").first();
  await expect(historical).toContainText("Respondida y bloqueada");
  await expect(historical).toContainText("Ver respuesta enviada");
  await expect(historical).not.toContainText("mute por nabo");
});

test("loads muted users only on demand, paginates without duplicates and keeps results on errors", async ({
  page,
}) => {
  const seed = structuredClone(initial);
  seed.interactions[0].status = "muted";
  seed.interactions[0].reply_text =
    "mute por nabo 🫜 https://xpeace.vercel.app/bpn";
  seed.stats.muted = 1;
  await page.clock.install();
  await mount(page, seed);
  const requests: Record<string, unknown>[] = [];
  let fail = false;
  await page.route("**/api/actions", async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (fail)
      return route.fulfill({
        status: 429,
        json: { error: "X ha limitado las peticiones." },
      });
    const users = body.cursor
      ? [
          { id: "2", username: "otra_cuenta", name: "Otra cuenta" },
          { id: "3", username: "silenciada", name: "Cuenta silenciada" },
        ]
      : [{ id: "2", username: "otra_cuenta", name: "Otra cuenta" }];
    return route.fulfill({
      json: { users, nextCursor: body.cursor ? null : "next" },
    });
  });
  await page.clock.fastForward(9000);
  expect(requests).toHaveLength(0);
  await expect(
    page.getByText("Respondida y silenciada", { exact: true }),
  ).toBeVisible();
  const list = page.getByRole("region", { name: "Usuarios silenciados" });
  await list.getByRole("button", { name: "Ver silenciados" }).click();
  await expect(list.getByText("@otra_cuenta", { exact: true })).toBeVisible();
  await expect(list.getByText(/hay más resultados/)).toBeVisible();
  await list.getByRole("button", { name: "Cargar más silenciados" }).click();
  await expect(list.getByText("@silenciada", { exact: true })).toBeVisible();
  await expect(list.getByText("@otra_cuenta", { exact: true })).toHaveCount(1);
  await expect(
    list.getByRole("button", { name: "Cargar más silenciados" }),
  ).toHaveCount(0);
  expect(requests).toEqual([
    { action: "mutes" },
    { action: "mutes", cursor: "next" },
  ]);
  fail = true;
  await list.getByRole("button", { name: "Actualizar lista" }).click();
  await expect(list.getByRole("alert")).toContainText(
    "Se conservan los últimos resultados",
  );
  await expect(list.getByText("@silenciada", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/muted-users-mobile.png",
    fullPage: true,
  });
});

test("shows an empty mute list only after X returns a complete empty result", async ({
  page,
}) => {
  await mount(page);
  const list = page.getByRole("region", { name: "Usuarios silenciados" });
  await expect(
    list.getByText("No tienes usuarios silenciados en X."),
  ).toHaveCount(0);
  await page.route("**/api/actions", (route) =>
    route.fulfill({ json: { users: [], nextCursor: null } }),
  );
  await list.getByRole("button", { name: "Ver silenciados" }).click();
  await expect(
    list.getByText("No tienes usuarios silenciados en X."),
  ).toBeVisible();
});

test("unmutes a single row only after confirmation and disables duplicate actions", async ({
  page,
}) => {
  await mount(page);
  const list = page.getByRole("region", { name: "Usuarios silenciados" });
  const requests: Record<string, unknown>[] = [];
  let confirm!: () => void;
  const confirmation = new Promise<void>((resolve) => {
    confirm = resolve;
  });
  await page.route("**/api/actions", async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (body.action === "unmute") {
      await confirmation;
      return route.fulfill({ json: { ok: true, userId: body.userId } });
    }
    return route.fulfill({
      json: {
        users: [
          { id: "2", username: "otra_cuenta", name: "Otra cuenta" },
          { id: "3", username: "silenciada", name: "Cuenta silenciada" },
        ],
        nextCursor: "next",
      },
    });
  });
  await list.getByRole("button", { name: "Ver silenciados" }).click();
  await list
    .getByRole("button", {
      name: "Dejar de silenciar a @otra_cuenta",
      exact: true,
    })
    .click();
  await expect(list.getByText("Quitando silencio…")).toBeVisible();
  await expect(list.getByText("@otra_cuenta", { exact: true })).toBeVisible();
  await expect(
    list.getByRole("button", {
      name: "Dejar de silenciar a @silenciada",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    list.getByRole("button", { name: "Actualizar lista" }),
  ).toBeDisabled();
  confirm();
  await expect(list.getByText("@otra_cuenta", { exact: true })).toHaveCount(0);
  await expect(list.getByText("@silenciada", { exact: true })).toBeVisible();
  await expect(
    list.getByText(/1 cuentas cargadas; hay más resultados/),
  ).toBeVisible();
  await expect(
    list.getByRole("button", { name: "Cargar más silenciados" }),
  ).toBeEnabled();
  await expect(
    page.getByText("Has dejado de silenciar a @otra_cuenta", { exact: true }),
  ).toBeVisible();
  expect(requests).toEqual([
    { action: "mutes" },
    { action: "unmute", userId: "2" },
  ]);
});

test("keeps a failed unmute available to retry, including when the later panel refresh fails", async ({
  page,
}) => {
  await mount(page);
  const list = page.getByRole("region", { name: "Usuarios silenciados" });
  let fail = true;
  await page.route("**/api/actions", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "unmute")
      return route.fulfill(
        fail
          ? {
              status: 403,
              json: { error: "X ha rechazado la operación de silenciado." },
            }
          : { json: { ok: true, userId: body.userId } },
      );
    return route.fulfill({
      json: {
        users: [{ id: "2", username: "otra_cuenta", name: "Otra cuenta" }],
        nextCursor: null,
      },
    });
  });
  await list.getByRole("button", { name: "Ver silenciados" }).click();
  const undo = list.getByRole("button", {
    name: "Dejar de silenciar a @otra_cuenta",
    exact: true,
  });
  await undo.click();
  await expect(list.getByRole("alert")).toContainText(
    "No se ha podido confirmar el cambio para @otra_cuenta",
  );
  await expect(list.getByText("@otra_cuenta", { exact: true })).toBeVisible();
  await expect(undo).toBeEnabled();
  await expect(
    page.getByText("Has dejado de silenciar a @otra_cuenta", { exact: true }),
  ).toHaveCount(0);
  fail = false;
  await page.route("**/api/state", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await undo.click();
  await expect(
    list.getByText("No tienes usuarios silenciados en X."),
  ).toBeVisible();
  await expect(list.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByText(
      "Operación completada, pero no se pudo actualizar el panel.",
      { exact: true },
    ),
  ).toBeVisible();
});

test("read-only mute permission allows the list but cannot unmute", async ({
  page,
}) => {
  const seed = structuredClone(initial);
  seed.muteAccess.write = false;
  await mount(page, seed);
  await page.route("**/api/actions", (route) =>
    route.fulfill({
      json: {
        users: [{ id: "2", username: "otra_cuenta", name: "Otra cuenta" }],
        nextCursor: null,
      },
    }),
  );
  const list = page.getByRole("region", { name: "Usuarios silenciados" });
  await list.getByRole("button", { name: "Ver silenciados" }).click();
  await expect(
    list.getByRole("button", {
      name: "Dejar de silenciar a @otra_cuenta",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    list.getByText(
      "Reconecta X en el panel de BPN para poder dejar de silenciar usuarios.",
    ),
  ).toBeVisible();
});
