
const API_URL=(import.meta.env.VITE_API_URL || "").replace(/\/$/,"");
const ACCESS_KEY="puravi_access";
const REFRESH_KEY="puravi_refresh";

export const isApiConfigured=Boolean(API_URL);
export function getAccessToken(){return localStorage.getItem(ACCESS_KEY);}
export function getRefreshToken(){return localStorage.getItem(REFRESH_KEY);}
export function saveSession(session){if(session?.access_token)localStorage.setItem(ACCESS_KEY,session.access_token);if(session?.refresh_token)localStorage.setItem(REFRESH_KEY,session.refresh_token);}
export function clearSession(){localStorage.removeItem(ACCESS_KEY);localStorage.removeItem(REFRESH_KEY);}

async function request(path,options={},retry=true){
  if(!API_URL) throw new Error("API_NOT_CONFIGURED");
  const headers={"Content-Type":"application/json",...(options.headers||{})};
  const token=getAccessToken();if(token)headers.Authorization="Bearer "+token;
  const response=await fetch(API_URL+path,{...options,headers,credentials:"include"});
  if(response.status===401 && retry && getRefreshToken()){
    const refresh=await fetch(API_URL+"/api/auth/refresh",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({refresh_token:getRefreshToken()}),credentials:"include"});
    if(refresh.ok){const data=await refresh.json();saveSession(data.session);return request(path,options,false);}
    clearSession();
  }
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.error?.message || "Request failed");
  return data;
}
export const api={
  health:()=>request("/api/health"),
  signup:(body)=>request("/api/auth/signup",{method:"POST",body:JSON.stringify(body)}),
  login:(body)=>request("/api/auth/login",{method:"POST",body:JSON.stringify(body)}),
  logout:(body)=>request("/api/auth/logout",{method:"POST",body:JSON.stringify(body)}),
  me:()=>request("/api/me"),
  products:(q="")=>request("/api/products?q="+encodeURIComponent(q)),
  createProduct:(body)=>request("/api/products",{method:"POST",body:JSON.stringify(body)}),
  updateProduct:(id,body)=>request("/api/products/"+id,{method:"PATCH",body:JSON.stringify(body)}),
  deleteProduct:(id)=>request("/api/products/"+id,{method:"DELETE"}),
  categories:()=>request("/api/categories"),
  createCategory:(body)=>request("/api/categories",{method:"POST",body:JSON.stringify(body)}),
  customers:(q="")=>request("/api/customers?q="+encodeURIComponent(q)),
  createCustomer:(body)=>request("/api/customers",{method:"POST",body:JSON.stringify(body)}),
  suppliers:(q="")=>request("/api/suppliers?q="+encodeURIComponent(q)),
  createSupplier:(body)=>request("/api/suppliers",{method:"POST",body:JSON.stringify(body)}),
  stores:()=>request("/api/stores"),
  sales:(body)=>request("/api/sales",{method:"POST",body:JSON.stringify(body)}),
  invoices:()=>request("/api/invoices"),
  invoice:(id)=>request("/api/invoices/"+id),
  purchases:(body)=>request("/api/purchases",{method:"POST",body:JSON.stringify(body)}),
  purchaseList:()=>request("/api/purchases"),
  returns:(body)=>request("/api/returns",{method:"POST",body:JSON.stringify(body)}),
  adjustStock:(body)=>request("/api/inventory/adjust",{method:"POST",body:JSON.stringify(body)}),
  movements:()=>request("/api/inventory/movements"),
  dashboard:()=>request("/api/dashboard"),
  reports:(range)=>request("/api/reports/summary?range="+encodeURIComponent(range)),
  settings:()=>request("/api/settings"),
  updateSettings:(body)=>request("/api/settings",{method:"PATCH",body:JSON.stringify(body)}),
  audit:()=>request("/api/audit"),
  notifications:()=>request("/api/notifications"),
  users:()=>request("/api/users"),
  updateUserRole:(id,role)=>request("/api/users/"+id+"/role",{method:"PATCH",body:JSON.stringify({role})}),
  importPreview:(body)=>request("/api/imports/preview",{method:"POST",body:JSON.stringify(body)}),
  importCommit:(body)=>request("/api/imports/commit",{method:"POST",body:JSON.stringify(body)}),
  imports:()=>request("/api/imports"),
  sync:(body)=>request("/api/offline/sync",{method:"POST",body:JSON.stringify(body)})
};
