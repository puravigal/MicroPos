
import fs from "node:fs";

const required=[
 "src/App.jsx","src/api.js","src/styles.css","database/schema.sql",
 "server/src/server.js","server/src/migrate.js",
 "docs/MICRO_POS_DEVELOPMENT_MASTER.md","docs/BUILD_STATUS.md",
 "docs/IMPLEMENTATION_TRACKER.md","docs/LOCALIZATION_AND_COMPLIANCE.md","docs/RELEASE_GATES.md"
];
const missing=required.filter(p=>!fs.existsSync(p));
if(missing.length){console.error("Missing files:",missing.join(", "));process.exit(1);}

const app=fs.readFileSync("src/App.jsx","utf8");
const server=fs.readFileSync("server/src/server.js","utf8");
const schema=fs.readFileSync("database/schema.sql","utf8");
const requiredApp=["Billing","Products","Inventory","Purchases","People","Reports","Returns","Settings"];
const requiredApi=["/api/auth/signup","/api/auth/login","/api/auth/refresh","/api/auth/logout","/api/sales","/api/purchases","/api/returns","/api/inventory/adjust","/api/reports/summary","/api/offline/sync"];
const requiredTables=["organizations","stores","users","sessions","products","customers","suppliers","invoices","invoice_items","payments","stock_balances","stock_movements","suppliers_purchases","purchase_items","returns","return_items","refund_transactions","invoice_deliveries","plans","organization_subscriptions","usage_counters","notifications","import_jobs","offline_operations","audit_logs"];
const missApp=requiredApp.filter(x=>!app.includes("function "+x) && !app.includes("function "+x+"("));
const missApi=requiredApi.filter(x=>!server.includes(x));
const missTables=requiredTables.filter(x=>!schema.includes("create table if not exists "+x));
const spacedJsx=(app.match(/\/ >/g)||[]).length;
if(missApp.length||missApi.length||missTables.length||spacedJsx){
 console.error(JSON.stringify({missApp,missApi,missTables,spacedJsx},null,2));process.exit(1);
}
console.log("Puravigal POS product integrity check: PASS");
console.log("UI modules:",requiredApp.length,"API contracts:",requiredApi.length,"core tables:",requiredTables.length);
