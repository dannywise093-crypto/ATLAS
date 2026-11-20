export function extractBearerToken(header) {
  if (typeof header !== "string") return "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isSafeStorageSegment(value) {
  return typeof value === "string" && SAFE_SEGMENT.test(value) && value !== "." && value !== "..";
}

export function validStorageRequest(method, path) {
  const parts = String(path).split("/").filter(Boolean);
  if (parts[0] !== "v1" || parts[1] !== "tenants" || !isSafeStorageSegment(parts[2])) return false;
  if (parts[3] === "records" && parts.length === 5) {
    return isSafeStorageSegment(parts[4]) && method === "GET";
  }
  if (parts[3] === "records" && parts.length === 6) {
    return isSafeStorageSegment(parts[4]) && isSafeStorageSegment(parts[5]) &&
      ["GET", "PUT", "DELETE"].includes(method);
  }
  if (parts[3] === "events" && parts.length === 5) {
    return isSafeStorageSegment(parts[4]) && ["GET", "POST"].includes(method);
  }
  return false;
}
