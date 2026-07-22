// Port of backend/src/services/export.service.js -- pure string building,
// no dependencies, ports as-is.

var CsvExport = (function () {
  var CSV_COLUMNS = [
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
    // a column existed keep their positions, and SheetsStore extends the
    // header in place. Reordering would misalign every old row.
    { key: "medicareClaims", label: "Medicare Claims" },
    { key: "medicareBeneficiaries", label: "Medicare Beneficiaries" },
    { key: "medicarePayment", label: "Medicare Payment $" },
    { key: "contactPhone", label: "Contact Phone" },
    { key: "nppesLastUpdated", label: "NPPES Last Updated" },
  ];

  function escapeCsvValue(value) {
    if (value === null || value === undefined) return "";
    var str = String(value);
    if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
    return str;
  }

  function flattenCompany(company) {
    var primaryContact = (company.decisionMakers && company.decisionMakers[0]) || null;
    var sources = company.sources || {};
    var activeSources = Object.keys(sources).filter(function (k) { return sources[k]; }).join("; ");
    var address = company.address || {};
    var taxonomy = company.taxonomy || {};
    var places = company.places || {};
    var score = company.score || {};

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
      medicareBeneficiaries: company.medicare && company.medicare.totalBeneficiaries != null ? company.medicare.totalBeneficiaries : "",
      medicarePayment: company.medicare && company.medicare.medicarePayment != null ? company.medicare.medicarePayment : "",
      nppesLastUpdated: company.lastUpdated || "",
    };
  }

  function companiesToCsv(companies) {
    companies = companies || [];
    if (!Array.isArray(companies) || companies.length === 0) {
      var error = new Error("At least one company is required to export");
      error.status = 400;
      throw error;
    }

    var header = CSV_COLUMNS.map(function (c) { return escapeCsvValue(c.label); }).join(",");
    var rows = companies.map(function (company) {
      var flat = flattenCompany(company);
      return CSV_COLUMNS.map(function (c) { return escapeCsvValue(flat[c.key]); }).join(",");
    });

    return [header].concat(rows).join("\r\n");
  }

  return {
    CSV_COLUMNS: CSV_COLUMNS,
    flattenCompany: flattenCompany,
    companiesToCsv: companiesToCsv,
  };
})();