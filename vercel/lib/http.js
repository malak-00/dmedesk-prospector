// Shared request/response plumbing for every api/ route. The Apps Script
// version of this (appscript/Code.js) had to work around Web Apps that
// can't set real HTTP status codes and don't handle CORS preflight -- none
// of that applies here, so this is the "real" version: real status codes,
// real CORS headers, a real Authorization header instead of a `?token=`
// query param. See ARCHITECTURE.md's CORS section for why the old app
// looked the way it did.

import config from "./config.js";
import { createUserClient, createServiceClient } from "./supabaseClient.js";

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export function sendData(res, data, status = 200) {
  res.status(status).json({ success: true, data });
}

export function sendError(res, status, message) {
  res.status(status).json({ success: false, error: message });
}

// Splits the path segments after `basePath` out of the raw request URL --
// used by the catch-all routes (api/auth/[...action].js etc.) instead of
// Vercel's file-system dynamic-segment `req.query` population, which isn't
// reliably populated for plain (non-framework) Vercel Functions the way
// Next.js API routes populate it. Parsing req.url directly works regardless.
export function getActionSegments(req, basePath) {
  const pathname = req.url.split("?")[0];
  const idx = pathname.indexOf(basePath);
  const rest = idx >= 0 ? pathname.slice(idx + basePath.length) : "";
  return rest.split("/").filter(Boolean);
}

// Verifies the Authorization: Bearer <token> header against Supabase Auth
// and loads that user's `app_users` row (display name / saved
// exclude-keywords default). Returns { user, profile, supabase } or throws a
// 401 -- used directly by the catch-all routes (api/leads/[[...action]].js
// etc.) that need to authenticate some of their sub-actions but not others,
// and by withAuth below for single-purpose routes.
export async function authenticate(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    const err = new Error("Not signed in");
    err.status = 401;
    throw err;
  }

  // Verifying a token is one of the few things that needs the service-role
  // client -- there's no user-scoped client to check the token WITH until
  // we know it's valid.
  const serviceClient = createServiceClient();
  const { data: userData, error: userError } = await serviceClient.auth.getUser(token);
  if (userError || !userData || !userData.user) {
    const err = new Error("Not signed in (or session expired)");
    err.status = 401;
    throw err;
  }

  const { data: profile, error: profileError } = await serviceClient
    .from("app_users")
    .select("*")
    .eq("id", userData.user.id)
    .single();
  if (profileError || !profile) {
    const err = new Error("No account found -- sign in again, or contact the app owner");
    err.status = 401;
    throw err;
  }

  return {
    user: { id: userData.user.id, email: userData.user.email },
    profile,
    supabase: createUserClient(token),
  };
}

// Wraps a handler with the same CORS/OPTIONS/error-handling as withPublic,
// plus authenticate() above -- attaches req.user/req.profile/req.supabase.
// Route handlers should always query through req.supabase, never a raw
// service-role client, so RLS stays the real enforcement point.
export function withAuth(handler) {
  return async function (req, res) {
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    try {
      const { user, profile, supabase } = await authenticate(req);
      req.user = user;
      req.profile = profile;
      req.supabase = supabase;

      await handler(req, res);
    } catch (err) {
      console.error(`[api] ${req.url}:`, err);
      sendError(res, err.status || 500, err.message || "Internal Server Error");
    }
  };
}

// Same CORS/OPTIONS/error-handling wrapper as withAuth, but for routes that
// must be reachable without a session (health check, login itself).
export function withPublic(handler) {
  return async function (req, res) {
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    try {
      await handler(req, res);
    } catch (err) {
      console.error(`[api] ${req.url}:`, err);
      sendError(res, err.status || 500, err.message || "Internal Server Error");
    }
  };
}
