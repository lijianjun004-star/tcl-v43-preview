// opencc-js 1.4.2, bundled t2cn preset. Include Taiwan phrase conversion.
import { Converter } from './vendor/opencc/t2cn.mjs';
const convert = Converter({ from: 'twp', to: 'cn' });
export function toSimplified(raw) {
  // Unit spelling only; preserve model IDs, Latin abbreviations and quantities.
  return convert(String(raw ?? '').trim()).replace(/吋/g, '寸');
}
