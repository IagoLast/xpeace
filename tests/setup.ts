import { vi } from "vitest";
vi.mock("server-only", () => ({}));
process.env.APP_SECRET = "test-secret-with-at-least-32-characters-for-xpeace";
process.env.DATABASE_URL = "postgres://test:test@localhost/test";
process.env.APP_URL = "http://localhost:3000";
