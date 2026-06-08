const planCodeMap: Record<string, string> = {
  UHIP2: "Hospital Indemnity Shield 2.0",
  UNHIP: "Original Hospital Indemnity Shield",
  UNCAN: "Cancer Shield 2.0",
  UGHIP: "Guaranteed Issue Hospital Indemnity Shield",
  UTHHC: "Home Health Care Shield with TCARE benefit",
  UNHHC: "Original Home Health Care Shield",
  UNFEL: "Final Expense Shield - Life",
  UDV17: "Dental Vision",
  UDV18: "Dental Vision",
  UDN21: "Dental Shield 2.0",
  UDN24: "Dental Shield 2.0 with waiving of waiting periods option",
  UFGHI: "Guaranteed Issue Hospital Indemnity Shield - FL with Assoc.",
  UFHIP: "Hospital Indemnity Shield 2.0 - FL with Assoc.",
  UIHHC: "Caregiver Shield",
  UCSIA: "Original Cancer Individual Plan A",
  UCSIB: "Original Cancer Individual Plan B",
  UCSIC: "Original Cancer Individual Plan C",
  UNFEX: "Optional Guaranteed Issue $5k Life policy offered on Hosp Indem Shield",
};

export function resolvePlanName(value: string | null | undefined): string {
  if (!value) return "";
  const key = value.trim().toUpperCase();
  return planCodeMap[key] || value;
}

export const UNL_PLAN_OPTIONS = [
  "Hospital Indemnity Shield 2.0",
  "Original Hospital Indemnity Shield",
  "Cancer Shield 2.0",
  "Guaranteed Issue Hospital Indemnity Shield",
  "Home Health Care Shield with TCARE benefit",
  "Original Home Health Care Shield",
  "Final Expense Shield - Life",
  "Dental Vision",
  "Dental Shield 2.0",
  "Dental Shield 2.0 with waiving of waiting periods option",
  "Guaranteed Issue Hospital Indemnity Shield - FL with Assoc.",
  "Hospital Indemnity Shield 2.0 - FL with Assoc.",
  "Caregiver Shield",
  "Original Cancer Individual Plan A",
  "Original Cancer Individual Plan B",
  "Original Cancer Individual Plan C",
  "Optional Guaranteed Issue $5k Life policy offered on Hosp Indem Shield",
];

export { planCodeMap };
