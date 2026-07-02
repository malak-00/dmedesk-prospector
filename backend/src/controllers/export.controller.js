import { companiesToCsv } from "../services/export.service.js";
import { exportCompaniesToSheet, SheetsNotConfiguredError } from "../services/sheetsExport.service.js";

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

export async function exportToSheet(req, res, next) {
  try {
    const { companies } = req.body;

    if (!Array.isArray(companies) || companies.length === 0) {
      const error = new Error("Request body must include a non-empty 'companies' array");
      error.status = 400;
      throw error;
    }

    const result = await exportCompaniesToSheet(companies);
    res.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof SheetsNotConfiguredError) {
      err.status = 503;
    }
    next(err);
  }
}

export default { exportCsv, exportToSheet };