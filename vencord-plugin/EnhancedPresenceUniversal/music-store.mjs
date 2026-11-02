// Apple Music storefront IDs for the stores whose IDs are well established. Any other
// storefront returns null, and callers fall back to the Mac's region.
const storefronts = new Map(Object.entries({
  143441: 'US', 143442: 'FR', 143443: 'DE', 143444: 'GB', 143445: 'AT', 143446: 'BE', 143447: 'FI', 143448: 'GR',
  143449: 'IE', 143450: 'IT', 143451: 'LU', 143452: 'NL', 143453: 'PT', 143454: 'ES', 143455: 'CA', 143456: 'SE',
  143457: 'NO', 143458: 'DK', 143459: 'CH', 143460: 'AU', 143461: 'NZ', 143462: 'JP', 143463: 'HK', 143464: 'SG',
  143465: 'CN', 143466: 'KR', 143467: 'IN', 143468: 'MX', 143469: 'RU', 143470: 'TW', 143471: 'VN', 143472: 'ZA',
  143473: 'MY', 143474: 'PH', 143475: 'TH', 143476: 'ID', 143477: 'PK', 143478: 'PL', 143479: 'SA', 143480: 'TR',
  143481: 'AE', 143482: 'HU', 143483: 'CL', 143485: 'PA', 143486: 'LK', 143487: 'RO', 143489: 'CZ', 143491: 'IL',
  143492: 'UA', 143493: 'KW', 143494: 'HR', 143495: 'CR', 143496: 'SK', 143497: 'LB', 143498: 'QA', 143499: 'SI',
  143501: 'CO', 143502: 'VE', 143503: 'BR', 143504: 'GT', 143505: 'AR', 143506: 'SV', 143507: 'PE', 143508: 'DO',
  143509: 'EC', 143510: 'HN', 143511: 'JM', 143512: 'NI', 143513: 'PY', 143514: 'UY', 143515: 'MO', 143516: 'EG',
  143517: 'KZ', 143518: 'EE', 143519: 'LV', 143520: 'LT', 143521: 'MT', 143526: 'BG'
}));

// Music saves identifiers such as "143455-6,42": the storefront ID, then language and platform codes.
export function storeCountryFromStorefront(identifier) {
  if (typeof identifier !== 'string' || identifier.length > 32) return null;
  const id = /^(\d{6})(?:-[\d,]+)?$/.exec(identifier)?.[1];
  return id ? storefronts.get(id) ?? null : null;
}
