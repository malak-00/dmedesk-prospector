import { companiesToCsv } from "../services/export.service.js";

export async function exportCsv(req, res, next) {
  try {
    const { companies } = req.body;

    if (!Array.isArray(companies)) {
      const error = new Error("Request body must include a 'companies' array");
      error.status = 400;
      throw error;
    }

    const csv = companiesToCsv(companies);
    const timestamp = new Date().toISOString().slice(0, 10);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="dme-leads-${timestamp}.csv"`
    );
    res.send(csv);
  } catch (err) {
    next(err);
  }
}

export default { exportCsv };