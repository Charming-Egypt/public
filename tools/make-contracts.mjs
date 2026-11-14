// Builds the downloadable contract PDFs (shared/contracts/*.pdf) that partners and sellers print, sign and upload with their application.
// Run:  node tools/make-contracts.mjs      (needs playwright; the PDFs are committed, so this is only for editing the wording)
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const req = createRequire(import.meta.url); let pw; try { pw = req('playwright'); } catch { pw = req('/opt/npm-tools/node_modules/playwright'); }
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'shared', 'contracts'); fs.mkdirSync(OUT, { recursive: true });

const C = {
  partner: {
    en: { title: 'Partner Agreement', sub: 'Discover Sharm — listing & distribution of tourism services', party2: 'The Partner', fields: ['Business name', 'Commercial registration no.', 'Tax card no.', 'Authorised signatory', 'National ID / passport no.', 'Address', 'Phone', 'Email'],
      clauses: [
        ['Subject', 'The Partner lists its services (hotel, excursions, transfers, packages or restaurant) on Discover Sharm ("the Platform"), and the Platform promotes them, takes bookings and collects payments on the Partner\'s behalf under this Agreement.'],
        ['Accuracy of listings', 'The Partner is responsible for the accuracy of descriptions, photos, prices, availability and policies. The Partner must honour every confirmed booking at the price and terms shown at the time of booking, and must hold all licences needed to operate (including tourism licences where applicable).'],
        ['Commission', 'The Platform earns a commission on each completed booking at the rate shown in the Partner\'s dashboard (a default rate per service type, or a rate agreed in writing for the Partner). The rate in force at the time of the booking applies to that booking. Payment-gateway fees may be deducted as shown in the dashboard.'],
        ['Payments and payouts', 'The Platform collects customer payments and pays the Partner its share (booking value less commission and fees) to the bank account or InstaPay account registered in the dashboard, once the booking is completed and subject to the minimum payout and verification rules shown in the dashboard. Where a customer pays a balance directly to the Partner, the commission on that booking is settled as shown in the dashboard.'],
        ['Cancellations and refunds', 'Cancellations and refunds follow the Platform\'s published Cancellation and Refund policies. If the Partner cancels or cannot deliver a confirmed booking, the Partner bears the resulting refund and may be charged for the customer\'s reasonable extra costs.'],
        ['Service quality', 'The Partner will deliver services with due care, safety and in accordance with Egyptian law and applicable regulations. Repeated complaints, fraud or safety breaches may lead to suspension of listings.'],
        ['Customer data', 'Customer data received through the Platform may be used only to deliver the booked service. It must be kept confidential, protected, and not sold, shared or used for marketing without the customer\'s consent.'],
        ['Term and termination', 'This Agreement starts on the date of signature and continues until terminated by either party with 30 days\' written notice. The Platform may suspend or terminate immediately for fraud, misleading listings or material breach. Earned amounts for completed bookings remain payable.'],
        ['Liability', 'Each party is liable for its own acts. The Partner is solely responsible for the services it provides and indemnifies the Platform against third-party claims arising from them. The Platform is not liable for indirect or consequential loss.'],
        ['Governing law', 'This Agreement is governed by the laws of the Arab Republic of Egypt. Disputes are first settled amicably; otherwise they are submitted to the competent Egyptian courts.']] },
    ar: { title: 'عقد شراكة', sub: 'ديسكفر شرم — عرض وتوزيع الخدمات السياحية', party2: 'الشريك', fields: ['اسم النشاط', 'رقم السجل التجاري', 'رقم البطاقة الضريبية', 'المفوَّض بالتوقيع', 'رقم البطاقة / جواز السفر', 'العنوان', 'الهاتف', 'البريد الإلكتروني'],
      clauses: [
        ['موضوع العقد', 'يعرض الشريك خدماته (فندق أو رحلات أو انتقالات أو باقات أو مطعم) على منصة ديسكفر شرم ("المنصة")، وتتولى المنصة الترويج لها واستقبال الحجوزات وتحصيل المدفوعات نيابةً عن الشريك وفق هذا العقد.'],
        ['دقة البيانات', 'الشريك مسؤول عن دقة الوصف والصور والأسعار والتوافر والسياسات. ويلتزم بتنفيذ كل حجز مؤكد بالسعر والشروط الظاهرة وقت الحجز، وبحيازة جميع التراخيص اللازمة لمزاولة النشاط (ومنها الترخيص السياحي عند الاقتضاء).'],
        ['العمولة', 'تحصل المنصة على عمولة عن كل حجز مكتمل بالنسبة الظاهرة في لوحة الشريك (نسبة افتراضية لكل نوع خدمة أو نسبة متفق عليها كتابةً مع الشريك). وتسري النسبة السارية وقت الحجز على ذلك الحجز. وقد تُخصم رسوم بوابة الدفع كما تظهر في اللوحة.'],
        ['المدفوعات والتحويلات', 'تحصّل المنصة مدفوعات العملاء وتحوّل للشريك نصيبه (قيمة الحجز بعد خصم العمولة والرسوم) إلى حسابه البنكي أو إنستا باي المسجَّل في اللوحة بعد اكتمال الحجز، وبما يتفق مع الحد الأدنى للتحويل وقواعد التحقق الظاهرة في اللوحة. وإذا سدّد العميل الباقي للشريك مباشرةً فتُسوَّى عمولة ذلك الحجز كما هو موضح في اللوحة.'],
        ['الإلغاء والاسترداد', 'يخضع الإلغاء والاسترداد لسياستي الإلغاء والاسترداد المنشورتين على المنصة. وإذا ألغى الشريك حجزًا مؤكدًا أو تعذّر عليه تنفيذه فهو يتحمل الاسترداد الناتج، وقد يُحمَّل التكاليف الإضافية المعقولة التي تكبدها العميل.'],
        ['جودة الخدمة', 'يلتزم الشريك بتقديم الخدمة بعناية وأمان ووفق القانون المصري واللوائح المعمول بها. وقد يؤدي تكرار الشكاوى أو الاحتيال أو مخالفات السلامة إلى إيقاف العروض.'],
        ['بيانات العملاء', 'تُستخدم بيانات العملاء الواردة عبر المنصة لتنفيذ الخدمة المحجوزة فقط، ويجب الحفاظ على سريتها وحمايتها وعدم بيعها أو مشاركتها أو استخدامها للتسويق دون موافقة العميل.'],
        ['المدة والإنهاء', 'يبدأ العقد من تاريخ التوقيع ويستمر حتى ينهيه أي طرف بإخطار كتابي قبل 30 يومًا. وللمنصة الإيقاف أو الإنهاء فورًا في حالة الاحتيال أو العروض المضللة أو الإخلال الجوهري. وتظل المبالغ المستحقة عن الحجوزات المكتملة واجبة السداد.'],
        ['المسؤولية', 'يتحمل كل طرف مسؤولية أفعاله. والشريك وحده مسؤول عن الخدمات التي يقدمها ويعوّض المنصة عن أي مطالبات من الغير ناشئة عنها. ولا تسأل المنصة عن الأضرار غير المباشرة أو التبعية.'],
        ['القانون الواجب التطبيق', 'يخضع هذا العقد لقوانين جمهورية مصر العربية. وتُحل المنازعات ودّيًا أولًا، وإلا أُحيلت إلى المحاكم المصرية المختصة.']] }
  },
  affiliate: {
    en: { title: 'Seller (Affiliate) Agreement', sub: 'Discover Sharm — independent sales programme', party2: 'The Seller', fields: ['Full name', 'National ID / passport no.', 'Address', 'Phone / WhatsApp', 'Email (account e-mail)', 'Payout method (bank / InstaPay) and account'],
      clauses: [
        ['Subject', 'The Seller promotes and sells Discover Sharm services (hotels, excursions, transfers, packages) to customers using a personal seller code and the seller dashboard, and earns commission on confirmed bookings. The Seller is an independent contractor — not an employee, agent or partner of the Platform — and is responsible for his own taxes and costs.'],
        ['Genuine bookings only', 'The Seller may only create real bookings for real customers. Fake, self-dealing or test bookings made to earn commission, abuse of promotions, or misleading statements about prices, services or the Platform are prohibited and void any commission on those bookings.'],
        ['Commission', 'The Seller earns a share of the Platform\'s commission on each completed booking, at the seller rate shown in the dashboard (default rate, or a personal rate agreed in writing). Commission is earned only once the service is completed and is cancelled if the booking is cancelled, refunded, charged back or found to be fraudulent.'],
        ['Customer money', 'The Seller may collect a deposit or payment from a customer only through the methods and limits provided in the seller dashboard, and must record it immediately. Cash received must be handed over / recorded as the dashboard requires; keeping or misusing customer money is a serious breach and may be reported to the authorities.'],
        ['Payouts', 'Earned commission is paid to the bank account or InstaPay account registered in the dashboard, subject to the minimum payout, verification and holding rules shown there. The Platform may withhold amounts that are under review for fraud or customer reports.'],
        ['Customer data and conduct', 'Customer data seen through the dashboard is confidential and may be used only to serve that booking. The Seller must treat customers respectfully, must not spam, and must comply with applicable law and the Platform\'s policies. Customers may report a seller; reports may lead to limits or suspension.'],
        ['Identity verification', 'The Seller confirms that the identity document supplied is genuine, valid and his own, and that all information in the application is true. The Platform may verify it and may refuse or end the relationship if it is false.'],
        ['Term and termination', 'This Agreement starts on the date of signature and continues until either party ends it with written notice (immediately for breach). Commission already earned on completed, valid bookings stays payable after termination.'],
        ['Liability', 'The Seller is responsible for losses caused by his breach or negligence, including customer money he holds. The Platform is not liable for indirect or consequential loss.'],
        ['Governing law', 'This Agreement is governed by the laws of the Arab Republic of Egypt. Disputes are first settled amicably; otherwise they are submitted to the competent Egyptian courts.']] },
    ar: { title: 'عقد سيلر (برنامج الأفيليت)', sub: 'ديسكفر شرم — برنامج المبيعات المستقل', party2: 'السيلر', fields: ['الاسم بالكامل', 'رقم البطاقة / جواز السفر', 'العنوان', 'الهاتف / واتساب', 'البريد الإلكتروني (إيميل الحساب)', 'طريقة استلام الأرباح (بنك / إنستا باي) والحساب'],
      clauses: [
        ['موضوع العقد', 'يقوم السيلر بالترويج لخدمات ديسكفر شرم (فنادق ورحلات وانتقالات وباقات) وبيعها للعملاء باستخدام كود السيلر الشخصي ولوحة السيلر، ويحصل على عمولة عن الحجوزات المؤكدة. والسيلر متعاقد مستقل — وليس موظفًا أو وكيلًا أو شريكًا للمنصة — ويتحمل ضرائبه وتكاليفه بنفسه.'],
        ['حجوزات حقيقية فقط', 'لا يجوز للسيلر إنشاء إلا حجوزات حقيقية لعملاء حقيقيين. ويُحظر إنشاء حجوزات وهمية أو ذاتية أو تجريبية بغرض الحصول على عمولة، أو إساءة استخدام العروض، أو تقديم معلومات مضللة عن الأسعار أو الخدمات أو المنصة، وتسقط العمولة عن تلك الحجوزات.'],
        ['العمولة', 'يحصل السيلر على نسبة من عمولة المنصة عن كل حجز مكتمل بنسبة السيلر الظاهرة في اللوحة (النسبة الافتراضية أو نسبة شخصية متفق عليها كتابةً). ولا تُستحق العمولة إلا بعد اكتمال الخدمة، وتُلغى إذا أُلغي الحجز أو استُرد أو رُدّت قيمته أو ثبت أنه احتيالي.'],
        ['أموال العملاء', 'لا يجوز للسيلر تحصيل عربون أو مبلغ من العميل إلا بالطرق والحدود المتاحة في لوحة السيلر، ويجب تسجيله فورًا. ويجب تسليم/تسجيل النقدية كما تشترط اللوحة؛ واحتجاز أموال العملاء أو إساءة استخدامها إخلال جسيم قد يُبلَّغ عنه للجهات المختصة.'],
        ['تحويل الأرباح', 'تُحوَّل العمولة المستحقة إلى الحساب البنكي أو إنستا باي المسجَّل في اللوحة، وفق الحد الأدنى للتحويل وقواعد التحقق والاحتجاز الظاهرة فيها. وللمنصة حجز المبالغ قيد المراجعة بسبب اشتباه احتيال أو بلاغات العملاء.'],
        ['بيانات العملاء والسلوك', 'بيانات العملاء الظاهرة في اللوحة سرية ولا تُستخدم إلا لخدمة ذلك الحجز. ويلتزم السيلر بمعاملة العملاء باحترام وعدم الإزعاج، وبالقانون وسياسات المنصة. ويجوز للعملاء الإبلاغ عن سيلر، وقد تؤدي البلاغات إلى فرض حدود أو الإيقاف.'],
        ['التحقق من الهوية', 'يقر السيلر بأن وثيقة الهوية المقدمة أصلية وسارية وخاصة به، وأن جميع بيانات الطلب صحيحة. وللمنصة التحقق منها ورفض الطلب أو إنهاء العلاقة إذا ثبت عدم صحتها.'],
        ['المدة والإنهاء', 'يبدأ العقد من تاريخ التوقيع ويستمر حتى ينهيه أي طرف بإخطار كتابي (وفورًا عند الإخلال). وتظل العمولة المكتسبة عن الحجوزات المكتملة الصحيحة مستحقة بعد الإنهاء.'],
        ['المسؤولية', 'يتحمل السيلر الخسائر الناتجة عن إخلاله أو إهماله، بما في ذلك أموال العملاء التي بحوزته. ولا تسأل المنصة عن الأضرار غير المباشرة أو التبعية.'],
        ['القانون الواجب التطبيق', 'يخضع هذا العقد لقوانين جمهورية مصر العربية. وتُحل المنازعات ودّيًا أولًا، وإلا أُحيلت إلى المحاكم المصرية المختصة.']] }
  }
};
const L = { en: { dir: 'ltr', between: 'This Agreement is made between', p1: 'Discover Sharm (the "Platform")', and: 'and', details: 'Details', date: 'Date', sign: 'Signature', name: 'Name', stamp: 'Stamp (if a company)', foot: 'Print, sign, scan or photograph clearly, and upload with your application.' },
            ar: { dir: 'rtl', between: 'أُبرم هذا العقد بين', p1: 'ديسكفر شرم ("المنصة")', and: 'و', details: 'البيانات', date: 'التاريخ', sign: 'التوقيع', name: 'الاسم', stamp: 'الختم (للشركات)', foot: 'اطبع العقد ووقّعه وصوّره بوضوح ثم ارفعه مع طلبك.' } };
