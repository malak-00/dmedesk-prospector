// 1:1 port of appscript/services/CsvExport.js -- pure string building.
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
  { key: "medicareClaims", label: "Medicare Claims" },
  { key: "medicareBeneficiaries", label: "Medicare Beneficiaries" },
  { key: "medicarePayment", label: "Medicare Payment $" },
  { key: "contactPhone", label: "Contact Phone" },
  { key: "nppesLastUpdated", label: "NPPES Last Updated" },
];

function escapeCsvValue(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

export function flattenCompany(company) {
  const primaryContact = (company.decisionMakers && company.decisionMakers[0]) || null;
  const sources = company.sources || {};
  const activeSources = Object.keys(sources)
    .filter((k) => sources[k])
    .join("; ");
  const address = company.address || {};
  const taxonomy = company.taxonomy || {};
  const places = company.places || {};
  const score = company.score || {};

  return {
    name: company.name,
    npi: company.npi,
    phone: company.phone,
    fax: company.fax,
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
    contactPhone: primaryContact && primaryContact.phone ? primaryContact.phone : "",
    additionalContacts: Math.max(((company.decisionMakers && company.decisionMakers.length) || 1) - 1, 0),
    rating: places.rating != null ? places.rating : "",
    scoreValue: score.value != null ? score.value : "",
    scorePercentage: score.percentage != null ? score.percentage : "",
    sources: activeSources,
    medicareClaims: company.medicare && company.medicare.totalClaims != null ? company.medicare.totalClaims : "",
    medicareBeneficiaries:
      company.medicare && company.medicare.totalBeneficiaries != null ? company.medicare.totalBeneficiaries : "",
    medicarePayment: company.medicare && company.medicare.medicarePayment != null ? company.medicare.medicarePayment : "",
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

  return [header].concat(rows).join("\r\n");
}
