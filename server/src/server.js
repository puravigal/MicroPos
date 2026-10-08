
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import pg from "pg";
import { z } from "zod";

const { Pool } = pg;
const app = express();
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DB_POOL_MAX || 10)
}) : null;

const JWT_SECRET = process.env.JWT_SECRET || "development-only-change-me";
if(process.env.NODE_ENV==="production" && JWT_SECRET==="development-only-change-me") throw new Error("JWT_SECRET must be configured in production");
if(process.env.NODE_ENV==="production" && !process.env.CORS_ORIGIN) throw new Error("CORS_ORIGIN must be configured in production");
const ACCESS_TTL = "15m";
const REFRESH_DAYS = 30;
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false });

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map(function(x){return x.trim();}) : true,
  credentials: true
}));
app.use(express.json({ limit: "2mb" }));
app.use("/api", apiLimiter);
app.use(function(req,res,next){ res.setHeader("X-API-Version","1"); next(); });

const ok = function(res,data,status){ return res.status(status || 200).json(data); };
const fail = function(res,status,code,message,details){ return res.status(status).json({ error:{code:code,message:message,details:details || undefined} }); };
const uuid = z.string().uuid();
const money = z.coerce.number().finite().nonnegative();
const positive = z.coerce.number().finite().positive();

function accessToken(user, orgId, role){
  return jwt.sign({ sub:user.id, email:user.email, orgId:orgId, role:role }, JWT_SECRET, { expiresIn:ACCESS_TTL, issuer:"puravigal-pos" });
}
function hashToken(value){ return crypto.createHash("sha256").update(value).digest("hex"); }
function newRefreshToken(){ return crypto.randomBytes(48).toString("base64url"); }
async function issueSession(client,user,orgId,role){
  const refresh = newRefreshToken();
  const expires = new Date(Date.now() + REFRESH_DAYS * 86400000);
  await client.query("insert into sessions(user_id,token_hash,expires_at) values($1,$2,$3)",[user.id,hashToken(refresh),expires]);
  return { access_token:accessToken(user,orgId,role), refresh_token:refresh, expires_at:expires.toISOString() };
}
function auth(req,res,next){
  const header = req.headers.authorization || "";
  if(!header.startsWith("Bearer ")) return fail(res,401,"AUTH_REQUIRED","Authentication required.");
  try { req.user = jwt.verify(header.slice(7),JWT_SECRET,{issuer:"puravigal-pos"}); next(); }
  catch(e){ return fail(res,401,"SESSION_EXPIRED","Session is invalid or expired."); }
}
function roles(){
  const allowed = Array.prototype.slice.call(arguments);
  return function(req,res,next){
    if(allowed.includes(req.user.role) || req.user.role === "owner" || req.user.role === "admin") return next();
    return fail(res,403,"FORBIDDEN","You do not have permission for this action.");
  };
}
async function audit(client,req,action,entityType,entityId,beforeData,afterData){
  await client.query(
    "insert into audit_logs(organization_id,user_id,action,entity_type,entity_id,before_data,after_data,ip_address,user_agent) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [req.user && req.user.orgId,req.user && req.user.sub,action,entityType,entityId || null,beforeData ? JSON.stringify(beforeData) : null,afterData ? JSON.stringify(afterData) : null,req.ip,req.get("user-agent") || null]
  );
}
async function storeFor(client,orgId,storeId){
  if(storeId){
    const r=await client.query("select id from stores where id=$1 and organization_id=$2 and is_active=true",[storeId,orgId]);
    if(!r.rowCount) throw Object.assign(new Error("Store not found"),{code:"STORE_NOT_FOUND"});
    return r.rows[0].id;
  }
  const r=await client.query("select id from stores where organization_id=$1 and is_active=true order by created_at limit 1",[orgId]);
  if(!r.rowCount) throw Object.assign(new Error("Store not found"),{code:"STORE_NOT_FOUND"});
  return r.rows[0].id;
}
async function runTx(fn){
  if(!pool) throw Object.assign(new Error("Database not configured"),{code:"DATABASE_NOT_CONFIGURED"});
  const client=await pool.connect();
  try { await client.query("begin"); const value=await fn(client); await client.query("commit"); return value; }
  catch(e){ try{await client.query("rollback");}catch(_){} throw e; }
  finally{client.release();}
}
function requireDb(res){
  if(!pool){ fail(res,503,"DATABASE_NOT_CONFIGURED","Database is not configured."); return false; }
  return true;
}

const signupSchema=z.object({
  email:z.string().email().max(320),
  password:z.string().min(8).max(128),
  display_name:z.string().trim().min(1).max(120),
  business_name:z.string().trim().min(1).max(200),
  country_code:z.string().regex(/^[A-Za-z]{2}$/).default("IN").transform(function(x){return x.toUpperCase();}),
  currency_code:z.string().regex(/^[A-Za-z]{3}$/).default("INR").transform(function(x){return x.toUpperCase();}),
  timezone:z.string().min(1).max(80).default("Asia/Kolkata"),
  locale:z.string().min(2).max(20).default("en-IN")
});
const productSchema=z.object({
  name:z.string().trim().min(1).max(200),
  sku:z.string().trim().max(80).optional().nullable(),
  barcode:z.string().trim().max(80).optional().nullable(),
  description:z.string().max(5000).optional().nullable(),
  selling_price:money,
  purchase_price:money.default(0),
  min_stock:z.coerce.number().finite().nonnegative().default(0),
  tax_profile_id:uuid.optional().nullable(),
  category_id:uuid.optional().nullable(),
  hsn_sac:z.string().max(32).optional().nullable(),
  currency_code:z.string().regex(/^[A-Za-z]{3}$/).default("INR").transform(function(x){return x.toUpperCase();})
});
const personSchema=z.object({
  name:z.string().trim().min(1).max(200),
  phone:z.string().trim().max(40).optional().nullable(),
  email:z.string().email().max(320).optional().nullable(),
  tax_id:z.string().trim().max(80).optional().nullable(),
  notes:z.string().max(2000).optional().nullable()
});
const saleSchema=z.object({
  store_id:uuid.optional(),
  customer_id:uuid.optional().nullable(),
  currency_code:z.string().regex(/^[A-Za-z]{3}$/).default("INR").transform(function(x){return x.toUpperCase();}),
  discount_total:z.coerce.number().finite().nonnegative().default(0),
  payment_method:z.enum(["cash","upi","card","bank","other"]).default("cash"),
  payment_amount:money.optional(),
  payment_reference:z.string().max(200).optional().nullable(),
  items:z.array(z.object({
    product_id:uuid,
    quantity:positive,
    unit_price:money.optional(),
    discount_amount:z.coerce.number().finite().nonnegative().default(0)
  })).min(1).max(500),
  idempotency_key:z.string().min(8).max(200).optional()
});
const purchaseSchema=z.object({
  store_id:uuid.optional(),
  supplier_id:uuid.optional().nullable(),
  currency_code:z.string().regex(/^[A-Za-z]{3}$/).default("INR").transform(function(x){return x.toUpperCase();}),
  payment_method:z.enum(["cash","upi","card","bank","other"]).default("cash"),
  payment_amount:money.optional(),
  items:z.array(z.object({product_id:uuid,quantity:positive,unit_cost:money,tax_rate:z.coerce.number().finite().nonnegative().default(0)})).min(1).max(500),
  idempotency_key:z.string().min(8).max(200).optional()
});
const returnSchema=z.object({
  store_id:uuid.optional(),
  invoice_id:uuid,
  reason:z.string().max(500).optional().nullable(),
  payment_method:z.enum(["cash","upi","card","bank","other"]).default("cash"),
  items:z.array(z.object({invoice_item_id:uuid,quantity:positive})).min(1).max(500),
  idempotency_key:z.string().min(8).max(200).optional()
});
const adjustmentSchema=z.object({
  store_id:uuid.optional(),
  product_id:uuid,
  quantity:z.coerce.number().finite(),
  reason:z.string().trim().min(1).max(500),
  idempotency_key:z.string().min(8).max(200).optional()
});

