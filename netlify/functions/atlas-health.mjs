import { proxy } from "./_shared/gateway.mjs";

export default async (request) => proxy(request, "/api/health", "GET");

export const config = { path: "/api/health", method: "GET" };
