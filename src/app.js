import { usageAdapters } from "./adapters/grok-usage-csv.js";
import { usageStore } from "./storage/usage-store.js";

const $ = s => document.querySelector(s);
const state = { events: [], sourceName: "", skippedRows: 0, range: "all", custom: null, metric: "total", search: "", page: 1, pageSize: 10, hoveredIndex: -1, selectedProduct: "", selectedUser: "", detailKind: "product", maskEmails: false, lastImport: null };
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const exact = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const fmt = n => compact.format(n || 0), exactFmt = n => exact.format(n || 0);
const safe = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const colors = ["#a78bfa","#60a5fa","#48d9d1","#f5bd61","#4adea2","#f472b6","#fb923c","#94a3b8"];
const metrics = { total:"All tokens", prompt:"Input tokens", completion:"Output tokens", cached:"Cached tokens", requests:"Usage events" };
const productOf = e => e.product || "Grok (unspecified product)";
const usageOf = e => e.usageType || "Uncategorised";
const userOf = e => e.userEmail?.trim() || "Unknown user";
const MODEL_REGISTRY = [{ id:"grok", match:/grok|xai|x\\.ai/i, provider:"xAI", icon:"✳", kind:"grok" }];
const modelMeta = model => { const value=String(model||"Grok (unspecified)"); const config=MODEL_REGISTRY.find(item=>item.match.test(value)); return {label:value,icon:config?.icon||value.trim().slice(0,2).toUpperCase(),kind:config?.kind||"generic",provider:config?.provider||"Model provider"}; };
const modelBadge = model => { const m=modelMeta(model); return '<span class="model-logo '+m.kind+'" aria-label="'+(m.kind==="grok"?"Grok logo":"Model icon")+'" aria-hidden="true">'+(m.kind==="grok"?"✳":safe(m.icon))+'</span>'; };
const displayUser = email => { if(!state.maskEmails||email==="Unknown user")return email; const parts=email.split("@"); return parts.length===2?parts[0].slice(0,1)+"•••@"+parts[1]:"••••••"; };
function switchPage(page) {
  $("#dashboard-page").hidden = page !== "dashboard"; $("#explorer-page").hidden = page !== "explorer"; $("#import-page").hidden = page !== "import";
  $("#page-title").textContent = page === "dashboard" ? "Usage overview" : page === "explorer" ? "Data Explorer" : "Import usage data";
  document.querySelectorAll(".nav-item[data-page]").forEach(el => el.classList.toggle("active", el.dataset.page === page));
  if (page === "import") renderImportHistory();
  if (page === "explorer") window.dispatchEvent(new CustomEvent("usage-data-updated"));
  if (page === "dashboard") requestAnimationFrame(() => renderChart(activeRange()));
}
function activeRange() {
  if (!state.events.length) return [];
  let from = -Infinity, to = Infinity; const latest = state.events[state.events.length - 1].timestamp;
  if (state.range === "7d") from = latest - 7 * 86400000;
  if (state.range === "30d") from = latest - 30 * 86400000;
  if (state.range === "90d") from = latest - 90 * 86400000;
  if (state.range === "custom" && state.custom) { from = state.custom.from; to = state.custom.to; }
  return state.events.filter(e => e.timestamp >= from && e.timestamp <= to);
}
function summarize(events) {
  return events.reduce((s,e) => { ["prompt","completion","cached","cacheWrite","total","cost"].forEach(k => s[k] += e[k] || 0); s.requests++; return s; }, {prompt:0,completion:0,cached:0,cacheWrite:0,total:0,cost:0,requests:0});
}
function groupBy(events, keyFn) {
  const map = new Map();
  events.forEach(e => { const key = keyFn(e); if (!map.has(key)) map.set(key, []); map.get(key).push(e); });
  return Array.from(map.entries()).map(([key,items]) => ({key,events:items,summary:summarize(items)}));
}
function renderKpis(events) {
  const s = summarize(events);
  $("#kpi-total").textContent = fmt(s.total); $("#kpi-requests").textContent = exactFmt(s.requests);
  $("#kpi-prompt").textContent = fmt(s.prompt); $("#kpi-completion").textContent = fmt(s.completion); $("#kpi-cached").textContent = fmt(s.cached);
  $("#kpi-total-sub").textContent = exactFmt(s.total) + " tokens in selected dates";
  $("#kpi-events-sub").textContent = events.length.toLocaleString() + " usage rows";
  $("#kpi-cache-rate").textContent = "Cache share " + (s.total ? s.cached / s.total * 100 : 0).toFixed(1) + "%";
}
function renderUsageBreakdown(events) {
  const groups = groupBy(events, usageOf).sort((a,b) => b.summary.total - a.summary.total);
  const total = groups.reduce((s,g) => s + g.summary.total, 0);
  $("#usage-donut-total").textContent = fmt(total);
  let angle = 0;
  const slices = groups.map((g,i) => { const start = angle; angle += total ? g.summary.total / total * 360 : 0; return colors[i % colors.length] + " " + start + "deg " + angle + "deg"; });
  $("#usage-donut").style.background = total ? "conic-gradient(" + slices.join(",") + ")" : "conic-gradient(#30394a 0deg 360deg)";
  $("#usage-breakdown-list").innerHTML = groups.length ? groups.map((g,i) => '<div class="usage-breakdown-row"><span class="breakdown-name"><i class="legend-dot" style="background:' + colors[i % colors.length] + '"></i>' + safe(g.key) + '</span><strong>' + exactFmt(g.summary.total) + '</strong><small>' + (total ? g.summary.total / total * 100 : 0).toFixed(1) + '%</small></div>').join("") : '<div class="empty-small">No usage categories found in this date range.</div>';
}
function renderModels(events) {
  const groups=groupBy(events,e=>e.model||"Grok (unspecified)").sort((a,b)=>b.summary.total-a.summary.total);
  const total=groups.reduce((s,g)=>s+g.summary.total,0);
  $("#model-count").textContent=groups.length+" model"+(groups.length===1?"":"s");
  $("#model-list").innerHTML=groups.length?groups.map(g=>{const meta=modelMeta(g.key),share=total?g.summary.total/total*100:0;return '<div class="model-row"><div class="model-identity">'+modelBadge(g.key)+'<span><strong>'+safe(meta.label)+'</strong><small>'+safe(meta.provider)+' · '+g.events.length.toLocaleString()+' events</small></span></div><div class="model-usage-bar-wrap"><div class="model-usage-bar"><span style="width:'+share.toFixed(2)+'%"></span></div><div class="model-usage-meta">'+share.toFixed(1)+'% of selected tokens</div></div><div class="model-total"><strong>'+exactFmt(g.summary.total)+'</strong><small>tokens</small></div></div>';}).join(""):'<div class="empty-small">Import usage data to see token totals by model.</div>';
}
function renderUsers(events) {
  const groups=groupBy(events,userOf).sort((a,b)=>b.summary.total-a.summary.total);
  const total=groups.reduce((s,g)=>s+g.summary.total,0);
  $("#user-list").innerHTML=groups.length?groups.map(g=>{
    const share=total?g.summary.total/total*100:0;
    const products=groupBy(g.events,productOf).sort((a,b)=>b.summary.total-a.summary.total);
    const types=groupBy(g.events,usageOf).sort((a,b)=>b.summary.total-a.summary.total);
    return '<button type="button" class="user-row user-row-button" data-user="'+safe(g.key)+'"><span class="user-identity"><span class="user-avatar">'+safe(g.key==="Unknown user"?"?":g.key.slice(0,1).toUpperCase())+'</span><span><strong>'+safe(displayUser(g.key))+'</strong><small>'+g.summary.requests.toLocaleString()+' usage events</small></span></span><span class="user-usage-bar-wrap"><span class="user-usage-bar"><span style="width:'+share.toFixed(2)+'%"></span></span><span class="model-usage-meta">'+share.toFixed(1)+'% of selected tokens</span></span><span class="user-top-use"><strong>'+safe(products[0]?.key||"No product")+'</strong><small>Top product · '+safe(types[0]?.key||"No usage type")+'</small></span><span class="user-total"><strong>'+exactFmt(g.summary.total)+'</strong><small>tokens</small></span><span class="user-arrow">›</span></button>';
  }).join(""):'<div class="empty-state"><strong>No user data yet</strong><span>Import a CSV that includes the User Email column to compare users.</span></div>';
  $("#user-list").querySelectorAll("[data-user]").forEach(button=>button.addEventListener("click",()=>openUser(button.dataset.user,events)));
}
function renderProducts(events) {
  const groups = groupBy(events, productOf).sort((a,b) => b.summary.total - a.summary.total);
  const total = groups.reduce((s,g) => s + g.summary.total, 0);
  $("#product-count").textContent = groups.length + " product" + (groups.length === 1 ? "" : "s");
  $("#product-list").innerHTML = groups.length ? groups.map(g => {
    const share = total ? g.summary.total / total * 100 : 0;
    const modelCount = new Set(g.events.map(e => e.model)).size;
    return '<button class="product-row" type="button" data-product="' + safe(g.key) + '"><span class="product-name"><strong>' + safe(g.key) + '</strong><small>' + g.events.length.toLocaleString() + ' usage events · ' + modelCount + ' model' + (modelCount === 1 ? '' : 's') + '</small></span><span class="product-share-wrap"><span class="product-bar-wrap"><span class="product-bar" style="display:block;width:' + share.toFixed(2) + '%"></span></span><span class="product-share">' + share.toFixed(1) + '% of selected tokens</span></span><span class="product-tokens"><strong>' + exactFmt(g.summary.total) + '</strong><small>tokens</small></span><span class="product-arrow">›</span></button>';
  }).join("") : '<div class="empty-state"><strong>No product data yet</strong><span>Import a Grok Usage CSV to see which products consume the most tokens.</span></div>';
  $("#product-list").querySelectorAll("[data-product]").forEach(button => button.addEventListener("click", () => openProduct(button.dataset.product, events)));
}
function bucketEvents(events) {
  const daily = new Map();
  events.forEach(e => {
    const d = new Date(e.timestamp), key = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
    if (!daily.has(key)) daily.set(key,{timestamp:new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime(),total:0,prompt:0,completion:0,cached:0,requests:0});
    const b = daily.get(key); ["total","prompt","completion","cached"].forEach(k => b[k] += e[k] || 0); b.requests++;
  });
  return Array.from(daily.values()).sort((a,b) => a.timestamp-b.timestamp);
}
function renderChart(events) {
  const canvas = $("#usage-chart"), wrap = canvas.parentElement, empty = $("#chart-empty"), tooltip = $("#chart-tooltip");
  const rect = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1,Math.floor(rect.width*dpr)); canvas.height = Math.max(1,Math.floor(rect.height*dpr));
  const ctx = canvas.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,rect.width,rect.height);
  const buckets = bucketEvents(events), metric = state.metric;
  $("#legend-label").textContent = metrics[metric];
  $("#chart-period").textContent = buckets.length ? new Date(buckets[0].timestamp).toLocaleDateString() + " — " + new Date(buckets[buckets.length-1].timestamp).toLocaleDateString() : "No data in range";
  $("#bucket-label").textContent = "Daily totals · " + buckets.length + " day" + (buckets.length === 1 ? "" : "s"); empty.hidden = !!buckets.length;
  if (!buckets.length || rect.width < 10 || rect.height < 10) { tooltip.hidden = true; canvas._points = []; return; }
  const pad={left:48,right:12,top:18,bottom:32}, pw=rect.width-pad.left-pad.right, ph=rect.height-pad.top-pad.bottom;
  const values=buckets.map(b => b[metric] || 0), max=Math.max(...values,1), scale=max*1.15;
  ctx.font="10px Inter,system-ui,sans-serif"; ctx.textBaseline="middle";
  for(let i=0;i<=4;i++){const y=pad.top+ph*i/4;ctx.strokeStyle="#27303d";ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(rect.width-pad.right,y);ctx.stroke();ctx.fillStyle="#7f8ba0";ctx.textAlign="right";ctx.fillText(fmt(scale*(1-i/4)),pad.left-8,y);}
  const points=buckets.map((b,i)=>({x:pad.left+(buckets.length===1?pw/2:i/(buckets.length-1)*pw),y:pad.top+ph*(1-values[i]/scale),bucket:b}));
  const grad=ctx.createLinearGradient(0,pad.top,0,pad.top+ph);grad.addColorStop(0,"#a78bfa42");grad.addColorStop(1,"#a78bfa00");
  ctx.beginPath();ctx.moveTo(points[0].x,pad.top+ph);points.forEach(p=>ctx.lineTo(p.x,p.y));ctx.lineTo(points[points.length-1].x,pad.top+ph);ctx.closePath();ctx.fillStyle=grad;ctx.fill();
  ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.strokeStyle="#a78bfa";ctx.lineWidth=2;ctx.stroke();
  const ticks=Math.min(5,points.length);ctx.fillStyle="#7f8ba0";ctx.textAlign="center";ctx.textBaseline="top";
  for(let i=0;i<ticks;i++){const p=points[Math.round(i*(points.length-1)/Math.max(ticks-1,1))];ctx.fillText(new Date(p.bucket.timestamp).toLocaleDateString(undefined,{month:"short",day:"numeric"}),p.x,rect.height-pad.bottom+10);}
  if(state.hoveredIndex>=0&&state.hoveredIndex<points.length){const p=points[state.hoveredIndex];ctx.strokeStyle="#9ba7bb66";ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(p.x,pad.top);ctx.lineTo(p.x,pad.top+ph);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle="#a78bfa";ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fill();tooltip.hidden=false;tooltip.innerHTML="<strong>"+safe(new Date(p.bucket.timestamp).toLocaleDateString())+"</strong><span>"+safe(metrics[metric])+": <b>"+exactFmt(p.bucket[metric]||0)+"</b></span><span>Usage events: <b>"+p.bucket.requests+"</b></span>";tooltip.style.left=Math.max(5,Math.min(rect.width-190,p.x+12))+"px";tooltip.style.top=Math.max(5,Math.min(rect.height-70,p.y-18))+"px";}
  else tooltip.hidden=true;
  canvas._points=points;
}
function renderEvents(events) {
  const q=state.search.toLowerCase(), filtered=events.filter(e=>[productOf(e),e.model,userOf(e),usageOf(e),e.chargeCategory,new Date(e.timestamp).toISOString()].join(" ").toLowerCase().includes(q));
  const pages=Math.max(1,Math.ceil(filtered.length/state.pageSize));state.page=Math.min(state.page,pages);
  const rows=filtered.slice((state.page-1)*state.pageSize,state.page*state.pageSize);
  $("#events-body").innerHTML=rows.length?rows.slice().reverse().map(e=>'<tr><td>'+safe(new Date(e.timestamp).toLocaleString())+'</td><td>'+safe(productOf(e))+'</td><td><span class="model-chip">'+modelBadge(e.model)+safe(e.model)+'</span></td><td>'+safe(displayUser(userOf(e)))+'</td><td><span class="type-chip">'+safe(usageOf(e))+'</span></td><td class="num">'+exactFmt(e.total)+'</td><td class="num">'+exactFmt(e.prompt+e.cached+e.cacheWrite)+'</td><td class="num">'+exactFmt(e.completion)+'</td></tr>').join(""):'<tr><td colspan="8" class="table-empty">No usage records match this view.</td></tr>';
  $("#table-count").textContent=filtered.length.toLocaleString()+" events";$("#page-label").textContent="Page "+state.page+" of "+pages;$("#prev-page").disabled=state.page<=1;$("#next-page").disabled=state.page>=pages;$("#events-subtitle").textContent=filtered.length.toLocaleString()+" records in selected date range";
}
function renderImportHistory() { $("#import-history-meta").textContent=state.events.length?state.events.length.toLocaleString()+" events saved locally · Latest file: "+(state.sourceName||"Grok Usage CSV"):"No usage data saved in this browser yet."; }
function render() {
  const events=activeRange();renderKpis(events);renderUsageBreakdown(events);renderModels(events);renderProducts(events);renderUsers(events);renderChart(events);renderEvents(events);
  $("#dataset-name").textContent=state.sourceName||"No data imported yet";
  $("#dataset-meta").textContent=state.events.length?state.events.length.toLocaleString()+" saved events · "+new Date(state.events[0].timestamp).toLocaleDateString()+" – "+new Date(state.events[state.events.length-1].timestamp).toLocaleDateString()+(state.skippedRows?" · "+state.skippedRows+" invalid rows in last import":"")+(state.lastImport?" · Last import: +"+state.lastImport.added+" new, "+state.lastImport.duplicates+" duplicates ignored":""):"Import a Grok Usage CSV to start analysing your usage";
  renderImportHistory();
}
async function importFile(file) {
  if(!file)return;$("#import-error").hidden=true;$("#import-result").hidden=true;$("#dropzone-title").textContent=file.name;$("#dropzone-subtitle").textContent="Reading and validating file…";
  try {
    if($("#provider-select").value!=="grok"||$("#format-select").value!=="csv")throw new Error("This provider / format combination is not supported yet.");
    const source=await file.text(),adapter=usageAdapters.find(a=>a.supports(file.name,source.slice(0,12000)));
    if(!adapter)throw new Error("This does not look like a supported Grok Usage CSV. Expected Event Time, Product and Usage columns.");
    const result=adapter.parse(source),saved=await usageStore.save({sourceName:file.name,adapterId:adapter.id,importedAt:Date.now(),sourceRows:result.sourceRows,skippedRows:result.skippedRows,events:result.events});
    state.events=saved.events;window.dispatchEvent(new CustomEvent("usage-data-updated"));state.sourceName=file.name;state.skippedRows=result.skippedRows;state.lastImport={added:saved.added,duplicates:saved.duplicates,skipped:result.skippedRows};state.range="all";state.page=1;state.search="";
    $("#range-select").value="all";$("#event-search").value="";
    $("#import-result").innerHTML="<strong>Import complete</strong><br>Added <b>"+saved.added.toLocaleString()+"</b> new events · Ignored <b>"+saved.duplicates.toLocaleString()+"</b> duplicates · Skipped <b>"+result.skippedRows.toLocaleString()+"</b> invalid rows.<br>Total saved history: <b>"+saved.events.length.toLocaleString()+"</b> events.";
    $("#import-result").hidden=false;$("#dropzone-title").textContent="Import another CSV";$("#dropzone-subtitle").textContent="Drop a new export or click to choose a file";
    render();switchPage("dashboard");
  } catch(error) { $("#import-error").textContent=error.message||"Could not import this file.";$("#import-error").hidden=false;$("#dropzone-title").textContent="Drop your CSV file here";$("#dropzone-subtitle").textContent="or click to browse files"; }
}
function openProduct(product, events=activeRange()) {
  state.detailKind="product";state.selectedProduct=product;const subset=events.filter(e=>productOf(e)===product),sum=summarize(subset);
  const days=groupBy(subset,e=>{const d=new Date(e.timestamp);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}).sort((a,b)=>b.key.localeCompare(a.key));
  $("#detail-eyebrow").textContent="PRODUCT DEEP DIVE";$("#detail-title").textContent=product;$("#detail-subtitle").textContent=subset.length.toLocaleString()+" usage events in selected date range";$("#detail-model-heading").textContent="Usage by model";$("#detail-day-heading").textContent="Daily token usage";$("#view-product-events").textContent="View this product’s records";
  $("#detail-kpis").innerHTML='<div class="detail-kpi"><small>Total tokens</small><strong>'+exactFmt(sum.total)+'</strong></div><div class="detail-kpi"><small>Usage events</small><strong>'+exactFmt(sum.requests)+'</strong></div><div class="detail-kpi"><small>Input + cache</small><strong>'+fmt(sum.prompt+sum.cached+sum.cacheWrite)+'</strong></div><div class="detail-kpi"><small>Output tokens</small><strong>'+fmt(sum.completion)+'</strong></div>';
  function list(groups){return groups.length?groups.map(g=>'<div class="detail-list-row"><span>'+safe(g.key)+'</span><strong>'+exactFmt(g.summary.total)+' tokens</strong></div>').join(""):'<div class="empty-small">No data in this range.</div>';}
  $("#detail-usage-list").innerHTML=list(groupBy(subset,usageOf).sort((a,b)=>b.summary.total-a.summary.total));
  $("#detail-model-list").innerHTML=list(groupBy(subset,e=>e.model).sort((a,b)=>b.summary.total-a.summary.total));
  $("#detail-day-list").innerHTML=days.slice(0,14).map(d=>'<div class="detail-list-row"><span>'+safe(d.key)+' · '+d.summary.requests+' events</span><strong>'+exactFmt(d.summary.total)+' tokens</strong></div>').join("")||'<div class="empty-small">No daily usage in this range.</div>';
  $("#product-detail-backdrop").hidden=false;
}
function openUser(user, events=activeRange()) {
  state.detailKind="user";state.selectedUser=user;
  const subset=events.filter(e=>userOf(e)===user),sum=summarize(subset);
  const products=groupBy(subset,productOf).sort((a,b)=>b.summary.total-a.summary.total);
  const days=groupBy(subset,e=>{const d=new Date(e.timestamp);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}).sort((a,b)=>b.key.localeCompare(a.key));
  $("#detail-eyebrow").textContent="USER DEEP DIVE";$("#detail-title").textContent=displayUser(user);$("#detail-subtitle").textContent=subset.length.toLocaleString()+" usage events · "+exactFmt(sum.total)+" tokens";
  $("#detail-kpis").innerHTML='<div class="detail-kpi"><small>Total tokens</small><strong>'+exactFmt(sum.total)+'</strong></div><div class="detail-kpi"><small>Usage events</small><strong>'+exactFmt(sum.requests)+'</strong></div><div class="detail-kpi"><small>Input + cache</small><strong>'+fmt(sum.prompt+sum.cached+sum.cacheWrite)+'</strong></div><div class="detail-kpi"><small>Output tokens</small><strong>'+fmt(sum.completion)+'</strong></div>';
  const list=groups=>groups.length?groups.map(g=>'<div class="detail-list-row"><span>'+safe(g.key)+'</span><strong>'+exactFmt(g.summary.total)+' tokens</strong></div>').join(""):'<div class="empty-small">No data in this range.</div>';
  $("#detail-usage-list").innerHTML=list(groupBy(subset,usageOf).sort((a,b)=>b.summary.total-a.summary.total));
  $("#detail-model-list").innerHTML=list(products);
  $("#detail-day-list").innerHTML=days.slice(0,14).map(d=>'<div class="detail-list-row"><span>'+safe(d.key)+' · '+d.summary.requests+' events</span><strong>'+exactFmt(d.summary.total)+' tokens</strong></div>').join("")||'<div class="empty-small">No daily usage in this range.</div>';
  $("#detail-model-heading").textContent="Usage by product";$("#detail-day-heading").textContent="Daily token usage";$("#view-product-events").textContent="View this user’s records";
  $("#product-detail-backdrop").hidden=false;
}
function exportCsv() {
  const events=activeRange(),headers=["Event Time","Product","Model","User Email","Usage Type","Total Tokens","Prompt Tokens","Completion Tokens","Cached Prompt Tokens","Cache Write Tokens","Cost","Currency"];
  const quote=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
  const rows=events.map(e=>[new Date(e.timestamp).toISOString(),productOf(e),e.model,userOf(e),usageOf(e),e.total,e.prompt,e.completion,e.cached,e.cacheWrite,e.cost,e.currency]);
  const blob=new Blob([[headers,...rows].map(row=>row.map(quote).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="ai-usage-dashboard-export.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const closeMobileMenu=()=>{document.body.classList.remove("menu-open");$("#menu-toggle").setAttribute("aria-expanded","false");$("#menu-toggle").setAttribute("aria-label","Open navigation menu");$("#menu-backdrop").hidden=true;};
$("#menu-toggle").addEventListener("click",()=>{const open=!document.body.classList.contains("menu-open");document.body.classList.toggle("menu-open",open);$("#menu-toggle").setAttribute("aria-expanded",String(open));$("#menu-toggle").setAttribute("aria-label",open?"Close navigation menu":"Open navigation menu");$("#menu-backdrop").hidden=!open;});
$("#menu-backdrop").addEventListener("click",closeMobileMenu);
document.querySelectorAll(".nav-item[data-page]").forEach(el=>el.addEventListener("click",()=>{switchPage(el.dataset.page);closeMobileMenu();}));
$("#back-dashboard").addEventListener("click",()=>switchPage("dashboard"));
window.addEventListener("usage-data-updated",()=>window.dispatchEvent(new CustomEvent("usage-data-changed",{detail:state.events})));
$("#clear-data").addEventListener("click",async()=>{
  if(!window.confirm("Clear all saved usage data for AI Usage Dashboard in this browser? This only deletes this app’s own saved dataset. Data belonging to other pages on this domain will not be changed."))return;
  const button=$("#clear-data");
  button.disabled=true;
  try{
    await usageStore.clear();
    state.events=[];window.dispatchEvent(new CustomEvent("usage-data-updated"));state.sourceName="";state.skippedRows=0;state.lastImport=null;state.range="all";state.custom=null;state.search="";state.page=1;state.selectedProduct="";state.selectedUser="";state.detailKind="product";
    $("#event-search").value="";$("#range-select").value="all";$("#custom-range").hidden=true;$("#import-error").hidden=true;$("#import-result").hidden=true;
    $("#dropzone-title").textContent="Drop your CSV file here";$("#dropzone-subtitle").textContent="or click to browse files";
    $("#product-detail-backdrop").hidden=true;
    render();
  }catch(error){
    window.alert("Could not clear this app’s saved data: "+(error?.message||"Unknown storage error"));
  }finally{button.disabled=false;}
});
$("#csv-file").addEventListener("change",e=>{importFile(e.target.files?.[0]);e.target.value="";});
$("#dropzone").addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();$("#csv-file").click();}});
$("#dropzone").addEventListener("dragover",e=>{e.preventDefault();$("#dropzone").classList.add("dragging");});
$("#dropzone").addEventListener("dragleave",()=>$("#dropzone").classList.remove("dragging"));
$("#dropzone").addEventListener("drop",e=>{e.preventDefault();$("#dropzone").classList.remove("dragging");importFile(e.dataTransfer.files?.[0]);});
$("#provider-select").addEventListener("change",()=>{$("#format-select").disabled=$("#provider-select").value!=="grok";});
$("#range-select").addEventListener("change",e=>{state.range=e.target.value;$("#custom-range").hidden=state.range!=="custom";if(state.range!=="custom"){state.custom=null;state.page=1;render();}});
$("#apply-range").addEventListener("click",()=>{const from=Date.parse($("#date-from").value+"T00:00:00"),to=Date.parse($("#date-to").value+"T23:59:59.999");if(!Number.isFinite(from)||!Number.isFinite(to)||from>to){switchPage("import");$("#import-error").textContent="Choose a valid start and end date.";$("#import-error").hidden=false;return;}state.custom={from,to};state.range="custom";state.page=1;render();});
$("#metric-select").addEventListener("change",e=>{state.metric=e.target.value;state.hoveredIndex=-1;renderChart(activeRange());});
$("#event-search").addEventListener("input",e=>{state.search=e.target.value;state.page=1;renderEvents(activeRange());});
$("#prev-page").addEventListener("click",()=>{state.page--;renderEvents(activeRange());});$("#next-page").addEventListener("click",()=>{state.page++;renderEvents(activeRange());});$("#export-button").addEventListener("click",exportCsv);
$("#usage-chart").addEventListener("mousemove",e=>{const points=e.currentTarget._points||[];if(!points.length)return;const x=e.clientX-e.currentTarget.getBoundingClientRect().left;state.hoveredIndex=points.reduce((best,p,i)=>Math.abs(p.x-x)<Math.abs(points[best].x-x)?i:best,0);renderChart(activeRange());});
$("#usage-chart").addEventListener("click",e=>{const points=e.currentTarget._points||[];if(!points.length)return;const x=e.clientX-e.currentTarget.getBoundingClientRect().left;state.hoveredIndex=points.reduce((best,p,i)=>Math.abs(p.x-x)<Math.abs(points[best].x-x)?i:best,0);renderChart(activeRange());});
$("#usage-chart").addEventListener("mouseleave",()=>{state.hoveredIndex=-1;renderChart(activeRange());});
$("#close-detail").addEventListener("click",()=>$("#product-detail-backdrop").hidden=true);$("#product-detail-backdrop").addEventListener("click",e=>{if(e.target===$("#product-detail-backdrop"))$("#product-detail-backdrop").hidden=true;});
$("#view-product-events").addEventListener("click",()=>{const target=state.detailKind==="user"?state.selectedUser:state.selectedProduct;state.search=target;$("#event-search").value=target;state.page=1;$("#product-detail-backdrop").hidden=true;renderEvents(activeRange());$("#events-subtitle").textContent="Filtered to "+displayUser(target);document.querySelector(".table-panel").scrollIntoView({behavior:"smooth",block:"start"});});
$("#mask-emails").addEventListener("change",e=>{state.maskEmails=e.target.checked;renderUsers(activeRange());renderEvents(activeRange());if(!$("#product-detail-backdrop").hidden&&state.detailKind==="user")openUser(state.selectedUser);});
window.addEventListener("resize",()=>renderChart(activeRange()));
try{const saved=await usageStore.load();if(saved?.events?.length){state.events=saved.events;state.sourceName=saved.sourceName||"Saved usage history";state.skippedRows=saved.skippedRows||0;state.lastImport=saved.lastImport||null;state.range="all";}}catch(error){console.warn("Browser storage unavailable:",error);}
render();