app.get("/api/health",async function(req,res){
  let database="not-configured";
  if(pool){ try{await pool.query("select 1");database="ok";}catch(e){database="error";} }
  return ok(res,{ok:true,service:"puravigal-pos-api",database:database,time:new Date().toISOString()});
});

app.post("/api/auth/signup",authLimiter,async function(req,res){
  if(!requireDb(res)) return;
  const p=signupSchema.safeParse(req.body);
  if(!p.success) return fail(res,400,"VALIDATION_ERROR","Please check the signup details.",p.error.issues);
  const d=p.data;
  try{
    const result=await runTx(async function(client){
      const exists=await client.query("select 1 from users where lower(email)=lower($1)",[d.email]);
      if(exists.rowCount) throw Object.assign(new Error("Email exists"),{code:"EMAIL_EXISTS"});
      const hash=await bcrypt.hash(d.password,12);
      const user=(await client.query("insert into users(email,password_hash,display_name,is_verified) values(lower($1),$2,$3,true) returning id,email,display_name",[d.email,hash,d.display_name])).rows[0];
      const org=(await client.query("insert into organizations(name,country_code,currency_code,timezone,locale) values($1,$2,$3,$4,$5) returning id,name,country_code,currency_code,timezone,locale",[d.business_name,d.country_code,d.currency_code,d.timezone,d.locale])).rows[0];
      await client.query("insert into organization_users(organization_id,user_id,role) values($1,$2,'owner')",[org.id,user.id]);
      await client.query("insert into stores(organization_id,name,code) values($1,$2,'MAIN')",[org.id,d.business_name]);
      await client.query("insert into business_settings(organization_id) values($1)",[org.id]);
      await client.query("insert into tax_profiles(organization_id,name,country_code,rate,components,is_zero_rated,is_exempt) values($1,$2,$3,$4,$5,false,false)",[org.id,d.country_code,d.country_code==="AE"?"UAE VAT 5%":"Standard Tax",d.country_code==="AE"?5:0,JSON.stringify(d.country_code==="AE"?[{code:"VAT",rate:5}]:[])]);
      const session=await issueSession(client,user,org.id,"owner");
      return {user:user,organization:org,session:session};
    });
    return ok(res,result,201);
  }catch(e){
    if(e.code==="EMAIL_EXISTS") return fail(res,409,"EMAIL_EXISTS","An account with this email already exists.");
    console.error(e); return fail(res,500,"SIGNUP_FAILED","Unable to create the account.");
  }
});

app.post("/api/auth/login",authLimiter,async function(req,res){
  if(!requireDb(res)) return;
  const p=z.object({email:z.string().email(),password:z.string().min(1)}).safeParse(req.body);
  if(!p.success) return fail(res,400,"VALIDATION_ERROR","Email and password are required.");
  try{
    const q=await pool.query("select u.id,u.email,u.display_name,u.password_hash,ou.organization_id,ou.role from users u join organization_users ou on ou.user_id=u.id where lower(u.email)=lower($1) and u.is_active=true order by ou.created_at limit 1",[p.data.email]);
    if(!q.rowCount || !q.rows[0].password_hash || !(await bcrypt.compare(p.data.password,q.rows[0].password_hash))) return fail(res,401,"INVALID_CREDENTIALS","Email or password is incorrect.");
    const x=q.rows[0], user={id:x.id,email:x.email,display_name:x.display_name};
    const session=await runTx(function(client){return issueSession(client,user,x.organization_id,x.role);});
    return ok(res,{user:user,organization_id:x.organization_id,role:x.role,session:session});
  }catch(e){console.error(e);return fail(res,500,"LOGIN_FAILED","Unable to sign in.");}
});

app.post("/api/auth/refresh",authLimiter,async function(req,res){
  if(!requireDb(res)) return;
  const p=z.object({refresh_token:z.string().min(20)}).safeParse(req.body);
  if(!p.success) return fail(res,400,"VALIDATION_ERROR","Refresh token is required.");
  try{
    const result=await runTx(async function(client){
      const old=await client.query("select s.id,s.user_id from sessions s where s.token_hash=$1 and s.revoked_at is null and s.expires_at>now() for update",[hashToken(p.data.refresh_token)]);
      if(!old.rowCount) throw Object.assign(new Error("Invalid refresh"),{code:"INVALID_REFRESH"});
      await client.query("update sessions set revoked_at=now() where id=$1",[old.rows[0].id]);
      const q=await client.query("select u.id,u.email,u.display_name,ou.organization_id,ou.role from users u join organization_users ou on ou.user_id=u.id where u.id=$1 and u.is_active=true order by ou.created_at limit 1",[old.rows[0].user_id]);
      if(!q.rowCount) throw Object.assign(new Error("User missing"),{code:"INVALID_REFRESH"});
      const x=q.rows[0], user={id:x.id,email:x.email,display_name:x.display_name};
      return issueSession(client,user,x.organization_id,x.role);
    });
    return ok(res,{session:result});
  }catch(e){return fail(res,401,"INVALID_REFRESH","Refresh session is invalid or expired.");}
});

app.post("/api/auth/logout",auth,async function(req,res){
  if(!requireDb(res)) return;
  const p=z.object({refresh_token:z.string().min(20).optional()}).safeParse(req.body || {});
  if(p.success && p.data.refresh_token) await pool.query("update sessions set revoked_at=now() where token_hash=$1 and user_id=$2",[hashToken(p.data.refresh_token),req.user.sub]);
  return ok(res,{ok:true});
});

