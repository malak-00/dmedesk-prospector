import { scrapeCompanyWebsite } from "../services/scraper.service.js";

export async function scrapeWebsite(req, res, next) {
  try {
    const { url } = req.query;
    if (!url) {
      const error = new Error("Query parameter 'url' is required");
      error.status = 400;
      throw error;
    }
    const result = await scrapeCompanyWebsite(url);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export default { scrapeWebsite };
