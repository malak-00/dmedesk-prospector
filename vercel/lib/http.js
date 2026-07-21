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

// Verifies the Authorization: Bearer <token> header against Supabase Auth,
// loads that user's `profiles` row (display name / saved exclude-keywords
// default), and attaches:
//   req.user     -- { id, email } from Supabase Auth
//   req.profile  -- the profiles row
//   req.supabase -- a Supabase client scoped to THIS user's own access
//                   token, so every query it makes is subject to Postgres
//                   Row-Level Security as that user (see
//                   lib/supabaseClient.js and supabase/migrations/0001_init.sql)
//
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
      const authHeader = req.headers.authorization || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!token) return sendError(res, 401, "Not signed in");

      // Verifying a token is one of the few things that needs the
      // service-role client -- there's no user-scoped client to check the
      // token WITH until we know it's valid.
      const serviceClient = createServiceClient();
      const { data: userData, error: userError } = await serviceClient.auth.getUser(token);
      if (userError || !userData || !userData.user) {
        return sendError(res, 401, "Not signed in (or session expired)");
      }

      const { data: profile, error: profileError } = await serviceClient
        .from("profiles")
        .select("*")
        .eq("id", userData.user.id)
        .single();
      if (profileError || !profile) {
        return sendError(res, 401, "No profile found for this account -- sign in again, or contact the app owner");
      }

      req.user = { id: userData.user.id, email: userData.user.email };
      req.profile = profile;
      req.supabase = createUserClient(token);

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
