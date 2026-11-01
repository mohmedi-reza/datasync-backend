/**
 * Optional Bearer auth.
 * If AUTH_TOKEN is empty, all requests are allowed (useful for first deploy).
 * Matches Android SyncApiService: Authorization: Bearer <token>
 */
export function createAuthMiddleware(authToken) {
  const expected = (authToken ?? "").trim();

  return function requireAuth(req, res, next) {
    if (!expected) {
      return next();
    }

    const header = req.get("authorization") || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    const provided = match?.[1]?.trim();

    if (!provided || provided !== expected) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized",
        message: "Missing or invalid Bearer token",
      });
    }

    return next();
  };
}
