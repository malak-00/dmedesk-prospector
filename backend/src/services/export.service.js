export const CSV_COLUMNS = [
  { key: "name", label: "Company Name" },
  { key: "npi", label: "NPI" },
  { key: "phone", label: "Phone" },
  { key: "fax", label: "Fax" },
  { key: "website", label: "Website" },
  { key: "email", label: "Email" },
  { key: "addressLine1", label: "Address" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "postalCode", label: "Postal Code" },
  { key: "taxonomy", label: "Specialty" },
  { key: "contactName", label: "Contact Name" },
  { key: "contactTitle", label: "Contact Title" },
  { key: "contactRole", label: "Contact Role" },
  { key: "contactSource", label: "Contact Source" },
  { key: "additionalContacts", label: "Additional Contacts Found" },
  { key: "rating", label: "Rating" },
  { key: "scoreValue", label: "Score" },
  { key: "scorePercentage", label: "Score %" },
  { key: "sources", label: "Data Sources" },
  // New columns must only ever be APPENDED here: sheet rows written before
  // a column existed keep their positions. Reordering would misalign every
  // old row in the shared Google Sheet.
  { key: "medicareClaims", label: "Medicare Claims" },
  { key: "medicareBeneficiaries", label: "Medicare Beneficiaries" },
  { key: "medicarePayment", label: "Medicare Payment $" },
  { key: "contactPhone", label: "Contact Phone" },
  { key: "nppesLastUpdated", label: "NPPES Last Updated" },
];

function escapeCsvValue(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function flattenCompany(company) {
  const primaryContact = company.decisionMakers?.[0] || null;
  const activeSources = Object.entries(company.sources || {})
    .filter(([, active]) => active)
    .map(([source]) => source)
    .join("; ");

  return {
    name: company.name,
    npi: company.npi,
    phone: company.phone,
    fax: company.fax,
    website: company.website,
    email: company.email,
    addressLine1: company.address?.line1,
    city: company.address?.city,
    state: company.address?.state,
    postalCode: company.address?.postalCode,
    taxonomy: company.taxonomy?.description,
    contactName: primaryContact?.name || "",
    contactTitle: primaryContact?.title || "",
    contactRole: primaryContact?.roleCategory || "",
    contactSource: primaryContact?.source || "",
    contactPhone: primaryContact?.phone || "",
    additionalContacts: Math.max((company.decisionMakers?.length || 1) - 1, 0),
    rating: company.places?.rating ?? "",
    scoreValue: company.score?.value ?? "",
    scorePercentage: company.score?.percentage ?? "",
    sources: activeSources,
    medicareClaims: company.medicare?.totalClaims ?? "",
    medicareBeneficiaries: company.medicare?.totalBeneficiaries ?? "",
    medicarePayment: company.medicare?.medicarePayment ?? "",
    nppesLastUpdated: company.lastUpdated || "",
  };
}

/**
 * Converts an array of Company objects into a CSV string.
 */
export function companiesToCsv(companies = []) {
  if (!Array.isArray(companies) || companies.length === 0) {
    const error = new Error("At least one company is required to export");
    error.status = 400;
    throw error;
  }

  const header = CSV_COLUMNS.map((c) => escapeCsvValue(c.label)).join(",");

  const rows = companies.map((company) => {
    const flat = flattenCompany(company);
    return CSV_COLUMNS.map((c) => escapeCsvValue(flat[c.key])).join(",");
  });

  return [header, ...rows].join("\r\n");
}

export default { companiesToCsv };