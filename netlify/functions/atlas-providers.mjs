import { proxy } from "./_shared/gateway.mjs";

export default async (request) => proxy(request, "/api/providers", "GET");

export const config = { path: "/api/providers", method: "GET" };
