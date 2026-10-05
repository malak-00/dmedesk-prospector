// Lets an admin try searching DME Desk's own provider table while everyone
// else stays on the source the Worker is configured for (NPI_SOURCE).
//
// The browser sends X-Search-Source: dmedesk; this honours it only for an
// admin session. Anyone else's header is ignored, so it can't be used to
// bypass the configured source. Nothing is stored: each request decides, and
// switching the trial off is just not sending the header.
export const SOURCE_HEADER = "X-Search-Source";

// Returns the config to use for this request and whether the trial is active.
export function applySourceTrial(config, session, requested) {
  if (!session || session.isAdmin !== true) return { config, trial: false };
  if (String(requested || "").trim().toLowerCase() !== "dmedesk") return { config, trial: false };
  // Already on DME Desk for everyone: nothing to try.
  if (config && typeof config.npiSource === "function" && String(config.npiSource() || "").trim().toLowerCase() === "dmedesk") {
    return { config, trial: false };
  }
  return { config: { ...config, npiSource: () => "dmedesk" }, trial: true };
}
