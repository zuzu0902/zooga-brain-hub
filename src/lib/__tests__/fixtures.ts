/**
 * Synthetic dry-run fixtures. NO real customer data, NO PII:
 * every phone is in the reserved +9725500000xx test range and names are labels.
 */
export type LeadFixture = {
  label: string;
  raw_phone: string;
  full_name: string | null;
  expect_phone: string | null;
  consent: boolean;
};

export const LEAD_FIXTURES: LeadFixture[] = [
  { label: "il_local_0", raw_phone: "0550000001", full_name: "Fixture One", expect_phone: "+972550000001", consent: true },
  { label: "il_dashes", raw_phone: "055-000-0002", full_name: "Fixture Two", expect_phone: "+972550000002", consent: true },
  { label: "il_spaces", raw_phone: " 055 000 0003 ", full_name: null, expect_phone: "+972550000003", consent: true },
  { label: "e164", raw_phone: "+972550000004", full_name: "Fixture Four", expect_phone: "+972550000004", consent: true },
  { label: "intl_00", raw_phone: "00972550000005", full_name: "Fixture Five", expect_phone: "+972550000005", consent: false },
  { label: "no_leading_zero", raw_phone: "550000006", full_name: "Fixture Six", expect_phone: "+972550000006", consent: true },
  { label: "prefix_972", raw_phone: "972550000007", full_name: "Fixture Seven", expect_phone: "+972550000007", consent: true },
  { label: "dup_of_first", raw_phone: "+972550000001", full_name: "Fixture One Dup", expect_phone: "+972550000001", consent: true },
  { label: "invalid_short", raw_phone: "12", full_name: "Fixture Bad", expect_phone: null, consent: true },
  { label: "invalid_empty", raw_phone: "   ", full_name: "Fixture Empty", expect_phone: null, consent: true },
];
