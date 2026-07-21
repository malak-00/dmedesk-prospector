// 1:1 port of appscript/services/CsvExport.js -- pure string building, no
// I/O, no `fax` column (removed 2026-07-21). `flattenCompany`'s keys are
// also exactly what leadsService.js maps into the `leads` table's columns,
// so this one CSV_COLUMNS list is the single place the lead schema is
// defined -- keep leadsService.js's column mapping in sync with this if
// you ever change it.

export const CSV_COLUMNS = [
  { key: "name", label: "Company Name" },
  { key: "npi", label: "NPI" },
  { key: "phone", label: "Phone" },
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
  { key: "medicareClaims", label: "Medicare Claims" },
  { key: "medicareBeneficiaries", label: "Medicare Beneficiaries" },
  { key: "medicarePayment", label: "Medicare Payment $" },
  { key: "contactPhone", label: "Contact Phone" },
  { key: "nppesLastUpdated", label: "NPPES Last Updated" },
];

function escapeCsvValue(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function flattenCompany(company) {
  const primaryContact = company.decisionMakers?.[0] || null;
  const sources = company.sources || {};
  const activeSources = Object.keys(sources).filter((k) => sources[k]).join("; ");
  const address = company.address || {};
  const taxonomy = company.taxonomy || {};
  const places = company.places || {};
  const score = company.score || {};

  return {
    name: company.name,
    npi: company.npi,
    phone: company.phone,
    website: company.website,
    email: company.email,
    addressLine1: address.line1,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    taxonomy: taxonomy.description,
    contactName: primaryContact ? primaryContact.name : "",
    contactTitle: primaryContact ? primaryContact.title : "",
    contactRole: primaryContact ? primaryContact.roleCategory : "",
    contactSource: primaryContact ? primaryContact.source : "",
    contactPhone: primaryContact?.phone || "",
    additionalContacts: Math.max((company.decisionMakers?.length || 1) - 1, 0),
    rating: places.rating ?? "",
    scoreValue: score.value ?? "",
    scorePercentage: score.percentage ?? "",
    sources: activeSources,
    medicareClaims: company.medicare?.totalClaims ?? "",
    medicareBeneficiaries: company.medicare?.totalBeneficiaries ?? "",
    medicarePayment: company.medicare?.medicarePayment ?? "",
    nppesLastUpdated: company.lastUpdated || "",
  };
}

export function companiesToCsv(companies) {
  companies = companies || [];
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

export default { CSV_COLUMNS, flattenCompany, companiesToCsv };
