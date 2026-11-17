import { proxy } from "./_shared/gateway.mjs";

// The secured gateway's chat endpoint handles the Copilot conversation payload.
export default async (request) => proxy(request, "/api/chat", "POST");

export const config = { path: "/api/copilot", method: "POST" };
