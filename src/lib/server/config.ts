import "server-only";

export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta configurar ${name}.`);
  return value;
}

export function configuration() {
  return [
    "DATABASE_URL",
    "X_CLIENT_ID",
    "X_CLIENT_SECRET",
    "APP_SECRET",
    "APP_URL",
  ].filter((name) => !process.env[name]);
}

export function appUrl() {
  return required("APP_URL").replace(/\/$/, "");
}
