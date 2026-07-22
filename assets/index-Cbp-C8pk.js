var us=Object.defineProperty;var hs=(e,t,s)=>t in e?us(e,t,{enumerable:!0,configurable:!0,writable:!0,value:s}):e[t]=s;var A=(e,t,s)=>hs(e,typeof t!="symbol"?t+"":t,s);(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))n(i);new MutationObserver(i=>{for(const a of i)if(a.type==="childList")for(const o of a.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&n(o)}).observe(document,{childList:!0,subtree:!0});function s(i){const a={};return i.integrity&&(a.integrity=i.integrity),i.referrerPolicy&&(a.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?a.credentials="include":i.crossOrigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function n(i){if(i.ep)return;i.ep=!0;const a=s(i);fetch(i.href,a)}})();const $t={"1m":6e4,"5m":3e5,"15m":9e5,"30m":18e5,"1h":36e5,"4h":144e5,"1d":864e5,"1w":6048e5};function j(e){return{ok:!0,value:e}}function T(e){return{ok:!1,error:e}}const ps=1e11;function ee(e){return e<ps?e*1e3:e}function _e(e){return typeof e=="number"&&Number.isFinite(e)}function lt(e,t){for(const s of t){const n=e[s];if(_e(n))return n;if(typeof n=="string"&&n.trim()!==""&&Number.isFinite(Number(n)))return Number(n)}}function ms(e){if(Array.isArray(e)){if(e.length<6)return T(`candle array too short: length ${e.length}`);const t=e.slice(0,6).map(l=>typeof l=="string"?Number(l):l);if(!t.every(_e))return T("candle array contains non-numeric values");const[s,n,i,a,o,r]=t;return se({timestamp:ee(s),open:n,high:i,low:a,close:o,volume:r})}if(typeof e=="object"&&e!==null){const t=e,s=lt(t,["timestamp","time","t","start","openTime","start_time","startTime"]),n=lt(t,["open","o"]),i=lt(t,["high","h"]),a=lt(t,["low","l"]),o=lt(t,["close","c"]),r=lt(t,["volume","v","vol"]);return s===void 0?T("candle object missing timestamp"):n===void 0||i===void 0||a===void 0||o===void 0?T("candle object missing OHLC field(s)"):se({timestamp:ee(s),open:n,high:i,low:a,close:o,volume:r??0})}return T(`unsupported candle payload type: ${typeof e}`)}function se(e){return e.timestamp<=0?T(`invalid timestamp: ${e.timestamp}`):e.open<0||e.high<0||e.low<0||e.close<0?T("negative price"):e.volume<0?T("negative volume"):e.high<Math.max(e.open,e.close)?T("high below open/close"):e.low>Math.min(e.open,e.close)?T("low above open/close"):e.low>e.high?T("low above high"):j(e)}function Wt(e){const t=new Map,s=[];return e.forEach((i,a)=>{const o=ms(i);o.ok?t.set(o.value.timestamp,o.value):s.push({index:a,reason:o.error})}),{candles:[...t.values()].sort((i,a)=>i.timestamp-a.timestamp),rejected:s}}const fs="/api/revx",ys=15e3,gs={"1m":1,"5m":5,"15m":15,"30m":30,"1h":60,"4h":240,"1d":1440,"1w":10080};class vs{constructor(t={}){A(this,"name","Revolut X (read-only)");A(this,"baseUrl");A(this,"fetchFn");A(this,"now");A(this,"timeoutMs");this.baseUrl=(t.baseUrl??fs).replace(/\/$/,""),this.fetchFn=t.fetchFn??((s,n)=>fetch(s,n)),this.now=t.now??(()=>Date.now()),this.timeoutMs=t.timeoutMs??ys}async getJson(t){const s=`${this.baseUrl}${t}`,n=new AbortController,i=setTimeout(()=>n.abort(),this.timeoutMs);try{const a=await this.fetchFn(s,{method:"GET",headers:{Accept:"application/json"},signal:n.signal});return a.ok?j(await a.json()):T(`HTTP ${a.status} from ${s}`)}catch(a){const o=a instanceof Error?a.message:String(a);return T(`request failed for ${s}: ${o}`)}finally{clearTimeout(i)}}async getInstruments(){const t=await this.getJson("/configuration/pairs");if(!t.ok)return t;const s=t.value;if(typeof s!="object"||s===null||Array.isArray(s))return T("unexpected pairs payload: expected an object keyed by symbol");const n="data"in s?s.data:s;if(typeof n!="object"||n===null)return T("unexpected pairs payload: no pair map found");const i=[];for(const a of Object.keys(n)){const[o,r]=a.split("-");o&&r&&i.push({symbol:a,base:o,quote:r})}return i.length===0?T("no parseable trading pairs in payload"):j(i)}async getCandles(t,s,n){var y;if(n<=0)return T(`limit must be positive, got ${n}`);const i=gs[s],a=this.now(),o=a-n*$t[s],r=`/candles/${encodeURIComponent(t)}?interval=${i}&since=${o}&until=${a}`,l=await this.getJson(r);if(!l.ok)return l;const u=l.value,d=typeof u=="object"&&u!==null&&Array.isArray(u.data)?u.data:Array.isArray(u)?u:void 0;if(d===void 0)return T("unexpected candles payload shape");const{candles:c,rejected:h}=Wt(d);return c.length===0?T(h.length>0?`all ${h.length} candle rows invalid (first: ${(y=h[0])==null?void 0:y.reason})`:"empty candle series"):j(c)}}const bs="https://api.exchange.coinbase.com",$s=15e3,ws={"1m":{granularitySec:60,group:1},"5m":{granularitySec:300,group:1},"15m":{granularitySec:900,group:1},"30m":{granularitySec:900,group:2},"1h":{granularitySec:3600,group:1},"4h":{granularitySec:3600,group:4},"1d":{granularitySec:86400,group:1},"1w":{granularitySec:86400,group:7}},Ps=[{symbol:"BTC-EUR",base:"BTC",quote:"EUR"},{symbol:"ETH-EUR",base:"ETH",quote:"EUR"},{symbol:"SOL-EUR",base:"SOL",quote:"EUR"},{symbol:"XRP-EUR",base:"XRP",quote:"EUR"},{symbol:"ADA-EUR",base:"ADA",quote:"EUR"},{symbol:"DOGE-EUR",base:"DOGE",quote:"EUR"},{symbol:"LTC-EUR",base:"LTC",quote:"EUR"},{symbol:"DOT-EUR",base:"DOT",quote:"EUR"},{symbol:"LINK-EUR",base:"LINK",quote:"EUR"},{symbol:"AVAX-EUR",base:"AVAX",quote:"EUR"}];class xs{constructor(t={}){A(this,"name","Coinbase public market data (read-only)");A(this,"fetchFn");A(this,"timeoutMs");this.fetchFn=t.fetchFn??((s,n)=>fetch(s,n)),this.timeoutMs=t.timeoutMs??$s}getInstruments(){return Promise.resolve(j([...Ps]))}async getCandles(t,s,n){var y;if(n<=0)return T(`limit must be positive, got ${n}`);const{granularitySec:i,group:a}=ws[s],o=`${bs}/products/${encodeURIComponent(t)}/candles?granularity=${i}`,r=await this.getJson(o);if(!r.ok)return r;const l=r.value;if(!Array.isArray(l)){const v=typeof l=="object"&&l!==null&&"message"in l?String(l.message):"not an array";return T(`unexpected Coinbase payload: ${v}`)}const u=l.filter(v=>Array.isArray(v)&&v.length>=6).map(v=>[v[0],v[3],v[2],v[1],v[4],v[5]]),{candles:d,rejected:c}=Wt(u);if(d.length===0)return T(c.length>0?`all ${c.length} Coinbase rows invalid (first: ${(y=c[0])==null?void 0:y.reason})`:"empty candle series from Coinbase");const h=a===1?d:Ss(d,i*a*1e3);return j(h.slice(-n))}async getJson(t){const s=new AbortController,n=setTimeout(()=>s.abort(),this.timeoutMs);try{const i=await this.fetchFn(t,{method:"GET",headers:{Accept:"application/json"},signal:s.signal});return i.ok?j(await i.json()):T(`HTTP ${i.status} from ${t}`)}catch(i){const a=i instanceof Error?i.message:String(i);return T(`request failed for ${t}: ${a}`)}finally{clearTimeout(n)}}}function Ss(e,t){const s=new Map;for(const a of e){const o=a.timestamp-a.timestamp%t,r=s.get(o)??[];r.push(a),s.set(o,r)}const n=[...s.keys()].sort((a,o)=>a-o),i=[];return n.forEach((a,o)=>{const r=s.get(a);o===0&&r[0].timestamp!==a||i.push({timestamp:a,open:r[0].open,high:Math.max(...r.map(l=>l.high)),low:Math.min(...r.map(l=>l.low)),close:r[r.length-1].close,volume:r.reduce((l,u)=>l+u.volume,0)})}),i}const ne="https://api.kraken.com/0/public",ks=15e3,Ts=150,Rs={"1m":1,"5m":5,"15m":15,"30m":30,"1h":60,"4h":240,"1d":1440,"1w":10080},ie=[{symbol:"XBTEUR",base:"BTC",quote:"EUR"},{symbol:"ETHEUR",base:"ETH",quote:"EUR"},{symbol:"SOLEUR",base:"SOL",quote:"EUR"},{symbol:"XRPEUR",base:"XRP",quote:"EUR"},{symbol:"ADAEUR",base:"ADA",quote:"EUR"},{symbol:"DOGEEUR",base:"DOGE",quote:"EUR"},{symbol:"LTCEUR",base:"LTC",quote:"EUR"},{symbol:"DOTEUR",base:"DOT",quote:"EUR"},{symbol:"LINKEUR",base:"LINK",quote:"EUR"},{symbol:"AVAXEUR",base:"AVAX",quote:"EUR"}],Es=[{symbol:"POLEUR",base:"POL",quote:"EUR"},{symbol:"TRXEUR",base:"TRX",quote:"EUR"},{symbol:"ATOMEUR",base:"ATOM",quote:"EUR"},{symbol:"XLMEUR",base:"XLM",quote:"EUR"},{symbol:"BCHEUR",base:"BCH",quote:"EUR"},{symbol:"UNIEUR",base:"UNI",quote:"EUR"},{symbol:"AAVEEUR",base:"AAVE",quote:"EUR"},{symbol:"ETCEUR",base:"ETC",quote:"EUR"},{symbol:"FILEUR",base:"FIL",quote:"EUR"},{symbol:"NEAREUR",base:"NEAR",quote:"EUR"},{symbol:"ALGOEUR",base:"ALGO",quote:"EUR"},{symbol:"INJEUR",base:"INJ",quote:"EUR"},{symbol:"ARBEUR",base:"ARB",quote:"EUR"},{symbol:"OPEUR",base:"OP",quote:"EUR"},{symbol:"APTEUR",base:"APT",quote:"EUR"},{symbol:"PAXGEUR",base:"PAXG",quote:"EUR"}];class Ls{constructor(t={}){A(this,"name","Kraken public market data (read-only)");A(this,"fetchFn");A(this,"now");A(this,"timeoutMs");A(this,"staggerMs");A(this,"pending",[]);A(this,"draining",!1);A(this,"instrumentsCache",null);this.fetchFn=t.fetchFn??((s,n)=>fetch(s,n)),this.now=t.now??(()=>Date.now()),this.timeoutMs=t.timeoutMs??ks,this.staggerMs=t.staggerMs??Ts}async getInstruments(){if(this.instrumentsCache)return j([...this.instrumentsCache]);const t=new Set(ie.map(a=>a.symbol)),s=await this.fetchEurPairs(),n=(s.ok?s.value:Es).filter(a=>!t.has(a.symbol)),i=[...ie,...n];return this.instrumentsCache=i,j([...i])}async fetchEurPairs(){const t=await this.enqueue(()=>this.getJson(`${ne}/AssetPairs`),!0);if(!t.ok)return t;const s=t.value;if(Array.isArray(s.error)&&s.error.length>0)return T(`Kraken error: ${s.error.join("; ")}`);const n=s.result;if(typeof n!="object"||n===null)return T("unexpected Kraken payload: no result object");const i=[];for(const a of Object.values(n)){const o=a;if(o.status!=="online"||typeof o.wsname!="string"||typeof o.altname!="string")continue;const[r,l]=o.wsname.split("/");l!=="EUR"||!r||i.push({symbol:o.altname,base:r==="XBT"?"BTC":r,quote:"EUR"})}return i.length>0?j(i):T("no online EUR pairs found in AssetPairs response")}async getCandles(t,s,n,i){var p;if(n<=0)return T(`limit must be positive, got ${n}`);const a=Rs[s],o=Math.floor((this.now()-(n+2)*a*6e4)/1e3),r=`${ne}/OHLC?pair=${encodeURIComponent(t)}&interval=${a}&since=${o}`,l=await this.enqueue(()=>this.getJson(r),(i==null?void 0:i.priority)??!1);if(!l.ok)return l;const u=l.value;if(Array.isArray(u.error)&&u.error.length>0)return T(`Kraken error: ${u.error.join("; ")}`);const d=u.result;if(typeof d!="object"||d===null)return T("unexpected Kraken payload: no result object");const c=Object.keys(d).find(m=>m!=="last"),h=c!==void 0?d[c]:void 0;if(!Array.isArray(h))return T("unexpected Kraken payload: no OHLC rows");const y=h.filter(m=>Array.isArray(m)&&m.length>=7).map(m=>[m[0],m[1],m[2],m[3],m[4],m[6]]),{candles:v,rejected:f}=Wt(y);return v.length===0?T(f.length>0?`all ${f.length} Kraken rows invalid (first: ${(p=f[0])==null?void 0:p.reason})`:"empty candle series from Kraken"):j(v.slice(-n))}enqueue(t,s=!1){return new Promise((n,i)=>{const a={run:t,resolve:n,reject:i};s?this.pending.unshift(a):this.pending.push(a),this.drain()})}async drain(){if(!this.draining){this.draining=!0;try{for(;this.pending.length>0;){const t=this.pending.shift();try{t.resolve(await t.run())}catch(s){t.reject(s)}this.pending.length>0&&await new Promise(s=>setTimeout(s,this.staggerMs))}}finally{this.draining=!1}}}async getJson(t){const s=new AbortController,n=setTimeout(()=>s.abort(),this.timeoutMs);try{const i=await this.fetchFn(t,{method:"GET",headers:{Accept:"application/json"},signal:s.signal});return i.ok?j(await i.json()):T(`HTTP ${i.status} from ${t}`)}catch(i){const a=i instanceof Error?i.message:String(i);return T(`request failed for ${t}: ${a}`)}finally{clearTimeout(n)}}}function Cs(e){let t=e>>>0;return()=>{t=t+1831565813>>>0;let s=t;return s=Math.imul(s^s>>>15,s|1),s^=s+Math.imul(s^s>>>7,s|61),((s^s>>>14)>>>0)/4294967296}}function As(e){let t=2166136261;for(let s=0;s<e.length;s++)t^=e.charCodeAt(s),t=Math.imul(t,16777619);return t>>>0}function Ms(e){const{seed:t,startPrice:s,count:n,timeframe:i,startTimestamp:a,drift:o=0,volatility:r=.01,baseVolume:l=1e3}=e,u=Cs(t),d=$t[i],c=[];let h=s;for(let y=0;y<n;y++){const v=h,f=(u()*2-1)*r,p=Math.max(v*(1+o+f),1e-6),m=u()*r*v,g=u()*r*v,b=Math.max(v,p)+m,$=Math.max(Math.min(v,p)-g,1e-6),R=l*(.5+u());c.push({timestamp:a+y*d,open:v,high:b,low:$,close:p,volume:R}),h=p}return c}const qs=[{symbol:"BTC/USD",base:"BTC",quote:"USD"},{symbol:"ETH/USD",base:"ETH",quote:"USD"},{symbol:"SOL/USD",base:"SOL",quote:"USD"},{symbol:"XRP/USD",base:"XRP",quote:"USD"},{symbol:"ADA/USD",base:"ADA",quote:"USD"},{symbol:"DOGE/USD",base:"DOGE",quote:"USD"},{symbol:"LTC/USD",base:"LTC",quote:"USD"},{symbol:"DOT/USD",base:"DOT",quote:"USD"}],Fs={"BTC/USD":65e3,"ETH/USD":3400,"SOL/USD":150,"XRP/USD":.52,"ADA/USD":.45,"DOGE/USD":.12,"LTC/USD":82,"DOT/USD":6.4},Ds={"BTC/USD":.0012,"ETH/USD":8e-4,"SOL/USD":.002,"XRP/USD":-.0012,"ADA/USD":-.002,"DOGE/USD":1e-4,"LTC/USD":-3e-4,"DOT/USD":4e-4};class Is{constructor(t){A(this,"name","Demo data (synthetic)");this.anchorTimestamp=t}getInstruments(){return Promise.resolve(j([...qs]))}getCandles(t,s,n){const i=$t[s],a=this.anchorTimestamp-n*i,o=Ms({seed:As(`${t}:${s}`),startPrice:Fs[t]??100,count:n,timeframe:s,startTimestamp:a,drift:Ds[t]??0,volatility:.015,baseVolume:5e3});return Promise.resolve(j(o))}}function Us(){try{return new URLSearchParams(window.location.search).has("demo")}catch{return!1}}async function Ns(){const e=[];if(Us())e.push("demo mode forced via ?demo=1");else{const n=new vs({timeoutMs:6e3}),i=await n.getInstruments();if(i.ok&&i.value.length>0)return{source:n,instruments:[...i.value].sort((o,r)=>o.symbol.localeCompare(r.symbol)),isLive:!0,kind:"revolut",diagnostics:e};e.push("Revolut proxy: not running");const a=[new Ls,new xs];for(const o of a){const r=await o.getInstruments();if(!r.ok)continue;const l=await o.getCandles(r.value[0].symbol,"1h",2);if(l.ok)return{source:o,instruments:r.value,isLive:!0,kind:"public",diagnostics:e};e.push(`${o.name}: ${l.error}`)}}const t=new Is(Date.now()),s=await t.getInstruments();return{source:t,instruments:s.ok?s.value:[],isLive:!1,kind:"demo",diagnostics:e}}function Os(e,t){return new Promise((s,n)=>{const i=setTimeout(()=>n(new Error("timeout")),t);e.then(a=>{clearTimeout(i),s(a)},a=>{clearTimeout(i),n(a instanceof Error?a:new Error(String(a)))})})}async function Xt(e,t,s,n,i=!1){for(let a=0;a<2;a++)try{const o=await Os(e.source.getCandles(t,s,n,{priority:i}),7e3);if(o.ok)return o}catch{}return{ok:!1,error:"Market data temporarily unavailable"}}async function Hs(e,t,s,n,i=!0){const a=await Xt(e,t,s,n,i);if(!a.ok||a.value.length<2)return null;const o=a.value.map(u=>({timestamp:u.timestamp,value:u.close})),r=o[o.length-1].value,l=o[0].value;return{points:o,price:r,changePct:l>0?(r-l)/l*100:0}}async function js(e,t,s,n,i=!0){const a=await Xt(e,t,s,n,i);if(!a.ok||a.value.length<2)return null;const o=a.value[a.value.length-1].close,r=a.value[0].close;return{candles:a.value,price:o,changePct:r>0?(o-r)/r*100:0}}const Ve=[{base:"BTC",label:"Bitcoin"},{base:"ETH",label:"Ethereum"},{base:"SOL",label:"Solana"},{base:"XRP",label:"XRP"},{base:"ADA",label:"Cardano"},{base:"DOGE",label:"Dogecoin"},{base:"LTC",label:"Litecoin"},{base:"DOT",label:"Polkadot"}],Bs={LINK:"Chainlink",AVAX:"Avalanche",POL:"Polygon",TRX:"TRON",ATOM:"Cosmos",XLM:"Stellar",BCH:"Bitcoin Cash",UNI:"Uniswap",AAVE:"Aave",ETC:"Ethereum Classic",FIL:"Filecoin",NEAR:"NEAR Protocol",ALGO:"Algorand",INJ:"Injective",ARB:"Arbitrum",OP:"Optimism",APT:"Aptos",PAXG:"PAX Gold"};function ze(e,t){const s=e.instruments.find(n=>n.base.toUpperCase()===t.toUpperCase());return(s==null?void 0:s.symbol)??null}function Ge(e){return ze(e,"BTC")}function _s(e,t){var i;const s=e.instruments.find(a=>a.symbol===t),n=s==null?void 0:s.base.toUpperCase();return((i=Ve.find(a=>a.base===n))==null?void 0:i.label)??(n?Bs[n]:void 0)??n??t}async function We(e,t,s,n=48){const i=await Xt(e,t,"1h",n);if(!i.ok||i.value.length<2)return null;const a=i.value.map(l=>l.close),o=a[a.length-1],r=a[0];return{symbol:t,label:s,price:o,changePct:r>0?(o-r)/r*100:0,closes:a}}async function Xe(e,t=1/0){const s=new Set,n=[];for(const o of Ve){const r=ze(e,o.base);r!==null&&!s.has(r)&&(s.add(r),n.push({symbol:r,label:o.label}))}for(const o of e.instruments)s.has(o.symbol)||(s.add(o.symbol),n.push({symbol:o.symbol,label:_s(e,o.symbol)}));const i=n.slice(0,t);return(await Promise.all(i.map(o=>We(e,o.symbol,o.label)))).filter(o=>o!==null)}function P(e){const t=Math.abs(e);return t>=1e3?e.toLocaleString("en-US",{maximumFractionDigits:0}):t>=1?e.toFixed(2):e.toPrecision(4)}function C(e,t=2){return e===null?"—":`${e>0?"+":""}${e.toFixed(t)}%`}function it(e,t=1){return e===null?"—":e.toFixed(t)}function I(e){return e===null||e===0?"":e>0?"positive":"negative"}function Vs(e,t){return e.length>t?`${e.slice(0,t)}…`:e}function k(e){return e.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;")}const zs="https://raw.githubusercontent.com/davidpit1565/automatic-trading-ai/main/state/autopilot-state.json";function Gs(e,t){const s=/^paper (entry|exit) (\S+): ([\d.]+) @ ([\d.]+)(?:\s*\((.*)\))?/.exec(t);return s?{at:e,kind:s[1]==="entry"?"buy":"sell",symbol:s[2],quantity:Number(s[3]),price:Number(s[4]),note:s[5]??null}:null}async function Kt(e=(t,s)=>fetch(t,s)){for(let t=0;t<2;t++){const s=await Ws(e);if(s)return s}return null}async function Ws(e){var t;try{const s=await e(`${zs}?t=${Date.now()}`,{cache:"no-store"});if(!s.ok)return null;const n=await s.json(),i=n["portfolio-engine"]??{},a=(n["open-positions"]??[]).map(d=>({symbol:d.symbol,quantity:d.quantity,entryPrice:d.entryPrice,openedAt:d.openedAt})),o=(n["audit-log"]??[]).filter(d=>d.event==="filled").map(d=>Gs(d.timestamp,d.detail)).filter(d=>d!==null).sort((d,c)=>c.at-d.at),r=n["benchmark-anchor"],l=n["real-money-readiness"],u=l&&typeof l.ready=="boolean"?{ready:l.ready,summary:l.summary??"",criteria:(l.criteria??[]).map(d=>({key:d.key??"",ok:d.ok===!0,detail:d.detail??""}))}:null;return{cash:i.cash??0,initialCash:i.initialCash??1e4,baseCurrency:i.baseCurrency??"EUR",positions:a,history:o,lastRunAt:((t=n["autopilot-last-run"])==null?void 0:t.at)??null,benchmark:r&&r.btc&&r.equity?{btc:r.btc,equity:r.equity}:null,equityHistory:Array.isArray(n["equity-history"])?n["equity-history"]:[],readiness:u}}catch{return null}}function Ke(e,t={stroke:"currentColor"}){const s=t.width??120,n=t.height??40,i=3;if(e.length<2)return`<svg viewBox="0 0 ${s} ${n}" aria-hidden="true"></svg>`;const a=Math.min(...e),r=Math.max(...e)-a||1,u=e.map((c,h)=>{const y=i+h/(e.length-1)*(s-2*i),v=n-i-(c-a)/r*(n-2*i);return[y,v]}).map(([c,h])=>`${c.toFixed(1)},${h.toFixed(1)}`).join(" "),d=t.fill?`<polygon fill="${t.stroke}" fill-opacity="0.12" points="${i},${n-i} ${u} ${s-i},${n-i}" />`:"";return`<svg class="spark" viewBox="0 0 ${s} ${n}" preserveAspectRatio="none" aria-hidden="true">
    ${d}<polyline fill="none" stroke="${t.stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${u}" /></svg>`}const ct={left:8,right:58,top:12,bottom:26,viewWidth:380,viewHeight:240};function yt(e,t,s){const n=t??ct.viewWidth,i=s??ct.viewHeight,a=ct.left,o=ct.right,r=ct.top,l=ct.bottom,u=e.length,d=e.map(g=>g.value);let c=Math.min(...d),h=Math.max(...d);const y=(h-c)*.08||Math.abs(h)*.02||1;c-=y,h+=y;const v=h-c||1;return{W:n,H:i,padL:a,padR:o,padT:r,padB:l,n:u,min:c,max:h,x:g=>a+(u>1?g/(u-1)*(n-a-o):0),y:g=>r+(1-(g-c)/v)*(i-r-l),indexAtFraction:g=>{const $=(Math.min(1,Math.max(0,g))*n-a)/(n-a-o);return Math.min(u-1,Math.max(0,Math.round($*(u-1))))}}}function Ye(e,t){if(e.length<2)return'<div class="empty">Not enough history for this range yet.</div>';const s=yt(e,t.width,t.height),{W:n,H:i,padL:a,padR:o,padB:r}=s,l=e.map(($,R)=>`${s.x(R).toFixed(1)},${s.y($.value).toFixed(1)}`).join(" "),u=`${a.toFixed(1)},${(i-r).toFixed(1)} ${l} ${s.x(e.length-1).toFixed(1)},${(i-r).toFixed(1)}`;let d="";const c=4;for(let $=0;$<=c;$++){const R=s.min+(s.max-s.min)*$/c,w=s.y(R);d+=`<line class="pgrid" x1="${a}" y1="${w.toFixed(1)}" x2="${(n-o).toFixed(1)}" y2="${w.toFixed(1)}"/>`,d+=`<text class="paxis" x="${(n-o+5).toFixed(1)}" y="${(w+3).toFixed(1)}">${t.formatY(R)}</text>`}let h="";const y=Math.min(5,e.length);for(let $=0;$<y;$++){const R=Math.round($*(e.length-1)/(y-1));h+=`<text class="paxis pxlab" x="${s.x(R).toFixed(1)}" y="${i-8}">${t.formatX(e[R].timestamp)}</text>`}const v=s.x(e.length-1),f=s.y(e[e.length-1].value),p=t.formatY(e[e.length-1].value),m=`pg${Math.round(e[0].value)}${e.length}`,g=`
    <line class="pchart-now-line" x1="${a}" y1="${f.toFixed(1)}" x2="${(n-o).toFixed(1)}" y2="${f.toFixed(1)}"/>
    <g class="pchart-now-tag" transform="translate(${(n-o+1).toFixed(1)}, ${f.toFixed(1)})">
      <rect x="0" y="-7.5" width="${(o-2).toFixed(1)}" height="15" rx="3" fill="${t.stroke}"/>
      <text x="${((o-2)/2).toFixed(1)}" y="3.5" text-anchor="middle" class="pchart-now-text">${p}</text>
    </g>
    <circle class="pchart-now" cx="${v.toFixed(1)}" cy="${f.toFixed(1)}" r="3.5" fill="${t.stroke}"/>`,b=`
    <g class="pchart-cross" hidden>
      <line class="pchart-cross-line" x1="${v.toFixed(1)}" y1="${s.padT}" x2="${v.toFixed(1)}" y2="${(i-r).toFixed(1)}"/>
      <circle class="pchart-cross-dot" cx="${v.toFixed(1)}" cy="${f.toFixed(1)}" r="4" fill="${t.stroke}"/>
    </g>`;return`<svg class="pchart" viewBox="0 0 ${n} ${i}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="price chart">
    <defs><linearGradient id="${m}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${t.stroke}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${t.stroke}" stop-opacity="0"/></linearGradient></defs>
    ${d}
    <polygon fill="url(#${m})" points="${u}"/>
    <polyline fill="none" stroke="${t.stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${l}"/>
    ${h}
    ${g}
    ${b}
  </svg>`}function Yt(e,t,s){const n=e.map(r=>({timestamp:r.timestamp,value:r.close})),i=[];for(const r of e)i.push({timestamp:r.timestamp,value:r.high}),i.push({timestamp:r.timestamp,value:r.low});const a=yt(n,t,s),o=yt(i.length>=2?i:n,t,s);return{...a,min:o.min,max:o.max,y:o.y}}function Je(e,t){if(e.length<2)return'<div class="empty">Not enough history for this range yet.</div>';const s=Yt(e,t.width,t.height),{W:n,H:i,padL:a,padR:o,padB:r}=s,l=e.length,u=Math.max(1,(n-a-o)/l*.7);let d="";const c=4;for(let w=0;w<=c;w++){const x=s.min+(s.max-s.min)*w/c,S=s.y(x);d+=`<line class="pgrid" x1="${a}" y1="${S.toFixed(1)}" x2="${(n-o).toFixed(1)}" y2="${S.toFixed(1)}"/>`,d+=`<text class="paxis" x="${(n-o+5).toFixed(1)}" y="${(S+3).toFixed(1)}">${t.formatY(x)}</text>`}let h="";const y=Math.min(5,l);for(let w=0;w<y;w++){const x=Math.round(w*(l-1)/(y-1));h+=`<text class="paxis pxlab" x="${s.x(x).toFixed(1)}" y="${i-8}">${t.formatX(e[x].timestamp)}</text>`}let v="";for(let w=0;w<l;w++){const x=e[w],S=s.x(w),E=x.close>=x.open,M=s.y(x.high),q=s.y(x.low),U=s.y(x.open),N=s.y(x.close),O=Math.min(U,N),H=Math.max(1,Math.abs(N-U));v+=`<g class="pcandle ${E?"up":"down"}"><line class="pcandle-wick" x1="${S.toFixed(1)}" y1="${M.toFixed(1)}" x2="${S.toFixed(1)}" y2="${q.toFixed(1)}"/><rect class="pcandle-body" x="${(S-u/2).toFixed(1)}" y="${O.toFixed(1)}" width="${u.toFixed(1)}" height="${H.toFixed(1)}"/></g>`}const f=e[l-1],p=s.x(l-1),m=s.y(f.close),g=f.close>=e[0].close,b=t.formatY(f.close),$=`
    <line class="pchart-now-line" x1="${a}" y1="${m.toFixed(1)}" x2="${(n-o).toFixed(1)}" y2="${m.toFixed(1)}"/>
    <g class="pchart-now-tag" transform="translate(${(n-o+1).toFixed(1)}, ${m.toFixed(1)})">
      <rect x="0" y="-7.5" width="${(o-2).toFixed(1)}" height="15" rx="3"/>
      <text x="${((o-2)/2).toFixed(1)}" y="3.5" text-anchor="middle" class="pchart-now-text">${b}</text>
    </g>
    <circle class="pchart-now" cx="${p.toFixed(1)}" cy="${m.toFixed(1)}" r="3.5"/>`,R=`
    <g class="pchart-cross" hidden>
      <line class="pchart-cross-line" x1="${p.toFixed(1)}" y1="${s.padT}" x2="${p.toFixed(1)}" y2="${(i-r).toFixed(1)}"/>
      <circle class="pchart-cross-dot" cx="${p.toFixed(1)}" cy="${m.toFixed(1)}" r="4"/>
    </g>`;return`<svg class="pchart pcandle-chart ${g?"up":"down"}" viewBox="0 0 ${n} ${i}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="candlestick chart">
    ${d}
    ${v}
    ${h}
    ${$}
    ${R}
  </svg>`}function Bt(e,t){if(e.length<2)return'<p class="status-line">Not enough points for a chart.</p>';const s=t.width??800,n=t.height??180,i=8,a=e.map(d=>d.value),o=Math.min(...a),l=Math.max(...a)-o||1,u=e.map((d,c)=>{const h=i+c/(e.length-1)*(s-2*i),y=n-i-(d.value-o)/l*(n-2*i);return`${h.toFixed(1)},${y.toFixed(1)}`}).join(" ");return`
    <svg class="equity-curve" viewBox="0 0 ${s} ${n}" role="img"
         aria-label="${t.ariaLabel}">
      <polyline class="${t.lineClass}" fill="none" stroke-width="2" points="${u}" />
    </svg>
  `}const ae=15e3,Xs=12e4,st=e=>`€${P(e)}`,oe="#2fbf71",re="#e4574f";function V(e,t,s){const n=document.createElement(e);return t&&(n.className=t),s!==void 0&&(n.textContent=s),n}async function Ks(e,t){const s={};return await Promise.all(t.map(async n=>{const i=await e.source.getCandles(n,"1h",2);i.ok&&i.value.length>0&&(s[n]=i.value[i.value.length-1].close)})),s}function Ys(e,t){e.innerHTML="";const s=V("section","hero tappable");s.dataset.nav="value",s.innerHTML=`
    <div class="hero-label">Portfolio value <span class="tag-sim">SIMULATED</span><span class="hero-more">history ›</span></div>
    <div class="hero-value" id="hv-equity">—</div>
    <div class="hero-change" id="hv-change"></div>
    <div class="hero-split"><span id="hv-cash"></span><span id="hv-invested"></span></div>
    <div class="hero-bench" id="hv-bench" hidden></div>
  `;const n=V("section","block readiness");n.id="home-readiness";const i=V("section","block");i.innerHTML='<div class="block-head"><h2>Markets</h2><button class="link-btn" data-nav="markets">See all</button></div>';const a=V("div","markets-strip");a.id="home-markets",i.appendChild(a);const o=V("section","block");o.innerHTML='<div class="block-head"><h2>Open positions</h2></div>';const r=V("div","stack");r.id="home-positions",o.appendChild(r);const l=V("section","block");l.innerHTML='<div class="block-head"><h2>Recent activity</h2><button class="link-btn" data-nav="history">See all</button></div>';const u=V("div","stack");u.id="home-activity",l.appendChild(u);const d=V("p","muted-line","Loading the cloud robot…");d.id="home-status",e.append(s,n,i,o,l,d);let c=null;const h=(S,E)=>{const M=e.querySelector(`#${S}`);M&&(M.textContent=E)};function y(S){if(a.innerHTML="",S.length===0){a.appendChild(V("div","empty","Live market data unavailable right now."));return}for(const E of S){const M=E.changePct>=0,q=V("div","market-card tappable");q.dataset.nav="markets",q.innerHTML=`
        <div class="market-top"><span class="market-name">${E.label}</span>
          <span class="chg ${M?"up":"down"}">${C(E.changePct)}</span></div>
        <div class="market-price">${st(E.price)}</div>
        <div class="market-spark" style="color:${M?oe:re}">${Ke(E.closes,{stroke:M?oe:re,fill:!0,width:150,height:44})}</div>`,a.appendChild(q)}}function v(S){if(r.innerHTML="",!c||c.positions.length===0){r.appendChild(V("div","empty","No open positions — holding cash and waiting for a good setup."));return}for(const E of c.positions){const M=S[E.symbol]??E.entryPrice,q=E.entryPrice>0?(M-E.entryPrice)/E.entryPrice*100:0,U=q>=0,N=V("div","row");N.innerHTML=`
        <div class="row-main"><span class="row-title">${E.symbol}</span>
          <span class="row-sub">entry ${st(E.entryPrice)}</span></div>
        <div class="row-side"><span class="row-title">${st(E.quantity*M)}</span>
          <span class="chg ${U?"up":"down"}">${C(q)}</span></div>`,r.appendChild(N)}}function f(){const S=(c==null?void 0:c.readiness)??null;if(!S){n.innerHTML='<div class="block-head"><h2>Real-money readiness</h2></div><div class="empty">Assessing the paper track record…</div>';return}const E=S.ready?'<span class="ready-badge go">READY</span>':'<span class="ready-badge no">NOT READY</span>',M=S.criteria.map(q=>`<li class="${q.ok?"ok":"no"}">${q.ok?"✓":"✗"} ${q.detail}</li>`).join("");n.innerHTML=`<div class="block-head"><h2>Real-money readiness</h2>${E}</div><p class="readiness-note">Is the SIMULATED record strong enough to risk real money yet? A checklist, not a profit promise.</p><ul class="readiness-list">${M}</ul>`}function p(){if(u.innerHTML="",!c||c.history.length===0){u.appendChild(V("div","empty","No trades yet — the robot is waiting for a qualified opportunity."));return}for(const S of c.history.slice(0,5)){const E=S.kind==="buy",M=V("div",`row trade ${S.kind}`);M.innerHTML=`
        <div class="row-main"><span class="pill ${E?"buy":"sell"}">${E?"BUY":"SELL"}</span>
          <span class="row-title">${S.symbol}</span></div>
        <div class="row-side"><span class="row-sub">${S.quantity.toLocaleString("en-US",{maximumFractionDigits:4})} @ ${st(S.price)}</span>
          <span class="row-sub">${new Date(S.at).toLocaleDateString("en-GB")}</span></div>`,u.appendChild(M)}}async function m(){if(!c)return;const S=c.positions.map(F=>F.symbol),E=Ge(t);E&&S.push(E);const M=await Ks(t,S),q=c.positions.reduce((F,D)=>F+D.quantity*(M[D.symbol]??D.entryPrice),0),U=c.cash+q,N=c.initialCash>0?(U-c.initialCash)/c.initialCash*100:0;h("hv-equity",st(U));const O=e.querySelector("#hv-change");O.textContent=`${C(N)} all time`,O.className=`hero-change ${N>=0?"up":"down"}`,h("hv-cash",`Cash ${st(c.cash)}`),h("hv-invested",`Invested ${st(q)}`);const H=e.querySelector("#hv-bench");if(E&&c.benchmark&&M[E]&&c.benchmark.btc>0&&c.benchmark.equity>0){const F=(U-c.benchmark.equity)/c.benchmark.equity*100,D=(M[E]-c.benchmark.btc)/c.benchmark.btc*100;H.hidden=!1,H.textContent=`vs Bitcoin — robot ${C(F)} · BTC ${C(D)}${F>=D?" · leading":""}`}else H.hidden=!0;v(M);const Y=new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});h("home-status",`Live · updated ${Y}`)}async function g(){const S=await Kt();S?(c=S,f(),p(),await m()):c||h("home-status","Couldn't reach the cloud robot — retrying automatically.")}async function b(){y(await Xe(t,6))}let $=0,R=0,w=0;const x=()=>{$=window.setInterval(()=>void m(),ae),R=window.setInterval(()=>void g(),Xs),w=window.setInterval(()=>void b(),ae*4)};return f(),g(),b(),x(),{pause:()=>{window.clearInterval($),window.clearInterval(R),window.clearInterval(w)},resume:()=>{g(),b(),x()}}}const Js={BTC:"XBT",DOGE:"XDG"};function Qs(e,t){const s=e.instruments.find(i=>i.symbol===t);return s?`${Js[s.base.toUpperCase()]??s.base.toUpperCase()}/${s.quote.toUpperCase()}`:null}function Zs(e,t,s,n={}){const i=n.pollMs??3e3;let a=!1,o=null,r=0;const l=(c,h)=>{!a&&Number.isFinite(c)&&c>0&&s({price:c,at:h})},u=async()=>{if(!a)try{const c=await e.source.getCandles(t,"1m",2,{priority:!0});if(c.ok&&c.value.length>0){const h=c.value[c.value.length-1];l(h.close,h.timestamp)}}catch{}};u(),r=window.setInterval(()=>void u(),i);const d=/kraken/i.test(e.source.name);if(e.kind==="public"&&d&&typeof WebSocket<"u"){const c=Qs(e,t);if(c)try{o=new WebSocket("wss://ws.kraken.com"),o.addEventListener("open",()=>{try{o==null||o.send(JSON.stringify({event:"subscribe",pair:[c],subscription:{name:"ticker"}}))}catch{}}),o.addEventListener("message",h=>{try{const y=JSON.parse(String(h.data));if(Array.isArray(y)&&y[2]==="ticker"){const v=y[1],f=v==null?void 0:v.c;if(Array.isArray(f)&&f.length>0){const p=Number(f[0]);l(p,Date.now())}}}catch{}}),o.addEventListener("error",()=>{})}catch{o=null}}return function(){if(a=!0,window.clearInterval(r),o){try{o.close()}catch{}o=null}}}const tn=2e4,Tt=6e4,en=60,Rt="#16c784",Et="#ea3943",le=[{key:"1D",tf:"15m",limit:96,fx:e=>Qe(e)},{key:"1W",tf:"1h",limit:168,fx:e=>ce(e)},{key:"1M",tf:"4h",limit:180,fx:e=>ce(e)},{key:"1Y",tf:"1d",limit:365,fx:e=>nn(e),long:!0},{key:"5Y",tf:"1w",limit:260,fx:e=>Lt(e),long:!0},{key:"10Y",tf:"1w",limit:520,fx:e=>Lt(e),long:!0},{key:"All",tf:"1w",limit:720,fx:e=>Lt(e),long:!0}],sn=new Set(["1m","5m","15m","30m","1h","4h"]),Qe=e=>new Date(e).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}),ce=e=>new Date(e).toLocaleDateString("en-GB",{day:"2-digit",month:"2-digit"}),nn=e=>new Date(e).toLocaleDateString("en-GB",{month:"short"}),Lt=e=>String(new Date(e).getFullYear());function de(e,t){const s=new Date(e);return sn.has(t)?s.toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):s.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})}function an(e,t){e.innerHTML=`
    <div id="mk-list-view">
      <h2 class="view-title">Markets</h2>
      <p class="view-sub">Largest cryptocurrencies, live. Prices in EUR (€). Tap a coin for its chart.</p>
      <div class="stack" id="mk-list"><div class="empty">Loading markets…</div></div>
      <p class="muted-line" id="mk-status"></p>
    </div>
    <div id="mk-detail-view" hidden></div>`;const s=e.querySelector("#mk-list-view"),n=e.querySelector("#mk-detail-view"),i=e.querySelector("#mk-list"),a=e.querySelector("#mk-status");let o=[],r=0,l=0,u=null,d=null,c=0,h="1D",y="candle";const v=()=>{u&&(u(),u=null)};function f(){if(o.length===0){i.innerHTML='<div class="empty">Live market data is unavailable right now.</div>';return}i.innerHTML="",o.forEach(($,R)=>{const w=$.changePct>=0,x=document.createElement("button");x.className="market-row tappable",x.innerHTML=`
        <div class="market-row-id"><span class="row-title">${$.label}</span><span class="row-sub">${$.symbol}</span></div>
        <div class="market-row-spark" style="color:${w?Rt:Et}">${Ke($.closes,{stroke:w?Rt:Et,fill:!0,width:130,height:40})}</div>
        <div class="market-row-num"><span class="row-title">€${P($.price)}</span><span class="chg ${w?"up":"down"}">${C($.changePct)}</span></div>`,x.addEventListener("click",()=>g(R)),i.appendChild(x)}),a.textContent=`Live · updated ${Qe(Date.now())} · ~48h change`}let p=!1;async function m(){if(!p){p=!0;try{const $=await Xe(t,en);$.length>0&&(o=$),n.hidden&&f()}finally{p=!1}}}function g($,R={}){d=$,c++;const w=c;window.clearInterval(r),s.hidden=!0,n.hidden=!1;let x=$,S=R.preserveRange?h:"1D",E=R.preserveRange?y:"candle";h=S,y=E;let M=0;const q=new Map,U=async(O={})=>{var Y;const H=++M;v();try{const F=o[x],D=le.find(L=>L.key===S),tt=D.long?"line":E,z=`${x}:${S}:${tt}`;let at,ot,Q,X=null;if(tt==="candle"){let L=!O.force&&q.has(z)?q.get(z):await js(t,F.symbol,D.tf,D.limit);if(L?q.set(z,L):q.has(z)&&(L=q.get(z)),ot=(L==null?void 0:L.price)??F.price,Q=(L==null?void 0:L.changePct)??0,at=L?Je(L.candles,{formatX:D.fx,formatY:B=>`€${P(B)}`}):'<div class="empty">No history for this range yet.</div>',L){const B=L.candles,G=Yt(B);X=()=>N({geo:G,symbol:F.symbol,range:D,firstValue:B[0].close,valueAt:Z=>B[Z].close,tipHtml:Z=>{const _=B[Z];return`<span class="pchart-tip-price">€${P(_.close)}</span><span class="pchart-tip-ohlc">O €${P(_.open)} · H €${P(_.high)} · L €${P(_.low)} · C €${P(_.close)}</span><span class="pchart-tip-time">${de(_.timestamp,D.tf)}</span>`}})}}else{let L=!O.force&&q.has(z)?q.get(z):await Hs(t,F.symbol,D.tf,D.limit);L?q.set(z,L):q.has(z)&&(L=q.get(z)),ot=(L==null?void 0:L.price)??F.price,Q=(L==null?void 0:L.changePct)??0;const B=Q>=0;if(at=L?Ye(L.points,{stroke:B?Rt:Et,formatX:D.fx,formatY:G=>`€${P(G)}`}):'<div class="empty">No history for this range yet.</div>',L){const G=L.points,Z=yt(G);X=()=>N({geo:Z,symbol:F.symbol,range:D,firstValue:G[0].value,valueAt:_=>G[_].value,tipHtml:_=>{const rt=G[_];return`<span class="pchart-tip-price">€${P(rt.value)}</span><span class="pchart-tip-time">${de(rt.timestamp,D.tf)}</span>`}})}}if(H!==M||w!==c)return;const J=Q>=0,et=le.map(L=>`<button class="range-btn ${L.key===S?"active":""}" data-range="${L.key}">${L.key}</button>`).join("");n.innerHTML=`
        <button class="tool-back" id="mk-back">← All markets</button>
        <div class="detail-head">
          <div><div class="detail-name">${F.label}</div><div class="row-sub">${F.symbol} · EUR</div></div>
          <div class="detail-price"><div class="row-title big" id="mk-price">€${P(ot)}</div>
            <div class="chg ${J?"up":"down"}" id="mk-change">${C(Q)} · ${S}</div></div>
        </div>
        <div class="chart-controls">
          <div class="range-bar">${et}</div>
          <div class="chart-toggle">
            <button class="ctoggle-btn ${tt==="candle"?"active":""}" data-mode="candle" ${D.long?"disabled":""}>Candles</button>
            <button class="ctoggle-btn ${tt==="line"?"active":""}" data-mode="line" ${D.long?"disabled":""}>Line</button>
          </div>
        </div>
        <div class="detail-chart"><div class="pchart-wrap">${at}<div class="pchart-tip" hidden></div></div></div>
        <div class="detail-nav">
          <button class="pager" id="mk-prev" ${x===0?"disabled":""}>‹ Prev</button>
          <span class="row-sub">${x+1} / ${o.length}</span>
          <button class="pager" id="mk-next" ${x===o.length-1?"disabled":""}>Next ›</button>
        </div>`,n.querySelector("#mk-back").addEventListener("click",b),n.querySelector("#mk-prev").addEventListener("click",()=>{x>0&&(x--,S="1D",h=S,U())}),n.querySelector("#mk-next").addEventListener("click",()=>{x<o.length-1&&(x++,S="1D",h=S,U())}),n.querySelectorAll(".range-btn").forEach(L=>{L.addEventListener("click",()=>{S=L.dataset.range,h=S,U()})}),n.querySelectorAll(".ctoggle-btn").forEach(L=>{L.addEventListener("click",()=>{const B=L.dataset.mode;(B==="candle"||B==="line")&&(E=B,y=B,U())})}),X&&X()}catch{w===c&&H===M&&!n.querySelector("svg.pchart")&&(n.innerHTML='<button class="tool-back" id="mk-eb">← All markets</button><div class="empty">Chart unavailable — retrying…</div>',(Y=n.querySelector("#mk-eb"))==null||Y.addEventListener("click",b))}},N=O=>{const H=n.querySelector("svg.pchart"),Y=n.querySelector(".pchart-tip");if(!H||!Y)return;const F=O.geo,D=H.querySelector(".pchart-cross"),tt=H.querySelector(".pchart-cross-line"),z=H.querySelector(".pchart-cross-dot"),at=X=>{const J=H.getBoundingClientRect();if(J.width<=0)return;const et=F.indexAtFraction((X-J.left)/J.width),L=F.x(et),B=F.y(O.valueAt(et));tt&&(tt.setAttribute("x1",L.toFixed(1)),tt.setAttribute("x2",L.toFixed(1))),z&&(z.setAttribute("cx",L.toFixed(1)),z.setAttribute("cy",B.toFixed(1))),D==null||D.classList.add("show"),Y.hidden=!1,Y.innerHTML=O.tipHtml(et),Y.style.left=`${L/F.W*100}%`,Y.style.top=`${B/F.H*100}%`},ot=()=>{D==null||D.classList.remove("show"),Y.hidden=!0};H.addEventListener("pointermove",X=>at(X.clientX)),H.addEventListener("pointerdown",X=>at(X.clientX)),H.addEventListener("pointerleave",ot),H.addEventListener("pointercancel",ot);const Q=O.firstValue;u=Zs(t,O.symbol,X=>{const J=X.price,et=n.querySelector("#mk-price");et&&(et.textContent=`€${P(J)}`);const L=Q>0?(J-Q)/Q*100:0,B=n.querySelector("#mk-change");B&&(B.className=`chg ${L>=0?"up":"down"}`,B.textContent=`${C(L)} · ${O.range.key}`);const G=Math.max(F.padT,Math.min(F.H-F.padB,F.y(J))),Z=H.querySelector(".pchart-now"),_=H.querySelector(".pchart-now-line"),rt=H.querySelector(".pchart-now-tag"),te=H.querySelector(".pchart-now-text");Z==null||Z.setAttribute("cy",G.toFixed(1)),_==null||_.setAttribute("y1",G.toFixed(1)),_==null||_.setAttribute("y2",G.toFixed(1)),rt==null||rt.setAttribute("transform",`translate(${(F.W-F.padR+1).toFixed(1)}, ${G.toFixed(1)})`),te&&(te.textContent=`€${P(J)}`)})};U(),window.clearInterval(l),l=window.setInterval(()=>{const O=n.querySelector(".pchart-tip");O&&!O.hidden||U({force:!0})},tn)}function b(){d=null,c++,window.clearInterval(l),v(),n.hidden=!0,s.hidden=!1,f(),r=window.setInterval(()=>void m(),Tt)}return m(),r=window.setInterval(()=>void m(),Tt),{pause:()=>{window.clearInterval(r),window.clearInterval(l),v()},resume:()=>{d!==null?g(d,{preserveRange:!0}):(m(),r=window.setInterval(()=>void m(),Tt))}}}const on=e=>`€${P(e)}`;function rn(e,t){e.innerHTML=`
    <h2 class="view-title">History</h2>
    <p class="view-sub">Every simulated buy and sell, newest first.</p>
    <div class="stack" id="history-list"><div class="empty">Loading…</div></div>`;const s=e.querySelector("#history-list");async function n(){const a=await Kt();if(!a){s.innerHTML=`<div class="empty">Couldn't reach the cloud robot — retrying automatically.</div>`;return}if(a.history.length===0){s.innerHTML='<div class="empty">No trades yet — the robot is waiting for a qualified opportunity.</div>';return}s.innerHTML="";for(const o of a.history){const r=o.kind==="buy",l=document.createElement("div");l.className=`row trade ${o.kind}`,l.innerHTML=`
        <div class="row-main"><span class="pill ${r?"buy":"sell"}">${r?"BUY":"SELL"}</span>
          <div><div class="row-title">${o.symbol}</div>
            <div class="row-sub">${o.note?o.note:r?"opened":"closed"}</div></div></div>
        <div class="row-side"><span class="row-title">${on(o.price)}</span>
          <span class="row-sub">${o.quantity.toLocaleString("en-US",{maximumFractionDigits:4})} units</span>
          <span class="row-sub">${new Date(o.at).toLocaleString("en-GB",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</span></div>`,s.appendChild(l)}}let i=0;return n(),i=window.setInterval(()=>void n(),6e4),{pause:()=>window.clearInterval(i),resume:()=>{n(),i=window.setInterval(()=>void n(),6e4)}}}const ln="#16c784",cn="#ea3943",ue=6e4,nt=864e5,he=36e5,Ct=[{key:"1D",ms:nt,bucketMs:he,fx:e=>dn(e)},{key:"1W",ms:7*nt,bucketMs:4*he,fx:e=>At(e)},{key:"1M",ms:30*nt,bucketMs:nt,fx:e=>At(e)},{key:"1Y",ms:365*nt,bucketMs:7*nt,fx:e=>un(e)},{key:"All",ms:0,bucketMs:7*nt,fx:e=>At(e)}],dn=e=>new Date(e).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}),At=e=>new Date(e).toLocaleDateString("en-GB",{day:"2-digit",month:"2-digit"}),un=e=>new Date(e).toLocaleDateString("en-GB",{month:"short",year:"2-digit"}),hn=30,pn=5*6e4;function mn(e,t){return e<=0?t:Math.max(pn,Math.min(t,e/hn))}function fn(e,t){const s=new Map;for(const n of e){const i=Math.floor(n.at/t)*t,a=s.get(i);a?s.set(i,{...a,high:Math.max(a.high,n.equity),low:Math.min(a.low,n.equity),close:n.equity}):s.set(i,{timestamp:i,open:n.equity,high:n.equity,low:n.equity,close:n.equity,volume:0})}return[...s.values()].sort((n,i)=>n.timestamp-i.timestamp)}function yn(e,t){e.innerHTML=`
    <button class="tool-back" data-nav="home">← Home</button>
    <h2 class="view-title">Portfolio value</h2>
    <p class="view-sub">Simulated portfolio value over time.</p>
    <div id="pv-body"><div class="empty">Loading…</div></div>`;const s=e.querySelector("#pv-body");let n=[],i="All",a="candle";function o(){const c=Ct.find(v=>v.key===i),h=n[n.length-1].at;let y=c.ms>0?n.filter(v=>v.at>=h-c.ms):n.slice();return y.length<2&&(y=n.slice()),y}function r(){if(n.length<2){s.innerHTML='<div class="empty">Collecting data — the value chart appears after a few cloud runs. Check back soon.</div>';return}const c=Ct.find(x=>x.key===i),h=o(),y=h[0].equity,v=h[h.length-1].equity,f=y>0?(v-y)/y*100:0,p=f>=0,m=h[h.length-1].at-h[0].at,g=fn(h,mn(m,c.bucketMs)),b=g.length>=2?a:"line";let $,R=null;if(b==="candle")$=Je(g,{formatX:c.fx,formatY:x=>`€${P(x)}`}),R=Yt(g);else{const x=h.map(S=>({timestamp:S.at,value:S.equity}));$=Ye(x,{stroke:p?ln:cn,formatX:c.fx,formatY:S=>`€${P(S)}`}),R=yt(x)}const w=Ct.map(x=>`<button class="range-btn ${x.key===i?"active":""}" data-range="${x.key}">${x.key}</button>`).join("");s.innerHTML=`
      <div class="hero">
        <div class="hero-label">Now <span class="tag-sim">SIMULATED</span></div>
        <div class="hero-value">€${P(v)}</div>
        <div class="hero-change ${p?"up":"down"}">${C(f)} · ${i}</div>
        <div class="hero-split"><span>since ${new Date(h[0].at).toLocaleDateString("en-GB")}</span></div>
      </div>
      <div class="chart-controls">
        <div class="range-bar">${w}</div>
        <div class="chart-toggle">
          <button class="ctoggle-btn ${b==="candle"?"active":""}" data-mode="candle">Candles</button>
          <button class="ctoggle-btn ${b==="line"?"active":""}" data-mode="line">Line</button>
        </div>
      </div>
      <div class="detail-chart"><div class="pchart-wrap">${$}<div class="pchart-tip" hidden></div></div></div>`,s.querySelectorAll(".range-btn").forEach(x=>{x.addEventListener("click",()=>{i=x.dataset.range,r()})}),s.querySelectorAll(".ctoggle-btn").forEach(x=>{x.addEventListener("click",()=>{const S=x.dataset.mode;(S==="candle"||S==="line")&&(a=S,r())})}),l(R,b,g)}function l(c,h,y,v){const f=s.querySelector("svg.pchart"),p=s.querySelector(".pchart-tip");if(!f||!p)return;const m=f.querySelector(".pchart-cross"),g=f.querySelector(".pchart-cross-line"),b=f.querySelector(".pchart-cross-dot"),$=w=>{const x=f.getBoundingClientRect();if(x.width<=0)return;const S=c.indexAtFraction((w-x.left)/x.width),E=y[S],M=c.x(S),q=c.y(E.close);g==null||g.setAttribute("x1",M.toFixed(1)),g==null||g.setAttribute("x2",M.toFixed(1)),b==null||b.setAttribute("cx",M.toFixed(1)),b==null||b.setAttribute("cy",q.toFixed(1)),m==null||m.classList.add("show"),p.hidden=!1;const U=new Date(E.timestamp).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});p.innerHTML=h==="candle"?`<span class="pchart-tip-price">€${P(E.close)}</span><span class="pchart-tip-ohlc">O €${P(E.open)} · H €${P(E.high)} · L €${P(E.low)} · C €${P(E.close)}</span><span class="pchart-tip-time">${U}</span>`:`<span class="pchart-tip-price">€${P(E.close)}</span><span class="pchart-tip-time">${U}</span>`,p.style.left=`${M/c.W*100}%`,p.style.top=`${q/c.H*100}%`},R=()=>{m==null||m.classList.remove("show"),p.hidden=!0};f.addEventListener("pointermove",w=>$(w.clientX)),f.addEventListener("pointerdown",w=>$(w.clientX)),f.addEventListener("pointerleave",R),f.addEventListener("pointercancel",R)}async function u(){const c=await Kt();if(!c){n.length===0&&(s.innerHTML=`<div class="empty">Couldn't reach the cloud robot — retrying.</div>`);return}n=c.equityHistory,r()}let d=0;return u(),d=window.setInterval(()=>void u(),ue),{pause:()=>window.clearInterval(d),resume:()=>{u(),d=window.setInterval(()=>void u(),ue)}}}function Ze(e){let t=-1/0,s=0;for(const n of e)if(t=Math.max(t,n.equity),t>0){const i=(t-n.equity)/t*100;s=Math.max(s,i)}return s}function gn(e){const t=e.filter(i=>i.pnl>0).length,s=e.filter(i=>i.pnl<0).length,n=e.reduce((i,a)=>i+a.pnl,0);return{tradeCount:e.length,winCount:t,lossCount:s,winRatePct:e.length===0?null:t/e.length*100,totalPnl:n}}function gt(e,t,s){if(e.length===0)throw new RangeError("cannot backtest an empty candle series");if(!(s.initialCash>0))throw new RangeError(`initialCash must be > 0, got ${s.initialCash}`);const n=s.feeRate??0;if(n<0||n>=1)throw new RangeError(`feeRate must be in [0, 1), got ${n}`);const i=s.spreadPct??0;if(i<0||i>=1)throw new RangeError(`spreadPct must be in [0, 1), got ${i}`);const a=s.slippagePct??0;if(a<0||a>=.5)throw new RangeError(`slippagePct must be in [0, 0.5), got ${a}`);const o=s.executionDelayCandles??0;if(!Number.isInteger(o)||o<0)throw new RangeError(`executionDelayCandles must be a non-negative integer, got ${o}`);const r=i/2+a,l=new Map;for(const m of t.generateOrders(e)){if(!Number.isInteger(m.index)||m.index<0||m.index>=e.length)throw new RangeError(`strategy '${t.name}' emitted invalid order index ${m.index}`);const g=Math.min(m.index+o,e.length-1),b=l.get(g)??[];b.push(m),l.set(g,b)}let u=s.initialCash,d=0,c=0,h=0,y=0;const v=[],f=[];for(let m=0;m<e.length;m++){const g=e[m],b=g.close;for(const $ of l.get(m)??[])if($.side==="buy"){const R=b*(1+r),w=Math.min($.amountQuote??u,u);if(w<=0||R<=0)continue;const x=w*n,S=(w-x)/R;d===0&&(y=g.timestamp),c=(c*d+R*S)/(d+S),d+=S,u-=w,h+=x}else{const R=$.fractionOfPosition??1;if(R<=0||d===0)continue;const w=b*(1-r),x=d*Math.min(R,1),S=x*w,E=S*n;u+=S-E,h+=E,v.push({entryTimestamp:y,exitTimestamp:g.timestamp,entryPrice:c,exitPrice:w,quantity:x,pnl:(w-c)*x-E}),d-=x,d<1e-12&&(d=0,c=0)}f.push({timestamp:g.timestamp,equity:u+d*b})}const p=f[f.length-1].equity;return{strategyName:t.name,initialCash:s.initialCash,finalEquity:p,totalReturnPct:vn(s.initialCash,p),maxDrawdownPct:Ze(f),feesPaid:h,equityCurve:f,closedTrades:v,stats:gn(v)}}function vn(e,t){return(t-e)/e*100}function bn(e,t,s){return t.map(n=>gt(e,n,s))}function $n(){return{name:"Buy & Hold",generateOrders(e){return e.length<2?[]:[{index:0,side:"buy"},{index:e.length-1,side:"sell"}]}}}function wn(e){const{intervalCandles:t,amountPerPurchase:s}=e;if(!Number.isInteger(t)||t<1)throw new RangeError(`intervalCandles must be a positive integer, got ${t}`);if(!(s>0))throw new RangeError(`amountPerPurchase must be > 0, got ${s}`);return{name:`DCA (every ${t}, ${s}/buy)`,generateOrders(n){if(n.length<2)return[];const i=[];for(let a=0;a<n.length-1;a+=t)i.push({index:a,side:"buy",amountQuote:s});return i.push({index:n.length-1,side:"sell"}),i}}}function vt(e,t){K(t,e.length);const s=new Array(e.length).fill(null);let n=0;for(let i=0;i<e.length;i++)n+=e[i],i>=t&&(n-=e[i-t]),i>=t-1&&(s[i]=n/t);return s}function K(e,t){if(!Number.isInteger(e)||e<1)throw new RangeError(`period must be a positive integer, got ${e}`);if(t<0)throw new RangeError("input length cannot be negative")}function pt(e,t){K(t,e.length);const s=new Array(e.length).fill(null);if(e.length<t)return s;const n=2/(t+1);let i=0;for(let o=0;o<t;o++)i+=e[o];let a=i/t;s[t-1]=a;for(let o=t;o<e.length;o++)a=e[o]*n+a*(1-n),s[o]=a;return s}function Pn(e,t=14){K(t,e.length);const s=new Array(e.length).fill(null);if(e.length<=t)return s;let n=0,i=0;for(let r=1;r<=t;r++){const l=e[r]-e[r-1];l>0?n+=l:i-=l}let a=n/t,o=i/t;s[t]=pe(a,o);for(let r=t+1;r<e.length;r++){const l=e[r]-e[r-1],u=l>0?l:0,d=l<0?-l:0;a=(a*(t-1)+u)/t,o=(o*(t-1)+d)/t,s[r]=pe(a,o)}return s}function pe(e,t){return t===0?e===0?50:100:100-100/(1+e/t)}function xn(e,t=12,s=26,n=9){if(K(t,e.length),K(s,e.length),K(n,e.length),t>=s)throw new RangeError(`fastPeriod (${t}) must be < slowPeriod (${s})`);const i=pt(e,t),a=pt(e,s),o=e.map((d,c)=>{const h=i[c],y=a[c];return h!=null&&y!==null&&y!==void 0?h-y:null}),r=o.findIndex(d=>d!==null),l=new Array(e.length).fill(null);if(r!==-1){const d=o.slice(r),c=pt(d,n);for(let h=0;h<c.length;h++)l[r+h]=c[h]??null}const u=o.map((d,c)=>{const h=l[c];return d!==null&&h!==null&&h!==void 0?d-h:null});return{macd:o,signal:l,histogram:u}}function Sn(e,t=20,s=2){if(K(t,e.length),!(s>0))throw new RangeError(`multiplier must be > 0, got ${s}`);const n=vt(e,t),i=new Array(e.length).fill(null),a=new Array(e.length).fill(null),o=new Array(e.length).fill(null),r=new Array(e.length).fill(null);for(let l=t-1;l<e.length;l++){const u=n[l];if(u==null)continue;let d=0;for(let v=l-t+1;v<=l;v++){const f=e[v]-u;d+=f*f}const c=Math.sqrt(d/t),h=u+s*c,y=u-s*c;i[l]=h,a[l]=y,o[l]=u!==0?(h-y)/u:null,r[l]=h!==y?(e[l]-y)/(h-y):.5}return{middle:n,upper:i,lower:a,bandwidth:o,percentB:r}}function ts(e){return e.map((t,s)=>{if(s===0)return t.high-t.low;const n=e[s-1].close;return Math.max(t.high-t.low,Math.abs(t.high-n),Math.abs(t.low-n))})}function kn(e,t=14){K(t,e.length);const s=new Array(e.length).fill(null);if(e.length<t)return s;const n=ts(e);let i=0;for(let o=0;o<t;o++)i+=n[o];let a=i/t;s[t-1]=a;for(let o=t;o<e.length;o++)a=(a*(t-1)+n[o])/t,s[o]=a;return s}function Tn(e,t=14){K(t,e.length);const s=e.length,n=new Array(s).fill(null),i=new Array(s).fill(null),a=new Array(s).fill(null);if(s<=t)return{plusDi:n,minusDi:i,adx:a};const o=ts(e),r=new Array(s).fill(0),l=new Array(s).fill(0);for(let p=1;p<s;p++){const m=e[p].high-e[p-1].high,g=e[p-1].low-e[p].low;m>g&&m>0&&(r[p]=m),g>m&&g>0&&(l[p]=g)}let u=0,d=0,c=0;for(let p=1;p<=t;p++)u+=o[p],d+=r[p],c+=l[p];const h=new Array(s).fill(null);for(let p=t;p<s;p++){p>t&&(u=u-u/t+o[p],d=d-d/t+r[p],c=c-c/t+l[p]);const m=u===0?0:100*d/u,g=u===0?0:100*c/u;n[p]=m,i[p]=g;const b=m+g;h[p]=b===0?0:100*Math.abs(m-g)/b}const y=2*t-1;if(s<=y)return{plusDi:n,minusDi:i,adx:a};let v=0;for(let p=t;p<=y;p++)v+=h[p];let f=v/t;a[y]=f;for(let p=y+1;p<s;p++)f=(f*(t-1)+h[p])/t,a[p]=f;return{plusDi:n,minusDi:i,adx:a}}function Rn(e,t=14,s=3){K(t,e.length),K(s,e.length);const n=e.length,i=new Array(n).fill(null);for(let r=t-1;r<n;r++){let l=-1/0,u=1/0;for(let c=r-t+1;c<=r;c++)l=Math.max(l,e[c].high),u=Math.min(u,e[c].low);const d=l-u;i[r]=d===0?50:100*(e[r].close-u)/d}const a=new Array(n).fill(null),o=i.findIndex(r=>r!==null);if(o!==-1){const r=i.slice(o),l=vt(r,s);for(let u=0;u<l.length;u++)a[o+u]=l[u]??null}return{k:i,d:a}}function En(e,t=20){return vt(e.map(s=>s.volume),t)}function Ln(e,t=20){K(t,e.length);const s=En(e,t);return e.map((n,i)=>{const a=s[i];return a==null||a===0?null:n.volume/a})}function W(e){for(let t=e.length-1;t>=0;t--){const s=e[t];if(s!=null)return s}return null}function _t(e={fastPeriod:10,slowPeriod:30}){const{fastPeriod:t,slowPeriod:s}=e;if(t>=s)throw new RangeError(`fastPeriod (${t}) must be < slowPeriod (${s})`);return{name:`Trend (SMA ${t}/${s})`,generateOrders(n){const i=n.map(u=>u.close),a=vt(i,t),o=vt(i,s),r=[];let l=!1;for(let u=1;u<n.length;u++){const d=a[u],c=o[u],h=a[u-1],y=o[u-1];if(d==null||c==null||h==null||y==null)continue;const v=h<=y&&d>c,f=h>=y&&d<c;v&&!l?(r.push({index:u,side:"buy"}),l=!0):f&&l&&(r.push({index:u,side:"sell"}),l=!1)}return l&&n.length>0&&r.push({index:n.length-1,side:"sell"}),r}}}function Cn(e,t,s){if(!(e>0)||!(t>e))throw new RangeError(`invalid grid bounds: [${e}, ${t}]`);if(!Number.isInteger(s)||s<2)throw new RangeError(`levels must be an integer >= 2, got ${s}`);const n=(t-e)/(s-1);return Array.from({length:s},(i,a)=>e+a*n)}function An(e){const{lowerBound:t,upperBound:s,levels:n,amountPerLevel:i}=e,a=Cn(t,s,n);if(!(i>0))throw new RangeError(`amountPerLevel must be > 0, got ${i}`);return{name:`Grid (${n} levels ${t}-${s})`,generateOrders(o){if(o.length<2)return[];const r=new Array(a.length).fill(!1),l=[];let u=!1;for(let d=1;d<o.length;d++){const c=o[d-1].close,h=o[d].close;for(let y=0;y<a.length;y++){const v=a[y];!r[y]&&c>v&&h<=v&&(l.push({index:d,side:"buy",amountQuote:i}),r[y]=!0,u=!0)}for(let y=a.length-2;y>=0;y--){const v=a[y+1];if(r[y]&&c<v&&h>=v){const f=r.filter(Boolean).length;l.push({index:d,side:"sell",fractionOfPosition:1/f}),r[y]=!1}}}return u&&r.some(Boolean)&&l.push({index:o.length-1,side:"sell"}),l}}}const Mn=["1h","4h","1d"],me=300;function qn(e,t){e.innerHTML=`
    <h2>Backtesting Lab</h2>
    <p class="status-line">
      Compare strategies over the same history, fees included, liquidation at the end.
      Past performance never guarantees future results.
    </p>
    <div class="controls">
      <label class="control">Market
        <select id="bt-symbol">
          ${t.instruments.map(a=>`<option value="${k(a.symbol)}">${k(a.symbol)}</option>`).join("")}
        </select>
      </label>
      <label class="control">Timeframe
        <select id="bt-timeframe">
          ${Mn.map(a=>`<option value="${a}" ${a==="1d"?"selected":""}>${a}</option>`).join("")}
        </select>
      </label>
      <label class="control">Initial cash
        <input id="bt-cash" type="number" value="10000" min="100" step="100" />
      </label>
      <label class="control">Fee %
        <input id="bt-fee" type="number" value="0.1" min="0" max="5" step="0.05" />
      </label>
      <div class="control-checkboxes">
        <label><input type="checkbox" id="bt-hold" checked /> Buy &amp; Hold</label>
        <label><input type="checkbox" id="bt-dca" checked /> DCA</label>
        <label><input type="checkbox" id="bt-trend" checked /> Trend (SMA 10/30)</label>
      </div>
      <button class="primary" id="bt-run">Run backtest</button>
    </div>
    <div class="status-line" id="bt-status"></div>
    <div id="bt-results"></div>
  `;const s=e.querySelector("#bt-run"),n=e.querySelector("#bt-status"),i=e.querySelector("#bt-results");s.addEventListener("click",async()=>{s.disabled=!0,i.innerHTML="";const a=e.querySelector("#bt-symbol").value,o=e.querySelector("#bt-timeframe").value,r=Number(e.querySelector("#bt-cash").value),l=Number(e.querySelector("#bt-fee").value)/100;n.textContent=`Loading ${me} ${o} candles for ${a}…`;try{const u=await t.source.getCandles(a,o,me);if(!u.ok){n.innerHTML=`<span class="error-line">${k(u.error)}</span>`;return}const d=[];if(e.querySelector("#bt-hold").checked&&d.push($n()),e.querySelector("#bt-dca").checked&&d.push(wn({intervalCandles:Math.max(1,Math.floor(u.value.length/20)),amountPerPurchase:r/20})),e.querySelector("#bt-trend").checked&&d.push(_t({fastPeriod:10,slowPeriod:30})),d.length===0){n.innerHTML='<span class="error-line">Select at least one strategy.</span>';return}const c=bn(u.value,d,{initialCash:r,feeRate:l});n.textContent=`${a} · ${u.value.length} candles (${o}) · source: ${t.source.name}`,Fn(i,c)}catch(u){n.innerHTML=`<span class="error-line">Backtest failed: ${k(String(u))}</span>`}finally{s.disabled=!1}})}function Fn(e,t){const s=document.createElement("table");s.className="data-table",s.innerHTML=`
    <thead>
      <tr>
        <th>Strategy</th>
        <th>Final equity</th>
        <th>Return</th>
        <th>Max drawdown</th>
        <th>Trades</th>
        <th>Win rate</th>
        <th>Fees paid</th>
      </tr>
    </thead>
    <tbody>
      ${t.map(n=>`
        <tr>
          <td>${k(n.strategyName)}</td>
          <td>${P(n.finalEquity)}</td>
          <td class="${I(n.totalReturnPct)}">${C(n.totalReturnPct)}</td>
          <td>${C(-n.maxDrawdownPct)}</td>
          <td>${n.stats.tradeCount}</td>
          <td>${n.stats.winRatePct===null?"—":C(n.stats.winRatePct,0)}</td>
          <td>${P(n.feesPaid)}</td>
        </tr>`).join("")}
    </tbody>
  `,e.appendChild(s)}const Dn=300;function In(e,t){e.innerHTML=`
    <h2>Grid Simulation</h2>
    <p class="status-line">
      Buys fixed amounts as price falls through grid levels and sells them as it
      recovers. Works in ranges; loses in sustained downtrends — the simulation
      shows both honestly.
    </p>
    <div class="controls">
      <label class="control">Market
        <select id="grid-symbol">
          ${t.instruments.map(a=>`<option value="${k(a.symbol)}">${k(a.symbol)}</option>`).join("")}
        </select>
      </label>
      <label class="control">Timeframe
        <select id="grid-timeframe">
          <option value="1h" selected>1h</option>
          <option value="4h">4h</option>
          <option value="1d">1d</option>
        </select>
      </label>
      <label class="control">Levels
        <input id="grid-levels" type="number" value="8" min="2" max="50" step="1" />
      </label>
      <label class="control">Amount per level
        <input id="grid-amount" type="number" value="1000" min="10" step="10" />
      </label>
      <label class="control">Initial cash
        <input id="grid-cash" type="number" value="10000" min="100" step="100" />
      </label>
      <button class="primary" id="grid-run">Simulate</button>
    </div>
    <div class="status-line" id="grid-status"></div>
    <div id="grid-results"></div>
  `;const s=e.querySelector("#grid-run"),n=e.querySelector("#grid-status"),i=e.querySelector("#grid-results");s.addEventListener("click",async()=>{s.disabled=!0,i.innerHTML="";const a=e.querySelector("#grid-symbol").value,o=e.querySelector("#grid-timeframe").value,r=Number(e.querySelector("#grid-levels").value),l=Number(e.querySelector("#grid-amount").value),u=Number(e.querySelector("#grid-cash").value);n.textContent=`Loading ${a} history…`;try{const d=await t.source.getCandles(a,o,Dn);if(!d.ok){n.innerHTML=`<span class="error-line">${k(d.error)}</span>`;return}const c=d.value.map(m=>m.low),h=d.value.map(m=>m.high),y=Math.min(...c),v=Math.max(...h),f=An({lowerBound:y,upperBound:v,levels:r,amountPerLevel:l}),p=gt(d.value,f,{initialCash:u});n.textContent=`${a} · grid ${P(y)} – ${P(v)} · ${d.value.length} candles (${o}) · source: ${t.source.name}`,i.innerHTML=`
        <div class="result-cards">
          <div class="stat-card"><div class="stat-label">Final equity</div>
            <div class="stat-value">${P(p.finalEquity)}</div></div>
          <div class="stat-card"><div class="stat-label">Return</div>
            <div class="stat-value ${I(p.totalReturnPct)}">${C(p.totalReturnPct)}</div></div>
          <div class="stat-card"><div class="stat-label">Max drawdown</div>
            <div class="stat-value">${C(-p.maxDrawdownPct)}</div></div>
          <div class="stat-card"><div class="stat-label">Closed trades</div>
            <div class="stat-value">${p.stats.tradeCount}</div></div>
          <div class="stat-card"><div class="stat-label">Win rate</div>
            <div class="stat-value">${p.stats.winRatePct===null?"—":C(p.stats.winRatePct,0)}</div></div>
        </div>
      `}catch(d){n.innerHTML=`<span class="error-line">Simulation failed: ${k(String(d))}</span>`}finally{s.disabled=!1}})}class wt{constructor(t="ata:"){this.prefix=t}prefixed(t){return this.prefix+t}get(t){const s=window.localStorage.getItem(this.prefixed(t));if(s!==null)try{return JSON.parse(s)}catch{window.localStorage.removeItem(this.prefixed(t));return}}set(t,s){window.localStorage.setItem(this.prefixed(t),JSON.stringify(s))}remove(t){window.localStorage.removeItem(this.prefixed(t))}keys(){const t=[];for(let s=0;s<window.localStorage.length;s++){const n=window.localStorage.key(s);n!==null&&n.startsWith(this.prefix)&&t.push(n.slice(this.prefix.length))}return t}}const fe="paper-portfolio";class Jt{constructor(t,s=1e4){A(this,"state");if(this.store=t,!(s>0))throw new RangeError(`initialCash must be > 0, got ${s}`);const n=t.get(fe);this.state=n??{cash:s,positions:{},trades:[],realizedPnl:0}}get cash(){return this.state.cash}get realizedPnl(){return this.state.realizedPnl}get trades(){return this.state.trades}positions(){return Object.entries(this.state.positions).map(([t,s])=>({symbol:t,quantity:s.quantity,avgCost:s.avgCost}))}buy(t,s,n,i){const a=ye(t,s,n);if(a)return T(a);const o=s*n;if(o>this.state.cash+1e-9)return T(`insufficient cash: need ${o.toFixed(2)}, have ${this.state.cash.toFixed(2)}`);const r=this.state.positions[t]??{quantity:0,avgCost:0},l=r.quantity+s;this.state.positions[t]={quantity:l,avgCost:(r.avgCost*r.quantity+o)/l},this.state.cash-=o;const u={timestamp:i,symbol:t,side:"buy",quantity:s,price:n,realizedPnl:0};return this.state.trades.push(u),this.persist(),j(u)}sell(t,s,n,i){const a=ye(t,s,n);if(a)return T(a);const o=this.state.positions[t];if(!o||o.quantity+1e-12<s)return T(`insufficient position in ${t}: have ${(o==null?void 0:o.quantity)??0}, want to sell ${s}`);const r=(n-o.avgCost)*s,l=o.quantity-s;l<1e-12?delete this.state.positions[t]:this.state.positions[t]={quantity:l,avgCost:o.avgCost},this.state.cash+=s*n,this.state.realizedPnl+=r;const u={timestamp:i,symbol:t,side:"sell",quantity:s,price:n,realizedPnl:r};return this.state.trades.push(u),this.persist(),j(u)}equity(t){let s=this.state.cash;for(const[n,i]of Object.entries(this.state.positions)){const a=t[n]??i.avgCost;s+=i.quantity*a}return s}unrealizedPnl(t){let s=0;for(const[n,i]of Object.entries(this.state.positions)){const a=t[n]??i.avgCost;s+=(a-i.avgCost)*i.quantity}return s}reset(t){if(!(t>0))throw new RangeError(`initialCash must be > 0, got ${t}`);this.state={cash:t,positions:{},trades:[],realizedPnl:0},this.persist()}persist(){this.store.set(fe,this.state)}}function ye(e,t,s){return e.trim()===""?"symbol must not be empty":!(t>0)||!Number.isFinite(t)?`quantity must be > 0, got ${t}`:!(s>0)||!Number.isFinite(s)?`price must be > 0, got ${s}`:null}const ge="daily-loss";function Un(e){return new Date(e).toISOString().slice(0,10)}class mt{constructor(t){this.store=t}stateFor(t){const s=this.store.get(ge),n=Un(t);return s===void 0||s.day!==n?{day:n,loss:0}:s}record(t,s){if(!Number.isFinite(t)||t>=0)return;const n=this.stateFor(s);this.store.set(ge,{day:n.day,loss:n.loss+-t})}lossToday(t){return this.stateFor(t).loss}isPaused(t,s,n){if(!(s>0))return!1;const i=s*(n.dailyLossLimitPct/100);return this.lossToday(t)>=i}}const Qt={maxRiskPerTradePct:1,maxPositionPct:20,maxTotalExposurePct:60,maxOpenPositions:5,maxExposurePerAssetPct:20,dailyLossLimitPct:3,minRewardRisk:1.5,maxRewardRisk:20,minStopDistancePct:.25};function Nn(e){const t=e.limits??Qt,{accountEquity:s,entry:n,stopLoss:i,currentExposure:a}=e;if(!(s>0))return T(`accountEquity must be > 0, got ${s}`);if(!(e.riskPerTradePct>0))return T(`riskPerTradePct must be > 0, got ${e.riskPerTradePct}`);if(!(n>0))return T(`entry must be > 0, got ${n}`);if(!(i>0)||i>=n)return T(`stopLoss must be positive and below entry (entry ${n}, stop ${i})`);if(!(a>=0))return T(`currentExposure must be >= 0, got ${a}`);const o=[];let r=e.riskPerTradePct;r>t.maxRiskPerTradePct&&(r=t.maxRiskPerTradePct,o.push(`requested risk ${e.riskPerTradePct}% clamped to the ${t.maxRiskPerTradePct}% per-trade risk ceiling`));const l=n-i;let u=s*(r/100)/l,d=u*n;const c=s*(t.maxPositionPct/100);d>c&&(u=c/n,d=c,o.push(`size capped by the ${t.maxPositionPct}% single-position limit`));const h=s*(t.maxTotalExposurePct/100)-a;if(d>h){if(h<=0)return T(`no exposure headroom: ${a.toFixed(2)} already deployed of the ${t.maxTotalExposurePct}% total-exposure limit`);u=h/n,d=h,o.push(`size capped by the ${t.maxTotalExposurePct}% total-exposure limit`)}const y=u*l;return j({quantity:u,positionValue:d,maxLoss:y,riskPctUsed:y/s*100,constraintsApplied:o})}const Mt=e=>e.quantity*e.entryPrice;function Pt(e,t,s={}){const n=s.limits??Qt,{entry:i,stopLoss:a,takeProfit:o}=e.levels,r=[],l=[],u=t.openPositions.reduce((N,O)=>N+Mt(O),0),d=t.equity>0?u/t.equity*100:0,c=()=>({approved:!1,asset:e.symbol,entry:i,stopLoss:a,takeProfit:o,positionSize:0,positionValue:0,riskAmount:0,riskPercentage:0,rewardRiskRatio:f,portfolioExposure:d,reasons:r,warnings:l});t.equity>0||r.push(`portfolio equity must be positive, got ${t.equity}`);const h=s.dailyLossSoFar??0,y=t.equity*(n.dailyLossLimitPct/100);h>=y&&y>0&&r.push(`daily loss limit reached: ${h.toFixed(2)} lost today of the ${y.toFixed(2)} (${n.dailyLossLimitPct}% of equity) allowance — no new trades until the next trading day`);const v=i>0?(i-a)/i*100:0;let f=0;!(a>0)||a>=i?r.push(`invalid stop: stop loss ${a} must be positive and below entry ${i}`):(f=(o-i)/(i-a),v<n.minStopDistancePct&&r.push(`stop too close to entry: ${v.toFixed(2)}% distance is below the ${n.minStopDistancePct}% minimum — it would be triggered by normal noise`),f<n.minRewardRisk?r.push(`reward/risk ${f.toFixed(2)} is below the required minimum of ${n.minRewardRisk}`):f>n.maxRewardRisk&&r.push(`unrealistic target: reward/risk ${f.toFixed(1)} exceeds the plausible maximum of ${n.maxRewardRisk}`)),o>i||r.push(`take profit ${o} must be above entry ${i} for a long position`),t.openPositions.length>=n.maxOpenPositions&&r.push(`maximum open positions reached (${t.openPositions.length}/${n.maxOpenPositions})`);const p=t.openPositions.filter(N=>N.symbol===e.symbol).reduce((N,O)=>N+Mt(O),0),g=t.equity*(n.maxExposurePerAssetPct/100)-p;p>0&&g<=0&&r.push(`${e.symbol} already uses ${(p/t.equity*100).toFixed(1)}% of equity — at or above the ${n.maxExposurePerAssetPct}% per-asset cap`);const b=n.correlationThreshold!==void 0&&n.maxCorrelatedExposurePct!==void 0&&s.correlationTo!==void 0,$=b?t.openPositions.filter(N=>N.symbol!==e.symbol&&s.correlationTo(N.symbol)>=n.correlationThreshold).reduce((N,O)=>N+Mt(O),0):0,w=(b?t.equity*(n.maxCorrelatedExposurePct/100):0)-$;if(b&&$>0&&w<=0&&r.push(`${e.symbol}'s correlated cluster already uses ${($/t.equity*100).toFixed(1)}% of equity — at or above the ${n.maxCorrelatedExposurePct}% correlated-cluster cap`),r.length>0)return c();const x=Nn({accountEquity:t.equity,riskPerTradePct:s.riskPerTradePct??n.maxRiskPerTradePct,entry:i,stopLoss:a,currentExposure:u,limits:n});if(!x.ok)return r.push(x.error),c();let{quantity:S,positionValue:E,maxLoss:M,riskPctUsed:q,constraintsApplied:U}=x.value;return p>0&&E>g&&(S=g/i,E=g,M=S*(i-a),q=M/t.equity*100,U=[...U,`size capped by the ${n.maxExposurePerAssetPct}% per-asset cap (existing ${e.symbol} exposure)`]),b&&$>0&&E>w&&(S=w/i,E=w,M=S*(i-a),q=M/t.equity*100,U=[...U,`size capped by the ${n.maxCorrelatedExposurePct}% correlated-cluster cap`]),S>0?(l.push(...U.map(N=>`size capped: ${N}`)),r.push(`risking ${M.toFixed(2)} (${q.toFixed(2)}% of equity) for a ${f.toFixed(1)}:1 reward/risk — within every configured limit`),{approved:!0,asset:e.symbol,entry:i,stopLoss:a,takeProfit:o,positionSize:S,positionValue:E,riskAmount:M,riskPercentage:q,rewardRiskRatio:f,portfolioExposure:(u+E)/t.equity*100,reasons:r,warnings:l}):(r.push("position size rounds to zero under the current limits"),c())}const es={emaFastPeriod:20,emaSlowPeriod:50,rsiPeriod:14,adxPeriod:14,atrPeriod:14,stochasticKPeriod:14,stochasticDPeriod:3,volumePeriod:20,bollingerPeriod:20,minCandles:60,hotThreshold:30},dt={trend:30,rsi:20,macd:20,stochastic:15,volume:15},qt=25,On=.2,ut=(e,t,s)=>Math.min(s,Math.max(t,e));function xt(e,t,s,n=es){if(s.length<n.minCandles)return T(`${e}: need at least ${n.minCandles} candles for a reliable scan, got ${s.length}`);const i=s.map(w=>w.close),a=i[i.length-1],o=i[0],r=pt(i,n.emaFastPeriod),l=pt(i,n.emaSlowPeriod),u=Pn(i,n.rsiPeriod),d=xn(i),c=Tn(s,n.adxPeriod),h=kn(s,n.atrPeriod),y=Rn(s,n.stochasticKPeriod,n.stochasticDPeriod),v=Sn(i,n.bollingerPeriod),f=Ln(s,n.volumePeriod),p=W(h),m={price:a,changePct:o!==0?(a-o)/o*100:0,rsi:W(u),macdHistogram:W(d.histogram),emaFast:W(r),emaSlow:W(l),adx:W(c.adx),plusDi:W(c.plusDi),minusDi:W(c.minusDi),atrPct:p!==null&&a!==0?p/a*100:null,bollingerBandwidth:W(v.bandwidth),percentB:W(v.percentB),stochasticK:W(y.k),stochasticD:W(y.d),relativeVolume:W(f)},g=[],b=[];if(m.emaFast!==null&&m.emaSlow!==null&&a!==0){const w=(m.emaFast-m.emaSlow)/a,x=ut(w/.02,-1,1),S=m.adx===null?.5:ut(m.adx/qt,0,1),E=x*S*dt.trend;g.push({label:`Trend (EMA ${n.emaFastPeriod}/${n.emaSlowPeriod} + ADX)`,detail:`EMA${n.emaFastPeriod} ${Ft(m.emaFast)} vs EMA${n.emaSlowPeriod} ${Ft(m.emaSlow)}, ADX ${m.adx===null?"n/a":m.adx.toFixed(1)}`,contribution:E})}if(m.rsi!==null){const w=(m.rsi-50)/50*dt.rsi;g.push({label:`Momentum (RSI ${n.rsiPeriod})`,detail:`RSI ${m.rsi.toFixed(1)}`,contribution:w}),m.rsi>=70&&b.push(`RSI ${m.rsi.toFixed(1)} is overbought (≥ 70)`),m.rsi<=30&&b.push(`RSI ${m.rsi.toFixed(1)} is oversold (≤ 30)`)}if(m.macdHistogram!==null&&p!==null&&p>0){const w=ut(m.macdHistogram/p,-1,1),x=w*dt.macd;g.push({label:"MACD histogram",detail:`histogram ${Ft(m.macdHistogram)} (ATR-normalised ${w.toFixed(2)})`,contribution:x})}if(m.stochasticK!==null){const w=(m.stochasticK-50)/50*dt.stochastic;g.push({label:`Stochastic %K ${n.stochasticKPeriod}`,detail:`%K ${m.stochasticK.toFixed(1)}`,contribution:w})}if(m.relativeVolume!==null){const w=s[s.length-1],x=Math.sign(w.close-w.open),S=ut(m.relativeVolume-1,-1,1),E=x*Math.max(S,0)*dt.volume;g.push({label:`Volume (vs ${n.volumePeriod}-bar average)`,detail:`relative volume ${m.relativeVolume.toFixed(2)}×`,contribution:E})}m.bollingerBandwidth!==null&&m.bollingerBandwidth>On&&b.push(`Bollinger bandwidth ${(m.bollingerBandwidth*100).toFixed(1)}% — unusually volatile`),m.adx!==null&&m.adx<qt&&b.push(`ADX ${m.adx.toFixed(1)} < ${qt} — weak/absent trend`);const $=ut(g.reduce((w,x)=>w+x.contribution,0),-100,100),R=$>=n.hotThreshold?"hot":$<=-n.hotThreshold?"cold":"neutral";return j({symbol:e,timeframe:t,candleCount:s.length,score:$,temperature:R,snapshot:m,components:g,warnings:b})}async function Zt(e,t,s,n=150,i=es){const a=[],o=[],r=await Promise.all(t.map(async l=>({symbol:l,candles:await e.getCandles(l,s,n)})));for(const{symbol:l,candles:u}of r){if(!u.ok){o.push({symbol:l,reason:u.error});continue}const d=xt(l,s,u.value,i);d.ok?a.push(d.value):o.push({symbol:l,reason:d.error})}return a.sort((l,u)=>u.score-l.score),{timeframe:s,results:a,failures:o}}function Ft(e){const t=Math.abs(e);return t>=1e3?e.toFixed(0):t>=1?e.toFixed(2):e.toPrecision(3)}const Vt={minScore:30,minAdx:20,maxRsiForLong:75,atrStopMultiple:2,atrTargetMultiple:4,minRiskReward:1.5,maxAtrPct:8,minConfidence:0},St=90,Dt={scoreFactor:.6,trendMax:15,volumeMax:10},ve=20,Hn=50,zt=(e,t,s)=>Math.min(s,Math.max(t,e));function kt(e,t=Vt){_n(t);const{snapshot:s}=e,n=[];e.score<0?n.push(`bearish evidence (score ${e.score.toFixed(0)}) — this platform is long-only and does not simulate short positions`):e.score<t.minScore&&n.push(`insufficient bullish evidence: score ${e.score.toFixed(0)} is below the required ${t.minScore}`),s.adx===null?n.push("trend strength unknown: ADX unavailable for this series"):s.adx<t.minAdx&&n.push(`weak trend: ADX ${s.adx.toFixed(1)} is below the required ${t.minAdx}`),s.rsi!==null&&s.rsi>t.maxRsiForLong&&n.push(`overextended: RSI ${s.rsi.toFixed(1)} exceeds the long entry ceiling of ${t.maxRsiForLong}`),s.atrPct===null?n.push("cannot size risk: ATR unavailable for this series"):s.atrPct>t.maxAtrPct&&n.push(`volatility too high: ATR ${s.atrPct.toFixed(1)}% of price exceeds the ${t.maxAtrPct}% limit`);const i=t.atrTargetMultiple/t.atrStopMultiple;i<t.minRiskReward&&n.push(`risk/reward ${i.toFixed(2)} is below the required ${t.minRiskReward}`);let a=null;if(s.atrPct!==null&&s.price>0){const u=s.atrPct/100*s.price,d=s.price,c=d-t.atrStopMultiple*u,h=d+t.atrTargetMultiple*u;c<=0?n.push("stop loss would be at or below zero — volatility too large for the price"):a={entry:d,stopLoss:c,takeProfit:h,riskReward:i}}if(n.length>0||a===null)return{kind:"rejected",symbol:e.symbol,timeframe:e.timeframe,reasons:n};const o=jn(e),r=zt(o.reduce((u,d)=>u+d.effect,0),0,St);return r<t.minConfidence?{kind:"rejected",symbol:e.symbol,timeframe:e.timeframe,reasons:[`confidence ${r.toFixed(0)} is below the required ${t.minConfidence} (too little conviction — protecting capital)`]}:{kind:"opportunity",opportunity:{symbol:e.symbol,timeframe:e.timeframe,direction:"long",levels:a,confidence:r,confidenceComponents:o,explanation:Bn(e,a,r,t),warnings:[...e.warnings],basedOn:{score:e.score,candleCount:e.candleCount}}}}function jn(e){const t=[],{snapshot:s}=e;if(t.push({label:"Scanner evidence",detail:`composite score ${e.score.toFixed(0)} of 100`,effect:e.score*Dt.scoreFactor}),s.adx!==null){const n=zt((s.adx-ve)/(Hn-ve),0,1);t.push({label:"Trend strength",detail:`ADX ${s.adx.toFixed(1)}`,effect:n*Dt.trendMax})}return s.relativeVolume!==null&&s.relativeVolume>1&&t.push({label:"Volume participation",detail:`${s.relativeVolume.toFixed(2)}× average volume`,effect:zt(s.relativeVolume-1,0,1)*Dt.volumeMax}),e.warnings.length>0&&t.push({label:"Active warnings",detail:e.warnings.join("; "),effect:-8*e.warnings.length}),t}function Bn(e,t,s,n){const i=[...e.components].filter(o=>o.contribution>0).sort((o,r)=>r.contribution-o.contribution).slice(0,3).map(o=>`${o.label} (${o.detail})`),a=e.warnings.length>0?` Caution: ${e.warnings.join("; ")}.`:"";return`${e.symbol} on the ${e.timeframe} timeframe shows bullish technical evidence (score ${e.score.toFixed(0)}/100 over ${e.candleCount} candles), driven mainly by ${i.join(", ")}. Suggested plan: enter near ${It(t.entry)}, stop loss at ${It(t.stopLoss)} (${n.atrStopMultiple}× ATR below entry), take profit at ${It(t.takeProfit)} (${n.atrTargetMultiple}× ATR above), risk/reward ${t.riskReward.toFixed(1)}.`+a+` Confidence ${s.toFixed(0)}/${St} reflects the strength of current evidence only — it is not a guarantee, and any position should be sized so its loss at the stop is acceptable.`}function It(e){const t=Math.abs(e);return t>=1e3?e.toFixed(0):t>=1?e.toFixed(2):e.toPrecision(4)}function _n(e){if(!(e.atrStopMultiple>0)||!(e.atrTargetMultiple>0))throw new RangeError("ATR multiples must be positive");if(!(e.minScore>=0))throw new RangeError("minScore must be >= 0");if(!(e.minConfidence>=0))throw new RangeError("minConfidence must be >= 0")}const Vn=["15m","1h","4h","1d"],be=12,zn=150;function Gn(){const e=new wt,t=new Jt(e);return{portfolio:{equity:t.equity({}),openPositions:t.positions().map(s=>({symbol:s.symbol,quantity:s.quantity,entryPrice:s.avgCost}))},dailyLossSoFar:new mt(e).lossToday(Date.now())}}function Wn(e,t){e.innerHTML=`
    <h2>Market Scan</h2>
    <p class="status-line">
      Scores each market from −100 (strong bearish evidence) to +100 (strong bullish
      evidence) using trend, momentum, MACD, stochastic and volume. Click a row for the
      full breakdown.
    </p>
    <div class="controls">
      <label class="control">Timeframe
        <select id="scan-timeframe">
          ${Vn.map(o=>`<option value="${o}" ${o==="1h"?"selected":""}>${o}</option>`).join("")}
        </select>
      </label>
      <button class="primary" id="scan-run">Run scan</button>
    </div>
    <div class="status-line" id="scan-status"></div>
    <div id="scan-results"></div>
    <p class="disclaimer">
      Scores measure current technical evidence only. They are not predictions and not
      financial advice.
    </p>
  `;const s=e.querySelector("#scan-run"),n=e.querySelector("#scan-timeframe"),i=e.querySelector("#scan-status"),a=e.querySelector("#scan-results");s.addEventListener("click",async()=>{s.disabled=!0;const o=n.value;i.textContent=`Scanning ${Math.min(t.instruments.length,be)} markets on ${o} (${t.source.name})…`,a.innerHTML="";try{const r=t.instruments.slice(0,be).map(u=>u.symbol),l=await Zt(t.source,r,o,zn);i.textContent=`Scanned ${l.results.length} markets on ${o} · source: ${t.source.name}`,Xn(a,l,Gn())}catch(r){i.textContent="",a.innerHTML=`<p class="error-line">Scan failed: ${k(String(r))}</p>`}finally{s.disabled=!1}})}function Xn(e,t,s){if(t.results.length===0){e.innerHTML='<p class="error-line">No markets could be scanned.</p>',$e(e,t);return}const n=document.createElement("table");n.className="data-table",n.innerHTML=`
    <thead>
      <tr>
        <th>Market</th>
        <th>Price</th>
        <th>Change</th>
        <th>RSI</th>
        <th>ADX</th>
        <th>Rel. vol</th>
        <th>Score</th>
        <th>Signal</th>
      </tr>
    </thead>
  `;const i=document.createElement("tbody");for(const a of t.results){const o=document.createElement("tr");o.className="scan-row",o.setAttribute("aria-expanded","false"),o.innerHTML=`
      <td>${k(a.symbol)}</td>
      <td>${P(a.snapshot.price)}</td>
      <td class="${I(a.snapshot.changePct)}">${C(a.snapshot.changePct)}</td>
      <td>${it(a.snapshot.rsi)}</td>
      <td>${it(a.snapshot.adx)}</td>
      <td>${a.snapshot.relativeVolume===null?"—":`${a.snapshot.relativeVolume.toFixed(2)}×`}</td>
      <td class="${I(a.score)}">${a.score.toFixed(0)}</td>
      <td>${Kn(a)}</td>
    `;const r=Yn(a,s);r.hidden=!0,o.addEventListener("click",()=>{r.hidden=!r.hidden,o.classList.toggle("expanded",!r.hidden),o.setAttribute("aria-expanded",String(!r.hidden))}),i.appendChild(o),i.appendChild(r)}n.appendChild(i),e.appendChild(n),$e(e,t)}function Kn(e){const t={hot:"HOT",cold:"COLD",neutral:"NEUTRAL"};return`<span class="badge badge-${e.temperature}">${t[e.temperature]}</span>`}function Yn(e,t){const s=document.createElement("tr");s.className="scan-detail";const n=e.components.map(o=>`
        <div class="scan-component">
          <div class="label">${k(o.label)}</div>
          <div class="detail">${k(o.detail)}</div>
          <div class="contribution ${I(o.contribution)}">
            ${o.contribution>=0?"+":""}${o.contribution.toFixed(1)} pts
          </div>
        </div>`).join(""),i=e.warnings.length>0?`<ul class="scan-warnings">${e.warnings.map(o=>`<li>⚠ ${k(o)}</li>`).join("")}</ul>`:"",a=e.snapshot;return s.innerHTML=`
    <td colspan="8">
      <div class="scan-detail-grid">${n}</div>
      ${i}
      <p class="status-line">
        ATR ${it(a.atrPct,2)}% · Bollinger %B ${it(a.percentB,2)} ·
        bandwidth ${a.bollingerBandwidth===null?"—":(a.bollingerBandwidth*100).toFixed(1)+"%"} ·
        +DI ${it(a.plusDi)} / −DI ${it(a.minusDi)} ·
        Stoch %D ${it(a.stochasticD)} ·
        based on ${e.candleCount} candles (${e.timeframe})
      </p>
      ${Jn(kt(e),t)}
    </td>
  `,s}function Jn(e,t){if(e.kind==="rejected")return`
      <div class="signal-panel signal-rejected">
        <div class="signal-title">Signal Engine: no qualifying setup</div>
        ${e.reasons.length>0?`<ul>${e.reasons.map(i=>`<li>${k(i)}</li>`).join("")}</ul>`:""}
      </div>
    `;const s=e.opportunity;return`
    <div class="signal-panel signal-opportunity">
      <div class="signal-title">
        Signal Engine: LONG setup · confidence ${s.confidence.toFixed(0)}/${St}
      </div>
      <div class="signal-levels">
        <span>Entry ≈ ${P(s.levels.entry)}</span>
        <span>Stop loss ${P(s.levels.stopLoss)}</span>
        <span>Take profit ${P(s.levels.takeProfit)}</span>
        <span>R/R ${s.levels.riskReward.toFixed(1)}</span>
      </div>
      <p class="signal-explanation">${k(s.explanation)}</p>
    </div>
    ${Qn(e,t)}
  `}function Qn(e,t){const s=Pt(e.opportunity,t.portfolio,{dailyLossSoFar:t.dailyLossSoFar}),n=`<ul>${s.reasons.map(a=>`<li>${k(a)}</li>`).join("")}</ul>`;if(!s.approved)return`
      <div class="risk-panel risk-refused">
        <div class="signal-title">Risk Engine: trade refused to protect the portfolio</div>
        ${n}
      </div>
    `;const i=s.warnings.length>0?`<ul class="scan-warnings">${s.warnings.map(a=>`<li>⚠ ${k(a)}</li>`).join("")}</ul>`:"";return`
    <div class="risk-panel risk-approved">
      <div class="signal-title">Risk Engine: approved for the current paper portfolio</div>
      <div class="signal-levels">
        <span>Size ${s.positionSize.toLocaleString("en-US",{maximumFractionDigits:6})} units</span>
        <span>Value ${P(s.positionValue)}</span>
        <span>Risk ${P(s.riskAmount)} (${s.riskPercentage.toFixed(2)}%)</span>
        <span>R/R ${s.rewardRiskRatio.toFixed(1)}</span>
        <span>Portfolio exposure after: ${s.portfolioExposure.toFixed(1)}%</span>
      </div>
      ${n}
      ${i}
    </div>
  `}function $e(e,t){if(t.failures.length===0)return;const s=document.createElement("div");s.className="scan-failures",s.innerHTML=`
    <strong>Not scanned (${t.failures.length}):</strong>
    ${t.failures.map(n=>`${k(n.symbol)} — ${k(n.reason)}`).join("; ")}
  `,e.appendChild(s)}const we="alerts",Pe=200;class Zn{constructor(t,s,n){A(this,"state");if(this.store=t,this.channels=s,this.options=n,!(n.cooldownMs>0))throw new RangeError(`cooldownMs must be > 0, got ${n.cooldownMs}`);this.state=t.get(we)??{history:[],lastAlertAt:{}}}async notify(t,s){const n=`${t.symbol}:${t.timeframe}`,i=this.state.lastAlertAt[n];if(i!==void 0&&s-i<this.options.cooldownMs){const o=this.options.cooldownMs-(s-i);return{sent:!1,reason:`cooldown: ${t.symbol} was alerted ${Math.round((s-i)/6e4)}m ago (${Math.round(o/6e4)}m remaining)`}}const a={id:`${n}:${s}`,createdAt:s,symbol:t.symbol,timeframe:t.timeframe,confidence:t.confidence,title:`Qualified opportunity: ${t.symbol}`,message:`${t.symbol} (${t.timeframe}) qualified at confidence ${t.confidence.toFixed(0)} near ${t.price}. `+t.explanation};for(const o of this.channels)try{await o.deliver(a)}catch{}return this.state.lastAlertAt[n]=s,this.state.history.push(a),this.state.history.length>Pe&&(this.state.history=this.state.history.slice(-Pe)),this.persist(),{sent:!0}}history(){return this.state.history}persist(){this.store.set(we,this.state)}}const ti=8,ei=30,si=(e,t,s)=>Math.min(s,Math.max(t,e));function ss(e,t){if(e.kind==="rejected")return e;const s=e.opportunity;if(t===null)return{kind:"opportunity",opportunity:{...s,warnings:[...s.warnings,"higher timeframe unavailable — this setup is unconfirmed by the larger trend"]}};if(t.temperature==="cold")return{kind:"rejected",symbol:s.symbol,timeframe:s.timeframe,reasons:[`higher timeframe (${t.timeframe}) shows bearish evidence (score ${t.score.toFixed(0)}) — a long against the larger trend is refused`]};if(t.score>=ei){const n=si(s.confidence+ti,0,St);return{kind:"opportunity",opportunity:{...s,confidence:n,confidenceComponents:[...s.confidenceComponents,{label:`Higher timeframe confirmation (${t.timeframe})`,detail:`score ${t.score.toFixed(0)} on the ${t.timeframe} chart`,effect:n-s.confidence}],explanation:s.explanation+` The larger ${t.timeframe} trend confirms this setup (score ${t.score.toFixed(0)}).`}}}return{kind:"opportunity",opportunity:{...s,warnings:[...s.warnings,`higher timeframe (${t.timeframe}) is neutral (score ${t.score.toFixed(0)}) — no confirmation from the larger trend`]}}}const ns={"5m":3e5,"15m":9e5,"30m":18e5,"1h":36e5,"4h":144e5,"1d":864e5};class is{constructor(){A(this,"handle",null);A(this,"activeIntervalMs",null)}start(t,s){if(!(t>0))throw new RangeError(`intervalMs must be > 0, got ${t}`);this.stop(),this.activeIntervalMs=t,this.handle=setInterval(()=>{s()},t)}stop(){this.handle!==null&&clearInterval(this.handle),this.handle=null,this.activeIntervalMs=null}isRunning(){return this.handle!==null}intervalMs(){return this.activeIntervalMs}}const Ut=150;class ni{constructor(t){A(this,"clock");A(this,"interval",null);A(this,"lastScanAt",null);A(this,"lastResult",null);A(this,"previouslyQualified",new Set);this.options=t,this.clock=t.clock??(()=>Date.now())}start(t){this.interval=t,this.options.scheduler.start(ns[t],async()=>{await this.runScanOnce(this.clock())})}stop(){this.options.scheduler.stop(),this.interval=null}status(){const t=this.options.scheduler.isRunning(),s=this.options.scheduler.intervalMs();return{running:t,interval:t?this.interval:null,lastScanAt:this.lastScanAt,nextScanAt:t&&this.lastScanAt!==null&&s!==null?this.lastScanAt+s:null,lastResult:this.lastResult}}watchlistEntries(){return this.options.watchlist.entries()}opportunityHistory(){return this.options.log.entries()}alertHistory(){return this.options.alerts.history()}async higherTimeframeScan(t){const s=this.options.confirmationTimeframe;if(!s)return null;const n=await this.options.source.getCandles(t,s,Ut);if(!n.ok)return null;const i=xt(t,s,n.value);return i.ok?i.value:null}async runScanOnce(t){const{source:s,symbols:n,timeframe:i}=this.options,a=await Zt(s,n,i,Ut),o=this.options.getPortfolio(),r=this.options.getDailyLoss(),l=[],u=new Set;for(const c of a.results){let h=kt(c);if(h.kind==="opportunity"&&this.options.confirmationTimeframe&&(h=ss(h,await this.higherTimeframeScan(c.symbol))),h.kind==="rejected"){const m=c.temperature==="hot"?"watch":"none";l.push({symbol:c.symbol,outcome:m,reasons:h.reasons}),this.options.watchlist.recordScanOutcome(c.symbol,{timestamp:t,status:m});continue}const y=Pt(h.opportunity,o,{dailyLossSoFar:r});if(!y.approved){l.push({symbol:c.symbol,outcome:"watch",reasons:y.reasons}),this.options.watchlist.recordScanOutcome(c.symbol,{timestamp:t,status:"watch",confidence:h.opportunity.confidence});continue}const v=await s.getCandles(c.symbol,i,Ut),f=v.ok?this.options.validator(c.symbol,i,v.value):"not-run",p={symbol:c.symbol,timeframe:i,detectedAt:t,price:c.snapshot.price,confidence:h.opportunity.confidence,entry:y.entry,stopLoss:y.stopLoss,takeProfit:y.takeProfit,positionSize:y.positionSize,positionValue:y.positionValue,riskAmount:y.riskAmount,riskPct:y.riskPercentage,explanation:h.opportunity.explanation,validationVerdict:f,warnings:[...h.opportunity.warnings,...y.warnings]};u.add(c.symbol),l.push({symbol:c.symbol,outcome:"qualified",opportunity:p,reasons:y.reasons}),this.options.log.append({id:`${p.symbol}:${i}:${t}`,detectedAt:t,symbol:p.symbol,timeframe:i,price:p.price,confidence:p.confidence,entry:p.entry,stopLoss:p.stopLoss,takeProfit:p.takeProfit,positionSize:p.positionSize,riskPct:p.riskPct,explanation:p.explanation,validationVerdict:f,snapshot:{rsi:c.snapshot.rsi,adx:c.snapshot.adx,atrPct:c.snapshot.atrPct,relativeVolume:c.snapshot.relativeVolume},disappearedAt:null}),this.options.watchlist.recordScanOutcome(c.symbol,{timestamp:t,status:"qualified",confidence:p.confidence}),await this.options.alerts.notify({symbol:p.symbol,timeframe:i,confidence:p.confidence,price:p.price,explanation:p.explanation},t)}for(const c of this.previouslyQualified)u.has(c)||this.options.log.markDisappeared(c,i,t);this.previouslyQualified=u;const d={timestamp:t,timeframe:i,outcomes:l,failures:a.failures};return this.lastScanAt=t,this.lastResult=d,d}}const xe="opportunity-log";class ii{constructor(t){A(this,"records");this.store=t,this.records=t.get(xe)??[]}append(t){if(this.records.some(s=>s.id===t.id))throw new Error(`opportunity record '${t.id}' already exists — history is append-only`);this.records.push(t),this.persist()}markDisappeared(t,s,n){for(let i=this.records.length-1;i>=0;i--){const a=this.records[i];if(a.symbol===t&&a.timeframe===s)return a.disappearedAt!==null?!1:(this.records[i]={...a,disappearedAt:n},this.persist(),!0)}return!1}entries(){return this.records}persist(){this.store.set(xe,this.records)}}const Nt=20,Se=3,ke=.5,Te=90,ai=10;function as(e){const t=[];e.totalTestTrades<Nt&&t.push({kind:"small-sample",detail:`only ${e.totalTestTrades} out-of-sample trades (minimum ${Nt}) — results this small are dominated by luck, not edge`}),e.foldCount<Se&&t.push({kind:"small-sample",detail:`only ${e.foldCount} walk-forward folds (minimum ${Se}) — not enough distinct market periods`});const s=e.avgTrainReturnPct>0;if(s&&e.avgTestReturnPct<=0?t.push({kind:"curve-fitting",detail:`in-sample return ${e.avgTrainReturnPct.toFixed(1)}% became ${e.avgTestReturnPct.toFixed(1)}% on unseen data — the strategy fit the training history, not the market`}):s&&e.avgTestReturnPct<e.avgTrainReturnPct*ke&&t.push({kind:"degradation",detail:`out-of-sample return ${e.avgTestReturnPct.toFixed(1)}% keeps less than ${(ke*100).toFixed(0)}% of the in-sample ${e.avgTrainReturnPct.toFixed(1)}% — expect live results closer to the lower number`}),e.avgTrainSharpe!==null&&e.avgTestSharpe!==null&&e.avgTrainSharpe>1&&e.avgTestSharpe<=0&&t.push({kind:"curve-fitting",detail:`risk-adjusted quality collapsed: Sharpe ${e.avgTrainSharpe.toFixed(2)} in training vs ${e.avgTestSharpe.toFixed(2)} on unseen data`}),e.parameterSpread){const{chosenReturnPct:i,medianReturnPct:a}=e.parameterSpread;i-a>ai&&t.push({kind:"parameter-sensitivity",detail:`the chosen parameters returned ${i.toFixed(1)}% while the median candidate returned ${a.toFixed(1)}% — performance depends heavily on one lucky setting, a hallmark of curve fitting`})}e.avgTestWinRatePct!==null&&e.avgTestWinRatePct>Te&&e.totalTestTrades>=Nt&&t.push({kind:"unrealistic-win-rate",detail:`${e.avgTestWinRatePct.toFixed(0)}% win rate is above the ${Te}% plausibility ceiling — usually a sign of look-ahead bias, survivorship, or tiny targets hiding rare large losses`});const n=oi(t);return{flags:t,verdict:n,explanation:ri(n,t,e)}}function oi(e){if(e.some(s=>s.kind==="small-sample"))return"insufficient-data";if(e.some(s=>s.kind==="curve-fitting"))return"overfitted";const t=e.length;return t>=2||t===1?"caution":"robust"}function ri(e,t,s){const n=`Across ${s.foldCount} walk-forward folds the strategy averaged ${s.avgTrainReturnPct.toFixed(1)}% in training and ${s.avgTestReturnPct.toFixed(1)}% on unseen data over ${s.totalTestTrades} out-of-sample trades.`;switch(e){case"robust":return`${n} No robustness checks were triggered. This raises confidence that the edge is real, but past performance on any data never guarantees future results.`;case"caution":return`${n} ${t.length} check(s) were triggered — treat the in-sample numbers with scepticism and prefer the out-of-sample figures.`;case"overfitted":return`${n} The pattern matches curve fitting: performance found in training did not exist on unseen data. This configuration should not be trusted.`;case"insufficient-data":return`${n} There is not enough out-of-sample evidence to judge this strategy either way — more data or a longer test period is needed before drawing any conclusion.`}}const li=365*864e5;function ci(e){return li/$t[e]}function di(e,t){if(e.length<2)return null;const s=[];for(let o=1;o<e.length;o++){const r=e[o-1].equity;if(r<=0)return null;s.push(e[o].equity/r-1)}const n=s.reduce((o,r)=>o+r,0)/s.length,i=s.reduce((o,r)=>o+(r-n)**2,0)/s.length,a=Math.sqrt(i);return a===0?null:n/a*Math.sqrt(t)}function os(e){const t=e.filter(a=>a.pnl>0).reduce((a,o)=>a+o.pnl,0),s=-e.filter(a=>a.pnl<0).reduce((a,o)=>a+o.pnl,0),n=e.length>0?e.reduce((a,o)=>a+o.pnl,0)/e.length:null,i=e.length>0?e.reduce((a,o)=>a+(o.exitTimestamp-o.entryTimestamp),0)/e.length:null;return{profitFactor:e.length>0&&s>0?t/s:null,expectancy:n,avgTradePnl:n,avgHoldingTimeMs:i,grossProfit:t,grossLoss:s}}function Re(e,t){const s=e.closedTrades,n=os(s);return{totalReturnPct:e.totalReturnPct,maxDrawdownPct:e.maxDrawdownPct,tradeCount:s.length,winRatePct:e.stats.winRatePct,profitFactor:n.profitFactor,expectancy:n.expectancy,avgTradePnl:n.avgTradePnl,avgHoldingTimeMs:n.avgHoldingTimeMs,sharpe:di(e.equityCurve,ci(t)),feesPaid:e.feesPaid}}function rs(e,t){if(e.length===0)throw new RangeError("optimisation grid must not be empty");return{name:`Trend (walk-forward optimised, ${e.length} candidates)`,train(s){const n=e.map(a=>{const o=gt(s,_t(a),t);return{params:`SMA ${a.fastPeriod}/${a.slowPeriod}`,returnPct:o.totalReturnPct,options:a}}),i=n.reduce((a,o)=>o.returnPct>a.returnPct?o:a);return{strategy:_t(i.options),diagnostics:{evaluated:n.map(({params:a,returnPct:o})=>({params:a,returnPct:o})),chosen:i.params}}}}}function ls(e,t,s){var l;const{trainSize:n,testSize:i}=s;if(!Number.isInteger(n)||n<2)throw new RangeError(`trainSize must be an integer >= 2, got ${n}`);if(!Number.isInteger(i)||i<2)throw new RangeError(`testSize must be an integer >= 2, got ${i}`);if(e.length<n+i)throw new RangeError(`need at least ${n+i} candles for one fold, got ${e.length}`);const a=[],o=[];let r=1;for(let u=0;u+n+i<=e.length;u+=i){const d={start:u,end:u+n},c={start:d.end,end:d.end+i},h=e.slice(d.start,d.end),y=e.slice(c.start,c.end),v=t.train(h),f=gt(h,v.strategy,s.backtest),p=gt(y,v.strategy,s.backtest),m=s.backtest.initialCash,g=r*100/m;for(const b of p.equityCurve)o.push({timestamp:b.timestamp,equity:b.equity*g});r*=p.finalEquity/m,a.push({foldIndex:a.length,trainRange:d,testRange:c,chosenParams:(l=v.diagnostics)==null?void 0:l.chosen,diagnostics:v.diagnostics,train:Re(f,s.timeframe),test:Re(p,s.timeframe)})}return{strategyName:t.name,timeframe:s.timeframe,folds:a,aggregate:ui(a),oosEquityCurve:o}}function ht(e){return e.length===0?null:e.reduce((t,s)=>t+s,0)/e.length}function ui(e){const t=ht(e.map(n=>n.train.totalReturnPct))??0,s=ht(e.map(n=>n.test.totalReturnPct))??0;return{avgTrainReturnPct:t,avgTestReturnPct:s,avgTrainSharpe:ht(e.map(n=>n.train.sharpe).filter(n=>n!==null)),avgTestSharpe:ht(e.map(n=>n.test.sharpe).filter(n=>n!==null)),avgTestWinRatePct:ht(e.map(n=>n.test.winRatePct).filter(n=>n!==null)),degradationPct:t>0?(1-s/t)*100:null,totalTestTrades:e.reduce((n,i)=>n+i.test.tradeCount,0)}}const Ee=75,Le=25,hi=[{fastPeriod:5,slowPeriod:20},{fastPeriod:10,slowPeriod:30}];function pi(e){const t=new Map;return(s,n,i)=>{const a=`${s}:${n}`,o=t.get(a);if(o!==void 0)return o;let r;try{if(i.length<Ee+Le)r="not-run";else{const l=ls(i,rs(hi,e),{trainSize:Ee,testSize:Le,timeframe:n,backtest:e});r=as({avgTrainReturnPct:l.aggregate.avgTrainReturnPct,avgTestReturnPct:l.aggregate.avgTestReturnPct,avgTrainSharpe:l.aggregate.avgTrainSharpe,avgTestSharpe:l.aggregate.avgTestSharpe,totalTestTrades:l.aggregate.totalTestTrades,foldCount:l.folds.length,avgTestWinRatePct:l.aggregate.avgTestWinRatePct}).verdict}}catch{r="not-run"}return t.set(a,r),r}}const Ce="watchlist";class mi{constructor(t){A(this,"bySymbol");this.store=t;const s=t.get(Ce)??[];this.bySymbol=new Map(s.map(n=>[n.symbol,n]))}addManual(t,s){this.bySymbol.has(t)||(this.bySymbol.set(t,{symbol:t,source:"manual",favorite:!1,addedAt:s,firstDetectedAt:null,lastScanAt:null,highestConfidence:null,currentStatus:"none"}),this.persist())}remove(t){this.bySymbol.delete(t)&&this.persist()}toggleFavorite(t){const s=this.bySymbol.get(t);s&&(this.bySymbol.set(t,{...s,favorite:!s.favorite}),this.persist())}recordScanOutcome(t,s){const n=this.bySymbol.get(t),i=s.status!=="none";if(!n&&!i)return;const a=n??{symbol:t,source:"auto",favorite:!1,addedAt:s.timestamp,firstDetectedAt:null,lastScanAt:null,highestConfidence:null,currentStatus:"none"};this.bySymbol.set(t,{...a,lastScanAt:s.timestamp,currentStatus:s.status,firstDetectedAt:a.firstDetectedAt??(i?s.timestamp:null),highestConfidence:s.confidence===void 0?a.highestConfidence:Math.max(a.highestConfidence??-1/0,s.confidence)}),this.persist()}entries(){return[...this.bySymbol.values()].sort((t,s)=>t.favorite!==s.favorite?t.favorite?-1:1:(s.highestConfidence??-1/0)-(t.highestConfidence??-1/0))}persist(){this.store.set(Ce,[...this.bySymbol.values()])}}function fi(e){return{name:"in-app",deliver:t=>e(t)}}function yi(){return{name:"browser-notification",deliver:e=>{typeof Notification>"u"||Notification.permission==="granted"&&new Notification(e.title,{body:e.message.slice(0,180),tag:e.id})}}}async function gi(){return typeof Notification>"u"?"unsupported":Notification.permission==="granted"?"granted":Notification.requestPermission()}const vi=12,bi=36e5,$i={initialCash:1e4,feeRate:.001,spreadPct:.001,slippagePct:5e-4};function wi(e,t){const s=new wt,n=new mi(s),i=new ii(s),a=[],o=new Zn(s,[fi(c=>a.push(c)),yi()],{cooldownMs:bi}),r=new ni({source:t.source,symbols:t.instruments.slice(0,vi).map(c=>c.symbol),timeframe:"1h",confirmationTimeframe:"4h",scheduler:new is,watchlist:n,log:i,alerts:o,getPortfolio:()=>{const c=new Jt(s);return{equity:c.equity({}),openPositions:c.positions().map(h=>({symbol:h.symbol,quantity:h.quantity,entryPrice:h.avgCost}))}},getDailyLoss:()=>new mt(s).lossToday(Date.now()),validator:pi($i)});e.innerHTML=`
    <h2>Monitoring</h2>
    <p class="status-line">
      Continuous scheduled scans through the verified pipeline: scanner → signal engine →
      risk engine → validation. Analysis only — nothing is ever traded automatically.
    </p>
    <div class="controls">
      <label class="control">Interval
        <select id="mon-interval">
          ${["5m","15m","30m","1h","4h","1d"].map(c=>`<option value="${c}" ${c==="15m"?"selected":""}>${c}</option>`).join("")}
        </select>
      </label>
      <button class="primary" id="mon-start">Start monitoring</button>
      <button class="secondary" id="mon-stop">Stop</button>
      <button class="secondary" id="mon-scan-now">Scan now</button>
      <button class="secondary" id="mon-notify-perm">Enable browser notifications</button>
    </div>
    <div class="status-line" id="mon-status">Monitoring stopped.</div>
    <h3>Current opportunities</h3>
    <div id="mon-opportunities"><p class="status-line">No scan has run yet.</p></div>
    <h3>Watchlist</h3>
    <div class="controls">
      <label class="control">Add symbol
        <select id="mon-watch-symbol">
          ${t.instruments.map(c=>`<option value="${k(c.symbol)}">${k(c.symbol)}</option>`).join("")}
        </select>
      </label>
      <button class="secondary" id="mon-watch-add">Add to watchlist</button>
    </div>
    <div id="mon-watchlist"></div>
    <h3>Opportunity history</h3>
    <div id="mon-history"></div>
    <h3>Alert history</h3>
    <div id="mon-alerts"></div>
    <p class="disclaimer">
      Alerts flag technical evidence for review — they are not trade instructions and not
      financial advice.
    </p>
  `;const l=e.querySelector("#mon-status");function u(){const c=r.status(),h=[c.running?`Monitoring RUNNING (every ${c.interval})`:"Monitoring stopped.",c.lastScanAt!==null?`Last scan: ${new Date(c.lastScanAt).toLocaleString()}`:"No scan yet.",c.running&&c.nextScanAt!==null?`Next scan: ${new Date(c.nextScanAt).toLocaleString()}`:"",c.lastResult!==null?`${c.lastResult.outcomes.filter(y=>y.outcome==="qualified").length} qualified / ${c.lastResult.outcomes.filter(y=>y.outcome==="watch").length} watch / ${c.lastResult.failures.length} failed`:""].filter(Boolean);l.textContent=h.join(" · ")}function d(){u(),Pi(e.querySelector("#mon-opportunities"),r),xi(e.querySelector("#mon-watchlist"),r,n,d),Si(e.querySelector("#mon-history"),r),ki(e.querySelector("#mon-alerts"),r)}e.querySelector("#mon-start").addEventListener("click",()=>{const c=e.querySelector("#mon-interval").value;r.start(c),u()}),e.querySelector("#mon-stop").addEventListener("click",()=>{r.stop(),u()}),e.querySelector("#mon-scan-now").addEventListener("click",()=>{l.textContent="Scanning…",r.runScanOnce(Date.now()).then(d)}),e.querySelector("#mon-notify-perm").addEventListener("click",()=>{gi()}),e.querySelector("#mon-watch-add").addEventListener("click",()=>{const c=e.querySelector("#mon-watch-symbol").value;n.addManual(c,Date.now()),d()}),d()}function Pi(e,t){const s=t.status().lastResult;if(!s){e.innerHTML='<p class="status-line">No scan has run yet.</p>';return}const n=s.outcomes.filter(i=>i.outcome==="qualified");if(n.length===0){e.innerHTML='<p class="status-line">No qualified opportunities in the last scan — refusing weak setups is the system protecting capital.</p>';return}e.innerHTML=`
    <table class="data-table">
      <thead><tr>
        <th>Market</th><th>Price</th><th>Confidence</th><th>Entry</th><th>Stop</th>
        <th>Target</th><th>Size</th><th>Risk %</th><th>Validation</th>
      </tr></thead>
      <tbody>
        ${n.map(({opportunity:i})=>`<tr title="${k(i.explanation)}">
            <td>${k(i.symbol)}</td>
            <td>${P(i.price)}</td>
            <td>${i.confidence.toFixed(0)}</td>
            <td>${P(i.entry)}</td>
            <td>${P(i.stopLoss)}</td>
            <td>${P(i.takeProfit)}</td>
            <td>${i.positionSize.toLocaleString("en-US",{maximumFractionDigits:6})}</td>
            <td>${i.riskPct.toFixed(2)}%</td>
            <td>${k(i.validationVerdict)}</td>
          </tr>`).join("")}
      </tbody>
    </table>
  `}function xi(e,t,s,n){const i=t.watchlistEntries();if(i.length===0){e.innerHTML='<p class="status-line">Watchlist is empty.</p>';return}e.innerHTML=`
    <table class="data-table">
      <thead><tr>
        <th>Market</th><th>Source</th><th>Status</th><th>Best confidence</th>
        <th>First detected</th><th>Last scan</th><th></th>
      </tr></thead>
      <tbody>
        ${i.map(a=>`<tr>
              <td>${a.favorite?"★ ":""}${k(a.symbol)}</td>
              <td>${a.source}</td>
              <td>${a.currentStatus}</td>
              <td>${a.highestConfidence===null?"—":a.highestConfidence.toFixed(0)}</td>
              <td>${a.firstDetectedAt===null?"—":new Date(a.firstDetectedAt).toLocaleString()}</td>
              <td>${a.lastScanAt===null?"—":new Date(a.lastScanAt).toLocaleString()}</td>
              <td>
                <button class="secondary" data-fav="${k(a.symbol)}">${a.favorite?"Unfavourite":"Favourite"}</button>
                <button class="secondary" data-del="${k(a.symbol)}">Remove</button>
              </td>
            </tr>`).join("")}
      </tbody>
    </table>
  `,e.querySelectorAll("[data-fav]").forEach(a=>a.addEventListener("click",()=>{s.toggleFavorite(a.dataset.fav),n()})),e.querySelectorAll("[data-del]").forEach(a=>a.addEventListener("click",()=>{s.remove(a.dataset.del),n()}))}function Si(e,t){const s=[...t.opportunityHistory()].reverse().slice(0,25);if(s.length===0){e.innerHTML='<p class="status-line">No opportunities recorded yet.</p>';return}e.innerHTML=`
    <table class="data-table">
      <thead><tr>
        <th>Detected</th><th>Market</th><th>Confidence</th><th>Entry</th>
        <th>RSI</th><th>ADX</th><th>Validation</th><th>Status</th>
      </tr></thead>
      <tbody>
        ${s.map(n=>`<tr>
              <td>${new Date(n.detectedAt).toLocaleString()}</td>
              <td>${k(n.symbol)}</td>
              <td>${n.confidence.toFixed(0)}</td>
              <td>${P(n.entry)}</td>
              <td>${n.snapshot.rsi===null?"—":n.snapshot.rsi.toFixed(0)}</td>
              <td>${n.snapshot.adx===null?"—":n.snapshot.adx.toFixed(0)}</td>
              <td>${k(n.validationVerdict)}</td>
              <td class="${n.disappearedAt===null?"positive":""}">${n.disappearedAt===null?"active":`gone ${new Date(n.disappearedAt).toLocaleString()}`}</td>
            </tr>`).join("")}
      </tbody>
    </table>
  `}function ki(e,t){const s=[...t.alertHistory()].reverse().slice(0,25);if(s.length===0){e.innerHTML='<p class="status-line">No alerts yet.</p>';return}e.innerHTML=`
    <table class="data-table">
      <thead><tr><th>Time</th><th>Market</th><th>Confidence</th><th>Message</th></tr></thead>
      <tbody>
        ${s.map(n=>`<tr>
              <td>${new Date(n.createdAt).toLocaleString()}</td>
              <td>${k(n.symbol)}</td>
              <td class="${I(n.confidence)}">${n.confidence.toFixed(0)}</td>
              <td>${k(Vs(n.message,140))}</td>
            </tr>`).join("")}
      </tbody>
    </table>
  `}function Ti(e,t){const s=new Jt(new wt,1e4);e.innerHTML=`
    <h2>Paper Portfolio</h2>
    <p class="status-line">
      Simulated trading with virtual money — practice without risk. Nothing here
      touches a real account.
    </p>
    <div id="pp-summary"></div>
    <div class="controls">
      <label class="control">Market
        <select id="pp-symbol">
          ${t.instruments.map(r=>`<option value="${k(r.symbol)}">${k(r.symbol)}</option>`).join("")}
        </select>
      </label>
      <label class="control">Quantity
        <input id="pp-quantity" type="number" value="0.1" min="0" step="any" />
      </label>
      <button class="primary" id="pp-buy">Buy at market</button>
      <button class="primary" id="pp-sell">Sell at market</button>
      <button class="secondary" id="pp-reset">Reset portfolio</button>
    </div>
    <div class="status-line" id="pp-status"></div>
    <h3>Positions</h3>
    <div id="pp-positions"></div>
    <h3>Trade journal</h3>
    <div id="pp-trades"></div>
  `;const n=e.querySelector("#pp-status");async function i(r){const l=await t.source.getCandles(r,"1m",2);if(!l.ok||l.value.length===0){const u=await t.source.getCandles(r,"1h",2);return!u.ok||u.value.length===0?null:u.value[u.value.length-1].close}return l.value[l.value.length-1].close}async function a(){const r={};for(const l of s.positions()){const u=await i(l.symbol);u!==null&&(r[l.symbol]=u)}Ri(e.querySelector("#pp-summary"),s,r),Ei(e.querySelector("#pp-positions"),s,r),Li(e.querySelector("#pp-trades"),s)}async function o(r){const l=e.querySelector("#pp-symbol").value,u=Number(e.querySelector("#pp-quantity").value);n.textContent=`Fetching ${l} price…`;const d=await i(l);if(d===null){n.innerHTML=`<span class="error-line">No price available for ${k(l)}</span>`;return}const c=r==="buy"?s.buy(l,u,d,Date.now()):s.sell(l,u,d,Date.now());n.innerHTML=c.ok?`${r==="buy"?"Bought":"Sold"} ${u} ${k(l)} @ ${P(d)} (${t.source.name})`:`<span class="error-line">${k(c.error)}</span>`,await a()}e.querySelector("#pp-buy").addEventListener("click",()=>void o("buy")),e.querySelector("#pp-sell").addEventListener("click",()=>void o("sell")),e.querySelector("#pp-reset").addEventListener("click",()=>{window.confirm("Reset the paper portfolio to 10,000 and clear the journal?")&&(s.reset(1e4),n.textContent="Portfolio reset.",a())}),a()}function Ri(e,t,s){const n=t.equity(s),i=t.unrealizedPnl(s);e.innerHTML=`
    <div class="result-cards">
      <div class="stat-card"><div class="stat-label">Equity</div>
        <div class="stat-value">${P(n)}</div></div>
      <div class="stat-card"><div class="stat-label">Cash</div>
        <div class="stat-value">${P(t.cash)}</div></div>
      <div class="stat-card"><div class="stat-label">Realized P&amp;L</div>
        <div class="stat-value ${I(t.realizedPnl)}">${P(t.realizedPnl)}</div></div>
      <div class="stat-card"><div class="stat-label">Unrealized P&amp;L</div>
        <div class="stat-value ${I(i)}">${P(i)}</div></div>
    </div>
  `}function Ei(e,t,s){const n=t.positions();if(n.length===0){e.innerHTML='<p class="status-line">No open positions.</p>';return}e.innerHTML=`
    <table class="data-table">
      <thead><tr><th>Market</th><th>Quantity</th><th>Avg cost</th><th>Price</th><th>P&amp;L %</th></tr></thead>
      <tbody>
        ${n.map(i=>{const a=s[i.symbol],o=a===void 0?null:(a-i.avgCost)/i.avgCost*100;return`<tr>
              <td>${k(i.symbol)}</td>
              <td>${i.quantity.toLocaleString("en-US",{maximumFractionDigits:8})}</td>
              <td>${P(i.avgCost)}</td>
              <td>${a===void 0?"—":P(a)}</td>
              <td class="${I(o)}">${C(o)}</td>
            </tr>`}).join("")}
      </tbody>
    </table>
  `}function Li(e,t){const s=[...t.trades].reverse().slice(0,50);if(s.length===0){e.innerHTML='<p class="status-line">No trades yet.</p>';return}e.innerHTML=`
    <table class="data-table">
      <thead><tr><th>Time</th><th>Market</th><th>Side</th><th>Quantity</th><th>Price</th><th>Realized P&amp;L</th></tr></thead>
      <tbody>
        ${s.map(n=>`<tr>
              <td>${new Date(n.timestamp).toLocaleString()}</td>
              <td>${k(n.symbol)}</td>
              <td class="${n.side==="buy"?"positive":"negative"}">${n.side.toUpperCase()}</td>
              <td>${n.quantity.toLocaleString("en-US",{maximumFractionDigits:8})}</td>
              <td>${P(n.price)}</td>
              <td class="${I(n.realizedPnl)}">${n.side==="sell"?P(n.realizedPnl):"—"}</td>
            </tr>`).join("")}
      </tbody>
    </table>
  `}const Ae="audit-log",Me=1e3;class Ci{constructor(t){A(this,"records");this.store=t,this.records=t.get(Ae)??[]}append(t){this.records.push(t),this.records.length>Me&&(this.records=this.records.slice(-Me)),this.store.set(Ae,this.records)}entries(){return this.records}}const Ot="kill-switch";class Ai{constructor(t){A(this,"state");this.store=t,this.state=t.get(Ot)??{engaged:!1,reason:null}}isEngaged(){return this.state.engaged}reason(){return this.state.reason}engage(t){this.state={engaged:!0,reason:t},this.store.set(Ot,this.state)}disengage(t){if(t.trim()==="")throw new Error("disengaging the kill switch requires an explicit human actor");this.state={engaged:!1,reason:null},this.store.set(Ot,this.state)}}function Mi(e){const t=e.entryPrice-e.initialStop;if(!(t>0)||e.highestPrice-e.entryPrice<e.config.activateR*t)return e.initialStop;const n=e.highestPrice-e.config.trailR*t;return Math.max(e.initialStop,e.entryPrice,n)}const Ht=150,qe="autopilot-state";class qi{constructor(t){A(this,"mode","paper");A(this,"clock");A(this,"interval",null);A(this,"lastCycleAt",null);A(this,"lastCycle",null);this.options=t,this.clock=t.clock??(()=>Date.now())}start(t){this.interval=t,this.options.scheduler.start(ns[t],async()=>{await this.runCycleOnce(this.clock())}),this.persistState({desiredRunning:!0,interval:t})}stop(){this.options.scheduler.stop(),this.interval=null,this.persistState({desiredRunning:!1,interval:null})}resume(){var s;const t=(s=this.options.store)==null?void 0:s.get(qe);return!(t!=null&&t.desiredRunning)||t.interval===null||this.options.killSwitch.isEngaged()?!1:(this.start(t.interval),!0)}persistState(t){var s;(s=this.options.store)==null||s.set(qe,t)}status(){const t=this.options.scheduler.isRunning(),s=this.options.scheduler.intervalMs();return{running:t,interval:t?this.interval:null,lastCycleAt:this.lastCycleAt,nextCycleAt:t&&this.lastCycleAt!==null&&s!==null?this.lastCycleAt+s:null,killSwitchEngaged:this.options.killSwitch.isEngaged(),lastCycle:this.lastCycle}}async higherTimeframeScan(t){const s=this.options.confirmationTimeframe;if(!s)return null;const n=await this.options.source.getCandles(t,s,Ht);if(!n.ok)return null;const i=xt(t,s,n.value);return i.ok?i.value:null}async runCycleOnce(t){var c,h,y,v;const{killSwitch:s,audit:n}=this.options;if(s.isEngaged()){n.append({timestamp:t,intentId:"cycle",event:"kill-switch-engaged",mode:this.mode,detail:`cycle skipped: kill switch engaged (${s.reason()??"no reason recorded"})`});const f={timestamp:t,halted:!0,opened:[],closed:[],skipped:[]};return this.lastCycleAt=t,this.lastCycle=f,f}const i=[],a=[],o=[],r=this.options.costRate??0;for(const f of this.options.positions.openPositions()){const p=await this.options.source.getCandles(f.symbol,this.options.timeframe,Ht);if(!p.ok||p.value.length===0){o.push({symbol:f.symbol,reason:`no price data: ${p.ok?"empty":p.error}`});continue}const m=p.value[p.value.length-1].close;this.options.positions.updateMarketPrice(f.symbol,m,t);const g=this.options.trailing?Mi({entryPrice:f.entryPrice,initialStop:f.stopLoss,highestPrice:Math.max(f.highestPrice,m),config:this.options.trailing}):f.stopLoss;let b=null;if(m<=g?b="stop-loss":m>=f.takeProfit&&(b="take-profit"),b===null)continue;const $=f.quantity*m*r,R=this.options.portfolio.exit(f.id,{quantity:f.quantity,price:m,timestamp:t,reason:b,fee:$});if(R.ok){const w=f.realizedPnl+(m-f.entryPrice)*f.quantity-$;a.push({id:f.id,symbol:f.symbol,reason:b,price:m,pnl:w}),(h=(c=this.options).onRealizedPnl)==null||h.call(c,w,t),n.append({timestamp:t,intentId:f.id,event:"filled",mode:this.mode,detail:`paper exit ${f.symbol}: ${f.quantity} @ ${m} (${b})`})}else n.append({timestamp:t,intentId:f.id,event:"rejected",mode:this.mode,detail:`paper exit failed for ${f.symbol}: ${R.error}`})}if((v=(y=this.options).haltNewEntries)!=null&&v.call(y)){n.append({timestamp:t,intentId:"cycle",event:"rejected",mode:this.mode,detail:"new entries paused: portfolio drawdown circuit-breaker engaged"});const f={timestamp:t,halted:!1,opened:i,closed:a,skipped:o};return this.lastCycleAt=t,this.lastCycle=f,f}const l=await Zt(this.options.source,this.options.symbols,this.options.timeframe,Ht);for(const f of l.failures)o.push({symbol:f.symbol,reason:f.reason});const u=new Set(this.options.positions.openPositions().map(f=>f.symbol));for(const f of l.results){if(u.has(f.symbol)){o.push({symbol:f.symbol,reason:"already holding a position"});continue}let p=kt(f,{...Vt,maxRsiForLong:this.options.maxRsiForLong??Vt.maxRsiForLong,minConfidence:this.options.minConfidence??0});if(p.kind==="rejected")continue;if(this.options.confirmationTimeframe&&(p=ss(p,await this.higherTimeframeScan(f.symbol)),p.kind==="rejected")){o.push({symbol:f.symbol,reason:p.reasons.join("; ")}),n.append({timestamp:t,intentId:`${f.symbol}:${t}`,event:"rejected",mode:this.mode,detail:`higher-timeframe gate refused ${f.symbol}: ${p.reasons.join("; ")}`});continue}const m=this.options.portfolio.snapshot({},t),g=this.options.correlationBetween,b=Pt(p.opportunity,{equity:m.equity,openPositions:this.options.positions.openPositions().map(R=>({symbol:R.symbol,quantity:R.quantity,entryPrice:R.entryPrice}))},{limits:this.options.riskLimits??Qt,dailyLossSoFar:this.options.getDailyLoss(),correlationTo:g?R=>g(f.symbol,R):void 0});if(!b.approved){o.push({symbol:f.symbol,reason:b.reasons.join("; ")}),n.append({timestamp:t,intentId:`${f.symbol}:${t}`,event:"rejected",mode:this.mode,detail:`risk engine refused ${f.symbol}: ${b.reasons.join("; ")}`});continue}const $=this.options.portfolio.openFromAssessment(b,{timestamp:t,fee:b.positionSize*b.entry*r,confidence:p.opportunity.confidence,strategyVersion:"autopilot-paper-v1",notes:"opened autonomously by the paper autopilot"});if($.ok){const R=p.opportunity.confidenceComponents.filter(w=>w.effect>0).sort((w,x)=>x.effect-w.effect).slice(0,2).map(w=>w.label);i.push({id:$.value.id,symbol:f.symbol,quantity:$.value.quantity,entry:$.value.entryPrice,confidence:p.opportunity.confidence,reasons:R}),u.add(f.symbol),n.append({timestamp:t,intentId:$.value.id,event:"filled",mode:this.mode,detail:`paper entry ${f.symbol}: ${$.value.quantity} @ ${$.value.entryPrice} (stop ${b.stopLoss}, target ${b.takeProfit}, confidence ${p.opportunity.confidence.toFixed(0)})`})}else o.push({symbol:f.symbol,reason:$.error}),n.append({timestamp:t,intentId:`${f.symbol}:${t}`,event:"rejected",mode:this.mode,detail:`paper entry failed for ${f.symbol}: ${$.error}`})}const d={timestamp:t,halted:!1,opened:i,closed:a,skipped:o};return this.lastCycleAt=t,this.lastCycle=d,d}}const Gt=1;function Fi(e,t){const s={};for(const n of e.keys())s[n]=e.get(n);return{version:Gt,exportedAt:t,data:s}}function Di(e){const t=e.keys();for(const s of t)e.remove(s);return t.length}function Ii(e,t){if(typeof t!="object"||t===null)return T("backup payload is not an object");if(t.version!==Gt)return T(`unsupported backup version ${String(t.version)} (expected ${Gt})`);if(typeof t.data!="object"||t.data===null||Array.isArray(t.data))return T("backup payload has no data map");const s=Object.entries(t.data);for(const[n,i]of s)e.set(n,i);return j({restoredKeys:s.length})}const Ui=365*864e5;function cs(e,t={}){const s=[...e].sort((g,b)=>g.exitTimestamp-b.exitTimestamp),n=s.filter(g=>g.realizedPnl>0),i=s.filter(g=>g.realizedPnl<0),a=os(s.map(g=>({pnl:g.realizedPnl,entryTimestamp:g.entryTimestamp,exitTimestamp:g.exitTimestamp}))),o=s.reduce((g,b)=>g+b.realizedPnl,0);let r=0,l=0,u=0,d=0;for(const g of s)g.realizedPnl>0?(u++,d=0):g.realizedPnl<0?(d++,u=0):(u=0,d=0),r=Math.max(r,u),l=Math.max(l,d);const c=t.initialCash??0,h=ds(s,c||1),y=s.length>0?Ze(h):0,v=Math.max(...h.map(g=>g.equity)),f=y/100*v,p=s.length>1?s[s.length-1].exitTimestamp-s[0].entryTimestamp:0,m=c>0&&p>0?o/c*100*(Ui/p):null;return{tradeCount:s.length,winRatePct:s.length>0?n.length/s.length*100:null,lossRatePct:s.length>0?i.length/s.length*100:null,profitFactor:a.profitFactor,expectancy:a.expectancy,avgWinner:n.length>0?a.grossProfit/n.length:null,avgLoser:i.length>0?-a.grossLoss/i.length:null,largestGain:n.length>0?Math.max(...n.map(g=>g.realizedPnl)):null,largestLoss:i.length>0?Math.min(...i.map(g=>g.realizedPnl)):null,maxConsecutiveWins:r,maxConsecutiveLosses:l,avgHoldingMs:a.avgHoldingTimeMs,totalPnl:o,maxDrawdownPct:y,recoveryFactor:y>0&&f>0?o/f:null,calmar:y>0&&m!==null?m/y:null}}function ds(e,t){const s=[...e].sort((a,o)=>a.exitTimestamp-o.exitTimestamp),n=[{timestamp:s[0]?Math.min(s[0].entryTimestamp,s[0].exitTimestamp):0,equity:t}];let i=t;for(const a of s)i+=a.realizedPnl,n.push({timestamp:a.exitTimestamp,equity:i});return n}function Ni(e){let t=-1/0;return e.map(s=>(t=Math.max(t,s.equity),{timestamp:s.timestamp,drawdownPct:t>0?(t-s.equity)/t*100:0}))}function Oi(e){const t=new Map;for(const s of e){const n=new Date(s.exitTimestamp).toISOString().slice(0,7),i=t.get(n)??{pnl:0,tradeCount:0};i.pnl+=s.realizedPnl,i.tradeCount++,t.set(n,i)}return[...t.entries()].sort(([s],[n])=>s.localeCompare(n)).map(([s,n])=>({month:s,...n}))}const Hi=[{label:"0–40",min:0,max:40},{label:"40–60",min:40,max:60},{label:"60–90",min:60,max:90.0001}];function ji(e){return Hi.map(({label:t,min:s,max:n})=>{const i=e.filter(r=>r.confidence!==null&&r.confidence>=s&&r.confidence<n),a=i.filter(r=>r.realizedPnl>0).length,o=i.reduce((r,l)=>r+l.realizedPnl,0);return{label:t,minConfidence:s,maxConfidence:n,tradeCount:i.length,winRatePct:i.length>0?a/i.length*100:null,expectancy:i.length>0?o/i.length:null,totalPnl:o}})}function Bi(e){const t=new Map;for(const s of e){const n=t.get(s.exitReason)??[];n.push(s),t.set(s.exitReason,n)}return[...t.entries()].map(([s,n])=>{const i=n.filter(o=>o.realizedPnl>0).length,a=n.reduce((o,r)=>o+r.realizedPnl,0);return{reason:s,tradeCount:n.length,winRatePct:n.length>0?i/n.length*100:null,totalPnl:a,avgPnl:n.length>0?a/n.length:null}}).sort((s,n)=>n.tradeCount-s.tradeCount)}const Fe=1;function _i(e){if(e.length===0)return{avgMfePct:null,avgMaePct:null,avgCapturePct:null,tradesThatSawProfit:0,losersThatWereProfitable:0};const t=n=>n.reduce((i,a)=>i+a,0)/n.length,s=e.filter(n=>n.mfePct>0).map(n=>n.returnPct/n.mfePct*100);return{avgMfePct:t(e.map(n=>n.mfePct)),avgMaePct:t(e.map(n=>n.maePct)),avgCapturePct:s.length>0?t(s):null,tradesThatSawProfit:e.filter(n=>n.mfePct>=Fe).length,losersThatWereProfitable:e.filter(n=>n.realizedPnl<0&&n.mfePct>=Fe).length}}function Vi(e){const t=new Map;for(const s of e){const n=s.strategyVersion??"manual",i=t.get(n)??[];i.push(s),t.set(n,i)}return[...t.entries()].map(([s,n])=>({strategyVersion:s,stats:cs(n)})).sort((s,n)=>n.stats.tradeCount-s.stats.tradeCount)}function zi(e,t,s){if(e.length===0)return null;const n=[...new Set(e.map(r=>r.symbol))].filter(r=>s[r]!==void 0&&s[r].startPrice>0);if(n.length===0)return null;const a=e.reduce((r,l)=>r+l.realizedPnl,0)/t*100,o=n.reduce((r,l)=>{const{startPrice:u,endPrice:d}=s[l];return r+(d-u)/u*100},0)/n.length;return{strategyReturnPct:a,holdReturnPct:o,beatBenchmark:a>o,symbols:n}}const De="portfolio-engine";function Gi(e){return new Date(e).toISOString().slice(0,10)}class Wi{constructor(t,s,n){A(this,"state");if(this.store=t,this.positions=s,!(n.initialCash>0))throw new RangeError(`initialCash must be > 0, got ${n.initialCash}`);this.state=this.store.get(De)??{cash:n.initialCash,initialCash:n.initialCash,baseCurrency:n.baseCurrency,closedRealizedPnl:0,dayAnchor:null}}cash(){return this.state.cash}openPositions(){return this.positions.openPositions()}openFromAssessment(t,s){return t.approved?this.open({symbol:t.asset,quantity:t.positionSize,entryPrice:t.entry,stopLoss:t.stopLoss,takeProfit:t.takeProfit,timestamp:s.timestamp,fee:s.fee,confidence:s.confidence,validationVerdict:s.validationVerdict,strategyVersion:s.strategyVersion,notes:s.notes}):T("only approved trade proposals can be opened — this assessment was refused")}open(t){const s=t.quantity*t.entryPrice+(t.fee??0);if(s>this.state.cash+1e-9)return T(`insufficient cash: need ${s.toFixed(2)}, have ${this.state.cash.toFixed(2)}`);const n=this.positions.open(t);return n.ok&&(this.state.cash-=s,this.persist()),n}exit(t,s){const n=this.positions.openPositions().find(a=>a.id===t),i=this.positions.exit(t,s);if(!i.ok)return i;if(this.state.cash+=s.quantity*s.price-(s.fee??0),i.value===null&&n!==void 0){const a=(s.price-n.entryPrice)*s.quantity-(s.fee??0);this.state.closedRealizedPnl+=n.realizedPnl+a}return this.persist(),i}snapshot(t,s){const n=this.positions.openPositions(),i=n.map(c=>{const h=t[c.symbol]??c.entryPrice;return{symbol:c.symbol,marketValue:c.quantity*h,pctOfEquity:0}}).sort((c,h)=>h.marketValue-c.marketValue),a=i.reduce((c,h)=>c+h.marketValue,0),o=this.state.cash+a,r=i.map(c=>({...c,pctOfEquity:o>0?c.marketValue/o*100:0})),l=Gi(s);(this.state.dayAnchor===null||this.state.dayAnchor.day!==l)&&(this.state.dayAnchor={day:l,equity:o},this.persist());const u=this.state.dayAnchor.equity,d=this.state.closedRealizedPnl+this.positions.openRealizedPnl();return{timestamp:s,baseCurrency:this.state.baseCurrency,equity:o,cash:this.state.cash,cashAvailable:this.state.cash,investedValue:a,unrealizedPnl:this.positions.unrealizedPnl(t),realizedPnl:d,totalReturnPct:(o-this.state.initialCash)/this.state.initialCash*100,dailyPnl:o-u,dailyReturnPct:u>0?(o-u)/u*100:0,exposurePct:o>0?a/o*100:0,largestPosition:r[0]??null,allocation:r,openPositionCount:n.length}}persist(){this.store.set(De,this.state)}}const Ie="open-positions";class Xi{constructor(t,s){A(this,"positions");this.store=t,this.journal=s,this.positions=t.get(Ie)??[]}openFromAssessment(t,s){return t.approved?this.open({symbol:t.asset,quantity:t.positionSize,entryPrice:t.entry,stopLoss:t.stopLoss,takeProfit:t.takeProfit,timestamp:s.timestamp,fee:s.fee,confidence:s.confidence,validationVerdict:s.validationVerdict,strategyVersion:s.strategyVersion,notes:s.notes}):T("only approved trade proposals can be opened — this assessment was refused")}open(t){if(t.symbol.trim()==="")return T("symbol must not be empty");if(!(t.quantity>0))return T(`quantity must be > 0, got ${t.quantity}`);if(!(t.entryPrice>0))return T(`entryPrice must be > 0, got ${t.entryPrice}`);if(!(t.stopLoss>0)||t.stopLoss>=t.entryPrice)return T(`stopLoss must be positive and below entry (${t.stopLoss} vs ${t.entryPrice})`);if((t.fee??0)<0)return T("fee cannot be negative");const s={id:`${t.symbol}:${t.timestamp}:${this.positions.length}`,symbol:t.symbol,openedAt:t.timestamp,entryPrice:t.entryPrice,quantity:t.quantity,initialQuantity:t.quantity,stopLoss:t.stopLoss,takeProfit:t.takeProfit,feesPaid:t.fee??0,realizedPnl:0,highestPrice:t.entryPrice,lowestPrice:t.entryPrice,confidence:t.confidence??null,validationVerdict:t.validationVerdict??null,strategyVersion:t.strategyVersion??null,notes:t.notes??null,exits:[]};return this.positions.push(s),this.persist(),j(jt(s))}exit(t,s){const n=this.positions.findIndex(c=>c.id===t);if(n===-1)return T(`unknown position '${t}'`);const i=this.positions[n];if(!(s.quantity>0)||s.quantity>i.quantity+1e-12)return T(`invalid exit quantity ${s.quantity}: position holds ${i.quantity}`);if(!(s.price>0))return T(`price must be > 0, got ${s.price}`);const a=s.fee??0;if(a<0)return T("fee cannot be negative");const o=Math.max(i.highestPrice,s.price),r=Math.min(i.lowestPrice,s.price),l=(s.price-i.entryPrice)*s.quantity-a,u=i.quantity-s.quantity,d={...i,quantity:u,feesPaid:i.feesPaid+a,realizedPnl:i.realizedPnl+l,highestPrice:o,lowestPrice:r,exits:[...i.exits,{quantity:s.quantity,price:s.price,fee:a,slippage:s.slippage??0}]};return u>1e-12?(this.positions[n]=d,this.persist(),j(jt(d))):(this.positions.splice(n,1),this.persist(),this.journal.append(Ki(d,s)),j(null))}updateMarketPrice(t,s,n){if(!(s>0))return;let i=!1;this.positions=this.positions.map(a=>{if(a.symbol!==t)return a;const o=Math.max(a.highestPrice,s),r=Math.min(a.lowestPrice,s);return o===a.highestPrice&&r===a.lowestPrice?a:(i=!0,{...a,highestPrice:o,lowestPrice:r})}),i&&this.persist()}openPositions(){return this.positions.map(jt)}unrealizedPnl(t){return this.positions.reduce((s,n)=>{const i=t[n.symbol]??n.entryPrice;return s+(i-n.entryPrice)*n.quantity},0)}openRealizedPnl(){return this.positions.reduce((t,s)=>t+s.realizedPnl,0)}persist(){this.store.set(Ie,this.positions)}}function jt(e){const{exits:t,...s}=e;return s}function Ki(e,t){const s=e.exits.reduce((a,o)=>a+o.quantity,0),n=e.exits.reduce((a,o)=>a+o.price*o.quantity,0)/s,i=e.entryPrice*e.initialQuantity;return{id:e.id,symbol:e.symbol,entryTimestamp:e.openedAt,exitTimestamp:t.timestamp,entryPrice:e.entryPrice,exitPrice:n,positionSize:e.initialQuantity,stopLoss:e.stopLoss,takeProfit:e.takeProfit,exitReason:t.reason,fees:e.feesPaid,slippage:e.exits.reduce((a,o)=>a+o.slippage,0),holdingDurationMs:t.timestamp-e.openedAt,mfePct:(e.highestPrice-e.entryPrice)/e.entryPrice*100,maePct:(e.entryPrice-e.lowestPrice)/e.entryPrice*100,realizedPnl:e.realizedPnl,returnPct:i>0?e.realizedPnl/i*100:0,strategyVersion:e.strategyVersion,validationVerdict:e.validationVerdict,confidence:e.confidence,notes:e.notes}}const Ue=1,Ne={robust:3,caution:2,"insufficient-data":1,"not-run":1,overfitted:0};function Yi(e,t){const{price:s,timestamp:n}=t,i=[],a=(s-e.entryPrice)*e.quantity,o=(s-e.entryPrice)/e.entryPrice*100,r=(s-e.stopLoss)/s*100,l=(e.takeProfit-s)/s*100;return s<=e.stopLoss?i.push(`stop loss breached: price ${s} is at/below the ${e.stopLoss} stop — review this position now (informational only, nothing is closed automatically)`):r<=Ue&&i.push(`price is within ${Ue}% of the stop loss (${e.stopLoss}) — approaching the exit level`),s>=e.takeProfit&&i.push(`take-profit target ${e.takeProfit} reached — consider whether to realise gains`),t.regime==="cold"&&i.push("market regime has turned cold (bearish technical evidence) while this long position is open"),t.currentValidationVerdict!==void 0&&e.validationVerdict!==null&&Ne[t.currentValidationVerdict]<Ne[e.validationVerdict]&&i.push(`validation verdict deteriorated from '${e.validationVerdict}' at entry to '${t.currentValidationVerdict}' now`),{positionId:e.id,symbol:e.symbol,price:s,unrealizedPnl:a,pnlPct:o,distanceToStopPct:r,distanceToTargetPct:l,currentRisk:Math.max(s-e.stopLoss,0)*e.quantity,currentReward:Math.max(e.takeProfit-s,0)*e.quantity,timeInTradeMs:n-e.openedAt,regime:t.regime??null,warnings:i}}const Oe="trade-journal";class Ji{constructor(t){A(this,"records");this.store=t,this.records=t.get(Oe)??[]}append(t){if(this.records.some(s=>s.id===t.id))throw new Error(`journal entry '${t.id}' already exists — the journal is append-only`);Qi(t),this.records.push(t),this.store.set(Oe,this.records)}entries(){return this.records}}function Qi(e){if(!(e.positionSize>0))throw new RangeError(`positionSize must be > 0, got ${e.positionSize}`);if(!(e.entryPrice>0)||!(e.exitPrice>0))throw new RangeError("entry and exit prices must be positive");if(e.exitTimestamp<e.entryTimestamp)throw new RangeError("exitTimestamp cannot precede entryTimestamp");if(e.fees<0||e.slippage<0)throw new RangeError("fees and slippage cannot be negative")}const ft=1e4,Zi="USD",bt="1h",ta="pipeline-v1";function ea(e,t){const s=new wt,n=new Ji(s),i=new Xi(s,n),a=new Wi(s,i,{initialCash:ft,baseCurrency:Zi}),o=new Ai(s),r=new Ci(s),l=new qi({source:t.source,symbols:t.instruments.slice(0,12).map(p=>p.symbol),timeframe:bt,confirmationTimeframe:"4h",scheduler:new is,portfolio:a,positions:i,killSwitch:o,audit:r,getDailyLoss:()=>new mt(s).lossToday(Date.now()),onRealizedPnl:(p,m)=>new mt(s).record(p,m),store:s});l.resume()&&l.runCycleOnce(Date.now()).then(()=>{v(),h()}),e.innerHTML=`
    <h2>Portfolio</h2>
    <p class="status-line">
      Position tracking and analytics for simulated trades. Opening runs the full verified
      pipeline (scan → signal → risk); closing is your explicit action — or the paper
      autopilot's, using simulated money only.
    </p>
    <div id="pf-overview"></div>

    <h3>Paper Autopilot</h3>
    <p class="status-line">
      Trades completely autonomously with SIMULATED money: qualified entries via the
      verified pipeline, automatic stop-loss / take-profit exits, everything audited.
      No real orders exist anywhere in this platform — live trading would always require
      your explicit confirmation per trade.
    </p>
    <div class="controls">
      <label class="control">Cycle every
        <select id="ap-interval">
          ${["5m","15m","30m","1h","4h","1d"].map(p=>`<option value="${p}" ${p==="15m"?"selected":""}>${p}</option>`).join("")}
        </select>
      </label>
      <button class="primary" id="ap-start">Start autopilot</button>
      <button class="secondary" id="ap-stop">Stop</button>
      <button class="secondary" id="ap-cycle">Run cycle now</button>
      <button class="secondary" id="ap-kill">⛔ Kill switch</button>
    </div>
    <div class="status-line" id="ap-status"></div>
    <div id="ap-audit"></div>

    <div class="controls">
      <label class="control">Market
        <select id="pf-symbol">
          ${t.instruments.map(p=>`<option value="${k(p.symbol)}">${k(p.symbol)}</option>`).join("")}
        </select>
      </label>
      <button class="primary" id="pf-open">Open via pipeline</button>
      <button class="secondary" id="pf-refresh">Refresh prices</button>
    </div>
    <div class="status-line" id="pf-status"></div>
    <h3>Open positions</h3>
    <div id="pf-positions"></div>
    <h3>Closed trades (journal)</h3>
    <div id="pf-journal"></div>
    <h3>Analytics</h3>
    <div id="pf-analytics"></div>
    <h3>Performance feedback</h3>
    <div id="pf-feedback"></div>
    <h3>Backup</h3>
    <div class="controls">
      <button class="secondary" id="pf-export">Download backup</button>
      <label class="control">Restore from file
        <input id="pf-import" type="file" accept="application/json" />
      </label>
      <button class="secondary" id="pf-reset">Start fresh (erase simulated history)</button>
    </div>
    <div class="status-line" id="pf-backup-status"></div>
    <p class="disclaimer">
      Simulated positions only — no real orders exist anywhere in this platform. Metrics
      describe the past; they never promise future results.
    </p>
  `;const d=e.querySelector("#pf-status");async function c(p){const m=await t.source.getCandles(p,bt,150);if(!m.ok)return null;const g=xt(p,bt,m.value);return g.ok?g.value:null}async function h(){const p=a.openPositions(),m={},g={};for(const $ of p){const R=await c($.symbol);R&&(m[$.symbol]=R.snapshot.price,g[$.symbol]=R,i.updateMarketPrice($.symbol,R.snapshot.price,Date.now()))}const b=a.snapshot(m,Date.now());ia(e.querySelector("#pf-overview"),b),aa(e.querySelector("#pf-positions"),a,m,g,()=>void h(),d),oa(e.querySelector("#pf-journal"),n),ra(e.querySelector("#pf-analytics"),n),await sa(e.querySelector("#pf-feedback"),n,t)}e.querySelector("#pf-open").addEventListener("click",async()=>{const p=e.querySelector("#pf-symbol").value;d.textContent=`Running pipeline for ${p}…`;const m=await c(p);if(!m){d.innerHTML=`<span class="error-line">No market data for ${k(p)}</span>`;return}const g=kt(m);if(g.kind==="rejected"){d.innerHTML=`Signal Engine found no qualifying setup: ${k(g.reasons.join("; "))}`;return}const b=a.openPositions(),$=Pt(g.opportunity,{equity:a.snapshot({},Date.now()).equity,openPositions:b.map(w=>({symbol:w.symbol,quantity:w.quantity,entryPrice:w.entryPrice}))},{dailyLossSoFar:new mt(s).lossToday(Date.now())});if(!$.approved){d.innerHTML=`Risk Engine refused the trade: ${k($.reasons.join("; "))}`;return}const R=a.openFromAssessment($,{timestamp:Date.now(),confidence:g.opportunity.confidence,strategyVersion:ta});d.innerHTML=R.ok?`Opened ${k(p)}: ${R.value.quantity.toLocaleString("en-US",{maximumFractionDigits:6})} @ ${P(R.value.entryPrice)}`:`<span class="error-line">${k(R.error)}</span>`,await h()}),e.querySelector("#pf-refresh").addEventListener("click",()=>void h());const y=e.querySelector("#ap-status");function v(){const p=l.status(),m=[p.killSwitchEngaged?"⛔ KILL SWITCH ENGAGED — all automation halted":p.running?`Autopilot RUNNING (paper money, every ${p.interval})`:"Autopilot stopped.",p.lastCycleAt!==null?`Last cycle: ${new Date(p.lastCycleAt).toLocaleString()}`:"",p.running&&p.nextCycleAt!==null?`Next: ${new Date(p.nextCycleAt).toLocaleString()}`:"",p.lastCycle!==null&&!p.lastCycle.halted?`opened ${p.lastCycle.opened.length} / closed ${p.lastCycle.closed.length} / skipped ${p.lastCycle.skipped.length}`:""].filter(Boolean);y.textContent=m.join(" · "),na(e.querySelector("#ap-audit"),r)}e.querySelector("#ap-start").addEventListener("click",()=>{const p=e.querySelector("#ap-interval").value;l.start(p),v()}),e.querySelector("#ap-stop").addEventListener("click",()=>{l.stop(),v()}),e.querySelector("#ap-cycle").addEventListener("click",()=>{y.textContent="Running autopilot cycle…",l.runCycleOnce(Date.now()).then(async()=>{v(),await h()})}),e.querySelector("#ap-kill").addEventListener("click",()=>{o.isEngaged()?(o.disengage("dashboard-user"),r.append({timestamp:Date.now(),intentId:"kill-switch",event:"kill-switch-disengaged",mode:"paper",detail:"kill switch disengaged from the dashboard"})):(o.engage("engaged from the dashboard"),l.stop()),v()});const f=e.querySelector("#pf-backup-status");e.querySelector("#pf-export").addEventListener("click",()=>{const p=Fi(s,Date.now()),m=new Blob([JSON.stringify(p,null,2)],{type:"application/json"}),g=document.createElement("a");g.href=URL.createObjectURL(m),g.download=`trading-assistant-backup-${new Date().toISOString().slice(0,10)}.json`,g.click(),URL.revokeObjectURL(g.href),f.textContent=`Backup downloaded (${Object.keys(p.data).length} data sets).`}),e.querySelector("#pf-import").addEventListener("change",async p=>{var g;const m=(g=p.target.files)==null?void 0:g[0];if(m)try{const b=JSON.parse(await m.text()),$=Ii(s,b);f.innerHTML=$.ok?`Restored ${$.value.restoredKeys} data sets — reload the page to see them.`:`<span class="error-line">${k($.error)}</span>`}catch(b){f.innerHTML=`<span class="error-line">Could not read backup: ${k(String(b))}</span>`}}),e.querySelector("#pf-reset").addEventListener("click",()=>{if(!window.confirm("Erase ALL simulated data (positions, journal, audit, watchlists)? This cannot be undone — download a backup first if you want to keep it."))return;const m=Di(s);f.textContent=`Fresh start: ${m} data sets erased. Reloading…`,window.location.reload()}),v(),h()}async function sa(e,t,s){const n=t.entries();if(n.length===0){e.innerHTML='<p class="status-line">Feedback appears once closed trades accumulate — let the autopilot run.</p>';return}const i=ji(n),a=Bi(n),o=_i(n),r=Vi(n),l={};for(const d of new Set(n.map(c=>c.symbol))){const c=await s.source.getCandles(d,bt,150);c.ok&&c.value.length>1&&(l[d]={startPrice:c.value[0].close,endPrice:c.value[c.value.length-1].close})}const u=zi(n,ft,l);e.innerHTML=`
    ${u?`<div class="result-cards">
            <div class="stat-card"><div class="stat-label">System (realized)</div>
              <div class="stat-value ${I(u.strategyReturnPct)}">${C(u.strategyReturnPct)}</div></div>
            <div class="stat-card"><div class="stat-label">Buy &amp; hold same markets</div>
              <div class="stat-value ${I(u.holdReturnPct)}">${C(u.holdReturnPct)}</div></div>
            <div class="stat-card"><div class="stat-label">Verdict</div>
              <div class="stat-value">${u.beatBenchmark?"Beat holding":"Holding won"}</div></div>
          </div>`:""}
    <h4>Confidence calibration — do higher-confidence signals actually win more?</h4>
    <table class="data-table">
      <thead><tr><th>Confidence</th><th>Trades</th><th>Win rate</th><th>Expectancy</th><th>Total P&amp;L</th></tr></thead>
      <tbody>
        ${i.map(d=>`<tr>
              <td>${d.label}</td>
              <td>${d.tradeCount}</td>
              <td>${d.winRatePct===null?"—":C(d.winRatePct,0)}</td>
              <td>${d.expectancy===null?"—":P(d.expectancy)}</td>
              <td class="${I(d.totalPnl)}">${P(d.totalPnl)}</td>
            </tr>`).join("")}
      </tbody>
    </table>
    <h4>Exit quality</h4>
    <table class="data-table">
      <thead><tr><th>Exit reason</th><th>Trades</th><th>Win rate</th><th>Avg P&amp;L</th><th>Total</th></tr></thead>
      <tbody>
        ${a.map(d=>`<tr>
              <td>${k(d.reason)}</td>
              <td>${d.tradeCount}</td>
              <td>${d.winRatePct===null?"—":C(d.winRatePct,0)}</td>
              <td class="${I(d.avgPnl)}">${d.avgPnl===null?"—":P(d.avgPnl)}</td>
              <td class="${I(d.totalPnl)}">${P(d.totalPnl)}</td>
            </tr>`).join("")}
      </tbody>
    </table>
    <p class="status-line">
      Trade management: average best move ${o.avgMfePct===null?"—":C(o.avgMfePct)} ·
      average worst move ${o.avgMaePct===null?"—":C(-(o.avgMaePct??0))} ·
      captured ${o.avgCapturePct===null?"—":C(o.avgCapturePct,0)} of the best available move ·
      ${o.losersThatWereProfitable} loser(s) were once profitable.
    </p>
    <h4>By strategy</h4>
    <table class="data-table">
      <thead><tr><th>Strategy</th><th>Trades</th><th>Win rate</th><th>Profit factor</th><th>Total P&amp;L</th></tr></thead>
      <tbody>
        ${r.map(d=>`<tr>
              <td>${k(d.strategyVersion)}</td>
              <td>${d.stats.tradeCount}</td>
              <td>${d.stats.winRatePct===null?"—":C(d.stats.winRatePct,0)}</td>
              <td>${d.stats.profitFactor===null?"—":d.stats.profitFactor.toFixed(2)}</td>
              <td class="${I(d.stats.totalPnl)}">${P(d.stats.totalPnl)}</td>
            </tr>`).join("")}
      </tbody>
    </table>
  `}function na(e,t){const s=[...t.entries()].reverse().slice(0,15);if(s.length===0){e.innerHTML='<p class="status-line">No automated actions yet.</p>';return}e.innerHTML=`
    <table class="data-table">
      <thead><tr><th>Time</th><th>Event</th><th>Detail</th></tr></thead>
      <tbody>
        ${s.map(n=>`<tr>
              <td>${new Date(n.timestamp).toLocaleString()}</td>
              <td>${k(n.event)}</td>
              <td>${k(n.detail)}</td>
            </tr>`).join("")}
      </tbody>
    </table>
  `}function ia(e,t){e.innerHTML=`
    <div class="result-cards">
      <div class="stat-card"><div class="stat-label">Equity (${k(t.baseCurrency)})</div>
        <div class="stat-value">${P(t.equity)}</div></div>
      <div class="stat-card"><div class="stat-label">Cash available</div>
        <div class="stat-value">${P(t.cashAvailable)}</div></div>
      <div class="stat-card"><div class="stat-label">Open positions</div>
        <div class="stat-value">${t.openPositionCount}</div></div>
      <div class="stat-card"><div class="stat-label">Today's P&amp;L</div>
        <div class="stat-value ${I(t.dailyPnl)}">${P(t.dailyPnl)}</div></div>
      <div class="stat-card"><div class="stat-label">Total return</div>
        <div class="stat-value ${I(t.totalReturnPct)}">${C(t.totalReturnPct)}</div></div>
      <div class="stat-card"><div class="stat-label">Exposure</div>
        <div class="stat-value">${t.exposurePct.toFixed(1)}%</div></div>
    </div>
  `}function aa(e,t,s,n,i,a){const o=t.openPositions();if(o.length===0){e.innerHTML='<p class="status-line">No open positions.</p>';return}e.innerHTML=`
    <table class="data-table">
      <thead><tr>
        <th>Market</th><th>Entry</th><th>Price</th><th>Unrealized P&amp;L</th><th>Stop</th>
        <th>Target</th><th>Held</th><th>Confidence</th><th>Regime</th><th></th>
      </tr></thead>
      <tbody>
        ${o.map(l=>{var h;const u=s[l.symbol]??l.entryPrice,d=Yi(l,{price:u,timestamp:Date.now(),regime:(h=n[l.symbol])==null?void 0:h.temperature}),c=d.warnings.map(y=>`<li>⚠ ${k(y)}</li>`).join("");return`<tr>
              <td>${k(l.symbol)}</td>
              <td>${P(l.entryPrice)}</td>
              <td>${P(u)}</td>
              <td class="${I(d.unrealizedPnl)}">${P(d.unrealizedPnl)} (${C(d.pnlPct)})</td>
              <td>${P(l.stopLoss)}</td>
              <td>${P(l.takeProfit)}</td>
              <td>${(d.timeInTradeMs/36e5).toFixed(1)}h</td>
              <td>${l.confidence===null?"—":l.confidence.toFixed(0)}</td>
              <td>${d.regime??"—"}</td>
              <td>
                <button class="secondary" data-close-half="${k(l.id)}">Close ½</button>
                <button class="secondary" data-close-all="${k(l.id)}">Close</button>
              </td>
            </tr>${c?`<tr class="scan-detail"><td colspan="10"><ul class="scan-warnings">${c}</ul></td></tr>`:""}`}).join("")}
      </tbody>
    </table>
  `;const r=(l,u)=>{const d=t.openPositions().find(y=>y.id===l);if(!d)return;const c=s[d.symbol]??d.entryPrice,h=t.exit(l,{quantity:d.quantity*u,price:c,timestamp:Date.now(),reason:"manual"});a.innerHTML=h.ok?`Closed ${u===1?"all":"half"} of ${k(d.symbol)} @ ${P(c)}`:`<span class="error-line">${k(h.error)}</span>`,i()};e.querySelectorAll("[data-close-half]").forEach(l=>l.addEventListener("click",()=>r(l.dataset.closeHalf,.5))),e.querySelectorAll("[data-close-all]").forEach(l=>l.addEventListener("click",()=>r(l.dataset.closeAll,1)))}function oa(e,t){const s=[...t.entries()].reverse().slice(0,30);if(s.length===0){e.innerHTML='<p class="status-line">No closed trades yet.</p>';return}e.innerHTML=`
    <table class="data-table">
      <thead><tr>
        <th>Closed</th><th>Market</th><th>Entry</th><th>Exit</th><th>Size</th><th>P&amp;L</th>
        <th>Return</th><th>Held</th><th>MFE/MAE</th><th>Reason</th><th>Fees</th>
      </tr></thead>
      <tbody>
        ${s.map(n=>`<tr title="${k(n.notes??"")}">
              <td>${new Date(n.exitTimestamp).toLocaleString()}</td>
              <td>${k(n.symbol)}</td>
              <td>${P(n.entryPrice)}</td>
              <td>${P(n.exitPrice)}</td>
              <td>${n.positionSize.toLocaleString("en-US",{maximumFractionDigits:6})}</td>
              <td class="${I(n.realizedPnl)}">${P(n.realizedPnl)}</td>
              <td class="${I(n.returnPct)}">${C(n.returnPct)}</td>
              <td>${(n.holdingDurationMs/36e5).toFixed(1)}h</td>
              <td>+${n.mfePct.toFixed(1)}% / −${n.maePct.toFixed(1)}%</td>
              <td>${k(n.exitReason)}</td>
              <td>${P(n.fees)}</td>
            </tr>`).join("")}
      </tbody>
    </table>
  `}function ra(e,t){var r;const s=t.entries();if(s.length===0){e.innerHTML='<p class="status-line">Analytics appear after the first closed trade.</p>';return}const n=cs(s,{initialCash:ft}),i=ds(s,ft),a=Ni(i),o=Oi(s);e.innerHTML=`
    <div class="result-cards">
      <div class="stat-card"><div class="stat-label">Win rate</div>
        <div class="stat-value">${n.winRatePct===null?"—":C(n.winRatePct,0)}</div></div>
      <div class="stat-card"><div class="stat-label">Profit factor</div>
        <div class="stat-value">${n.profitFactor===null?"—":n.profitFactor.toFixed(2)}</div></div>
      <div class="stat-card"><div class="stat-label">Expectancy / trade</div>
        <div class="stat-value ${I(n.expectancy)}">${n.expectancy===null?"—":P(n.expectancy)}</div></div>
      <div class="stat-card"><div class="stat-label">Avg winner / loser</div>
        <div class="stat-value">${n.avgWinner===null?"—":P(n.avgWinner)} / ${n.avgLoser===null?"—":P(n.avgLoser)}</div></div>
      <div class="stat-card"><div class="stat-label">Largest gain / loss</div>
        <div class="stat-value">${n.largestGain===null?"—":P(n.largestGain)} / ${n.largestLoss===null?"—":P(n.largestLoss)}</div></div>
      <div class="stat-card"><div class="stat-label">Streaks (W/L)</div>
        <div class="stat-value">${n.maxConsecutiveWins} / ${n.maxConsecutiveLosses}</div></div>
      <div class="stat-card"><div class="stat-label">Max drawdown</div>
        <div class="stat-value">${C(-n.maxDrawdownPct)}</div></div>
      <div class="stat-card"><div class="stat-label">Recovery / Calmar</div>
        <div class="stat-value">${n.recoveryFactor===null?"—":n.recoveryFactor.toFixed(2)} / ${n.calmar===null?"—":n.calmar.toFixed(2)}</div></div>
    </div>
    <h4>Equity curve (realized)</h4>
    ${Bt(i.map(l=>({timestamp:l.timestamp,value:l.equity})),{lineClass:(((r=i[i.length-1])==null?void 0:r.equity)??0)>=ft?"equity-line-up":"equity-line-down",ariaLabel:"Realized equity curve"})}
    <h4>Drawdown</h4>
    ${Bt(a.map(l=>({timestamp:l.timestamp,value:-l.drawdownPct})),{lineClass:"equity-line-down",ariaLabel:"Rolling drawdown curve",height:100})}
    <h4>Monthly performance</h4>
    <table class="data-table">
      <thead><tr><th>Month</th><th>P&amp;L</th><th>Trades</th></tr></thead>
      <tbody>
        ${o.map(l=>`<tr>
              <td>${l.month}</td>
              <td class="${I(l.pnl)}">${P(l.pnl)}</td>
              <td>${l.tradeCount}</td>
            </tr>`).join("")}
      </tbody>
    </table>
  `}const He=600,je=150,Be=75,la=1e4,ca=[{fastPeriod:5,slowPeriod:20},{fastPeriod:10,slowPeriod:30},{fastPeriod:10,slowPeriod:50},{fastPeriod:20,slowPeriod:60}];function da(e,t){e.innerHTML=`
    <h2>Validation</h2>
    <p class="status-line">
      Walk-forward analysis: strategy parameters are chosen on a rolling training window,
      then judged on the unseen candles that follow — with fees, spread, and slippage
      included. Out-of-sample numbers are the ones that matter.
    </p>
    <div class="controls">
      <label class="control">Market
        <select id="val-symbol">
          ${t.instruments.map(a=>`<option value="${k(a.symbol)}">${k(a.symbol)}</option>`).join("")}
        </select>
      </label>
      <label class="control">Timeframe
        <select id="val-timeframe">
          <option value="1h" selected>1h</option>
          <option value="4h">4h</option>
          <option value="1d">1d</option>
        </select>
      </label>
      <label class="control">Fee %
        <input id="val-fee" type="number" value="0.1" min="0" max="2" step="0.05" />
      </label>
      <label class="control">Spread %
        <input id="val-spread" type="number" value="0.1" min="0" max="2" step="0.05" />
      </label>
      <label class="control">Slippage %
        <input id="val-slippage" type="number" value="0.05" min="0" max="2" step="0.05" />
      </label>
      <button class="primary" id="val-run">Run walk-forward</button>
    </div>
    <div class="status-line" id="val-status"></div>
    <div id="val-results"></div>
    <p class="disclaimer">
      Validation measures how a strategy behaved on unseen historical data with realistic
      costs. It cannot predict the future and is not financial advice.
    </p>
  `;const s=e.querySelector("#val-run"),n=e.querySelector("#val-status"),i=e.querySelector("#val-results");s.addEventListener("click",async()=>{s.disabled=!0,i.innerHTML="";const a=e.querySelector("#val-symbol").value,o=e.querySelector("#val-timeframe").value,r=Number(e.querySelector("#val-fee").value)/100,l=Number(e.querySelector("#val-spread").value)/100,u=Number(e.querySelector("#val-slippage").value)/100;n.textContent=`Loading ${He} ${o} candles for ${a}…`;try{const d=await t.source.getCandles(a,o,He);if(!d.ok){n.innerHTML=`<span class="error-line">${k(d.error)}</span>`;return}n.textContent=`Running walk-forward on ${d.value.length} candles…`;const c={initialCash:la,feeRate:r,spreadPct:l,slippagePct:u,executionDelayCandles:1},h=ls(d.value,rs(ca,c),{trainSize:je,testSize:Be,timeframe:o,backtest:c}),y=as({avgTrainReturnPct:h.aggregate.avgTrainReturnPct,avgTestReturnPct:h.aggregate.avgTestReturnPct,avgTrainSharpe:h.aggregate.avgTrainSharpe,avgTestSharpe:h.aggregate.avgTestSharpe,totalTestTrades:h.aggregate.totalTestTrades,foldCount:h.folds.length,avgTestWinRatePct:h.aggregate.avgTestWinRatePct,parameterSpread:ua(h)});n.textContent=`${a} · ${h.folds.length} folds (train ${je} / test ${Be}) · costs: ${(r*100).toFixed(2)}% fee, ${(l*100).toFixed(2)}% spread, ${(u*100).toFixed(2)}% slippage, 1-candle delay · source: ${t.source.name}`,ha(i,h,y)}catch(d){n.innerHTML=`<span class="error-line">Validation failed: ${k(String(d))}</span>`}finally{s.disabled=!1}})}function ua(e){const t=e.folds.map(s=>{if(!s.diagnostics)return null;const n=s.diagnostics.evaluated.map(o=>o.returnPct).sort((o,r)=>o-r),i=n[Math.floor(n.length/2)],a=s.diagnostics.evaluated.find(o=>o.params===s.diagnostics.chosen);return a?{chosen:a.returnPct,median:i}:null}).filter(s=>s!==null);if(t.length!==0)return{chosenReturnPct:t.reduce((s,n)=>s+n.chosen,0)/t.length,medianReturnPct:t.reduce((s,n)=>s+n.median,0)/t.length}}function ha(e,t,s){const n=t.aggregate;e.innerHTML=`
    <div class="verdict-panel verdict-${s.verdict}">
      <div class="signal-title">Verdict: ${pa(s.verdict)}</div>
      <p>${k(s.explanation)}</p>
      ${s.flags.length>0?`<ul class="scan-warnings">${s.flags.map(i=>`<li>⚠ <strong>${i.kind}</strong>: ${k(i.detail)}</li>`).join("")}</ul>`:""}
    </div>

    <h3>Out-of-sample equity (all folds, costs included)</h3>
    ${fa(t.oosEquityCurve)}

    <h3>Training vs unseen data</h3>
    <div class="result-cards">
      <div class="stat-card"><div class="stat-label">Avg return (train)</div>
        <div class="stat-value ${I(n.avgTrainReturnPct)}">${C(n.avgTrainReturnPct)}</div></div>
      <div class="stat-card"><div class="stat-label">Avg return (unseen)</div>
        <div class="stat-value ${I(n.avgTestReturnPct)}">${C(n.avgTestReturnPct)}</div></div>
      <div class="stat-card"><div class="stat-label">Degradation</div>
        <div class="stat-value">${n.degradationPct===null?"—":C(n.degradationPct,0)}</div></div>
      <div class="stat-card"><div class="stat-label">Sharpe (unseen)</div>
        <div class="stat-value">${n.avgTestSharpe===null?"—":n.avgTestSharpe.toFixed(2)}</div></div>
      <div class="stat-card"><div class="stat-label">Win rate (unseen)</div>
        <div class="stat-value">${n.avgTestWinRatePct===null?"—":C(n.avgTestWinRatePct,0)}</div></div>
      <div class="stat-card"><div class="stat-label">OOS trades</div>
        <div class="stat-value">${n.totalTestTrades}</div></div>
    </div>

    <h3>Per-fold results (${k(t.strategyName)})</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>Fold</th><th>Params</th><th>Train return</th><th>Unseen return</th>
          <th>Unseen trades</th><th>Win rate</th><th>Profit factor</th>
          <th>Expectancy</th><th>Max DD</th><th>Avg hold</th>
        </tr>
      </thead>
      <tbody>
        ${t.folds.map(i=>`<tr>
              <td>${i.foldIndex+1}</td>
              <td>${k(i.chosenParams??"—")}</td>
              <td class="${I(i.train.totalReturnPct)}">${C(i.train.totalReturnPct)}</td>
              <td class="${I(i.test.totalReturnPct)}">${C(i.test.totalReturnPct)}</td>
              <td>${i.test.tradeCount}</td>
              <td>${i.test.winRatePct===null?"—":C(i.test.winRatePct,0)}</td>
              <td>${i.test.profitFactor===null?"—":i.test.profitFactor.toFixed(2)}</td>
              <td>${i.test.expectancy===null?"—":P(i.test.expectancy)}</td>
              <td>${C(-i.test.maxDrawdownPct)}</td>
              <td>${ma(i.test.avgHoldingTimeMs)}</td>
            </tr>`).join("")}
      </tbody>
    </table>
  `}function pa(e){return{robust:"ROBUST — no checks triggered",caution:"CAUTION — treat with scepticism",overfitted:"OVERFITTED — do not trust this configuration","insufficient-data":"INSUFFICIENT DATA — no conclusion possible"}[e]}function ma(e){if(e===null)return"—";const t=e/36e5;return t<48?`${t.toFixed(1)}h`:`${(t/24).toFixed(1)}d`}function fa(e){if(e.length<2)return'<p class="status-line">Not enough points for a curve.</p>';const t=e[e.length-1].equity;return`${Bt(e.map(n=>({timestamp:n.timestamp,value:n.equity})),{lineClass:t>=100?"equity-line-up":"equity-line-down",ariaLabel:`Out-of-sample equity curve from ${e[0].equity.toFixed(1)} to ${t.toFixed(1)}`})}<p class="status-line">Start 100 → end ${t.toFixed(1)} (${C(t-100)})</p>`}const ya={home:Ys,value:yn,markets:an,history:rn},ga={backtest:qn,grid:In,portfolio:Ti,positions:ea,validation:da,monitoring:wi,scan:Wn,learn:null};function va(e){const t=document.getElementById("data-source-banner");if(t)if(t.hidden=!1,e.kind==="revolut")t.classList.add("live"),t.textContent=`Connected to ${e.source.name} — live data, read-only.`;else if(e.kind==="public")t.classList.add("live"),t.textContent=`Live market data (${e.source.name.replace(" (read-only)","")}) — read-only.`;else{const s=e.diagnostics.length>0?` [${e.diagnostics.join(" · ")}]`:"";t.textContent=`Live data unavailable — showing DEMO data, not real prices.${s}`}}async function ba(){const e=await Ns();va(e);const t=new Set,s=new Set,n=new Map;let i=null;function a(l){var d,c;document.querySelectorAll(".view").forEach(h=>{h.classList.toggle("active",h.id===`view-${l}`)}),document.querySelectorAll(".nav-btn").forEach(h=>{h.classList.toggle("active",h.dataset.nav===l)}),i&&i!==l&&((d=n.get(i))==null||d.pause());const u=ya[l];if(u){const h=document.getElementById(`view-${l}`);if(h)if(t.has(l))(c=n.get(l))==null||c.resume();else{const y=u(h,e);y&&n.set(l,y),t.add(l)}}i=l,l==="tools"&&o(),window.scrollTo({top:0})}function o(){const l=document.getElementById("tools-menu"),u=document.getElementById("tool-detail");l&&(l.hidden=!1),u&&(u.hidden=!0)}function r(l){const u=document.getElementById("tools-menu"),d=document.getElementById("tool-detail");u&&(u.hidden=!0),d&&(d.hidden=!1),document.querySelectorAll(".tab-panel").forEach(h=>{h.classList.toggle("active",h.id===`tab-${l}`)});const c=ga[l];if(c&&!s.has(l)){const h=document.getElementById(`tab-${l}`);h&&(c(h,e),s.add(l))}window.scrollTo({top:0})}document.addEventListener("click",l=>{const u=l.target,d=u.closest("[data-nav]");if(d){a(d.dataset.nav);return}const c=u.closest("[data-tab]");if(c){r(c.dataset.tab);return}u.closest("[data-tool-back]")&&o()}),a("home"),$a(e)}async function $a(e){const t=document.getElementById("topbar-btc");if(!t)return;const s=Ge(e);if(!s)return;async function n(){const i=await We(e,s,"Bitcoin");if(!i||!t)return;const a=i.changePct>=0;t.hidden=!1,t.innerHTML=`<span class="tb-label">BTC</span><span class="tb-price">€${P(i.price)}</span><span class="chg ${a?"up":"down"}">${C(i.changePct)}</span>`}await n(),window.setInterval(()=>void n(),2e4)}ba();
//# sourceMappingURL=index-Cbp-C8pk.js.map
