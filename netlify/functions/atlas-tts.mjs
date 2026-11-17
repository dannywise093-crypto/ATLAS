import { proxyTts } from "./_shared/gateway.mjs";

export default async (request) => proxyTts(request);

export const config = { path: "/api/tts", method: "POST" };