app.get("/api/me",auth,async function(req,res){
  if(!requireDb(res)) return;
  const q=await pool.query("select u.id,u.email,u.display_name,ou.organization_id,ou.role,o.name organization_name,o.country_code,o.currency_code,o.timezone,o.locale from users u join organization_users ou on ou.user_id=u.id join organizations o on o.id=ou.organization_id where u.id=$1 and o.id=$2",[req.user.sub,req.user.orgId]);
  if(!q.rowCount) return fail(res,404,"NOT_FOUND","Account not found.");
  return ok(res,q.rows[0]);
});

app.get("/api/stores",auth,async function(req,res){
  if(!requireDb(res)) return;
  const q=await pool.query("select id,name,code,address,is_active from stores where organization_id=$1 order by created_at",[req.user.orgId]);
  return ok(res,{items:q.rows});
});

app.get("/api/categories",auth,async function(req,res){
  if(!requireDb(res)) return;
  const q=await pool.query("select id,name,is_active from categories where organization_id=$1 order by name",[req.user.orgId]);
  return ok(res,{items:q.rows});
});

app.post("/api/categories",auth,roles("manager","inventory"),async function(req,res){
  if(!requireDb(res)) return;
  const p=z.object({name:z.string().trim().min(1).max(100)}).safeParse(req.body);
  if(!p.success) return fail(res,400,"VALIDATION_ERROR","Category name is required.",p.error.issues);
  try{const q=await pool.query("insert into categories(organization_id,name) values($1,$2) returning *",[req.user.orgId,p.data.name]);return ok(res,q.rows[0],201);}
  catch(e){if(e.code==="23505")return fail(res,409,"DUPLICATE","Category already exists.");return fail(res,500,"CREATE_FAILED","Unable to create category.");}
});

async function createEntity(req,res,table,fields,schema,allowedRoles){
  if(!requireDb(res)) return;
  const p=schema.safeParse(req.body);
  if(!p.success) return fail(res,400,"VALIDATION_ERROR","Invalid data.",p.error.issues);
  if(allowedRoles && allowedRoles.length && !allowedRoles.includes(req.user.role) && !["owner","admin"].includes(req.user.role)) return fail(res,403,"FORBIDDEN","You do not have permission for this action.");
  const d=p.data, cols=Object.keys(d).filter(function(k){return fields.includes(k) && d[k] !== undefined;});
  const vals=cols.map(function(k){return d[k]});
  try{
    const q=await pool.query("insert into "+table+"(organization_id,"+cols.join(",")+") values($1,"+cols.map(function(_,i){return "$"+(i+2)}).join(",")+") returning *",[req.user.orgId].concat(vals));
    return ok(res,q.rows[0],201);
  }catch(e){if(e.code==="23505")return fail(res,409,"DUPLICATE","A record with the same unique value already exists.");return fail(res,500,"CREATE_FAILED","Unable to create record.");}
}
app.post("/api/products",auth,function(req,res){return createEntity(req,res,"products",["name","sku","barcode","description","selling_price","purchase_price","min_stock","tax_profile_id","category_id","hsn_sac","currency_code"],productSchema,["manager","inventory"]);});
app.post("/api/customers",auth,function(req,res){return createEntity(req,res,"customers",["name","phone","email","tax_id","notes"],personSchema,null);});
app.post("/api/suppliers",auth,function(req,res){return createEntity(req,res,"suppliers",["name","phone","email","tax_id","notes"],personSchema,["manager","inventory"]);});

app.get("/api/products",auth,async function(req,res){
  if(!requireDb(res)) return;
  const q=String(req.query.q || "");
  const r=await pool.query("select p.*,coalesce(sb.quantity,0) stock,coalesce(c.name,'General') category_name,coalesce(tp.rate,0) tax_rate from products p left join categories c on c.id=p.category_id left join tax_profiles tp on tp.id=p.tax_profile_id left join (select product_id,sum(quantity) quantity from stock_balances where organization_id=$1 group by product_id) sb on sb.product_id=p.id where p.organization_id=$1 and p.is_active=true and ($2='' or p.name ilike '%'||$2||'%' or coalesce(p.sku,'') ilike '%'||$2||'%' or coalesce(p.barcode,'') ilike '%'||$2||'%') order by p.name limit 500",[req.user.orgId,q]);
  return ok(res,{items:r.rows});
});
app.get("/api/customers",auth,async function(req,res){
  if(!requireDb(res)) return;
  const q=String(req.query.q || "");
  const r=await pool.query("select * from customers where organization_id=$1 and ($2='' or name ilike '%'||$2||'%' or coalesce(phone,'') ilike '%'||$2||'%') order by name limit 500",[req.user.orgId,q]);
  return ok(res,{items:r.rows});
});
app.get("/api/suppliers",auth,async function(req,res){
  if(!requireDb(res)) return;
  const q=String(req.query.q || "");
  const r=await pool.query("select * from suppliers where organization_id=$1 and ($2='' or name ilike '%'||$2||'%' or coalesce(phone,'') ilike '%'||$2||'%') order by name limit 500",[req.user.orgId,q]);
  return ok(res,{items:r.rows});
});

app.patch("/api/products/:id",auth,roles("manager","inventory"),async function(req,res){
  if(!requireDb(res)) return;
  const p=productSchema.partial().safeParse(req.body);
  if(!p.success) return fail(res,400,"VALIDATION_ERROR","Invalid product data.",p.error.issues);
  try{
    const before=(await pool.query("select * from products where id=$1 and organization_id=$2",[req.params.id,req.user.orgId])).rows[0];
    if(!before) return fail(res,404,"NOT_FOUND","Product not found.");
    const d=p.data, keys=Object.keys(d).filter(function(k){return d[k]!==undefined;});
    if(!keys.length) return ok(res,before);
    const sets=keys.map(function(k,i){return k+"=$"+(i+2)}).join(",");
    const q=await pool.query("update products set "+sets+",updated_at=now() where id=$1 and organization_id=$"+(keys.length+2)+" returning *",[req.params.id].concat(keys.map(function(k){return d[k]}),[req.user.orgId]));
    await audit(pool,req,"update","product",req.params.id,before,q.rows[0]);
    return ok(res,q.rows[0]);
  }catch(e){if(e.code==="23505")return fail(res,409,"DUPLICATE","SKU or barcode already exists.");return fail(res,500,"UPDATE_FAILED","Unable to update product.");}
});