const html = (kind, lang) => { const c = C[kind][lang], l = L[lang]; return `<!doctype html><html lang="${lang}" dir="${l.dir}"><meta charset="utf-8"><style>
@page{size:A4;margin:18mm 16mm}body{font-family:'DejaVu Sans',Arial,sans-serif;font-size:10.5pt;line-height:1.6;color:#111}
h1{font-size:19pt;margin:0 0 2px}.sub{color:#555;margin:0 0 14px;font-size:10pt}.brand{border-bottom:3px solid #d97706;padding-bottom:10px;margin-bottom:14px}
.f{display:flex;gap:8px;margin:5px 0}.f b{min-width:46%}.f i{flex:1;border-bottom:1px solid #777;height:18px}
h2{font-size:11pt;margin:12px 0 2px;color:#92400e}p{margin:0}ol{padding-inline-start:20px;margin:0}li{margin-bottom:7px;break-inside:avoid}
.sig{display:flex;gap:24px;margin-top:26px;break-inside:avoid}.sig div{flex:1}.box{border:1px solid #777;height:70px;margin-top:6px}.foot{margin-top:18px;font-size:9pt;color:#666;text-align:center}</style>
<div class="brand"><h1>${c.title}</h1><p class="sub">${c.sub}</p></div>
<p>${l.between} <b>${l.p1}</b> ${l.and} <b>${c.party2}</b> (${l.details}):</p>
${c.fields.map(f => `<div class="f"><b>${f}</b><i></i></div>`).join('')}
<h2>${lang === 'ar' ? 'البنود' : 'Terms'}</h2><ol>${c.clauses.map(([h, t]) => `<li><b>${h}.</b> ${t}</li>`).join('')}</ol>
<div class="sig"><div><b>${c.party2}</b><div class="f"><b>${l.name}</b><i></i></div><div class="f"><b>${l.date}</b><i></i></div><p>${l.sign}</p><div class="box"></div></div>
<div><b>${lang === 'ar' ? 'المنصة' : 'The Platform'}</b><div class="f"><b>${l.name}</b><i></i></div><div class="f"><b>${l.date}</b><i></i></div><p>${l.stamp}</p><div class="box"></div></div></div>
<p class="foot">${l.foot}</p></html>`; };
const b = await pw.chromium.launch(); const pg = await b.newPage();
for (const k of Object.keys(C)) for (const lang of ['en', 'ar']) { await pg.setContent(html(k, lang)); await pg.pdf({ path: path.join(OUT, `${k}-${lang}.pdf`), format: 'A4', printBackground: true, preferCSSPageSize: true }); console.log('wrote', `${k}-${lang}.pdf`); }
await b.close();
