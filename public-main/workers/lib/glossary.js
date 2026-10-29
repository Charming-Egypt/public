/**
 * Fixed renderings for names and trade terms that a general translator gets wrong (it either translates a place name
 * literally or transliterates it differently on every page). Only the entries that actually occur in the text being
 * translated are sent to the model, so the prompt stays small. Add a row whenever a translation of a recurring term looks off.
 * `en` = the English spellings to look for (case-insensitive); the rest are the exact target-language forms to use.
 * Destination names come from shared/data/destinations.json (already reviewed by a person).
 */
export const GLOSSARY = [
  { en: ['Sharm El-Sheikh', 'Sharm El Sheikh', 'Sharm el-Sheikh', 'Sharm'], ar: 'شرم الشيخ', ru: 'Шарм-эль-Шейх', de: 'Scharm El-Scheich', it: 'Sharm el-Sheikh', tr: 'Şarm El-Şeyh' },
  { en: ['Ras Mohammed', 'Ras Mohamed', 'Ras Muhammad'], ar: 'رأس محمد', ru: 'Рас-Мохаммед', de: 'Ras Mohammed', it: 'Ras Mohammed', tr: 'Ras Muhammed' },
  { en: ['Ras Mohammed National Park'], ar: 'محمية رأس محمد', ru: 'Национальный парк Рас-Мохаммед', de: 'Ras-Mohammed-Nationalpark', it: 'Parco Nazionale di Ras Mohammed', tr: 'Ras Muhammed Milli Parkı' },
  { en: ['Naama Bay'], ar: 'خليج نعمة', ru: 'Наама Бэй', de: 'Naama Bay', it: 'Naama Bay', tr: 'Naama Bay' },
  { en: ['Old Market', 'Old Market (Souk)'], ar: 'السوق القديم', ru: 'Старый рынок', de: 'Alter Markt', it: 'Vecchio Mercato', tr: 'Eski Çarşı' },
  { en: ['SOHO Square'], ar: 'سوهو سكوير', ru: 'SOHO Square', de: 'SOHO Square', it: 'SOHO Square', tr: 'SOHO Square' },
  { en: ['Al-Sahaba Mosque', 'Sahaba Mosque'], ar: 'مسجد الصحابة', ru: 'Мечеть Аль-Сахаба', de: 'Al-Sahaba-Moschee', it: 'Moschea Al-Sahaba', tr: 'Sahabe Camii' },
  { en: ['Tiran Island', 'Tiran'], ar: 'جزيرة تيران', ru: 'остров Тиран', de: 'Insel Tiran', it: 'Isola di Tiran', tr: 'Tiran Adası' },
  { en: ['Red Sea'], ar: 'البحر الأحمر', ru: 'Красное море', de: 'Rotes Meer', it: 'Mar Rosso', tr: 'Kızıldeniz' },
  { en: ['Dahab'], ar: 'دهب', ru: 'Дахаб', de: 'Dahab', it: 'Dahab', tr: 'Dahab' },
  { en: ['Blue Hole'], ar: 'الحفرة الزرقاء', ru: 'Голубая дыра', de: 'Blue Hole', it: 'Blue Hole', tr: 'Blue Hole' },
  { en: ['snorkeling', 'snorkelling'], ar: 'سنوركل', ru: 'снорклинг', de: 'Schnorcheln', it: 'snorkeling', tr: 'şnorkel' },
  { en: ['diving', 'scuba diving'], ar: 'الغوص', ru: 'дайвинг', de: 'Tauchen', it: 'immersioni subacquee', tr: 'dalış' },
  { en: ['glass-bottom boat', 'glass bottom boat'], ar: 'قارب بقاع زجاجي', ru: 'лодка со стеклянным дном', de: 'Glasbodenboot', it: 'barca con fondo di vetro', tr: 'cam tabanlı tekne' },
  { en: ['all inclusive', 'all-inclusive'], ar: 'شامل كل شيء', ru: 'всё включено', de: 'All Inclusive', it: 'all inclusive', tr: 'her şey dahil' },
  { en: ['half board'], ar: 'نصف إقامة', ru: 'полупансион', de: 'Halbpension', it: 'mezza pensione', tr: 'yarım pansiyon' },
  { en: ['quad safari', 'quad bike safari'], ar: 'سفاري بالدراجات الرباعية', ru: 'квадроциклы-сафари', de: 'Quad-Safari', it: 'safari in quad', tr: 'ATV safari' },
  { en: ['airport transfer'], ar: 'توصيل من/إلى المطار', ru: 'трансфер из/в аэропорт', de: 'Flughafentransfer', it: 'transfer aeroportuale', tr: 'havalimanı transferi' },
];

/** Entries whose English spelling occurs in `texts`, as `English => target form` lines (longest English match first). */
export function glossaryFor(texts, target) {
  const hay = texts.join('\n').toLowerCase(), seen = new Set(), lines = [];
  for (const g of GLOSSARY) {
    const form = g[target]; if (!form) continue;
    const hit = g.en.filter(e => hay.includes(e.toLowerCase())).sort((a, b) => b.length - a.length)[0];
    if (hit && !seen.has(g.en[0])) { seen.add(g.en[0]); lines.push(`${hit} => ${form}`); }
  }
  return lines;
}