app.delete("/api/products/:id",auth,roles("manager","inventory"),async function(req,res){
  if(!requireDb(res)) return;
  try{
    const q=await pool.query("update products set is_active=false,updated_at=now() where id=$1 and organization_id=$2 returning id",[req.params.id,req.user.orgId]);
    if(!q.rowCount)return fail(res,404,"NOT_FOUND","Product not found.");
    await audit(pool,req,"archive","product",req.params.id,null,{is_active:false});
    return ok(res,{ok:true});
  }catch(e){return fail(res,500,"DELETE_FAILED","Unable to archive product.");}
});

async function nextNumber(client,orgId,storeId,prefix,kind){
  const settings=(await client.query("select invoice_prefix,invoice_next from business_settings where organization_id=$1 for update",[orgId])).rows[0];
  const pfx=prefix || (settings && settings.invoice_prefix) || (kind==="purchase"?"PUR":"INV");
  const next=settings ? Number(settings.invoice_next) : 1;
  if(settings) await client.query("update business_settings set invoice_next=invoice_next+1,updated_at=now() where organization_id=$1",[orgId]);
  const code=String(next).padStart(6,"0");
  return pfx+"-"+code;
}

app.post("/api/sales",auth,roles("cashier","manager"),async function(req,res){
  if(!requireDb(res)) return;
  const p=saleSchema.safeParse(req.body);
  if(!p.success)return fail(res,400,"VALIDATION_ERROR","Invalid sale.",p.error.issues);
  const d=p.data;
  try{
    const result=await runTx(async function(client){
      if(d.idempotency_key){
        const existing=await client.query("select * from invoices where organization_id=$1 and idempotency_key=$2",[req.user.orgId,d.idempotency_key]);
        if(existing.rowCount)return {invoice:existing.rows[0],idempotent:true};
      }
      const storeId=await storeFor(client,req.user.orgId,d.store_id);
      const org=(await client.query("select * from organizations where id=$1",[req.user.orgId])).rows[0];
      let customer=null;
      if(d.customer_id){
        const c=await client.query("select * from customers where id=$1 and organization_id=$2",[d.customer_id,req.user.orgId]);
        if(!c.rowCount)throw Object.assign(new Error("Customer not found"),{code:"CUSTOMER_NOT_FOUND"});
        customer=c.rows[0];
      }
      let subtotal=0,discount=d.discount_total,taxTotal=0;
      const lines=[];
      for(const item of d.items){
        const pr=await client.query("select p.*,coalesce(tp.rate,0) tax_rate,coalesce(tp.components,'[]'::jsonb) tax_components from products p left join tax_profiles tp on tp.id=p.tax_profile_id where p.id=$1 and p.organization_id=$2 and p.is_active=true",[item.product_id,req.user.orgId]);
        if(!pr.rowCount)throw Object.assign(new Error("Product not found"),{code:"PRODUCT_NOT_FOUND"});
        const product=pr.rows[0];
        const sb=await client.query("select quantity from stock_balances where organization_id=$1 and store_id=$2 and product_id=$3 for update",[req.user.orgId,storeId,product.id]);
        const stock=sb.rowCount?Number(sb.rows[0].quantity):0;
        if(product.stock_tracking && stock < Number(item.quantity)){
          const settings=(await client.query("select negative_stock_allowed from business_settings where organization_id=$1",[req.user.orgId])).rows[0];
          if(!settings || !settings.negative_stock_allowed)throw Object.assign(new Error("Insufficient stock"),{code:"INSUFFICIENT_STOCK",product:product.name,available:stock,requested:Number(item.quantity)});
        }
        const unitPrice=item.unit_price === undefined ? Number(product.selling_price) : Number(item.unit_price);
        const lineGross=unitPrice*Number(item.quantity);
        const lineDiscount=Math.min(Number(item.discount_amount),lineGross);
        const taxable=Math.max(0,lineGross-lineDiscount);
        const lineTax=taxable*Number(product.tax_rate)/100;
        const lineTotal=taxable+lineTax;
        subtotal+=lineGross; taxTotal+=lineTax; discount+=lineDiscount;
        lines.push({product:product,quantity:Number(item.quantity),unitPrice:unitPrice,discount:lineDiscount,taxable:taxable,taxRate:Number(product.tax_rate),tax:lineTax,total:lineTotal,stock:stock});
      }
      const grand=Math.max(0,subtotal-discount+taxTotal);
      const paid=Math.min(Number(d.payment_amount === undefined ? grand : d.payment_amount),grand);
      const status=paid>=grand ? "paid" : paid>0 ? "partially_paid" : "issued";
      const invoiceNumber=await nextNumber(client,req.user.orgId,storeId,null,"invoice");
      const invoice=(await client.query(
        "insert into invoices(organization_id,store_id,customer_id,invoice_number,status,invoice_type,currency_code,subtotal,discount_total,taxable_total,tax_total,grand_total,paid_total,tax_snapshot,buyer_snapshot,seller_snapshot,created_by,idempotency_key) values($1,$2,$3,$4,$5,'tax_invoice',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *",
        [req.user.orgId,storeId,customer ? customer.id:null,invoiceNumber,status,d.currency_code,subtotal,discount,Math.max(0,subtotal-discount),taxTotal,grand,paid,JSON.stringify({country:org.country_code}),JSON.stringify(customer || {}),JSON.stringify({name:org.name,country_code:org.country_code,currency_code:org.currency_code}),req.user.sub,d.idempotency_key || null]
      )).rows[0];
      for(const line of lines){
        const ii=(await client.query("insert into invoice_items(invoice_id,product_id,description,quantity,unit_price,discount_amount,taxable_amount,tax_rate,tax_amount,line_total) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id",[invoice.id,line.product.id,line.product.name,line.quantity,line.unitPrice,line.discount,line.taxable,line.taxRate,line.tax,line.total])).rows[0];
        if(line.product.stock_tracking){
          if(sbSafe(line.stock - line.quantity)){}
          await client.query("insert into stock_balances(organization_id,store_id,product_id,quantity) values($1,$2,$3,$4) on conflict(organization_id,store_id,product_id) do update set quantity=stock_balances.quantity+excluded.quantity,updated_at=now()",[req.user.orgId,storeId,line.product.id,-line.quantity]);
          await client.query("insert into stock_movements(organization_id,store_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by,idempotency_key) values($1,$2,$3,'sale',$4,$5,'invoice',$6,$7,$8)",[req.user.orgId,storeId,line.product.id,-line.quantity,line.product.purchase_price,invoice.id,req.user.sub,d.idempotency_key ? d.idempotency_key+"-"+line.product.id : null]);
        }
      }
      if(paid>0) await client.query("insert into payments(organization_id,invoice_id,method,amount,currency_code,status,reference,created_by) values($1,$2,$3,$4,$5,'paid',$6,$7)",[req.user.orgId,invoice.id,d.payment_method,paid,d.currency_code,d.payment_reference || null,req.user.sub]);
      await audit(client,req,"create","invoice",invoice.id,null,invoice);
      return {invoice:invoice,idempotent:false};
    });
    return ok(res,result,201);
  }catch(e){
    if(e.code==="INSUFFICIENT_STOCK")return fail(res,409,"INSUFFICIENT_STOCK","Not enough stock for "+e.product+".",{available:e.available,requested:e.requested});
    if(e.code==="CUSTOMER_NOT_FOUND"||e.code==="PRODUCT_NOT_FOUND")return fail(res,404,e.code,e.message);
    if(e.code==="STORE_NOT_FOUND")return fail(res,404,e.code,"Store not found.");
    console.error(e);return fail(res,500,"SALE_FAILED","Unable to complete the sale.");
  }
});
function sbSafe(){ return true; }

