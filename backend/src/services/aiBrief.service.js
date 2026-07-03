import axios from "axios";
import config from "../config/index.js";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

class GeminiNotConfiguredError extends Error {
  constructor() {
    super("GEMINI_API_KEY is not configured");
    this.name = "GeminiNotConfiguredError";
  }
}

function assertConfigured() {
  if (!config.geminiApiKey) {
    throw new GeminiNotConfiguredError();
  }
}

function buildPrompt(company) {
  const dm = company.decisionMakers?.[0];
  const dmLine = dm
    ? `Primary contact: ${dm.name}${dm.title ? `, ${dm.title}` : ""} (role: ${dm.roleCategory})`
    : "No named contact identified -- brief should suggest asking for the owner or office manager.";

  const places = company.places || {};
  let reputationLine;
  if (typeof places.rating === "number") {
    reputationLine = `Online reputation: rated ${places.rating}/10 from ${places.ratingCount ?? "an unknown number of"} reviews on Foursquare.`;
  } else if (company.sources?.places) {
    reputationLine = "Online reputation: listed on Foursquare but has no rating yet (little/no review presence).";
  } else {
    reputationLine = "Online reputation: not found on Foursquare at all (weak or absent online presence).";
  }

  const webLine = company.website
    ? `Website: ${company.website}`
    : "Website: NONE FOUND -- likely relies entirely on phone; missed/after-hours calls are lost business.";

  let medicareLine;
  if (company.medicare?.totalClaims != null) {
    const m = company.medicare;
    medicareLine =
      `Medicare DMEPOS volume (CMS public data): ${m.totalClaims} claims` +
      (m.totalBeneficiaries != null ? ` across ${m.totalBeneficiaries} beneficiaries` : "") +
      (m.medicarePayment != null ? `, ~$${Math.round(m.medicarePayment).toLocaleString()} in Medicare payments` : "") +
      " -- an active biller with real call volume to protect.";
  } else {
    medicareLine = "Medicare DMEPOS volume: no CMS claims data found (small, new, or non-Medicare supplier).";
  }

  return `You are preparing a short call brief for a sales rep at DME Desk, an AI-powered voice receptionist product for DMEPOS (Durable Medical Equipment) suppliers. The rep is about to cold-call the company below to pitch DME Desk.

Company: ${company.name}
Location: ${company.address.city}, ${company.address.state}
Specialty: ${company.taxonomy?.description || "Unknown"}
${webLine}
${reputationLine}
${medicareLine}
${dmLine}
Lead score: ${company.score?.percentage ?? "N/A"}% (${company.score?.value ?? "N/A"}/${company.score?.maxPossible ?? "N/A"} points)

Base the pain point and talking point on the SPECIFIC signals above (web presence, reputation, Medicare volume) rather than generic DME industry claims. For example: no website or reviews suggests missed calls go nowhere; high Medicare volume means every missed call is expensive; low ratings suggest service strain.

Write a concise call brief with exactly these sections, each 1-3 short lines:
1. Opening line (personalized, not generic)
2. Likely pain point for this type of DME supplier
3. One key talking point connecting DME Desk to that pain point
4. One smart discovery question to ask
5. One likely objection and a brief response to it

Keep the entire brief under 150 words. Plain text, no markdown headers, just numbered lines.`;
}

/**
 * Generates a short call brief for a rep about to contact this company.
 * Throws GeminiNotConfiguredError if no key is set (caller should catch this specifically).
 */
export async function generateCallBrief(company) {
  assertConfigured();

  const prompt = buildPrompt(company);

  let response;
  try {
    response = await axios.post(
      `${BASE_URL}/${config.geminiModel}:generateContent`,
      { contents: [{ parts: [{ text: prompt }] }] },
      {
        headers: {
          "x-goog-api-key": config.geminiApiKey,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );
  } catch (err) {
    if (err.response?.status === 429) {
      const error = new Error("Gemini API rate limit reached -- try again shortly");
      error.status = 429;
      throw error;
    }
    if (err.response) {
      const error = new Error(`Gemini API responded with status ${err.response.status}`);
      error.status = 502;
      error.details = err.response.data;
      throw error;
    }
    const error = new Error("Failed to reach Gemini API");
    error.status = 504;
    error.details = err.message;
    throw error;
  }

  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const error = new Error("Gemini API returned no usable content");
    error.status = 502;
    throw error;
  }

  return text.trim();
}

export { GeminiNotConfiguredError };
export default { generateCallBrief };