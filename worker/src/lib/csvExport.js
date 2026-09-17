// 1:1 port of appscript/services/CsvExport.js -- pure string building.
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

// A search result can be several NPIs: companyService merges branches of the
// same business into one row with a `locations` array, and the export used to
// drop everything but the primary NPI. It rides in one trailing column rather
// than one row per branch, so a company stays one row -- and it is appended
// after the tracking columns in the Sheet, so tabs written before it keep
// every column where it was.
export const OTHER_LOCATIONS_COLUMN = { key: "otherLocations", label: "Other Locations" };

export function otherLocationsCell(company) {
  const locations = (company && company.locations) || [];
  if (locations.length <= 1) return "";
  return locations
    .filter((loc) => loc && String(loc.npi) !== String(company.npi))
    .map((loc) => {
      const address = loc.address || {};
      const where = [address.line1, [address.city, address.state].filter(Boolean).join(", "), address.postalCode]
        .filter(Boolean)
        .join(", ");
      return [loc.npi, where, loc.phone].filter(Boolean).join(" | ");
    })
    .join(" ; ");
}

// Same column for the Claimed view's export, built from the identity group
// leadsRepo attaches (sql/010) instead of an in-memory branch merge.
export function claimedOtherLocationsCell(lead) {
  return ((lead && lead.branches) || [])
    .map((branch) => {
      const where = [branch.addressLine1, [branch.city, branch.state].filter(Boolean).join(", "), branch.postalCode]
        .filter(Boolean)
        .join(", ");
      return [branch.npi, where, branch.phone].filter(Boolean).join(" | ");
    })
    .join(" ; ");
}

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

  const header = CSV_COLUMNS.map((c) => escapeCsvValue(c.label))
    .concat(escapeCsvValue(OTHER_LOCATIONS_COLUMN.label))
    .join(",");
  const rows = companies.map((company) => {
    const flat = flattenCompany(company);
    return CSV_COLUMNS.map((c) => escapeCsvValue(flat[c.key]))
      .concat(escapeCsvValue(otherLocationsCell(company)))
      .join(",");
  });

  return [header].concat(rows).join("\r\n");
}