app.get("/api/invoices",auth,async function(req,res){
  if(!requireDb(res))return;
  const r=await pool.query("select i.*,coalesce(c.name,'Walk-in customer') customer_name from invoices i left join customers c on c.id=i.customer_id where i.organization_id=$1 order by i.created_at desc limit 200",[req.user.orgId]);
  return ok(res,{items:r.rows});
});

app.get("/api/invoices/:id",auth,async function(req,res){
  if(!requireDb(res))return;
  const h=await pool.query("select i.*,c.name customer_name,c.phone customer_phone from invoices i left join customers c on c.id=i.customer_id where i.id=$1 and i.organization_id=$2",[req.params.id,req.user.orgId]);
  if(!h.rowCount)return fail(res,404,"NOT_FOUND","Invoice not found.");
  const items=await pool.query("select * from invoice_items where invoice_id=$1 order by id",[req.params.id]);
  const payments=await pool.query("select * from payments where invoice_id=$1 order by created_at",[req.params.id]);
  return ok(res,{invoice:h.rows[0],items:items.rows,payments:payments.rows});
});

app.post("/api/purchases",auth,roles("manager","inventory"),async function(req,res){
  if(!requireDb(res))return;
  const p=purchaseSchema.safeParse(req.body);if(!p.success)return fail(res,400,"VALIDATION_ERROR","Invalid purchase.",p.error.issues);
  const d=p.data;
  try{
    const result=await runTx(async function(client){
      if(d.idempotency_key){const old=await client.query("select * from suppliers_purchases where organization_id=$1 and idempotency_key=$2",[req.user.orgId,d.idempotency_key]);if(old.rowCount)return {purchase:old.rows[0],idempotent:true};}
      const storeId=await storeFor(client,req.user.orgId,d.store_id);
      let subtotal=0,taxTotal=0;const lines=[];
      for(const item of d.items){
        const pr=await client.query("select * from products where id=$1 and organization_id=$2 and is_active=true",[item.product_id,req.user.orgId]);
        if(!pr.rowCount)throw Object.assign(new Error("Product not found"),{code:"PRODUCT_NOT_FOUND"});
        const lineBase=Number(item.quantity)*Number(item.unit_cost), tax=lineBase*Number(item.tax_rate)/100;
        subtotal+=lineBase;taxTotal+=tax;lines.push({product:pr.rows[0],quantity:Number(item.quantity),unitCost:Number(item.unit_cost),tax:tax,total:lineBase+tax});
      }
      const total=subtotal+taxTotal, paid=Math.min(Number(d.payment_amount || 0),total), number=await nextNumber(client,req.user.orgId,storeId,"PUR","purchase");
      const purchase=(await client.query("insert into suppliers_purchases(organization_id,store_id,supplier_id,purchase_number,status,currency_code,subtotal,tax_total,total,paid_total,created_by,idempotency_key) values($1,$2,$3,$4,'received',$5,$6,$7,$8,$9,$10,$11) returning *",[req.user.orgId,storeId,d.supplier_id || null,number,d.currency_code,subtotal,taxTotal,total,paid,req.user.sub,d.idempotency_key || null])).rows[0];
      for(const line of lines){
        await client.query("insert into purchase_items(purchase_id,product_id,quantity,unit_cost,tax_amount,line_total) values($1,$2,$3,$4,$5,$6)",[purchase.id,line.product.id,line.quantity,line.unitCost,line.tax,line.total]);
        await client.query("insert into stock_balances(organization_id,store_id,product_id,quantity) values($1,$2,$3,$4) on conflict(organization_id,store_id,product_id) do update set quantity=stock_balances.quantity+excluded.quantity,updated_at=now()",[req.user.orgId,storeId,line.product.id,line.quantity]);
        await client.query("insert into stock_movements(organization_id,store_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by) values($1,$2,$3,'purchase',$4,$5,'purchase',$6,$7)",[req.user.orgId,storeId,line.product.id,line.quantity,line.unitCost,purchase.id,req.user.sub]);
        await client.query("update products set purchase_price=$1,updated_at=now() where id=$2 and organization_id=$3",[line.unitCost,line.product.id,req.user.orgId]);
      }
      await audit(client,req,"create","purchase",purchase.id,null,purchase);
      return {purchase:purchase,idempotent:false};
    });
    return ok(res,result,201);
  }catch(e){if(e.code==="PRODUCT_NOT_FOUND")return fail(res,404,e.code,e.message);console.error(e);return fail(res,500,"PURCHASE_FAILED","Unable to receive purchase.");}
});

app.get("/api/purchases",auth,async function(req,res){
  if(!requireDb(res))return;
  const r=await pool.query("select p.*,coalesce(s.name,'Unknown supplier') supplier_name from suppliers_purchases p left join suppliers s on s.id=p.supplier_id where p.organization_id=$1 order by p.created_at desc limit 200",[req.user.orgId]);
  return ok(res,{items:r.rows});
});

