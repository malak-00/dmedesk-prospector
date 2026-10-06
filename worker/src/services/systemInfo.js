// Read-only "what is this app connected to and what is installed" for the Admin
// Controls tab. Reports whether things are set, never their values.
import * as SearchInsights from "./searchInsights.js";

const hasColumn = async (supabase, table, column) => {
  const { error } = await supabase.from(table).select(column).limit(1);
  return !error;
};

export async function getSystemInfo(config, supabase) {
  const [meetings, removeUsers, claimForOthers, search] = await Promise.all([
    hasColumn(supabase, "leads", "meeting_at"),
    hasColumn(supabase, "app_users", "disabled_at"),
    hasColumn(supabase, "app_users", "can_claim_for_others"),
    SearchInsights.getCapabilities(config, supabase).catch(() => ({ advanced: false })),
  ]);

  const googleAuth = Boolean(config.googleOauthClientId() && config.googleOauthClientSecret() && config.googleOauthRefreshToken());
  return {
    searchSource: config.npiSource(),
    sessionHours: 6,
    integrations: [
      { key: "signin", label: "Sign-in", configured: Boolean(config.jwtSecret()), note: "Signed sessions last 6 hours" },
      { key: "sheets", label: "Google Sheet export", configured: googleAuth && Boolean(config.googleSheetId()), note: "The Export to Sheet button" },
      { key: "calendar", label: "Google Calendar", configured: googleAuth && Boolean(config.googleCalendarId()), note: "Booked meetings" },
      { key: "ai", label: "AI call briefs", configured: Boolean(config.geminiApiKey()), note: "Generate brief" },
      { key: "places", label: "Business details (Foursquare)", configured: Boolean(config.foursquareApiKey()), note: "Website, ratings and hours on results" },
    ],
    installed: [
      { key: "search", label: "Lead counts, quality filters and territory", installed: Boolean(search.advanced), note: "sql/021, 022, 024, 025" },
      { key: "meetings", label: "Meetings", installed: meetings, note: "sql/020" },
      { key: "claimForOthers", label: "Claiming for another user", installed: claimForOthers, note: "sql/011" },
      { key: "removeUsers", label: "Removing users", installed: removeUsers, note: "sql/026" },
    ],
  };
}
