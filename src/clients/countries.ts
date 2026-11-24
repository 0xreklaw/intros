/**
 * Countries, for the allow and block lists in Settings. Codes are ISO 3166-1 alpha-2; names
 * come from the platform's own locale data, so there is no table of names to keep up to date.
 */

const CODES = (
  "AF AX AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI " +
  "CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO " +
  "FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT " +
  "JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN " +
  "ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW " +
  "BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL " +
  "TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW"
).split(" ")

const names = new Intl.DisplayNames(["en"], { type: "region" })

export interface Country {
  code: string
  name: string
}

/** Every country, by name. */
export const COUNTRIES: Country[] = CODES.map((code) => ({
  code,
  name: names.of(code) ?? code,
})).sort((a, b) => a.name.localeCompare(b.name))

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]))

export const isCountryCode = (code: unknown): code is string =>
  typeof code === "string" && BY_CODE.has(code)

export const countryName = (code: string) => BY_CODE.get(code)?.name ?? code

/** The lists in Settings: who to leave out, and, when set, the only countries to keep. */
export interface CountrySettings {
  /** People in these countries are never shown. */
  blocked: string[]
  /** When not empty, only people in these countries are shown. */
  allowed: string[]
}

/**
 * Whether a person in `code` stays. A block always wins. An allow list keeps only its own
 * countries, so someone whose country is unknown (`null`) is dropped: we cannot say they are
 * from there. With no allow list, an unknown country stays: nothing says they are blocked.
 */
export function countryAllowed(
  code: string | null,
  settings: CountrySettings
): boolean {
  if (code && settings.blocked.includes(code)) return false
  if (settings.allowed.length)
    return code !== null && settings.allowed.includes(code)
  return true
}