app.post("/api/returns",auth,roles("manager"),async function(req,res){
  if(!requireDb(res))return;
  const p=returnSchema.safeParse(req.body);if(!p.success)return fail(res,400,"VALIDATION_ERROR","Invalid return.",p.error.issues);
  const d=p.data;
  try{
    const result=await runTx(async function(client){
      if(d.idempotency_key){const old=await client.query("select * from returns where organization_id=$1 and idempotency_key=$2",[req.user.orgId,d.idempotency_key]);if(old.rowCount)return {return:old.rows[0],idempotent:true};}
      const invoice=(await client.query("select * from invoices where id=$1 and organization_id=$2 for update",[d.invoice_id,req.user.orgId])).rows[0];
      if(!invoice)throw Object.assign(new Error("Invoice not found"),{code:"INVOICE_NOT_FOUND"});
      const storeId=await storeFor(client,req.user.orgId,d.store_id || invoice.store_id);
      let total=0;const lines=[];
      for(const item of d.items){
        const row=(await client.query("select ii.*,coalesce((select sum(ri.quantity) from return_items ri join returns r on r.id=ri.return_id where ri.invoice_item_id=ii.id and r.status='completed'),0) returned from invoice_items ii where ii.id=$1 and ii.invoice_id=$2",[item.invoice_item_id,d.invoice_id])).rows[0];
        if(!row)throw Object.assign(new Error("Invoice item not found"),{code:"ITEM_NOT_FOUND"});
        const remaining=Number(row.quantity)-Number(row.returned);
        if(Number(item.quantity)>remaining)throw Object.assign(new Error("Return quantity exceeds sold quantity"),{code:"RETURN_QTY_EXCEEDED",remaining:remaining});
        const amount=(Number(row.line_total)/Number(row.quantity))*Number(item.quantity);
        total+=amount;lines.push({row,quantity:Number(item.quantity),amount:amount});
      }
      const number=await nextNumber(client,req.user.orgId,storeId,"RET","return");
      const ret=(await client.query("insert into returns(organization_id,store_id,invoice_id,customer_id,return_number,status,reason,total,created_by,idempotency_key) values($1,$2,$3,$4,$5,'completed',$6,$7,$8,$9) returning *",[req.user.orgId,storeId,invoice.id,invoice.customer_id,number,d.reason || null,total,req.user.sub,d.idempotency_key || null])).rows[0];
      for(const line of lines){
        await client.query("insert into return_items(return_id,invoice_item_id,product_id,quantity,refund_amount) values($1,$2,$3,$4,$5)",[ret.id,line.row.id,line.row.product_id,line.quantity,line.amount]);
        if(line.row.product_id){
          await client.query("insert into stock_balances(organization_id,store_id,product_id,quantity) values($1,$2,$3,$4) on conflict(organization_id,store_id,product_id) do update set quantity=stock_balances.quantity+excluded.quantity,updated_at=now()",[req.user.orgId,storeId,line.row.product_id,line.quantity]);
          await client.query("insert into stock_movements(organization_id,store_id,product_id,movement_type,quantity,reference_type,reference_id,created_by) values($1,$2,$3,'sale_return',$4,'return',$5,$6)",[req.user.orgId,storeId,line.row.product_id,line.quantity,ret.id,req.user.sub]);
        }
      }
      await client.query("insert into refund_transactions(organization_id,return_id,method,amount,status) values($1,$2,$3,$4,'completed')",[req.user.orgId,ret.id,d.payment_method,total]);
      const returnedTotal=(await client.query("select coalesce(sum(total),0) total from returns where invoice_id=$1 and status='completed'",[invoice.id])).rows[0].total;
      const newStatus=Number(returnedTotal)>=Number(invoice.grand_total) ? "refunded" : invoice.status;
      await client.query("update invoices set status=$1,updated_at=now() where id=$2",[newStatus,invoice.id]);
      await audit(client,req,"create","return",ret.id,null,ret);
      return {return:ret,idempotent:false};
    });
    return ok(res,result,201);
  }catch(e){
    if(e.code==="INVOICE_NOT_FOUND"||e.code==="ITEM_NOT_FOUND")return fail(res,404,e.code,e.message);
    if(e.code==="RETURN_QTY_EXCEEDED")return fail(res,409,e.code,"Return quantity exceeds the remaining quantity.",{remaining:e.remaining});
    console.error(e);return fail(res,500,"RETURN_FAILED","Unable to process return.");
  }
});

app.post("/api/inventory/adjust",auth,roles("manager","inventory"),async function(req,res){
  if(!requireDb(res))return;
  const p=adjustmentSchema.safeParse(req.body);if(!p.success)return fail(res,400,"VALIDATION_ERROR","Invalid stock adjustment.",p.error.issues);
  const d=p.data;
  try{
    const result=await runTx(async function(client){
      if(d.idempotency_key){const old=await client.query("select id from stock_movements where organization_id=$1 and idempotency_key=$2",[req.user.orgId,d.idempotency_key]);if(old.rowCount)return {id:old.rows[0].id,idempotent:true};}
      const storeId=await storeFor(client,req.user.orgId,d.store_id);
      const product=await client.query("select id,name,purchase_price from products where id=$1 and organization_id=$2 and is_active=true",[d.product_id,req.user.orgId]);
      if(!product.rowCount)throw Object.assign(new Error("Product not found"),{code:"PRODUCT_NOT_FOUND"});
      const current=await client.query("select quantity from stock_balances where organization_id=$1 and store_id=$2 and product_id=$3 for update",[req.user.orgId,storeId,d.product_id]);
      const oldQty=current.rowCount?Number(current.rows[0].quantity):0,newQty=oldQty+Number(d.quantity);
      if(newQty<0)throw Object.assign(new Error("Stock cannot become negative"),{code:"NEGATIVE_STOCK",available:oldQty});
      await client.query("insert into stock_balances(organization_id,store_id,product_id,quantity) values($1,$2,$3,$4) on conflict(organization_id,store_id,product_id) do update set quantity=excluded.quantity,updated_at=now()",[req.user.orgId,storeId,d.product_id,newQty]);
      const movement=(await client.query("insert into stock_movements(organization_id,store_id,product_id,movement_type,quantity,unit_cost,reason,created_by,idempotency_key) values($1,$2,$3,'adjustment',$4,$5,$6,$7,$8) returning *",[req.user.orgId,storeId,d.product_id,d.quantity,product.rows[0].purchase_price,d.reason,req.user.sub,d.idempotency_key || null])).rows[0];
      await audit(client,req,"adjust","stock",d.product_id,{quantity:oldQty},{quantity:newQty,reason:d.reason});
      return {movement:movement,quantity:newQty,idempotent:false};
    });
    return ok(res,result,201);
  }catch(e){if(e.code==="NEGATIVE_STOCK")return fail(res,409,e.code,"Stock cannot become negative.",{available:e.available});if(e.code==="PRODUCT_NOT_FOUND")return fail(res,404,e.code,e.message);console.error(e);return fail(res,500,"ADJUSTMENT_FAILED","Unable to adjust stock.");}
});

app.get("/api/inventory/movements",auth,async function(req,res){
  if(!requireDb(res))return;
  const r=await pool.query("select sm.*,p.name product_name from stock_movements sm join products p on p.id=sm.product_id where sm.organization_id=$1 order by sm.created_at desc limit 500",[req.user.orgId]);
  return ok(res,{items:r.rows});
});

