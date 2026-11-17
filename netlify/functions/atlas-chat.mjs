import { proxy } from "./_shared/gateway.mjs";

export default async (request) => proxy(request, "/api/chat", "POST");

export const config = { path: "/api/chat", method: "POST" };
