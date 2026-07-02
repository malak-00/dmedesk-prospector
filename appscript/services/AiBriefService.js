// Port of backend/src/services/aiBrief.service.js.
// Same endpoint/header pattern (x-goog-api-key, not the deprecated ?key= param).

var GeminiNotConfiguredError = function () {
  var err = new Error("GEMINI_API_KEY is not configured");
  err.name = "GeminiNotConfiguredError";
  return err;
};

var AiBriefService = (function () {
  var BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

  function assertConfigured() {
    if (!Config.geminiApiKey()) throw GeminiNotConfiguredError();
  }

  function buildPrompt(company) {
    var dm = company.decisionMakers && company.decisionMakers[0];
    var dmLine = dm
      ? "Primary contact: " + dm.name + (dm.title ? ", " + dm.title : "") + " (role: " + dm.roleCategory + ")"
      : "No named contact identified -- brief should suggest asking for the owner or office manager.";

    var score = company.score || {};

    return "You are preparing a short call brief for a sales rep at DME Desk, an AI-powered voice receptionist product for DMEPOS (Durable Medical Equipment) suppliers. The rep is about to cold-call the company below to pitch DME Desk.\n\n" +
      "Company: " + company.name + "\n" +
      "Location: " + company.address.city + ", " + company.address.state + "\n" +
      "Specialty: " + (company.taxonomy && company.taxonomy.description ? company.taxonomy.description : "Unknown") + "\n" +
      "Website: " + (company.website || "None found") + "\n" +
      dmLine + "\n" +
      "Lead score: " + (score.percentage != null ? score.percentage : "N/A") + "% (" +
      (score.value != null ? score.value : "N/A") + "/" + (score.maxPossible != null ? score.maxPossible : "N/A") + " points)\n\n" +
      "Write a concise call brief with exactly these sections, each 1-3 short lines:\n" +
      "1. Opening line (personalized, not generic)\n" +
      "2. Likely pain point for this type of DME supplier\n" +
      "3. One key talking point connecting DME Desk to that pain point\n" +
      "4. One smart discovery question to ask\n" +
      "5. One likely objection and a brief response to it\n\n" +
      "Keep the entire brief under 150 words. Plain text, no markdown headers, just numbered lines.";
  }

  function generateCallBrief(company) {
    assertConfigured();

    var prompt = buildPrompt(company);
    var url = BASE_URL + "/" + Config.geminiModel() + ":generateContent";

    var response;
    try {
      response = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        headers: { "x-goog-api-key": Config.geminiApiKey() },
        payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        muteHttpExceptions: true,
      });
    } catch (err) {
      var unreachable = new Error("Failed to reach Gemini API");
      unreachable.status = 504;
      unreachable.details = String(err);
      throw unreachable;
    }

    var code = response.getResponseCode();
    if (code === 429) {
      var rateLimited = new Error("Gemini API rate limit reached -- try again shortly");
      rateLimited.status = 429;
      throw rateLimited;
    }
    if (code >= 400) {
      var upstreamError = new Error("Gemini API responded with status " + code);
      upstreamError.status = 502;
      upstreamError.details = response.getContentText();
      throw upstreamError;
    }

    var data = JSON.parse(response.getContentText());
    var text = data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;

    if (!text) {
      var noContent = new Error("Gemini API returned no usable content");
      noContent.status = 502;
      throw noContent;
    }

    return text.trim();
  }

  return { generateCallBrief: generateCallBrief };
})();