app.get("/api/reports/summary",auth,async function(req,res){
  if(!requireDb(res))return;
  const range=String(req.query.range || "month");
  const days=range==="today"?1:range==="week"?7:range==="year"?365:30;
  const sales=await pool.query("select coalesce(sum(grand_total),0) sales,count(*) bills,coalesce(avg(grand_total),0) avg_bill from invoices where organization_id=$1 and status not in('cancelled') and created_at>=now()-($2||' days')::interval",[req.user.orgId,String(days)]);
  const payments=await pool.query("select method,coalesce(sum(amount),0) total from payments where organization_id=$1 and created_at>=now()-($2||' days')::interval group by method order by total desc",[req.user.orgId,String(days)]);
  const top=await pool.query("select ii.product_id,ii.description product_name,sum(ii.quantity) quantity,sum(ii.line_total) total from invoice_items ii join invoices i on i.id=ii.invoice_id where i.organization_id=$1 and i.status<>'cancelled' and i.created_at>=now()-($2||' days')::interval group by ii.product_id,ii.description order by total desc limit 10",[req.user.orgId,String(days)]);
  const low=await pool.query("select p.id,p.name,p.min_stock,coalesce(sum(sb.quantity),0) stock from products p left join stock_balances sb on sb.product_id=p.id and sb.organization_id=p.organization_id where p.organization_id=$1 and p.is_active=true group by p.id order by stock asc limit 20",[req.user.orgId]);
  return ok(res,{range:range,sales:sales.rows[0],payments:payments.rows,top_products:top.rows,stock:low.rows});
});

app.get("/api/dashboard",auth,async function(req,res){
  if(!requireDb(res))return;
  const [sales,bills,low,outstanding]=await Promise.all([
    pool.query("select coalesce(sum(grand_total),0) total from invoices where organization_id=$1 and status<>'cancelled' and created_at::date=current_date",[req.user.orgId]),
    pool.query("select count(*) count from invoices where organization_id=$1 and created_at::date=current_date",[req.user.orgId]),
    pool.query("select count(*) count from products p where p.organization_id=$1 and p.is_active=true and p.min_stock>0 and (select coalesce(sum(sb.quantity),0) from stock_balances sb where sb.product_id=p.id and sb.organization_id=p.organization_id)<p.min_stock",[req.user.orgId]),
    pool.query("select coalesce(sum(greatest(i.grand_total-i.paid_total,0)),0) total from invoices i where i.organization_id=$1 and i.status in('issued','partially_paid')",[req.user.orgId])
  ]);
  return ok(res,{sales:sales.rows[0].total,bills:bills.rows[0].count,lowStock:low.rows[0].count,outstanding:outstanding.rows[0].total});
});

app.get("/api/settings",auth,async function(req,res){
  if(!requireDb(res))return;
  const [o,b]=await Promise.all([
    pool.query("select id,name,legal_name,country_code,currency_code,timezone,locale,tax_registration_number,tax_registration_type,address from organizations where id=$1",[req.user.orgId]),
    pool.query("select * from business_settings where organization_id=$1",[req.user.orgId])
  ]);
  return ok(res,{organization:o.rows[0],business:b.rows[0]});
});
app.patch("/api/settings",auth,roles("owner","admin"),async function(req,res){
  if(!requireDb(res))return;
  const p=z.object({
    name:z.string().trim().min(1).max(200).optional(),
    legal_name:z.string().max(200).optional().nullable(),
    country_code:z.string().regex(/^[A-Za-z]{2}$/).optional(),
    currency_code:z.string().regex(/^[A-Za-z]{3}$/).optional(),
    timezone:z.string().max(80).optional(),
    locale:z.string().max(20).optional(),
    tax_registration_number:z.string().max(100).optional().nullable(),
    tax_registration_type:z.string().max(50).optional().nullable(),
    invoice_prefix:z.string().regex(/^[A-Za-z0-9_-]{1,12}$/).optional(),
    tax_mode:z.enum(["inclusive","exclusive"]).optional(),
    negative_stock_allowed:z.boolean().optional(),
    default_payment_method:z.enum(["cash","upi","card","bank","other"]).optional(),
    receipt_width:z.enum(["58mm","80mm","A4"]).optional()
  }).safeParse(req.body);
  if(!p.success)return fail(res,400,"VALIDATION_ERROR","Invalid settings.",p.error.issues);
  try{
    const result=await runTx(async function(client){
      const before=(await client.query("select * from organizations where id=$1",[req.user.orgId])).rows[0];
      const d=p.data, orgKeys=["name","legal_name","country_code","currency_code","timezone","locale","tax_registration_number","tax_registration_type"];
      const keys=Object.keys(d).filter(function(k){return orgKeys.includes(k) && d[k]!==undefined;});
      if(keys.length)await client.query("update organizations set "+keys.map(function(k,i){return k+"=$"+(i+2)}).join(",")+",updated_at=now() where id=$1",[req.user.orgId].concat(keys.map(function(k){return d[k]})));
      const bsKeys=["invoice_prefix","tax_mode","negative_stock_allowed","default_payment_method","receipt_width"];
      const bk=Object.keys(d).filter(function(k){return bsKeys.includes(k)&&d[k]!==undefined;});
      if(bk.length)await client.query("update business_settings set "+bk.map(function(k,i){return k+"=$"+(i+2)}).join(",")+",updated_at=now() where organization_id=$1",[req.user.orgId].concat(bk.map(function(k){return d[k]})));
      await audit(client,req,"update","settings",req.user.orgId,before,d);
      return {ok:true};
    });
    return ok(res,result);
  }catch(e){console.error(e);return fail(res,500,"SETTINGS_FAILED","Unable to update settings.");}
});


app.get("/api/users",auth,roles("owner","admin"),async function(req,res){
  if(!requireDb(res))return;
  const r=await pool.query("select u.id,u.email,u.display_name,u.phone,u.is_verified,u.is_active,ou.role,ou.created_at from users u join organization_users ou on ou.user_id=u.id where ou.organization_id=$1 order by ou.created_at",[req.user.orgId]);
  return ok(res,{items:r.rows});
});
app.patch("/api/users/:id/role",auth,roles("owner","admin"),async function(req,res){
  if(!requireDb(res))return;
  const p=z.object({role:z.enum(["owner","admin","manager","cashier","inventory"])}).safeParse(req.body);
  if(!p.success)return fail(res,400,"VALIDATION_ERROR","Invalid role.");
  if(req.params.id===req.user.sub && p.data.role!=="owner")return fail(res,400,"SELF_DEMOTION_BLOCKED","You cannot remove your own owner access.");
  try{
    const q=await pool.query("update organization_users set role=$1 where organization_id=$2 and user_id=$3 returning *",[p.data.role,req.user.orgId,req.params.id]);
    if(!q.rowCount)return fail(res,404,"NOT_FOUND","User is not part of this organization.");
    await audit(pool,req,"update","user_role",req.params.id,null,{role:p.data.role});
    return ok(res,q.rows[0]);
  }catch(e){return fail(res,500,"ROLE_UPDATE_FAILED","Unable to update role.");}
});

