const DEFAULT_DURATION_MINUTES = 30;

export function GoogleCalendarNotConfiguredError() {
  const err = new Error("Google Calendar booking is not configured (missing Google OAuth credentials or GOOGLE_CALENDAR_ID)");
  err.name = "GoogleCalendarNotConfiguredError";
  return err;
}

let cachedToken = null;

function assertConfigured(config) {
  if (!config.googleOauthClientId() || !config.googleOauthClientSecret() || !config.googleOauthRefreshToken() || !config.googleCalendarId()) {
    throw GoogleCalendarNotConfiguredError();
  }
}

async function getAccessToken(config) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.googleOauthClientId(),
      client_secret: config.googleOauthClientSecret(),
      refresh_token: config.googleOauthRefreshToken(),
    }),
  });
  if (!res.ok) {
    const err = new Error("Failed to authenticate with Google Calendar: " + (await res.text().catch(() => res.statusText)));
    err.status = 502;
    throw err;
  }
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

async function calendarApi(token, calendarId, path, options = {}) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!res.ok) {
    const err = new Error("Google Calendar API error: " + (await res.text().catch(() => res.statusText)));
    err.status = 502;
    throw err;
  }
  return res.json();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function eventUrl(eventId, calendarId) {
  const raw = `${String(eventId).split("@")[0]} ${calendarId}`;
  const encoded = btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `https://calendar.google.com/calendar/u/0/r/eventedit/${encoded}`;
}

function displayLabel(startTime, timeZone) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone })
    .format(new Date(startTime));
}

export async function bookMeeting(config, lead, { startTime, durationMinutes = DEFAULT_DURATION_MINUTES } = {}) {
  assertConfigured(config);

  const start = new Date(startTime);
  const duration = Number(durationMinutes);
  if (Number.isNaN(start.getTime())) {
    const err = new Error("startTime must be a valid date/time");
    err.status = 400;
    throw err;
  }
  if (start.getTime() <= Date.now()) {
    const err = new Error("Meeting time must be in the future");
    err.status = 400;
    throw err;
  }
  if (!Number.isInteger(duration) || duration < 15 || duration > 180) {
    const err = new Error("durationMinutes must be a whole number between 15 and 180");
    err.status = 400;
    throw err;
  }
  if (!validEmail(lead.email)) {
    const err = new Error("This lead does not have a valid email address");
    err.status = 400;
    throw err;
  }

  const end = new Date(start.getTime() + duration * 60_000);
  const calendarId = config.googleCalendarId();
  const token = await getAccessToken(config);
  const timeMin = new Date(start.getTime() - 60_000).toISOString();
  const timeMax = new Date(start.getTime() + 60_000).toISOString();
  const duplicateQuery = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    privateExtendedProperty: `dmeNpi=${lead.npi}`,
    maxResults: "10",
  });
  const existing = await calendarApi(token, calendarId, `?${duplicateQuery}`);
  const duplicate = (existing.items || []).find((item) => item.start?.dateTime && Math.abs(new Date(item.start.dateTime).getTime() - start.getTime()) < 60_000);
  if (duplicate) {
    return {
      alreadyBooked: true,
      eventId: duplicate.id,
      eventUrl: eventUrl(duplicate.id, calendarId),
      displayText: displayLabel(duplicate.start.dateTime, config.googleCalendarTimeZone()),
      startTime: duplicate.start.dateTime,
    };
  }

  const internalGuests = String(config.googleCalendarInternalGuests() || "")
    .split(",")
    .map((email) => email.trim())
    .filter(validEmail);
  const guests = [...new Set([lead.email.trim(), ...internalGuests])].map((email) => ({ email }));
  const created = await calendarApi(token, calendarId, "?sendUpdates=all", {
    method: "POST",
    body: JSON.stringify({
      summary: `Meeting with George ${lead.name || "Lead"}${lead.contactName ? ` - ${lead.contactName}` : ""}`,
      description: `Booked from DME Desk Prospector\nNPI: ${lead.npi}\nCompany: ${lead.name || ""}`,
      start: { dateTime: start.toISOString(), timeZone: config.googleCalendarTimeZone() },
      end: { dateTime: end.toISOString(), timeZone: config.googleCalendarTimeZone() },
      attendees: guests,
      guestsCanModify: false,
      extendedProperties: { private: { dmeNpi: String(lead.npi), dmeBookedBy: String(lead.claimedBy || "") } },
      reminders: { useDefault: true },
    }),
  });

  return {
    alreadyBooked: false,
    eventId: created.id,
    eventUrl: eventUrl(created.id, calendarId),
    displayText: displayLabel(start, config.googleCalendarTimeZone()),
    startTime: start.toISOString(),
  };
}
