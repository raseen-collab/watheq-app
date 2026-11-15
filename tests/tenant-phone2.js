/* جوال إضافي للمستأجر v85 (15 نوفمبر 2026)
   تشغيل: npx esbuild lib/importParse.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/importParse.js
           node tests/tenant-phone2.js */
const P = require("/tmp/b/importParse.js");
let ok=0,bad=0;const t=(n,c)=>{if(c)ok++;else{bad++;console.log("✗",n)}};
t("normalizePhone spaces", P.normalizePhone("055 123 4567")==="0551234567");
t("normalizePhone +966", P.normalizePhone("+966 55 123 4567")==="0551234567");
t("normalizePhone arabic digits", P.normalizePhone("٠٥٥١٢٣٤٥٦٧")==="0551234567");
t("normalizePhone empty", P.normalizePhone("")==="" && P.normalizePhone(null)==="");
t("HEADERS/FIELDS aligned", P.HEADERS.length===P.FIELDS.length && P.FIELDS[P.FIELDS.length-1]==="phone2" && P.HEADERS[P.HEADERS.length-1]==="جوال إضافي");
t("lookup synonyms", P.HEADER_LOOKUP[Object.keys(P.HEADER_LOOKUP).find(k=>/جوال.?2|الجوال الثاني/.test(k))]==="phone2");
const grid=[["اسم المستأجر","رقم الوحدة","قيمة الدفعة","دورة السداد","بداية العقد","عدد الدفعات","الجوال","جوال إضافي","الدفعات المسدّدة"],["فهد","1","2500","شهري","2026-01-01","12","0551234567","+966 50 111 2222","3"],["سعد","2","3000","شهري","2026-01-01","12","0551234568","","1"]];
const r=P.parseGrid(grid,[{id:"p1",name:"x",property_type:"residential"}],{defaultPropertyId:"p1"});
const rows=r.rows||r;
t("phone2 parsed & normalized", rows[0].phone2==="0501112222" && rows[0].phone==="0551234567");
t("phone2 absent → undefined", rows[1].phone2===undefined);
const cells=P.tenantTemplateCells({name:"a",phone:"05",phone2:"06",rent_amount:1},"p");
t("template cells include phone2", cells.phone2==="06" && P.templateRow(cells).length===P.FIELDS.length);
console.log(`phone2: ${ok} ✅ ${bad?bad+" ❌":""}`);process.exit(bad?1:0);