app.post("/api/imports/preview",auth,roles("owner","admin","manager","inventory"),async function(req,res){
  if(!requireDb(res))return;
  const p=z.object({entity_type:z.enum(["products","customers","suppliers"]),source_filename:z.string().max(255).optional(),rows:z.array(z.record(z.string(),z.any())).max(5000)}).safeParse(req.body);
  if(!p.success)return fail(res,400,"VALIDATION_ERROR","Invalid import payload.",p.error.issues);
  const d=p.data,errors=[],valid=[];
  d.rows.forEach(function(row,index){const name=String(row.name||row.Name||"").trim();if(!name)errors.push({row:index+1,field:"name",message:"Name is required."});else valid.push({row:index+1,data:row});});
  return ok(res,{entity_type:d.entity_type,total_rows:d.rows.length,valid_rows:valid.length,invalid_rows:errors.length,errors:errors.slice(0,200),preview:valid.slice(0,20)});
});
app.post("/api/imports/commit",auth,roles("owner","admin","manager","inventory"),async function(req,res){
  if(!requireDb(res))return;
  const p=z.object({entity_type:z.enum(["products","customers","suppliers"]),source_filename:z.string().max(255).optional(),rows:z.array(z.record(z.string(),z.any())).max(5000)}).safeParse(req.body);
  if(!p.success)return fail(res,400,"VALIDATION_ERROR","Invalid import payload.",p.error.issues);
  const d=p.data;
  try{
    const result=await runTx(async function(client){
      const job=(await client.query("insert into import_jobs(organization_id,entity_type,status,source_filename,total_rows,created_by) values($1,$2,'processing',$3,$4,$5) returning *",[req.user.orgId,d.entity_type,d.source_filename||null,d.rows.length,req.user.sub])).rows[0];
      let valid=0;const errors=[];
      for(let i=0;i<d.rows.length;i++){
        const row=d.rows[i],name=String(row.name||row.Name||"").trim();
        if(!name){errors.push({row:i+1,message:"Name is required."});continue;}
        try{
          if(d.entity_type==="products"){
            const price=Number(row.selling_price??row.price??row.SellingPrice??0),purchase=Number(row.purchase_price??row.PurchasePrice??0),min=Number(row.min_stock??row.MinStock??0);
            if(!Number.isFinite(price)||price<0||!Number.isFinite(purchase)||purchase<0||!Number.isFinite(min)||min<0)throw new Error("Invalid numeric product value");
            await client.query("insert into products(organization_id,name,sku,barcode,selling_price,purchase_price,min_stock,currency_code) values($1,$2,$3,$4,$5,$6,$7,(select currency_code from organizations where id=$1))",[req.user.orgId,name,row.sku||row.SKU||null,row.barcode||row.Barcode||null,price,purchase,min]);
          }else if(d.entity_type==="customers"){
            await client.query("insert into customers(organization_id,name,phone,email,tax_id) values($1,$2,$3,$4,$5)",[req.user.orgId,name,row.phone||row.Phone||null,row.email||row.Email||null,row.tax_id||row.taxId||null]);
          }else{
            await client.query("insert into suppliers(organization_id,name,phone,email,tax_id) values($1,$2,$3,$4,$5)",[req.user.orgId,name,row.phone||row.Phone||null,row.email||row.Email||null,row.tax_id||row.taxId||null]);
          }
          valid++;
        }catch(e){errors.push({row:i+1,message:e.code==="23505"?"Duplicate unique value":e.message});}
      }
      await client.query("update import_jobs set status=$1,valid_rows=$2,invalid_rows=$3,errors=$4,completed_at=now() where id=$5",errors.length&&valid===0?"failed":"completed",valid,errors.length,JSON.stringify(errors.slice(0,500)),job.id);
      await audit(client,req,"import",d.entity_type,job.id,null,{valid_rows:valid,invalid_rows:errors.length});
      return {job_id:job.id,status:errors.length&&valid===0?"failed":"completed",total_rows:d.rows.length,valid_rows:valid,invalid_rows:errors.length,errors:errors.slice(0,200)};
    });
    return ok(res,result,201);
  }catch(e){console.error(e);return fail(res,500,"IMPORT_FAILED","Import could not be completed.");}
});
app.get("/api/imports",auth,roles("owner","admin","manager","inventory"),async function(req,res){
  if(!requireDb(res))return;
  const r=await pool.query("select * from import_jobs where organization_id=$1 order by created_at desc limit 100",[req.user.orgId]);
  return ok(res,{items:r.rows});
});

app.get("/api/audit",auth,roles("owner","admin"),async function(req,res){
  if(!requireDb(res))return;
  const r=await pool.query("select a.*,u.display_name from audit_logs a left join users u on u.id=a.user_id where a.organization_id=$1 order by a.created_at desc limit 300",[req.user.orgId]);
  return ok(res,{items:r.rows});
});

app.get("/api/notifications",auth,async function(req,res){
  if(!requireDb(res))return;
  const r=await pool.query("select * from notifications where organization_id=$1 and (user_id=$2 or user_id is null) order by created_at desc limit 100",[req.user.orgId,req.user.sub]);
  return ok(res,{items:r.rows});
});

app.post("/api/offline/sync",auth,async function(req,res){
  if(!requireDb(res))return;
  const p=z.object({device_id:z.string().min(1).max(200),operations:z.array(z.object({operation_key:z.string().min(8).max(200),operation_type:z.enum(["sale","stock_adjustment"]),payload:z.record(z.string(),z.any())})).max(200)}).safeParse(req.body);
  if(!p.success)return fail(res,400,"VALIDATION_ERROR","Invalid offline operations.",p.error.issues);
  const results=[];
  for(const op of p.data.operations){
    try{
      const row=await pool.query("insert into offline_operations(organization_id,device_id,operation_key,operation_type,payload,status) values($1,$2,$3,$4,$5,'queued') on conflict(organization_id,operation_key) do nothing returning id",[req.user.orgId,p.data.device_id,op.operation_key,op.operation_type,JSON.stringify(op.payload)]);
      results.push({operation_key:op.operation_key,accepted:true,duplicate:!row.rowCount});
    }catch(e){results.push({operation_key:op.operation_key,accepted:false,error:"Unable to queue operation"});}
  }
  return ok(res,{results:results});
});

app.use(function(err,req,res,next){console.error(err);return fail(res,500,"INTERNAL_ERROR","Something went wrong.");});
const port=Number(process.env.PORT || 4000);
app.listen(port,function(){console.log("Puravigal POS API listening on :"+port);});
