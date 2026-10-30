var On=Object.defineProperty;var Bn=(e,t,s)=>t in e?On(e,t,{enumerable:!0,configurable:!0,writable:!0,value:s}):e[t]=s;var J=(e,t,s)=>Bn(e,typeof t!="symbol"?t+"":t,s);(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))n(i);new MutationObserver(i=>{for(const a of i)if(a.type==="childList")for(const o of a.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&n(o)}).observe(document,{childList:!0,subtree:!0});function s(i){const a={};return i.integrity&&(a.integrity=i.integrity),i.referrerPolicy&&(a.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?a.credentials="include":i.crossOrigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function n(i){if(i.ep)return;i.ep=!0;const a=s(i);fetch(i.href,a)}})();var _n="@vercel/analytics",Vn="1.6.1",jn=()=>{window.va||(window.va=function(...t){(window.vaq=window.vaq||[]).push(t)})};function en(){return typeof window<"u"}function tn(){try{const e="production"}catch{}return"production"}function Gn(e="auto"){if(e==="auto"){window.vam=tn();return}window.vam=e}function Wn(){return(en()?window.vam:tn())||"production"}function Ct(){return Wn()==="development"}function Xn(e){return e.scriptSrc?e.scriptSrc:Ct()?"https://va.vercel-scripts.com/v1/script.debug.js":e.basePath?`${e.basePath}/insights/script.js`:"/_vercel/insights/script.js"}function zn(e={debug:!0}){var t;if(!en())return;Gn(e.mode),jn(),e.beforeSend&&((t=window.va)==null||t.call(window,"beforeSend",e.beforeSend));const s=Xn(e);if(document.head.querySelector(`script[src*="${s}"]`))return;const n=document.createElement("script");n.src=s,n.defer=!0,n.dataset.sdkn=_n+(e.framework?`/${e.framework}`:""),n.dataset.sdkv=Vn,e.disableAutoTrack&&(n.dataset.disableAutoTrack="1"),e.endpoint?n.dataset.endpoint=e.endpoint:e.basePath&&(n.dataset.endpoint=`${e.basePath}/insights`),e.dsn&&(n.dataset.dsn=e.dsn),n.onerror=()=>{const i=Ct()?"Please check if any ad blockers are enabled and try again.":"Be sure to enable Web Analytics for your project and deploy again. See https://vercel.com/docs/analytics/quickstart for more information.";console.log(`[Vercel Web Analytics] Failed to load script from ${s}. ${i}`)},Ct()&&e.debug===!1&&(n.dataset.debug="false"),document.head.appendChild(n)}const mt={"1m":6e4,"5m":3e5,"15m":9e5,"30m":18e5,"1h":36e5,"4h":144e5,"1d":864e5,"1w":6048e5};function ce(e){return{ok:!0,value:e}}function C(e){return{ok:!1,error:e}}const Kn=1e11;function es(e){return e<Kn?e*1e3:e}function sn(e){return typeof e=="number"&&Number.isFinite(e)}function Ge(e,t){for(const s of t){const n=e[s];if(sn(n))return n;if(typeof n=="string"&&n.trim()!==""&&Number.isFinite(Number(n)))return Number(n)}}function Yn(e){if(Array.isArray(e)){if(e.length<6)return C(`candle array too short: length ${e.length}`);const t=e.slice(0,6).map(d=>typeof d=="string"?Number(d):d);if(!t.every(sn))return C("candle array contains non-numeric values");const[s,n,i,a,o,r]=t;return ts({timestamp:es(s),open:n,high:i,low:a,close:o,volume:r})}if(typeof e=="object"&&e!==null){const t=e,s=Ge(t,["timestamp","time","t","start","openTime","start_time","startTime"]),n=Ge(t,["open","o"]),i=Ge(t,["high","h"]),a=Ge(t,["low","l"]),o=Ge(t,["close","c"]),r=Ge(t,["volume","v","vol"]);return s===void 0?C("candle object missing timestamp"):n===void 0||i===void 0||a===void 0||o===void 0?C("candle object missing OHLC field(s)"):ts({timestamp:es(s),open:n,high:i,low:a,close:o,volume:r??0})}return C(`unsupported candle payload type: ${typeof e}`)}function ts(e){return e.timestamp<=0?C(`invalid timestamp: ${e.timestamp}`):e.open<0||e.high<0||e.low<0||e.close<0?C("negative price"):e.volume<0?C("negative volume"):e.high<Math.max(e.open,e.close)?C("high below open/close"):e.low>Math.min(e.open,e.close)?C("low above open/close"):e.low>e.high?C("low above high"):ce(e)}function Wt(e){const t=new Map,s=[];return e.forEach((i,a)=>{const o=Yn(i);o.ok?t.set(o.value.timestamp,o.value):s.push({index:a,reason:o.error})}),{candles:[...t.values()].sort((i,a)=>i.timestamp-a.timestamp),rejected:s}}const Jn="/api/revx",Qn=15e3,Zn={"1m":1,"5m":5,"15m":15,"30m":30,"1h":60,"4h":240,"1d":1440,"1w":10080};class ea{constructor(t={}){J(this,"name","Revolut X (read-only)");J(this,"baseUrl");J(this,"fetchFn");J(this,"now");J(this,"timeoutMs");this.baseUrl=(t.baseUrl??Jn).replace(/\/$/,""),this.fetchFn=t.fetchFn??((s,n)=>fetch(s,n)),this.now=t.now??(()=>Date.now()),this.timeoutMs=t.timeoutMs??Qn}async getJson(t){const s=`${this.baseUrl}${t}`,n=new AbortController,i=setTimeout(()=>n.abort(),this.timeoutMs);try{const a=await this.fetchFn(s,{method:"GET",headers:{Accept:"application/json"},signal:n.signal});return a.ok?ce(await a.json()):C(`HTTP ${a.status} from ${s}`)}catch(a){const o=a instanceof Error?a.message:String(a);return C(`request failed for ${s}: ${o}`)}finally{clearTimeout(i)}}async getInstruments(){const t=await this.getJson("/configuration/pairs");if(!t.ok)return t;const s=t.value;if(typeof s!="object"||s===null||Array.isArray(s))return C("unexpected pairs payload: expected an object keyed by symbol");const n="data"in s?s.data:s;if(typeof n!="object"||n===null)return C("unexpected pairs payload: no pair map found");const i=[];for(const a of Object.keys(n)){const[o,r]=a.split("-");o&&r&&i.push({symbol:a,base:o,quote:r})}return i.length===0?C("no parseable trading pairs in payload"):ce(i)}async getCandles(t,s,n){var m;if(n<=0)return C(`limit must be positive, got ${n}`);const i=Zn[s],a=this.now(),o=a-n*mt[s],r=`/candles/${encodeURIComponent(t)}?interval=${i}&since=${o}&until=${a}`,d=await this.getJson(r);if(!d.ok)return d;const c=d.value,l=typeof c=="object"&&c!==null&&Array.isArray(c.data)?c.data:Array.isArray(c)?c:void 0;if(l===void 0)return C("unexpected candles payload shape");const{candles:u,rejected:h}=Wt(l);return u.length===0?C(h.length>0?`all ${h.length} candle rows invalid (first: ${(m=h[0])==null?void 0:m.reason})`:"empty candle series"):ce(u)}}const ta="https://api.exchange.coinbase.com",sa=15e3,na={"1m":{granularitySec:60,group:1},"5m":{granularitySec:300,group:1},"15m":{granularitySec:900,group:1},"30m":{granularitySec:900,group:2},"1h":{granularitySec:3600,group:1},"4h":{granularitySec:3600,group:4},"1d":{granularitySec:86400,group:1},"1w":{granularitySec:86400,group:7}},aa=[{symbol:"BTC-EUR",base:"BTC",quote:"EUR"},{symbol:"ETH-EUR",base:"ETH",quote:"EUR"},{symbol:"SOL-EUR",base:"SOL",quote:"EUR"},{symbol:"XRP-EUR",base:"XRP",quote:"EUR"},{symbol:"ADA-EUR",base:"ADA",quote:"EUR"},{symbol:"DOGE-EUR",base:"DOGE",quote:"EUR"},{symbol:"LTC-EUR",base:"LTC",quote:"EUR"},{symbol:"DOT-EUR",base:"DOT",quote:"EUR"},{symbol:"LINK-EUR",base:"LINK",quote:"EUR"},{symbol:"AVAX-EUR",base:"AVAX",quote:"EUR"},{symbol:"UNI-EUR",base:"UNI",quote:"EUR"},{symbol:"FIL-EUR",base:"FIL",quote:"EUR"},{symbol:"AAVE-EUR",base:"AAVE",quote:"EUR"},{symbol:"ATOM-EUR",base:"ATOM",quote:"EUR"},{symbol:"XLM-EUR",base:"XLM",quote:"EUR"},{symbol:"ALGO-EUR",base:"ALGO",quote:"EUR"}];class ia{constructor(t={}){J(this,"name","Coinbase public market data (read-only)");J(this,"fetchFn");J(this,"timeoutMs");this.fetchFn=t.fetchFn??((s,n)=>fetch(s,n)),this.timeoutMs=t.timeoutMs??sa}getInstruments(){return Promise.resolve(ce([...aa]))}async getCandles(t,s,n){var m;if(n<=0)return C(`limit must be positive, got ${n}`);const{granularitySec:i,group:a}=na[s],o=`${ta}/products/${encodeURIComponent(t)}/candles?granularity=${i}`,r=await this.getJson(o);if(!r.ok)return r;const d=r.value;if(!Array.isArray(d)){const p=typeof d=="object"&&d!==null&&"message"in d?String(d.message):"not an array";return C(`unexpected Coinbase payload: ${p}`)}const c=d.filter(p=>Array.isArray(p)&&p.length>=6).map(p=>[p[0],p[3],p[2],p[1],p[4],p[5]]),{candles:l,rejected:u}=Wt(c);if(l.length===0)return C(u.length>0?`all ${u.length} Coinbase rows invalid (first: ${(m=u[0])==null?void 0:m.reason})`:"empty candle series from Coinbase");const h=a===1?l:oa(l,i*a*1e3);return ce(h.slice(-n))}async getJson(t){const s=new AbortController,n=setTimeout(()=>s.abort(),this.timeoutMs);try{const i=await this.fetchFn(t,{method:"GET",headers:{Accept:"application/json"},signal:s.signal});return i.ok?ce(await i.json()):C(`HTTP ${i.status} from ${t}`)}catch(i){const a=i instanceof Error?i.message:String(i);return C(`request failed for ${t}: ${a}`)}finally{clearTimeout(n)}}}function oa(e,t){const s=new Map;for(const a of e){const o=a.timestamp-a.timestamp%t,r=s.get(o)??[];r.push(a),s.set(o,r)}const n=[...s.keys()].sort((a,o)=>a-o),i=[];return n.forEach((a,o)=>{const r=s.get(a);o===0&&r[0].timestamp!==a||i.push({timestamp:a,open:r[0].open,high:Math.max(...r.map(d=>d.high)),low:Math.min(...r.map(d=>d.low)),close:r[r.length-1].close,volume:r.reduce((d,c)=>d+c.volume,0)})}),i}const Ke="https://api.kraken.com/0/public",ra=15e3,la=150,ca={"1m":1,"5m":5,"15m":15,"30m":30,"1h":60,"4h":240,"1d":1440,"1w":10080},ht=[{symbol:"XBTEUR",base:"BTC",quote:"EUR"},{symbol:"ETHEUR",base:"ETH",quote:"EUR"},{symbol:"SOLEUR",base:"SOL",quote:"EUR"},{symbol:"XRPEUR",base:"XRP",quote:"EUR"},{symbol:"ADAEUR",base:"ADA",quote:"EUR"},{symbol:"DOGEEUR",base:"DOGE",quote:"EUR"},{symbol:"LTCEUR",base:"LTC",quote:"EUR"},{symbol:"DOTEUR",base:"DOT",quote:"EUR"},{symbol:"LINKEUR",base:"LINK",quote:"EUR"},{symbol:"AVAXEUR",base:"AVAX",quote:"EUR"},{symbol:"UNIEUR",base:"UNI",quote:"EUR"},{symbol:"FILEUR",base:"FIL",quote:"EUR"},{symbol:"AAVEEUR",base:"AAVE",quote:"EUR"},{symbol:"ATOMEUR",base:"ATOM",quote:"EUR"},{symbol:"XLMEUR",base:"XLM",quote:"EUR"},{symbol:"ALGOEUR",base:"ALGO",quote:"EUR"},{symbol:"HNTEUR",base:"HNT",quote:"EUR"},{symbol:"VELOEUR",base:"VELO",quote:"EUR"},{symbol:"AEROEUR",base:"AERO",quote:"EUR"},{symbol:"ENAEUR",base:"ENA",quote:"EUR"}],da=new Set(ht.map(e=>e.base)),ua={XBT:"BTC",XDG:"DOGE"},pa=new Map(ht.map(e=>[e.base,e.symbol])),ha=[{symbol:"POLEUR",base:"POL",quote:"EUR"},{symbol:"TRXEUR",base:"TRX",quote:"EUR"},{symbol:"BCHEUR",base:"BCH",quote:"EUR"},{symbol:"ETCEUR",base:"ETC",quote:"EUR"},{symbol:"NEAREUR",base:"NEAR",quote:"EUR"},{symbol:"INJEUR",base:"INJ",quote:"EUR"},{symbol:"ARBEUR",base:"ARB",quote:"EUR"},{symbol:"OPEUR",base:"OP",quote:"EUR"},{symbol:"APTEUR",base:"APT",quote:"EUR"},{symbol:"PAXGEUR",base:"PAXG",quote:"EUR"}];class ma{constructor(t={}){J(this,"name","Kraken public market data (read-only)");J(this,"fetchFn");J(this,"now");J(this,"timeoutMs");J(this,"staggerMs");J(this,"pending",[]);J(this,"draining",!1);J(this,"instrumentsCache",null);J(this,"pairKeyToSymbol",null);this.fetchFn=t.fetchFn??((s,n)=>fetch(s,n)),this.now=t.now??(()=>Date.now()),this.timeoutMs=t.timeoutMs??ra,this.staggerMs=t.staggerMs??la}async getInstruments(){if(this.instrumentsCache)return ce([...this.instrumentsCache]);const t=new Set(ht.map(a=>a.symbol)),s=await this.fetchEurPairs(),n=(s.ok?s.value:ha).filter(a=>!t.has(a.symbol)),i=[...ht,...n];return this.instrumentsCache=i,ce([...i])}async fetchEurPairs(){const t=await this.enqueue(()=>this.getJson(`${Ke}/AssetPairs`),!0);if(!t.ok)return t;const s=t.value;if(Array.isArray(s.error)&&s.error.length>0)return C(`Kraken error: ${s.error.join("; ")}`);const n=s.result;if(typeof n!="object"||n===null)return C("unexpected Kraken payload: no result object");const i=[],a=new Map;for(const[o,r]of Object.entries(n)){const d=r;if(d.status!=="online"||typeof d.wsname!="string"||typeof d.altname!="string")continue;const[c,l]=d.wsname.split("/");if(l!=="EUR"||!c)continue;const u=ua[c]??c,h=pa.get(u)??d.altname;i.push({symbol:h,base:u,quote:"EUR"}),a.set(o,h)}return i.length===0?C("no online EUR pairs found in AssetPairs response"):(this.pairKeyToSymbol=a,ce(i))}async getTickers(){await this.getInstruments();const t=this.pairKeyToSymbol;if(!t||t.size===0)return C("EUR pair map unavailable — cannot map Kraken ticker keys to symbols");const s=await this.enqueue(()=>this.getJson(`${Ke}/Ticker`),!0);if(!s.ok)return s;const n=s.value;if(Array.isArray(n.error)&&n.error.length>0)return C(`Kraken error: ${n.error.join("; ")}`);if(typeof n.result!="object"||n.result===null)return C("unexpected Kraken payload: no result object");const i=[];for(const[a,o]of Object.entries(n.result)){const r=t.get(a);if(r===void 0)continue;const d=o,c=Me(ba(d.c)),l=Me(d.o);if(c===null||l===null)continue;const u=Me(lt(d.v))??0,h=Me(lt(d.p))??c;i.push({symbol:r,price:c,open:l,high:Me(lt(d.h))??c,low:Me(lt(d.l))??c,volume:u,quoteVolume:u*h})}return ce(i)}async getCandles(t,s,n,i){var f;if(n<=0)return C(`limit must be positive, got ${n}`);const a=ca[s],o=Math.floor((this.now()-(n+2)*a*6e4)/1e3),r=`${Ke}/OHLC?pair=${encodeURIComponent(t)}&interval=${a}&since=${o}`,d=await this.enqueue(()=>this.getJson(r),(i==null?void 0:i.priority)??!1);if(!d.ok)return d;const c=d.value;if(Array.isArray(c.error)&&c.error.length>0)return C(`Kraken error: ${c.error.join("; ")}`);const l=c.result;if(typeof l!="object"||l===null)return C("unexpected Kraken payload: no result object");const u=Object.keys(l).find(y=>y!=="last"),h=u!==void 0?l[u]:void 0;if(!Array.isArray(h))return C("unexpected Kraken payload: no OHLC rows");const m=h.filter(y=>Array.isArray(y)&&y.length>=7).map(y=>[y[0],y[1],y[2],y[3],y[4],y[6]]),{candles:p,rejected:v}=Wt(m);return p.length===0?C(v.length>0?`all ${v.length} Kraken rows invalid (first: ${(f=v[0])==null?void 0:f.reason})`:"empty candle series from Kraken"):ce(p.slice(-n))}async getOrderBook(t,s=15){const n=`${Ke}/Depth?pair=${encodeURIComponent(t)}&count=${s}`,i=await this.enqueue(()=>this.getJson(n),!0);if(!i.ok)return i;const a=i.value;if(Array.isArray(a.error)&&a.error.length>0)return C(`Kraken error: ${a.error.join("; ")}`);const o=a.result;if(typeof o!="object"||o===null)return C("unexpected Kraken payload: no result object");const r=Object.keys(o)[0],d=r!==void 0?o[r]:void 0;if(!d||!Array.isArray(d.asks)||!Array.isArray(d.bids))return C("unexpected Kraken payload: no order book rows");const c=l=>l.filter(u=>Array.isArray(u)&&u.length>=2).map(u=>({price:Me(u[0])??0,volume:Me(u[1])??0})).filter(u=>u.price>0&&u.volume>0);return ce({bids:c(d.bids),asks:c(d.asks)})}async getRecentTrades(t,s=30){const n=`${Ke}/Trades?pair=${encodeURIComponent(t)}&count=${s}`,i=await this.enqueue(()=>this.getJson(n),!0);if(!i.ok)return i;const a=i.value;if(Array.isArray(a.error)&&a.error.length>0)return C(`Kraken error: ${a.error.join("; ")}`);const o=a.result;if(typeof o!="object"||o===null)return C("unexpected Kraken payload: no result object");const r=Object.keys(o).find(l=>l!=="last"),d=r!==void 0?o[r]:void 0;if(!Array.isArray(d))return C("unexpected Kraken payload: no trade rows");const c=d.filter(l=>Array.isArray(l)&&l.length>=4).map(l=>{const u=Me(l[0]),h=Me(l[1]),m=Me(l[2]);return u===null||h===null||m===null?null:{price:u,volume:h,time:Math.round(m*1e3),side:l[3]==="b"?"buy":"sell"}}).filter(l=>l!==null).reverse();return ce(c)}enqueue(t,s=!1){return new Promise((n,i)=>{const a={run:t,resolve:n,reject:i};s?this.pending.unshift(a):this.pending.push(a),this.drain()})}async drain(){if(!this.draining){this.draining=!0;try{for(;this.pending.length>0;){const t=this.pending.shift();try{t.resolve(await t.run())}catch(s){t.reject(s)}this.pending.length>0&&await new Promise(s=>setTimeout(s,this.staggerMs))}}finally{this.draining=!1}}}async getJson(t){let s=`request failed for ${t}`;for(let n=0;n<=ss;n++){n>0&&await ya(va*2**(n-1));const i=await this.getJsonOnce(t);if(i.ok||(s=i.error,!fa(i.error)))return i}return C(`${s} (after ${ss} retries)`)}async getJsonOnce(t){const s=new AbortController,n=setTimeout(()=>s.abort(),this.timeoutMs);try{const i=await this.fetchFn(t,{method:"GET",headers:{Accept:"application/json"},signal:s.signal});return i.ok?ce(await i.json()):C(`HTTP ${i.status} from ${t}`)}catch(i){const a=i instanceof Error?i.message:String(i);return C(`request failed for ${t}: ${a}`)}finally{clearTimeout(n)}}}const ss=3,va=500,ya=e=>new Promise(t=>setTimeout(t,e));function fa(e){return/HTTP (429|5\d\d) /.test(e)}function Me(e){if(typeof e!="string"&&typeof e!="number")return null;const t=typeof e=="number"?e:Number.parseFloat(e);return Number.isFinite(t)?t:null}function ba(e){return Array.isArray(e)?e[0]:e}function lt(e){return Array.isArray(e)?e[1]??e[0]:e}function ga(e){let t=e>>>0;return()=>{t=t+1831565813>>>0;let s=t;return s=Math.imul(s^s>>>15,s|1),s^=s+Math.imul(s^s>>>7,s|61),((s^s>>>14)>>>0)/4294967296}}function wa(e){let t=2166136261;for(let s=0;s<e.length;s++)t^=e.charCodeAt(s),t=Math.imul(t,16777619);return t>>>0}function $a(e){const{seed:t,startPrice:s,count:n,timeframe:i,startTimestamp:a,drift:o=0,volatility:r=.01,baseVolume:d=1e3}=e,c=ga(t),l=mt[i],u=[];let h=s;for(let m=0;m<n;m++){const p=h,v=(c()*2-1)*r,f=Math.max(p*(1+o+v),1e-6),y=c()*r*p,b=c()*r*p,w=Math.max(p,f)+y,T=Math.max(Math.min(p,f)-b,1e-6),x=d*(.5+c());u.push({timestamp:a+m*l,open:p,high:w,low:T,close:f,volume:x}),h=f}return u}const Sa=[{symbol:"BTC/USD",base:"BTC",quote:"USD"},{symbol:"ETH/USD",base:"ETH",quote:"USD"},{symbol:"SOL/USD",base:"SOL",quote:"USD"},{symbol:"XRP/USD",base:"XRP",quote:"USD"},{symbol:"ADA/USD",base:"ADA",quote:"USD"},{symbol:"DOGE/USD",base:"DOGE",quote:"USD"},{symbol:"LTC/USD",base:"LTC",quote:"USD"},{symbol:"DOT/USD",base:"DOT",quote:"USD"}],ns={"BTC/USD":65e3,"ETH/USD":3400,"SOL/USD":150,"XRP/USD":.52,"ADA/USD":.45,"DOGE/USD":.12,"LTC/USD":82,"DOT/USD":6.4},ka={"BTC/USD":.0012,"ETH/USD":8e-4,"SOL/USD":.002,"XRP/USD":-.0012,"ADA/USD":-.002,"DOGE/USD":1e-4,"LTC/USD":-3e-4,"DOT/USD":4e-4};class xa{constructor(t){J(this,"name","Demo data (synthetic)");this.anchorTimestamp=t}getInstruments(){return Promise.resolve(ce([...Sa]))}getCandles(t,s,n){if(!(t in ns))return Promise.resolve(C(`No demo data for unlisted symbol: ${t}`));const i=mt[s],a=this.anchorTimestamp-n*i,o=$a({seed:wa(`${t}:${s}`),startPrice:ns[t],count:n,timeframe:s,startTimestamp:a,drift:ka[t]??0,volatility:.015,baseVolume:5e3});return Promise.resolve(ce(o))}}function Ta(){try{return new URLSearchParams(window.location.search).has("demo")}catch{return!1}}async function Ea(){const e=[];if(Ta())e.push("demo mode forced via ?demo=1");else{const n=new ea({timeoutMs:6e3}),i=await n.getInstruments();if(i.ok&&i.value.length>0)return{source:n,instruments:[...i.value].sort((o,r)=>o.symbol.localeCompare(r.symbol)),isLive:!0,kind:"revolut",diagnostics:e};e.push("Revolut proxy: not running");const a=[new ma,new ia];for(const o of a){const r=await o.getInstruments();if(!r.ok)continue;const d=await o.getCandles(r.value[0].symbol,"1h",2);if(d.ok)return{source:o,instruments:r.value,isLive:!0,kind:"public",diagnostics:e};e.push(`${o.name}: ${d.error}`)}}const t=new xa(Date.now()),s=await t.getInstruments();return{source:t,instruments:s.ok?s.value:[],isLive:!1,kind:"demo",diagnostics:e}}function La(e,t){return new Promise((s,n)=>{const i=setTimeout(()=>n(new Error("timeout")),t);e.then(a=>{clearTimeout(i),s(a)},a=>{clearTimeout(i),n(a instanceof Error?a:new Error(String(a)))})})}async function Xt(e,t,s,n,i=!1){for(let a=0;a<2;a++)try{const o=await La(e.source.getCandles(t,s,n,{priority:i}),7e3);if(o.ok)return o}catch{}return{ok:!1,error:"Market data temporarily unavailable"}}async function Aa(e,t,s,n,i=!0){const a=await Xt(e,t,s,n,i);if(!a.ok||a.value.length<2)return null;const o=a.value.map(c=>({timestamp:c.timestamp,value:c.close})),r=o[o.length-1].value,d=o[0].value;return{points:o,price:r,changePct:d>0?(r-d)/d*100:0}}async function Pa(e,t,s,n,i=!0){const a=await Xt(e,t,s,n,i);if(!a.ok||a.value.length<2)return null;const o=a.value[a.value.length-1].close,r=a.value[0].close;return{candles:a.value,price:o,changePct:r>0?(o-r)/r*100:0}}const zt=[{base:"BTC",label:"Bitcoin"},{base:"ETH",label:"Ethereum"},{base:"SOL",label:"Solana"},{base:"XRP",label:"XRP"},{base:"ADA",label:"Cardano"},{base:"DOGE",label:"Dogecoin"},{base:"LTC",label:"Litecoin"},{base:"DOT",label:"Polkadot"}],Ra={LINK:"Chainlink",AVAX:"Avalanche",POL:"Polygon",TRX:"TRON",ATOM:"Cosmos",XLM:"Stellar",BCH:"Bitcoin Cash",UNI:"Uniswap",AAVE:"Aave",ETC:"Ethereum Classic",FIL:"Filecoin",NEAR:"NEAR Protocol",ALGO:"Algorand",INJ:"Injective",ARB:"Arbitrum",OP:"Optimism",APT:"Aptos",PAXG:"PAX Gold"};function nn(e,t){const s=e.instruments.find(n=>n.base.toUpperCase()===t.toUpperCase());return(s==null?void 0:s.symbol)??null}function qt(e){return nn(e,"BTC")}function an(e,t){var i;const s=e.instruments.find(a=>a.symbol===t),n=s==null?void 0:s.base.toUpperCase();return((i=zt.find(a=>a.base===n))==null?void 0:i.label)??(n?Ra[n]:void 0)??n??t}async function on(e,t,s,n=48){const i=await Xt(e,t,"1h",n);if(!i.ok||i.value.length<2)return null;const a=i.value.map(c=>c.close),o=a[a.length-1],r=Math.max(0,a.length-25),d=a[r];return{symbol:t,label:s,price:o,changePct:d>0?(o-d)/d*100:0,closes:a}}async function rn(e,t=1/0){const s=new Set,n=[];for(const o of zt){const r=nn(e,o.base);r!==null&&!s.has(r)&&(s.add(r),n.push({symbol:r,label:o.label}))}for(const o of e.instruments)s.has(o.symbol)||(s.add(o.symbol),n.push({symbol:o.symbol,label:an(e,o.symbol)}));const i=n.slice(0,t);return(await Promise.all(i.map(o=>on(e,o.symbol,o.label)))).filter(o=>o!==null)}async function ln(e,t=60,s=Date.now){let n=e.source.getTickers?await e.source.getTickers():null;if(e.source.getTickers&&!(n!=null&&n.ok)&&(n=await e.source.getTickers()),n!=null&&n.ok&&n.value.length>0){const o=s(),r=new Map;return zt.forEach((c,l)=>r.set(c.base,l)),[...n.value.map(c=>{const l=e.instruments.find(h=>h.symbol===c.symbol),u=((l==null?void 0:l.base)??c.symbol).toUpperCase();return{symbol:c.symbol,label:an(e,c.symbol),base:u,price:c.price,change:c.price-c.open,changePct:c.open>0?(c.price-c.open)/c.open*100:0,high:c.high,low:c.low,quoteVolume:c.quoteVolume,updatedAt:o}})].sort((c,l)=>{const u=r.get(c.base),h=r.get(l.base);return u!==void 0&&h!==void 0?u-h:u!==void 0?-1:h!==void 0?1:l.quoteVolume-c.quoteVolume})}if(e.source.getTickers)return[];const i=s();return(await rn(e,t)).map(o=>{const r=e.instruments.find(c=>c.symbol===o.symbol),d=o.closes[0]??o.price;return{symbol:o.symbol,label:o.label,base:((r==null?void 0:r.base)??o.symbol).toUpperCase(),price:o.price,change:o.price-d,changePct:o.changePct,high:Math.max(...o.closes,o.price),low:Math.min(...o.closes,o.price),quoteVolume:0,updatedAt:i}})}function O(e){const t=Math.abs(e);if(t>=1e3)return e.toLocaleString("en-US",{maximumFractionDigits:0});if(t>=1)return e.toFixed(2);if(t<1e-8)return 0 .toFixed(2);const s=e.toPrecision(4);return s.includes("e")?e.toFixed(10).replace(/0+$/,"").replace(/\.$/,""):s}function cn(e,t){const s=e.toFixed(t);return s.startsWith("-")&&Number(s)===0?s.slice(1):s}function ze(e){const t=e.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}),s=t.startsWith("-")&&Number(t)===0?t.slice(1):t,[n,i="00"]=s.split(".");return{major:n,minor:i}}function ue(e){const t=e.lastIndexOf(".");return t===-1?`<span class="tiered-price">${e}</span>`:`<span class="tiered-price">${e.slice(0,t)}<span class="tiered-minor">${e.slice(t)}</span></span>`}function V(e,t=2){return e===null?"—":`${e>0?"+":""}${cn(e,t)}%`}function He(e,t=1){return e===null?"—":cn(e,t)}function fe(e){return e===null||e===0?"":e>0?"positive":"negative"}function Ma(e,t){return e.length>t?`${e.slice(0,t)}…`:e}function $(e){return e.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;")}function $e(e,t=e){if(!Number.isFinite(e))return"—";const s=Math.abs(Number.isFinite(t)?t:e),n=Math.abs(e);return s>=1e3?e.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):s>=1?e.toFixed(2):s>=.01?e.toFixed(4):n===0?"0.00":e.toFixed(10).replace(/0+$/,"").replace(/\.$/,"")}function Ca(e,t=e){if(!Number.isFinite(e))return"—";const s=$e(Math.abs(e),t);return`${e>=0?"+":"-"}${s}`}function Kt(e){return new Date(e).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}const qa="https://raw.githubusercontent.com/davidpit1565/automatic-trading-ai/main/state/autopilot-state.json",Da="https://raw.githubusercontent.com/davidpit1565/automatic-trading-ai/main/state/stocks-state.json",Fa=20*60*1e3;function dn(e){return e.replace(/\d+\.\d{5,}/g,t=>O(Number(t)))}function Ha(e){var t;return((t=/^live-entry:([A-Z0-9]+):/.exec(e??""))==null?void 0:t[1])??null}function Ia(e){const t=e["live:live-cash-eur"];if(typeof t!="number")return null;const s=e["live:live-open-positions"],n=s?Object.values(s).map(c=>{var l;return{symbol:((l=c.entryAssessment)==null?void 0:l.asset)??c.symbol??"",quantity:c.quantity??0,entryPrice:c.entryPrice??0,stopLoss:c.stopLoss??0,takeProfit:c.takeProfit??0,openedAt:c.openedAt??0}}):[],i=e["live:kill-switch"],a=(e["live:audit-log"]??[]).filter(c=>c.event==="filled"||c.event==="rejected").map(c=>({at:c.timestamp??0,event:c.event??"",detail:dn(c.detail??""),symbol:Ha(c.intentId)})).sort((c,l)=>l.at-c.at).slice(0,5),o=(e["live:trade-journal"]??[]).filter(c=>typeof c.id=="string"&&typeof c.symbol=="string"&&typeof c.entryTimestamp=="number"&&typeof c.exitTimestamp=="number"&&typeof c.entryPrice=="number"&&typeof c.exitPrice=="number"&&typeof c.positionSize=="number"&&typeof c.exitReason=="string").map(c=>({id:c.id,symbol:c.symbol,entryTimestamp:c.entryTimestamp,exitTimestamp:c.exitTimestamp,entryPrice:c.entryPrice,exitPrice:c.exitPrice,positionSize:c.positionSize,exitReason:c.exitReason,fees:c.fees??0,slippage:c.slippage??0,holdingDurationMs:c.holdingDurationMs??0,mfePct:c.mfePct??0,maePct:c.maePct??0,realizedPnl:c.realizedPnl??0,returnPct:c.returnPct??0,notes:c.notes??null})).sort((c,l)=>l.exitTimestamp-c.exitTimestamp),r=e["live:confirmation-gate-pending"]??{},d=Object.entries(e["live:live-entry-pending"]??{}).filter(c=>{var u,h;const l=c[1];return typeof((u=l.opportunity)==null?void 0:u.symbol)=="string"&&typeof l.opportunity.confidence=="number"&&typeof((h=l.opportunity.levels)==null?void 0:h.entry)=="number"&&typeof l.opportunity.levels.stopLoss=="number"&&typeof l.opportunity.levels.takeProfit=="number"&&typeof l.opportunity.levels.riskReward=="number"&&typeof l.queuedAt=="number"}).map(([c,l])=>{var h,m,p,v;const u=((h=r[`live-entry:${c}:${l.queuedAt}`])==null?void 0:h.sentAt)??null;return{symbol:c,confidence:l.opportunity.confidence,entryPrice:l.opportunity.levels.entry,stopLoss:l.opportunity.levels.stopLoss,takeProfit:l.opportunity.levels.takeProfit,rewardRiskRatio:l.opportunity.levels.riskReward,queuedAt:l.queuedAt,sentAt:u,expiresAt:u!==null?u+Fa:null,positionValue:((m=l.lastAssessment)==null?void 0:m.positionValue)??null,riskAmount:((p=l.lastAssessment)==null?void 0:p.riskAmount)??null,riskPercentage:((v=l.lastAssessment)==null?void 0:v.riskPercentage)??null}}).sort((c,l)=>l.queuedAt-c.queuedAt);return{cash:t,positions:n,killSwitchEngaged:(i==null?void 0:i.engaged)===!0,killSwitchReason:(i==null?void 0:i.reason)??null,recentEvents:a,externalBtcQuantity:e["live:live-external-btc-qty"]??0,equityHistory:Array.isArray(e["live:live-equity-history"])?e["live:live-equity-history"]:[],tradeJournal:o,pendingApprovals:d}}function Ua(e,t){const s=/^paper (entry|exit) (\S+): ([\d.]+) @ ([\d.]+)(?:\s*\((.*)\))?/.exec(t);return s?{at:e,kind:s[1]==="entry"?"buy":"sell",symbol:s[2],quantity:Number(s[3]),price:Number(s[4]),note:s[5]?dn(s[5]):null}:null}async function qe(e=(s,n)=>fetch(s,n),t=qa){for(let s=0;s<2;s++){const n=await Na(e,t);if(n)return n}return null}async function vt(e=(t,s)=>fetch(t,s)){return qe(e,Da)}async function Na(e,t){var s,n,i;try{const a=await e(`${t}?t=${Date.now()}`,{cache:"no-store"});if(!a.ok)return null;const o=await a.json(),r=o["portfolio-engine"]??{},d=(o["open-positions"]??[]).map(p=>({symbol:p.symbol,quantity:p.quantity,entryPrice:p.entryPrice,openedAt:p.openedAt})),c=(o["audit-log"]??[]).filter(p=>p.event==="filled").map(p=>Ua(p.timestamp,p.detail)).filter(p=>p!==null).sort((p,v)=>v.at-p.at),l=o["benchmark-anchor"],u=o["real-money-readiness"],h=((u==null?void 0:u.criteria)??[]).map(p=>({key:p.key??"",ok:p.ok===!0,detail:p.detail??""})),m=u&&typeof u.ready=="boolean"?{ready:u.ready,summary:u.summary??"",criteria:h,unmet:Array.isArray(u.unmet)?u.unmet:h.filter(p=>!p.ok).map(p=>p.key)}:null;return{cash:r.cash??0,initialCash:r.initialCash??1e4,baseCurrency:r.baseCurrency??"EUR",positions:d,history:c,lastRunAt:((s=o["autopilot-last-run"])==null?void 0:s.at)??null,benchmark:l&&l.btc&&l.equity?{btc:l.btc,equity:l.equity}:null,benchmarkResult:(()=>{const p=o["benchmark-result"];return p&&typeof p.label=="string"&&typeof p.portfolioPct=="number"&&typeof p.assetPct=="number"?{label:p.label,portfolioPct:p.portfolioPct,assetPct:p.assetPct}:null})(),equityHistory:Array.isArray(o["equity-history"])?o["equity-history"]:[],readiness:m,marketSnapshot:(((n=o["market-snapshot"])==null?void 0:n.symbols)??[]).filter(p=>typeof p.symbol=="string"&&typeof p.price=="number"&&typeof p.changePct=="number"&&typeof p.updatedAt=="number"),shadowStandings:(((i=o["shadow-standings"])==null?void 0:i.standings)??[]).filter(p=>typeof p.key=="string"&&typeof p.label=="string"&&typeof p.equity=="number"&&typeof p.returnPct=="number"&&typeof p.trades=="number"&&typeof p.openPositions=="number"&&typeof p.startedAt=="number").map(p=>({key:p.key,label:p.label,equity:p.equity,returnPct:p.returnPct,trades:p.trades,winRatePct:typeof p.winRatePct=="number"?p.winRatePct:null,profitFactor:typeof p.profitFactor=="number"?p.profitFactor:null,openPositions:p.openPositions,startedAt:p.startedAt})),live:Ia(o)}}catch{return null}}function Pe(e){return e.replace(/EUR$|USD$/,"")}function Ne(e){return new Date(e).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}function un(e){const t=Math.round((Date.now()-e)/6e4);if(t<1)return"just now";if(t<60)return`${t}m ago`;const s=Math.floor(t/60);return s<24?`${s}h ${t%60}m ago`:`${Math.floor(s/24)}d ${s%24}h ago`}function yt(e){const t=Math.round(e/6e4);if(t<60)return`${t}m`;const s=Math.floor(t/60);return s<24?`${s}h ${t%60}m`:`${Math.floor(s/24)}d ${s%24}h`}const pn=30*60*1e3,ae=e=>`€${O(e)}`,Be=e=>`${e>=0?"+":"-"}${ae(Math.abs(e))}`,as=6e4;function Dt(e){return new Date(e).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}function Oa(e,t){const s=$(Pe(e.symbol)),n=e.expiresAt!==null?Dt(e.expiresAt):"pending send",i=e.expiresAt!==null&&e.expiresAt<=t,a=e.positionValue!==null?ae(e.positionValue):"calculated at confirmation time",o=e.riskPercentage!==null?`${e.riskPercentage.toFixed(2)}%`:"—";return`
    <div class="ops-action-card">
      <div class="ops-action-symbol">${s} · LONG</div>
      <div class="ops-action-row"><span>Confidence</span><span>${Math.round(e.confidence)}/100</span></div>
      <div class="ops-action-row"><span>Proposed entry</span><span>${ae(e.entryPrice)}</span></div>
      <div class="ops-action-row"><span>Position</span><span>${a}</span></div>
      <div class="ops-action-row"><span>Risk</span><span>${o}</span></div>
      <div class="ops-action-row"><span>Reward:Risk</span><span>${e.rewardRiskRatio.toFixed(1)}:1</span></div>
      <div class="ops-action-row${i?" ops-expired":""}"><span>${i?"Expired":"Expires"}</span><span>${n}</span></div>
    </div>`}function Ba(e){e.innerHTML=`
    <div class="ops-header">
      <div class="ops-title">OPERATIONS</div>
      <div class="ops-header-meta">
        <span id="ov-live-badge" class="ops-live-badge" hidden>LIVE · REAL MONEY · REVOLUT X</span>
        <span id="ov-system-status" class="ops-status" data-nav="system" role="button" tabindex="0">● checking…</span>
      </div>
    </div>
    <!-- This app reads a periodically-committed JSON snapshot, not a live
         API — the freshness badge makes that architecture explicit instead
         of letting the operator mistake the console for real-time. Never
         says "live" itself; "Fresh"/"Stale"/"Unknown" only. -->
    <p id="ov-freshness" class="ops-freshness"></p>
    <div id="ov-kill-switch" class="ops-banner ops-banner-critical" hidden>
      <div class="ops-banner-title">TRADING HALTED</div>
      <div class="ops-banner-body">Reason: <span id="ov-kill-reason"></span></div>
      <div class="ops-banner-note">New orders are blocked. Existing positions are not modified automatically.</div>
    </div>
    <div id="ov-action-required" class="ops-banner ops-banner-action" hidden>
      <div class="ops-banner-title">ACTION REQUIRED</div>
      <div id="ov-action-list" class="ops-action-list"></div>
    </div>
    <div class="ops-section">
      <div class="ops-section-title">
        <span class="ops-section-label">LIVE ACCOUNT</span> <span class="ops-tag-live">REAL MONEY · REVOLUT X</span>
        <button class="ops-view-all" data-nav="reports">Reports →</button>
      </div>
      <div id="ov-live-empty" class="ops-empty" hidden>No live account yet.</div>
      <div id="ov-kpis" class="ops-kpi-row"></div>
    </div>
    <div class="ops-section">
      <div class="ops-section-title">
        <span class="ops-section-label">RECENT ACTIVITY</span>
        <button class="ops-view-all" data-nav="trades">View trades →</button>
      </div>
      <div id="ov-activity" class="ops-activity-list"></div>
      <div id="ov-activity-empty" class="ops-empty" hidden>No recent activity.</div>
    </div>
    <div class="ops-section">
      <div class="ops-section-title">
        <span class="ops-section-label">STRATEGIES</span>
        <button class="ops-view-all" data-nav="strategies">Champion vs. challengers →</button>
      </div>
      <div class="ops-empty">Forward-tested candidates, all simulated — never real money.</div>
    </div>
    <p class="muted-line" id="ov-status">Loading…</p>`;const t=e.querySelector("#ov-live-badge"),s=e.querySelector("#ov-system-status"),n=e.querySelector("#ov-freshness"),i=e.querySelector("#ov-kill-switch"),a=e.querySelector("#ov-kill-reason"),o=e.querySelector("#ov-action-required"),r=e.querySelector("#ov-action-list"),d=e.querySelector("#ov-live-empty"),c=e.querySelector("#ov-kpis"),l=e.querySelector("#ov-activity"),u=e.querySelector("#ov-activity-empty"),h=e.querySelector("#ov-status");async function m(){var T;const v=await qe(),f=Date.now();if(!v){h.textContent="Unable to load the operations state. Retrying automatically.",s.textContent="● Unknown",s.className="ops-status ops-status-unknown",n.textContent="Snapshot: Unknown",n.className="ops-freshness ops-freshness-unknown";return}const y=v.live;if(t.hidden=!y,v.lastRunAt===null)n.textContent="Snapshot: Unknown — no automation cycle recorded yet",n.className="ops-freshness ops-freshness-unknown";else{const x=f-v.lastRunAt>pn;n.textContent=`Snapshot updated ${un(v.lastRunAt)}${x?" — stale":""}`,n.className=`ops-freshness ${x?"ops-freshness-stale":"ops-freshness-fresh"}`}y!=null&&y.killSwitchEngaged?(s.textContent="● Halted",s.className="ops-status ops-status-critical",i.hidden=!1,a.textContent=y.killSwitchReason??"no reason recorded"):(s.textContent=y?"● Operational":"● No live account",s.className=`ops-status ${y?"ops-status-ok":"ops-status-unknown"}`,i.hidden=!0);const b=(y==null?void 0:y.pendingApprovals)??[];if(o.hidden=b.length===0,r.innerHTML=b.map(x=>Oa(x,f)).join(""),d.hidden=!!y,c.hidden=!y,y){const x=((T=y.equityHistory.at(-1))==null?void 0:T.equity)??y.cash,k=new Date().setHours(0,0,0,0),M=y.tradeJournal.filter(I=>I.exitTimestamp>=k).reduce((I,G)=>I+G.realizedPnl,0),F=y.tradeJournal.filter(I=>I.exitTimestamp>=k).length;c.innerHTML=`
        <div class="ops-kpi"><div class="ops-kpi-value">${ae(x)}</div><div class="ops-kpi-label">Equity</div></div>
        <div class="ops-kpi"><div class="ops-kpi-value">${ae(y.cash)}</div><div class="ops-kpi-label">Available cash</div></div>
        <div class="ops-kpi"><div class="ops-kpi-value">${y.positions.length}</div><div class="ops-kpi-label">Open positions</div></div>
        <div class="ops-kpi"><div class="ops-kpi-value ${M>=0?"ops-up":"ops-down"}">${F===0?"—":Be(M)}</div><div class="ops-kpi-label">Today's P&L (${F} closed)</div></div>`}const w=(y==null?void 0:y.recentEvents)??[];u.hidden=w.length!==0,l.innerHTML=w.map(x=>`
        <div class="ops-activity-row">
          <span class="ops-activity-time">${Dt(x.at)}</span>
          <span class="ops-activity-event ops-activity-${$(x.event)}">${$(x.event)}</span>
          <span class="ops-activity-detail">${x.symbol?`${$(Pe(x.symbol))} — `:""}${$(x.detail)}</span>
        </div>`).join(""),h.textContent=`Updated ${Dt(f)}`}let p=0;return m(),p=window.setInterval(()=>void m(),as),{pause:()=>window.clearInterval(p),resume:()=>{m(),p=window.setInterval(()=>void m(),as)}}}const hn={tradeId:null},is=6e4;function _a(e,t){const s=$(Pe(e.symbol)),n=e.quantity*e.entryPrice,i=e.quantity*(e.entryPrice-e.stopLoss),a=t!==null&&t>0?i/t*100:null,o=e.entryPrice>0?(e.entryPrice-e.stopLoss)/e.entryPrice*100:null,r=e.entryPrice>0?(e.takeProfit-e.entryPrice)/e.entryPrice*100:null;return`
    <div class="ops-action-card">
      <div class="ops-action-symbol">${s} · LONG</div>
      <div class="ops-action-row"><span>Quantity</span><span>${e.quantity}</span></div>
      <div class="ops-action-row"><span>Entry price</span><span>${ae(e.entryPrice)}</span></div>
      <div class="ops-action-row"><span>Exposure</span><span>${ae(n)}</span></div>
      <div class="ops-action-row"><span>Risk</span><span>${ae(i)}${a!==null?` (${a.toFixed(2)}% of equity)`:""}</span></div>
      <div class="ops-action-row"><span>Stop loss</span><span>${ae(e.stopLoss)}${o!==null?` (−${o.toFixed(1)}%)`:""}</span></div>
      <div class="ops-action-row"><span>Take profit</span><span>${ae(e.takeProfit)}${r!==null?` (+${r.toFixed(1)}%)`:""}</span></div>
      <div class="ops-action-row"><span>Current price</span><span>— <span class="ops-note">unavailable in current snapshot</span></span></div>
      <div class="ops-action-row"><span>Opened</span><span>${Ne(e.openedAt)}</span></div>
    </div>`}function Va(e){const t=$(Pe(e.symbol)),s=e.realizedPnl>=0;return`
    <div class="ops-action-card ops-clickable" data-nav="trade-detail" data-trade-id="${$(e.id)}" role="button" tabindex="0">
      <div class="tv-trade-head">
        <div class="ops-action-symbol">${t} · ${$(e.exitReason)}</div>
        <div class="tv-trade-pnl ${s?"ops-up":"ops-down"}">${Be(e.realizedPnl)}</div>
      </div>
      <div class="ops-action-row"><span>Entry → Exit</span><span>${ae(e.entryPrice)} → ${ae(e.exitPrice)}</span></div>
      <div class="ops-action-row"><span>Return</span><span>${V(e.returnPct)}</span></div>
      <div class="ops-action-row"><span>Held</span><span>${yt(e.holdingDurationMs)}</span></div>
      <div class="ops-action-row"><span>Fees (estimated)</span><span>${ae(e.fees)}</span></div>
      <div class="ops-action-row"><span>Slippage (measured)</span><span>${ae(e.slippage)}</span></div>
      <div class="ops-action-row"><span>Closed</span><span>${Ne(e.exitTimestamp)}</span></div>
    </div>`}function ja(e){const t=e.realizedPnl>=0;return`
    <tr class="ops-clickable" data-nav="trade-detail" data-trade-id="${$(e.id)}" role="button" tabindex="0">
      <td>${Ne(e.exitTimestamp)}</td>
      <td>${$(Pe(e.symbol))}</td>
      <td>${ae(e.entryPrice)}</td>
      <td>${ae(e.exitPrice)}</td>
      <td>${e.positionSize}</td>
      <td class="${t?"ops-up":"ops-down"}">${Be(e.realizedPnl)}</td>
      <td>${V(e.returnPct)}</td>
      <td>${$(e.exitReason)}</td>
      <td>${yt(e.holdingDurationMs)}</td>
      <td>${ae(e.fees)}</td>
      <td>${ae(e.slippage)}</td>
    </tr>`}const Ga=`
  <thead><tr>
    <th>Closed</th><th>Asset</th><th>Entry</th><th>Exit</th><th>Size</th><th>P&amp;L</th>
    <th>Return</th><th>Exit reason</th><th>Held</th><th>Fees (est.)</th><th>Slippage (meas.)</th>
  </tr></thead>`;function Wa(e){e.innerHTML=`
    <button class="tool-back" data-nav="overview">← Overview</button>
    <h2 class="view-title">Trades</h2>
    <p class="view-sub">Every real Revolut X position — open and closed.</p>
    <div class="tv-filters" role="tablist" aria-label="Filter trades by status">
      <button class="tv-filter active" data-status="all" role="tab" aria-selected="true">All</button>
      <button class="tv-filter" data-status="open" role="tab" aria-selected="false">Open</button>
      <button class="tv-filter" data-status="closed" role="tab" aria-selected="false">Closed</button>
      <select id="tv-asset-filter" class="tv-asset-select" aria-label="Filter by asset">
        <option value="">All assets</option>
      </select>
    </div>
    <div class="ops-section" id="tv-open-section">
      <div class="ops-section-title"><span class="ops-section-label">OPEN POSITIONS</span> <span class="ops-tag-live">REAL MONEY</span></div>
      <div id="tv-open-empty" class="ops-empty" hidden>No open positions.</div>
      <div id="tv-open-list" class="ops-action-list"></div>
    </div>
    <div class="ops-section" id="tv-closed-section">
      <div class="ops-section-title">CLOSED TRADES</div>
      <div id="tv-closed-empty" class="ops-empty" hidden>No closed trades yet.</div>
      <div id="tv-closed-list" class="ops-action-list tv-cards-only"></div>
      <div class="tv-table-wrap tv-table-only">
        <table class="tv-table">
          ${Ga}
          <tbody id="tv-closed-table-body"></tbody>
        </table>
      </div>
    </div>
    <p class="muted-line" id="tv-status">Loading…</p>`;const t=e.querySelector(".tv-filters"),s=e.querySelector("#tv-asset-filter"),n=e.querySelector("#tv-open-section"),i=e.querySelector("#tv-closed-section"),a=e.querySelector("#tv-open-empty"),o=e.querySelector("#tv-open-list"),r=e.querySelector("#tv-closed-empty"),d=e.querySelector("#tv-closed-list"),c=e.querySelector("#tv-closed-table-body"),l=e.querySelector("#tv-status");let u="all",h="",m=[],p=[],v=null;function f(){const w=u==="all"||u==="open",T=u==="all"||u==="closed";n.hidden=!w,i.hidden=!T;const x=m.filter(M=>!h||Pe(M.symbol)===h);a.hidden=x.length!==0,o.innerHTML=x.map(M=>_a(M,v)).join("");const k=p.filter(M=>!h||Pe(M.symbol)===h);r.hidden=k.length!==0,d.innerHTML=k.map(Va).join(""),c.innerHTML=k.map(ja).join("")}t.addEventListener("click",w=>{const T=w.target.closest(".tv-filter");T&&(u=T.dataset.status,t.querySelectorAll(".tv-filter").forEach(x=>{const k=x===T;x.classList.toggle("active",k),x.setAttribute("aria-selected",String(k))}),f())}),s.addEventListener("change",()=>{h=s.value,f()});async function y(){var M;const w=await qe();if(!w){l.textContent="Unable to load the operations state. Retrying automatically.";return}const T=w.live;m=(T==null?void 0:T.positions)??[],p=(T==null?void 0:T.tradeJournal)??[],v=T?((M=T.equityHistory.at(-1))==null?void 0:M.equity)??T.cash:null;const x=Array.from(new Set([...m.map(F=>Pe(F.symbol)),...p.map(F=>Pe(F.symbol))])).sort(),k=s.value;s.innerHTML='<option value="">All assets</option>'+x.map(F=>`<option value="${$(F)}">${$(F)}</option>`).join(""),x.includes(k)?s.value=k:h="",f(),l.textContent=`Updated ${Ne(Date.now())}`}e.addEventListener("click",w=>{const T=w.target.closest("[data-trade-id]");T&&(hn.tradeId=T.dataset.tradeId??null)});let b=0;return y(),b=window.setInterval(()=>void y(),is),{pause:()=>window.clearInterval(b),resume:()=>{y(),b=window.setInterval(()=>void y(),is)}}}function Xa(e){return`
    <div class="ops-section">
      <div class="ops-section-title">RESULT</div>
      <div class="ops-action-card">
        <div class="ops-action-row"><span>Realized P&amp;L</span><span class="${e.realizedPnl>=0?"ops-up":"ops-down"}">${Be(e.realizedPnl)}</span></div>
        <div class="ops-action-row"><span>Return</span><span>${V(e.returnPct)}</span></div>
        <div class="ops-action-row"><span>Exit reason</span><span>${$(e.exitReason)}</span></div>
      </div>
    </div>
    <div class="ops-section">
      <div class="ops-section-title">EXECUTION</div>
      <div class="ops-action-card">
        <div class="ops-action-row"><span>Entry</span><span>${ae(e.entryPrice)} · ${Ne(e.entryTimestamp)}</span></div>
        <div class="ops-action-row"><span>Exit</span><span>${ae(e.exitPrice)} · ${Ne(e.exitTimestamp)}</span></div>
        <div class="ops-action-row"><span>Position size</span><span>${e.positionSize}</span></div>
      </div>
    </div>
    <div class="ops-section">
      <div class="ops-section-title">COSTS</div>
      <div class="ops-action-card">
        <div class="ops-action-row"><span>Fees (estimated)</span><span>${ae(e.fees)}</span></div>
        <div class="ops-action-row"><span>Slippage (measured)</span><span>${ae(e.slippage)}</span></div>
      </div>
    </div>
    <div class="ops-section">
      <div class="ops-section-title">BEHAVIOR</div>
      <div class="ops-action-card">
        <div class="ops-action-row"><span>Holding time</span><span>${yt(e.holdingDurationMs)}</span></div>
        <div class="ops-action-row"><span>Max favorable excursion</span><span>${V(e.mfePct)}</span></div>
        <div class="ops-action-row"><span>Max adverse excursion</span><span>${V(e.maePct)}</span></div>
      </div>
    </div>
    ${e.notes?`<div class="ops-section">
      <div class="ops-section-title">NOTES</div>
      <div class="ops-empty">${$(e.notes)}</div>
    </div>`:""}`}function za(e){e.innerHTML=`
    <button class="tool-back" data-nav="trades">← Trades</button>
    <h2 class="view-title" id="td-title">Trade detail</h2>
    <div id="td-body"><p class="muted-line">Loading…</p></div>`;const t=e.querySelector("#td-title"),s=e.querySelector("#td-body");async function n(){var r;const i=hn.tradeId;if(!i){s.innerHTML='<p class="ops-empty">No trade selected.</p>';return}const a=await qe(),o=((r=a==null?void 0:a.live)==null?void 0:r.tradeJournal.find(d=>d.id===i))??null;if(!o){s.innerHTML='<p class="ops-empty">Trade not found — it may have aged out of the recorded journal.</p>';return}t.textContent=`${Pe(o.symbol)} trade`,s.innerHTML=Xa(o)}return n(),{pause:()=>{},resume:()=>void n()}}const Xe=20,os="live-mirror";function Ka(e,t){if(t.trades<Xe)return{comparable:!1,reason:`challenger '${t.key}' has only ${t.trades}/${Xe} trades — too early to trust`,challengerAheadOn:[],championAheadOn:[]};if(e.trades<Xe)return{comparable:!1,reason:`champion '${e.key}' itself has only ${e.trades}/${Xe} trades — no reliable baseline to compare against yet`,challengerAheadOn:[],championAheadOn:[]};const s=[],n=[],i=(a,o,r)=>{o===null||r===null||(r>o?s.push(a):o>r&&n.push(a))};return i("returnPct",e.returnPct,t.returnPct),i("profitFactor",e.profitFactor,t.profitFactor),i("winRatePct",e.winRatePct,t.winRatePct),{comparable:!0,challengerAheadOn:s,championAheadOn:n}}const rs=6e4,Ya={returnPct:"Return",profitFactor:"Profit factor",winRatePct:"Win rate"};function ls(e){return e.length===0?"—":e.map(t=>Ya[t]??t).join(", ")}function Ja(e){return e?e.comparable?`
    <div class="ops-action-row"><span>Ahead on</span><span>${ls(e.challengerAheadOn)}</span></div>
    <div class="ops-action-row"><span>Behind on</span><span>${ls(e.championAheadOn)}</span></div>`:`<div class="ops-action-row"><span>vs. champion</span><span>not yet comparable</span></div>
      <div class="ops-empty">${$(e.reason??"")}</div>`:'<div class="ops-action-row"><span>vs. champion</span><span>no champion running yet</span></div>'}function Qa(e){const t=e<Xe;return`
      <div class="ops-action-row"><span>Sample size</span><span>${e} closed trade${e===1?"":"s"}</span></div>
      <div class="ops-action-row"><span>Minimum evaluation sample</span><span>${Xe}</span></div>
      ${t?'<div class="ops-note">Not yet meaningful</div>':""}`}function Za(e,t,s){const n=e.winRatePct!==null?`${e.winRatePct.toFixed(1)}%`:"—",i=e.profitFactor!==null?e.profitFactor.toFixed(2):"—";return`
    <div class="ops-action-card">
      <div class="ops-action-symbol">${$(e.label)}${t?" · CHAMPION":""}</div>
      <div class="ops-action-row"><span>Return</span><span>${V(e.returnPct)}</span></div>
      <div class="ops-action-row"><span>Win rate</span><span>${n}</span></div>
      <div class="ops-action-row"><span>Profit factor</span><span>${i}</span></div>
      <div class="ops-action-row"><span>Open positions</span><span>${e.openPositions}</span></div>
      ${Qa(e.trades)}
      ${t?"":Ja(s)}
    </div>`}function ei(e){e.innerHTML=`
    <button class="tool-back" data-nav="overview">← Overview</button>
    <h2 class="view-title">Strategies</h2>
    <p class="view-sub ops-shadow-label">SHADOW · SIMULATION · NO REAL MONEY — forward-tested candidates compared against the champion that mirrors live production.</p>
    <div id="sv-empty" class="ops-empty" hidden>No shadow candidates have run yet.</div>
    <div id="sv-list" class="ops-action-list"></div>
    <p class="muted-line" id="sv-status">Loading…</p>`;const t=e.querySelector("#sv-empty"),s=e.querySelector("#sv-list"),n=e.querySelector("#sv-status");async function i(){const o=await qe();if(!o){n.textContent="Unable to load the operations state. Retrying automatically.";return}const r=o.shadowStandings;t.hidden=r.length!==0;const d=r.find(c=>c.key===os)??null;s.innerHTML=r.map(c=>{const l=c.key===os,u=!l&&d?Ka(d,c):null;return Za(c,l,u)}).join(""),n.textContent=`Updated ${new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}`}let a=0;return i(),a=window.setInterval(()=>void i(),rs),{pause:()=>window.clearInterval(a),resume:()=>{i(),a=window.setInterval(()=>void i(),rs)}}}const cs=6e4;function ti(e){e.innerHTML=`
    <button class="tool-back" data-nav="overview">← Overview</button>
    <h2 class="view-title">System</h2>
    <p class="view-sub">Real signals only — no fabricated subsystem status.</p>
    <div class="ops-section">
      <div class="ops-section-title">KILL SWITCH</div>
      <div id="sy-kill-card" class="ops-action-card"></div>
    </div>
    <div class="ops-section">
      <div class="ops-section-title">AUTOMATION</div>
      <div id="sy-heartbeat-card" class="ops-action-card"></div>
    </div>
    <p class="muted-line" id="sy-status">Loading…</p>`;const t=e.querySelector("#sy-kill-card"),s=e.querySelector("#sy-heartbeat-card"),n=e.querySelector("#sy-status");async function i(){const o=await qe();if(!o){n.textContent="Unable to load the operations state. Retrying automatically.",t.innerHTML='<div class="ops-action-row"><span>Status</span><span>Unknown</span></div>',s.innerHTML='<div class="ops-empty">Unknown — unable to load the snapshot.</div>';return}const r=o.live;t.innerHTML=r?r.killSwitchEngaged?`<div class="ops-action-row"><span>Status</span><span class="ops-down">HALTED</span></div>
           <div class="ops-action-row"><span>Reason</span><span>${$(r.killSwitchReason??"no reason recorded")}</span></div>
           <div class="ops-action-row"><span>Note</span><span>New orders blocked; open positions untouched</span></div>`:'<div class="ops-action-row"><span>Status</span><span class="ops-up">Operational</span></div>':'<div class="ops-action-row"><span>Status</span><span>No live account yet</span></div>';const d=o.lastRunAt,c=d!==null&&Date.now()-d>pn;s.innerHTML=d===null?'<div class="ops-empty">No automation cycle recorded yet.</div>':`<div class="ops-action-row"><span>Last automation cycle</span><span>${Ne(d)}</span></div>
           <div class="ops-action-row${c?" ops-expired":""}"><span>Since</span><span>${un(d)}${c?" — no recent cycle recorded":""}</span></div>`,n.textContent=`Updated ${Ne(Date.now())}`}let a=0;return i(),a=window.setInterval(()=>void i(),cs),{pause:()=>window.clearInterval(a),resume:()=>{i(),a=window.setInterval(()=>void i(),cs)}}}const ds=6e4,si={"7d":7*864e5,"30d":30*864e5,"90d":90*864e5},ni={"7d":"7D","30d":"30D","90d":"90D",all:"ALL"};function ai(e,t){if(t==="all")return[...e];const s=Date.now()-si[t];return e.filter(n=>n.exitTimestamp>=s)}function ii(e){if(e.length===0)return null;const t=e.filter(o=>o.realizedPnl>0),s=e.filter(o=>o.realizedPnl<0),n=t.reduce((o,r)=>o+r.realizedPnl,0),i=s.reduce((o,r)=>o+r.realizedPnl,0),a=[...e].sort((o,r)=>o.realizedPnl-r.realizedPnl);return{tradeCount:e.length,totalPnl:e.reduce((o,r)=>o+r.realizedPnl,0),winRatePct:t.length/e.length*100,avgWin:t.length>0?n/t.length:null,avgLoss:s.length>0?i/s.length:null,profitFactor:i<0?n/Math.abs(i):null,worstTrade:a[0],bestTrade:a[a.length-1],totalFees:e.reduce((o,r)=>o+r.fees,0),totalSlippage:e.reduce((o,r)=>o+r.slippage,0),avgHoldingMs:e.reduce((o,r)=>o+r.holdingDurationMs,0)/e.length}}function oi(e){return`
    <div class="ops-kpi-row">
      <div class="ops-kpi"><div class="ops-kpi-value ${e.totalPnl>=0?"ops-up":"ops-down"}">${Be(e.totalPnl)}</div><div class="ops-kpi-label">Total realized P&amp;L</div></div>
      <div class="ops-kpi"><div class="ops-kpi-value">${e.tradeCount}</div><div class="ops-kpi-label">Closed trades</div></div>
      <div class="ops-kpi"><div class="ops-kpi-value">${e.winRatePct.toFixed(1)}%</div><div class="ops-kpi-label">Win rate</div></div>
      <div class="ops-kpi"><div class="ops-kpi-value">${e.profitFactor!==null?e.profitFactor.toFixed(2):"—"}</div><div class="ops-kpi-label">Profit factor</div></div>
    </div>
    <div class="ops-section">
      <div class="ops-section-title">AVERAGES</div>
      <div class="ops-action-card">
        <div class="ops-action-row"><span>Average win</span><span>${e.avgWin!==null?ae(e.avgWin):"—"}</span></div>
        <div class="ops-action-row"><span>Average loss</span><span>${e.avgLoss!==null?Be(e.avgLoss):"—"}</span></div>
        <div class="ops-action-row"><span>Average holding time</span><span>${yt(e.avgHoldingMs)}</span></div>
      </div>
    </div>
    <div class="ops-section">
      <div class="ops-section-title">BEST / WORST TRADE</div>
      <div class="ops-action-card">
        <div class="ops-action-row"><span>Best (${$(Pe(e.bestTrade.symbol))})</span><span class="ops-up">${Be(e.bestTrade.realizedPnl)}</span></div>
        <div class="ops-action-row"><span>Worst (${$(Pe(e.worstTrade.symbol))})</span><span class="ops-down">${Be(e.worstTrade.realizedPnl)}</span></div>
      </div>
    </div>
    <div class="ops-section">
      <div class="ops-section-title">COSTS</div>
      <div class="ops-action-card">
        <div class="ops-action-row"><span>Total fees (estimated)</span><span>${ae(e.totalFees)}</span></div>
        <div class="ops-action-row"><span>Total slippage (measured)</span><span>${ae(e.totalSlippage)}</span></div>
      </div>
    </div>`}function ri(e){e.innerHTML=`
    <button class="tool-back" data-nav="overview">← Overview</button>
    <h2 class="view-title">Reports</h2>
    <p class="view-sub">Aggregate stats over every closed real trade — plain sums and averages, nothing modelled.</p>
    <div class="tv-filters" role="tablist" aria-label="Report period">
      <button class="tv-filter" data-period="7d" role="tab" aria-selected="false">7D</button>
      <button class="tv-filter" data-period="30d" role="tab" aria-selected="false">30D</button>
      <button class="tv-filter" data-period="90d" role="tab" aria-selected="false">90D</button>
      <button class="tv-filter active" data-period="all" role="tab" aria-selected="true">ALL</button>
    </div>
    <div id="rp-empty" class="ops-empty" hidden></div>
    <div id="rp-body"></div>
    <p class="muted-line" id="rp-status">Loading…</p>`;const t=e.querySelector(".tv-filters"),s=e.querySelector("#rp-empty"),n=e.querySelector("#rp-body"),i=e.querySelector("#rp-status");let a="all",o=[];function r(){const l=ai(o,a),u=ii(l);s.hidden=u!==null,u||(s.textContent=o.length===0?"No closed live trades yet — nothing to report.":`No closed trades in the last ${ni[a]}.`),n.innerHTML=u?oi(u):""}t.addEventListener("click",l=>{const u=l.target.closest(".tv-filter");u&&(a=u.dataset.period,t.querySelectorAll(".tv-filter").forEach(h=>{const m=h===u;h.classList.toggle("active",m),h.setAttribute("aria-selected",String(m))}),r())});async function d(){var u;const l=await qe();if(!l){i.textContent="Unable to load the operations state. Retrying automatically.";return}o=((u=l.live)==null?void 0:u.tradeJournal)??[],r(),i.textContent=`Updated ${Ne(Date.now())}`}let c=0;return d(),c=window.setInterval(()=>void d(),ds),{pause:()=>window.clearInterval(c),resume:()=>{d(),c=window.setInterval(()=>void d(),ds)}}}function li(e,t=20){const s=e.slice(Math.max(0,e.length-t)),n=s.map(a=>a.high),i=s.map(a=>a.low);return{resistance:Math.max(...n),support:Math.min(...i)}}function us(e,t){const s=new Array(e.length).fill(void 0);if(e.length<t)return s;const n=2/(t+1);let i=0;for(let a=0;a<t;a++)i+=e[a];s[t-1]=i/t;for(let a=t;a<e.length;a++)s[a]=e[a]*n+s[a-1]*(1-n);return s}function pt(e,t={stroke:"currentColor"}){const s=t.width??120,n=t.height??40,i=3,a=`grad-${Math.random().toString(36).slice(2,9)}`;if(e.length<2)return`<svg viewBox="0 0 ${s} ${n}" aria-hidden="true"></svg>`;const o=Math.min(...e),d=Math.max(...e)-o||1,l=e.map((h,m)=>{const p=i+m/(e.length-1)*(s-2*i),v=n-i-(h-o)/d*(n-2*i);return[p,v]}).map(([h,m])=>`${h.toFixed(1)},${m.toFixed(1)}`).join(" "),u=t.fill?`<defs><linearGradient id="${a}" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" style="stop-color:${t.stroke};stop-opacity:0.25" />
        <stop offset="100%" style="stop-color:${t.stroke};stop-opacity:0.02" />
      </linearGradient></defs>
      <polygon fill="url(#${a})" points="${i},${n-i} ${l} ${s-i},${n-i}" />`:"";return`<svg class="spark" viewBox="0 0 ${s} ${n}" preserveAspectRatio="none" aria-hidden="true">
    ${u}<polyline fill="none" stroke="${t.stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${l}" /></svg>`}const We={left:8,right:58,top:12,bottom:26,viewWidth:380,viewHeight:240};function at(e,t,s){const n=t??We.viewWidth,i=s??We.viewHeight,a=We.left,o=We.right,r=We.top,d=We.bottom,c=e.length,l=e.map(b=>b.value);let u=Math.min(...l),h=Math.max(...l);const m=(h-u)*.08||Math.abs(h)*.02||1;u-=m,h+=m;const p=h-u||1;return{W:n,H:i,padL:a,padR:o,padT:r,padB:d,n:c,min:u,max:h,x:b=>a+(c>1?b/(c-1)*(n-a-o):0),y:b=>r+(1-(b-u)/p)*(i-r-d),indexAtFraction:b=>{const T=(Math.min(1,Math.max(0,b))*n-a)/(n-a-o);return Math.min(c-1,Math.max(0,Math.round(T*(c-1))))}}}function mn(e,t){if(e.length<2)return'<div class="empty">Not enough history for this range yet.</div>';const s=at(e,t.width,t.height),{W:n,H:i,padL:a,padR:o,padB:r}=s,d=e.map((x,k)=>`${s.x(k).toFixed(1)},${s.y(x.value).toFixed(1)}`).join(" "),c=`${a.toFixed(1)},${(i-r).toFixed(1)} ${d} ${s.x(e.length-1).toFixed(1)},${(i-r).toFixed(1)}`,l=s.y(e[e.length-1].value);let u="";const h=4;for(let x=0;x<=h;x++){const k=s.min+(s.max-s.min)*x/h,M=s.y(k);u+=`<line class="pgrid" x1="${a}" y1="${M.toFixed(1)}" x2="${(n-o).toFixed(1)}" y2="${M.toFixed(1)}"/>`,Math.abs(M-l)>11&&(u+=`<text class="paxis" x="${(n-o+5).toFixed(1)}" y="${(M+3).toFixed(1)}">${t.formatY(k)}</text>`)}let m="";const p=Math.min(5,e.length);for(let x=0;x<p;x++){const k=Math.round(x*(e.length-1)/(p-1)),M=x===0?"start":x===p-1?"end":"middle";m+=`<text class="paxis pxlab" style="text-anchor:${M}" x="${s.x(k).toFixed(1)}" y="${i-8}">${t.formatX(e[k].timestamp)}</text>`}const v=s.x(e.length-1),f=s.y(e[e.length-1].value),y=t.formatY(e[e.length-1].value),b=`pg${Math.round(e[0].value)}${e.length}`,w=`
    <line class="pchart-now-line" x1="${a}" y1="${f.toFixed(1)}" x2="${(n-o).toFixed(1)}" y2="${f.toFixed(1)}"/>
    <g class="pchart-now-tag" transform="translate(${(n-o+1).toFixed(1)}, ${f.toFixed(1)})">
      <rect x="0" y="-7.5" width="${(o-2).toFixed(1)}" height="15" rx="3" fill="${t.stroke}"/>
      <text x="${((o-2)/2).toFixed(1)}" y="3.5" text-anchor="middle" class="pchart-now-text">${y}</text>
    </g>
    <circle class="pchart-now" cx="${v.toFixed(1)}" cy="${f.toFixed(1)}" r="3.5" fill="${t.stroke}"/>`,T=`
    <g class="pchart-cross" hidden>
      <line class="pchart-cross-line" x1="${v.toFixed(1)}" y1="${s.padT}" x2="${v.toFixed(1)}" y2="${(i-r).toFixed(1)}"/>
      <circle class="pchart-cross-dot" cx="${v.toFixed(1)}" cy="${f.toFixed(1)}" r="4" fill="${t.stroke}"/>
    </g>`;return`<svg class="pchart" viewBox="0 0 ${n} ${i}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="price chart">
    <defs><linearGradient id="${b}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${t.stroke}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${t.stroke}" stop-opacity="0"/></linearGradient></defs>
    ${u}
    <polygon fill="url(#${b})" points="${c}"/>
    <polyline fill="none" stroke="${t.stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${d}"/>
    ${m}
    ${w}
    ${T}
  </svg>`}function Yt(e,t,s){const n=e.map(r=>({timestamp:r.timestamp,value:r.close})),i=[];for(const r of e)i.push({timestamp:r.timestamp,value:r.high}),i.push({timestamp:r.timestamp,value:r.low});const a=at(n,t,s),o=at(i.length>=2?i:n,t,s);return{...a,min:o.min,max:o.max,y:o.y}}function vn(e,t){if(e.length<2)return'<div class="empty">Not enough history for this range yet.</div>';const s=t.indicators??!0,n=Yt(e,t.width,t.height),{W:i,H:a,padL:o,padR:r,padB:d}=n,c=e.length,l=Math.max(1,(i-o-r)/c*.7),u=14,h=a-d+2,m=Math.max(...e.map(P=>P.volume))||1,p=n.y(e[e.length-1].close);let v="";const f=4;for(let P=0;P<=f;P++){const g=n.min+(n.max-n.min)*P/f,E=n.y(g);v+=`<line class="pgrid" x1="${o}" y1="${E.toFixed(1)}" x2="${(i-r).toFixed(1)}" y2="${E.toFixed(1)}"/>`,Math.abs(E-p)>11&&(v+=`<text class="paxis" x="${(i-r+5).toFixed(1)}" y="${(E+3).toFixed(1)}">${t.formatY(g)}</text>`)}let y="";const b=Math.min(5,c);for(let P=0;P<b;P++){const g=Math.round(P*(c-1)/(b-1)),E=P===0?"start":P===b-1?"end":"middle";y+=`<text class="paxis pxlab" style="text-anchor:${E}" x="${n.x(g).toFixed(1)}" y="${a-8}">${t.formatX(e[g].timestamp)}</text>`}const w=e.map(P=>P.close),T=s?us(w,20):[],x=s?us(w,50):[];let k="",M="";for(let P=0;P<c;P++){const g=e[P],E=n.x(P),L=g.close>=g.open,R=n.y(g.high),H=n.y(g.low),j=n.y(g.open),W=n.y(g.close),Ee=Math.min(j,W),de=Math.max(1,Math.abs(W-j));if(k+=`<g class="pcandle ${L?"up":"down"}"><line class="pcandle-wick" x1="${E.toFixed(1)}" y1="${R.toFixed(1)}" x2="${E.toFixed(1)}" y2="${H.toFixed(1)}"/><rect class="pcandle-body" x="${(E-l/2).toFixed(1)}" y="${Ee.toFixed(1)}" width="${l.toFixed(1)}" height="${de.toFixed(1)}"/></g>`,s){const pe=g.volume/m*u,we=L?"var(--hot)":"var(--cold)";M+=`<rect class="pvol-bar" x="${(E-l/2).toFixed(1)}" y="${(h-pe).toFixed(1)}" width="${l.toFixed(1)}" height="${pe.toFixed(1)}" fill="${we}" opacity="0.6"/>`}}function F(P){let g="",E=!1;for(let L=0;L<P.length;L++){const R=P[L];R!==void 0&&(E?g+=` L ${n.x(L).toFixed(1)} ${n.y(R).toFixed(1)}`:(g=`M ${n.x(L).toFixed(1)} ${n.y(R).toFixed(1)}`,E=!0))}return g}const I=F(T),G=F(x),q=`
    ${I?`<path class="pema pema20" fill="none" stroke="var(--accent-text)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" d="${I}"/>`:""}
    ${G?`<path class="pema pema50" fill="none" stroke="var(--text-dim)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" d="${G}"/>`:""}
  `;let B="";if(s){const P=li(e,20),g=n.y(P.resistance),E=n.y(P.support);B=`
    <line class="psr psr-resistance" x1="${o.toFixed(1)}" y1="${g.toFixed(1)}" x2="${(i-r).toFixed(1)}" y2="${g.toFixed(1)}" stroke="var(--hot)" stroke-width="1" stroke-dasharray="3,2" opacity="0.3"/>
    <text class="psr-label psr-label-resistance" x="${(o+2).toFixed(1)}" y="${(g-2.5).toFixed(1)}" font-size="7" fill="var(--hot)" opacity="0.85">R</text>
    <line class="psr psr-support" x1="${o.toFixed(1)}" y1="${E.toFixed(1)}" x2="${(i-r).toFixed(1)}" y2="${E.toFixed(1)}" stroke="var(--cold)" stroke-width="1" stroke-dasharray="3,2" opacity="0.3"/>
    <text class="psr-label psr-label-support" x="${(o+2).toFixed(1)}" y="${(E-2.5).toFixed(1)}" font-size="7" fill="var(--cold)" opacity="0.85">S</text>
  `}const se=e[c-1],ee=n.x(c-1),ie=n.y(se.close),De=se.close>=e[0].close,be=t.formatY(se.close),Se=`
    <line class="pchart-now-line" x1="${o}" y1="${ie.toFixed(1)}" x2="${(i-r).toFixed(1)}" y2="${ie.toFixed(1)}"/>
    <g class="pchart-now-tag" transform="translate(${(i-r+1).toFixed(1)}, ${ie.toFixed(1)})">
      <rect x="0" y="-7.5" width="${(r-2).toFixed(1)}" height="15" rx="3"/>
      <text x="${((r-2)/2).toFixed(1)}" y="3.5" text-anchor="middle" class="pchart-now-text">${be}</text>
    </g>
    <circle class="pchart-now" cx="${ee.toFixed(1)}" cy="${ie.toFixed(1)}" r="3.5"/>`,ge=`
    <g class="pchart-cross" hidden>
      <line class="pchart-cross-line" x1="${ee.toFixed(1)}" y1="${n.padT}" x2="${ee.toFixed(1)}" y2="${(a-d).toFixed(1)}"/>
      <circle class="pchart-cross-dot" cx="${ee.toFixed(1)}" cy="${ie.toFixed(1)}" r="4"/>
    </g>`,U=[`O ${t.formatY(se.open)}`,`H ${t.formatY(se.high)}`,`L ${t.formatY(se.low)}`],_=`C ${t.formatY(se.close)}`,A=U.join("   "),S=Math.max(60,(A.length+_.length+3)*4.1),D=`<g class="pohlc-labels" transform="translate(${o.toFixed(1)}, ${n.padT.toFixed(1)})">
    <rect class="pohlc-scrim" x="0" y="0" width="${S.toFixed(1)}" height="13" rx="3"/>
    <text class="pohlc-text" x="4" y="9.5" font-size="7.5">${A}<tspan dx="6" class="pohlc-close ${De?"up":"down"}">${_}</tspan></text>
  </g>`;return`<svg class="pchart pcandle-chart ${De?"up":"down"}" viewBox="0 0 ${i} ${a}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="candlestick chart">
    ${v}
    ${k}
    ${q}
    ${B}
    ${M}
    ${D}
    ${y}
    ${Se}
    ${ge}
  </svg>`}function yn(e,t,s,n){const i=t.clientWidth,a=e.offsetWidth;if(i<=0||a<=0){e.style.left=`${(s*100).toFixed(2)}%`,e.style.top=`${(n*100).toFixed(2)}%`,e.style.transform="";return}const o=4,r=s*i,d=Math.min(Math.max(r-a/2,o),i-a-o);e.style.left=`${d.toFixed(1)}px`,e.style.top=`${(n*100).toFixed(2)}%`,e.style.transform="translate(0, calc(-100% - 10px))"}function fn(e,t){if(e.length<2)return'<p class="status-line">Not enough points for a chart.</p>';const s=t.width??800,n=t.height??180,i=8,a=e.map(l=>l.value),o=Math.min(...a),d=Math.max(...a)-o||1,c=e.map((l,u)=>{const h=i+u/(e.length-1)*(s-2*i),m=n-i-(l.value-o)/d*(n-2*i);return`${h.toFixed(1)},${m.toFixed(1)}`}).join(" ");return`
    <svg class="equity-curve" viewBox="0 0 ${s} ${n}" role="img"
         aria-label="${t.ariaLabel}">
      <polyline class="${t.lineClass}" fill="none" stroke-width="2" points="${c}" />
    </svg>
  `}const ci="var(--hot)",di="var(--cold)",_e=864e5,ps=36e5,wt=[{key:"1D",ms:_e,bucketMs:ps,fx:e=>ui(e)},{key:"1W",ms:7*_e,bucketMs:4*ps,fx:e=>$t(e)},{key:"1M",ms:30*_e,bucketMs:_e,fx:e=>$t(e)},{key:"1Y",ms:365*_e,bucketMs:7*_e,fx:e=>pi(e)},{key:"All",ms:0,bucketMs:7*_e,fx:e=>$t(e)}],ui=e=>new Date(e).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}),$t=e=>new Date(e).toLocaleDateString("en-GB",{day:"2-digit",month:"2-digit"}),pi=e=>new Date(e).toLocaleDateString("en-GB",{month:"short",year:"2-digit"}),hi=30,mi=5*6e4;function vi(e,t){return e<=0?t:Math.max(mi,Math.min(t,e/hi))}function yi(e,t){const s=new Map;for(const n of e){const i=Math.floor(n.at/t)*t,a=s.get(i);a?s.set(i,{...a,high:Math.max(a.high,n.equity),low:Math.min(a.low,n.equity),close:n.equity}):s.set(i,{timestamp:i,open:n.equity,high:n.equity,low:n.equity,close:n.equity,volume:0})}return[...s.values()].sort((n,i)=>n.timestamp-i.timestamp)}function Ft(e,t={}){const s=t.currencySymbol??"€",n=t.live?'<span class="tag-live">REAL</span>':'<span class="tag-sim">SIMULATED</span>',i=t.showHero??!0;let a=[],o,r="All",d="line";function c(){const m=wt.find(f=>f.key===r),p=a[a.length-1].at;let v=m.ms>0?a.filter(f=>f.at>=p-m.ms):a.slice();return v.length<2&&(v=a.slice()),v}function l(){const m=e.querySelector(".detail-chart");m==null||m.classList.add("fade-out"),setTimeout(()=>{u();const p=e.querySelector(".detail-chart");p&&(p.classList.add("fade-in"),setTimeout(()=>p.classList.remove("fade-in"),300))},200)}function u(){if(a.length<2){e.innerHTML='<div class="empty">Collecting data — the chart appears after a few cloud runs. Check back soon.</div>';return}const m=wt.find(q=>q.key===r),p=c(),v=m.key==="All"&&o!==void 0&&o>0,f=v?o:p[0].equity,y=p[p.length-1].equity,b=f>0?(y-f)/f*100:0,w=b>=0,T=p[p.length-1].at-p[0].at,x=yi(p,vi(T,m.bucketMs)),k=x.length>=2?d:"line";let M,F=null,I;if(k==="candle")M=vn(x,{formatX:m.fx,formatY:q=>`${s}${O(q)}`,indicators:!1}),F=Yt(x),I=x;else{const q=p.map(B=>({timestamp:B.at,value:B.equity}));M=mn(q,{stroke:w?ci:di,formatX:m.fx,formatY:B=>`${s}${O(B)}`}),F=at(q),I=q.map(B=>({timestamp:B.timestamp,open:B.value,high:B.value,low:B.value,close:B.value,volume:0}))}const G=wt.map(q=>`<button class="range-btn ${q.key===r?"active":""}" data-range="${q.key}" aria-pressed="${q.key===r}">${q.key}</button>`).join("");e.innerHTML=`
      ${i?`<!-- hero-bare matches Home's balance treatment: same dominant-figure
           pattern for this sub-screen (shared by Crypto's and Stocks' History
           tab), not a secondary boxed widget. -->
      <div class="hero hero-bare">
        <div class="hero-label">Now ${n}</div>
        <div class="hero-value">${s}${O(y)}</div>
        <div class="hero-change ${w?"up":"down"}">${V(b)} · ${r}</div>
        <!-- Same wording the REAL-money hero already uses (homeView.ts/
             assetHubView.ts) for the identical situation: once the true
             starting equity is used instead of the oldest surviving sample,
             that sample's own date is no longer what the % is measured
             from, so showing it here would be its own new mismatch. -->
        <div class="hero-split"><span>${v?"since tracking began":`since ${new Date(p[0].at).toLocaleDateString("en-GB")}`}</span></div>
      </div>`:r==="All"?"":`<div class="hero-change compact ${w?"up":"down"}">${V(b)} · ${r}</div>`}
      <div class="chart-controls">
        <div class="range-bar">${G}</div>
        <div class="chart-toggle">
          <button class="ctoggle-btn ${k==="line"?"active":""}" data-mode="line" aria-pressed="${k==="line"}">Line</button>
          <!-- Disabled, not silently ignored, when there isn't enough
               history yet to bucket into 2+ candles (a brand-new account's
               first ~10-15 minutes) — real bug: tapping this while mode
               gets force-overridden back to 'line' above left the button
               tappable but inert, with "Line" reverting to shown-active
               instead of whatever the tap just selected. -->
          <button class="ctoggle-btn ${k==="candle"?"active":""}" data-mode="candle" aria-pressed="${k==="candle"}" ${x.length<2?"disabled":""}>Candles</button>
        </div>
      </div>
      <div class="detail-chart"><div class="pchart-wrap">${M}<div class="pchart-tip" hidden></div></div></div>`,e.querySelectorAll(".range-btn").forEach(q=>{q.addEventListener("click",()=>{const B=q.dataset.range;B!==r&&(r=B,l())})}),e.querySelectorAll(".ctoggle-btn").forEach(q=>{q.addEventListener("click",()=>{const B=q.dataset.mode;(B==="candle"||B==="line")&&B!==d&&(d=B,l())})}),h(F,k,I)}function h(m,p,v,f){const y=e.querySelector("svg.pchart"),b=e.querySelector(".pchart-tip");if(!y||!b)return;const w=y.querySelector(".pchart-cross"),T=y.querySelector(".pchart-cross-line"),x=y.querySelector(".pchart-cross-dot"),k=F=>{const I=y.getBoundingClientRect();if(I.width<=0)return;const G=m.indexAtFraction((F-I.left)/I.width),q=v[G],B=m.x(G),se=m.y(q.close);T==null||T.setAttribute("x1",B.toFixed(1)),T==null||T.setAttribute("x2",B.toFixed(1)),x==null||x.setAttribute("cx",B.toFixed(1)),x==null||x.setAttribute("cy",se.toFixed(1)),w==null||w.classList.add("show"),b.hidden=!1;const ee=new Date(q.timestamp).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});b.innerHTML=p==="candle"?`<span class="pchart-tip-price">${s}${O(q.close)}</span><span class="pchart-tip-ohlc">O ${s}${O(q.open)} · H ${s}${O(q.high)} · L ${s}${O(q.low)} · C ${s}${O(q.close)}</span><span class="pchart-tip-time">${ee}</span>`:`<span class="pchart-tip-price">${s}${O(q.close)}</span><span class="pchart-tip-time">${ee}</span>`;const ie=e.querySelector(".pchart-wrap");ie&&yn(b,ie,B/m.W,se/m.H)},M=()=>{w==null||w.classList.remove("show"),b.hidden=!0};y.addEventListener("pointermove",F=>k(F.clientX)),y.addEventListener("pointerdown",F=>k(F.clientX)),y.addEventListener("pointerleave",M),y.addEventListener("pointercancel",M)}return{setHistory(m,p){a=m,o=p,u()}}}const fi=new Set(["1INCH","AAVE","ACT","ADA","ADX","ALGO","ANKR","APE","ATOM","AVAX","BAL","BAND","BAT","BCH","BEAM","BNB","BNT","BTC","BTT","CC","CHZ","COMP","CRV","CVC","DAI","DASH","DENT","DOGE","DOT","ENJ","ETC","ETH","FIDA","FIL","FLUX","FUN","GAS","GMT","GNO","GRT","ICP","ICX","KIN","KNC","KSM","LINK","LPT","LRC","LSK","LTC","MANA","MLN","NANO","NEO","NMR","OMG","OXT","PAXG","POLIS","POWR","QNT","QTUM","RAY","REN","REQ","RLC","SAFE","SAND","SC","SKY","SNX","SOL","STORJ","STX","SUSHI","TEL","TRX","UMA","UNI","USDC","USDT","VET","VTHO","WBTC","XLM","XMR","XRP","XTZ","YFI","ZEC","ZRX"]);function bn(e){let t=0;for(let s=0;s<e.length;s++)t=(t*31+e.charCodeAt(s))%360;return t}function gn(e){return e.slice(0,4)}function Ht(e){return e.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;")}function bi(e){const t=e.toUpperCase();return`<span class="coin-logo coin-logo-tile" style="--coin-hue:${bn(t)}" aria-hidden="true">${Ht(gn(t))}</span>`}function Ce(e,t=""){const s=e.toUpperCase();if(!fi.has(s))return bi(s);const n=`${t}coins/${encodeURIComponent(s.toLowerCase())}.svg`;return`<img class="coin-logo" src="${Ht(n)}" alt="" loading="lazy" decoding="async" data-coin="${Ht(s)}">`}const gi=["EUR","USDT","USDC","USD"];function hs(e){const t=e.toUpperCase();for(const s of gi)if(t.length>s.length&&t.endsWith(s)){const n=t.slice(0,-s.length);return n==="XBT"?"BTC":n}return t}function It(e,t=""){return`<span class="logo-wrap">${Ce(e,t)}<span class="logo-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg></span></span>`}function Ve(e){e.addEventListener("error",t=>{const s=t.target;if(!(s instanceof HTMLImageElement)||!s.dataset.coin)return;const n=document.createElement("span");n.className="coin-logo coin-logo-tile",n.setAttribute("aria-hidden","true"),n.style.setProperty("--coin-hue",String(bn(s.dataset.coin))),n.textContent=gn(s.dataset.coin),s.replaceWith(n)},!0)}function wi(e="Loading...",t=3e4){const s=document.createElement("div");s.className="loading-overlay",s.id=`overlay-${Date.now()}`,s.innerHTML=`
    <div class="loading-modal">
      <div class="spinner lg"></div>
      <p>${Ut(e)}</p>
    </div>
  `,document.body.appendChild(s);const n=setTimeout(()=>{s.remove()},t);return()=>{clearTimeout(n),s.remove()}}function $i(){document.querySelectorAll(".loading-overlay").forEach(t=>t.remove())}function Si(e="md"){const t=document.createElement("div");return t.className=`spinner ${e}`,t}function Ie(e=2){return`
    <div class="skeleton-list-row">
      <div class="row-main"><span class="skeleton-dot"></span>
        <div class="skeleton-lines"><span class="skeleton-bar" style="width:72px"></span><span class="skeleton-bar" style="width:52px"></span></div>
      </div>
      <div class="skeleton-side"><span class="skeleton-bar" style="width:56px"></span></div>
    </div>`.repeat(e)}function ki(e=3){return`
    <div class="skeleton-market-card">
      <div class="skeleton-top"><span class="skeleton-dot"></span><span class="skeleton-bar" style="width:64px"></span></div>
      <span class="skeleton-bar mc-price"></span>
      <span class="skeleton-bar mc-spark"></span>
    </div>`.repeat(e)}function xi(e,t,s,n,i,a){const o=document.createElement("div");if(o.className="empty-state",o.innerHTML=`
    <div class="empty-state-icon">${t}</div>
    <div class="empty-state-title">${Ut(s)}</div>
    <div class="empty-state-text">${Ut(n)}</div>
  `,i&&a){const r=document.createElement("button");r.className="primary empty-state-action",r.textContent=i,r.addEventListener("click",a),o.appendChild(r)}e.innerHTML="",e.appendChild(o)}function Ut(e){const t={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"};return e.replace(/[&<>"']/g,s=>t[s]??s)}const ms=6e4;function vs(e,t){const s=document.createElement(e);return t&&(s.className=t),s}function wn(e,t){const s=U=>`${t.currencySymbol}${O(U)}`;e.innerHTML=`
    <h2 class="view-title">${t.title}</h2>
    <p class="view-sub" id="hub-subtitle">${t.subtitle}</p>
    <div class="hub-tabs" role="tablist">
      <button class="hub-tab active" data-hub="overview" role="tab" aria-selected="true">Overview</button>
      <button class="hub-tab" data-hub="history" role="tab" aria-selected="false" tabindex="-1">History</button>
      <button class="hub-tab" data-hub="market" role="tab" aria-selected="false" tabindex="-1">Market</button>
      <button class="hub-tab" data-hub="profit" role="tab" aria-selected="false" tabindex="-1">Profit</button>
      ${t.renderLongTerm?'<button class="hub-tab" data-hub="longterm" role="tab" aria-selected="false" tabindex="-1">Long-Term</button>':""}
    </div>
    <div class="hub-panel active" data-hub-panel="overview"></div>
    <div class="hub-panel" data-hub-panel="history">
      <!-- Real activity — hidden entirely until the live ledger has ever
           been initialized (state.live !== null), same convention homeView.ts
           uses, so this never appears for Stocks (no live account there)
           and never shows a misleading empty "real" section. David reported
           2026-09-03: this tab only ever showed the SIMULATED chart/list
           below, with no real counterpart anywhere on it — easy to mistake
           for "the real wallet still isn't reflected", when the real card
           simply only existed on the Overview tab. -->
      <section class="block" id="hub-real-activity" hidden>
        <div class="block-head"><h2>Real activity <span class="tag-live">REAL</span></h2></div>
        <div class="stack stack-card" id="hub-real-activity-list"></div>
      </section>
      <!-- The SIMULATED chart+list below — hidden once a live account exists
           (David asked, 2026-09-05, to stop showing the not-real wallet at
           all once real money is live), same as #hub-sim-hero on the
           Profit tab. Stays visible for Stocks (no live account there). -->
      <div id="hub-sim-history">
        <div id="hub-history-chart"></div>
        <!-- Shimmering row placeholders, not a bare "Loading…" line — a
             plain text row collapses this whole card down to one short line
             (confirmed by screenshot: a single pill floating over an
             otherwise-blank viewport) and then the real rows shove
             everything below back down once they land. skeletonRowsHtml
             already existed for exactly this (marketsView.ts/valueView.ts
             use the same shimmer treatment for their own first paint) but
             had no caller on this tab. -->
        <div class="stack stack-card" id="hub-history-list">${Ie(3)}</div>
      </div>
    </div>
    <div class="hub-panel" data-hub-panel="market"></div>
    <div class="hub-panel" data-hub-panel="profit">
      <!-- Once a live account exists, "Real money" IS the dominant figure on
           this tab (same reasoning as Home's #home-live-hero) — hero-bare,
           not a boxed secondary. Before that (or for Stocks, which has no
           live account), stays hidden and the simulated hero below is all
           there is to show. David asked (2026-09-05) to stop showing the
           simulated ("not real") wallet at all once real money exists — see
           #hub-sim-hero's own hiding below. -->
      <section class="hero hero-bare" id="hub-real-money" hidden>
        <div class="hero-label">Real money <span class="tag-live">REAL</span></div>
        <div class="hero-value" id="hub-real-equity"><span class="hero-value-major">—</span></div>
        <div class="hero-change" id="hub-real-change" hidden></div>
        <div class="hero-bench" id="hub-real-breakdown"></div>
        <!-- Found in the 2026-09-06 readiness/kill-switch audit: this exact
             "Real money" card is duplicated from Home (homeView.ts's
             #home-live-hero), but only Home ever showed the kill-switch
             banner — anyone landing here directly (Crypto/Stocks → Profit,
             without passing through Home first) saw the real-money balance
             with zero indication that trading might currently be paused. -->
        <div class="kill-switch-banner" id="hub-kill-switch" hidden></div>
        <div id="hub-real-equity-chart"></div>
      </section>
      <!-- Dominant figure ONLY while there's no live account to show instead
           (Stocks today, or Crypto before real money went live) — hidden
           entirely once one exists, per David's 2026-09-05 ask. -->
      <section class="hero hero-bare" id="hub-sim-hero">
        <div class="hero-label">Total return <span class="tag-sim">SIMULATED</span></div>
        <div class="hero-value" id="hub-return">—</div>
        <div class="hero-bench" id="hub-bench" hidden></div>
      </section>
      <section class="block readiness" id="hub-readiness"></section>
    </div>
    ${t.renderLongTerm?'<div class="hub-panel" data-hub-panel="longterm"></div>':""}`,Ve(e);const n=e.querySelector('[data-hub-panel="overview"]'),i=e.querySelector("#hub-sim-history"),a=e.querySelector("#hub-history-chart"),o=e.querySelector("#hub-history-list"),r=e.querySelector('[data-hub-panel="market"]'),d=e.querySelector("#hub-sim-hero"),c=e.querySelector("#hub-return"),l=e.querySelector("#hub-bench"),u=e.querySelector("#hub-readiness"),h=e.querySelector('[data-hub-panel="longterm"]'),m=e.querySelector("#hub-real-activity"),p=e.querySelector("#hub-real-activity-list"),v=e.querySelector("#hub-real-money"),f=e.querySelector("#hub-real-equity"),y=e.querySelector("#hub-real-change"),b=e.querySelector("#hub-real-breakdown"),w=e.querySelector("#hub-kill-switch"),T=e.querySelector("#hub-subtitle"),x=e.querySelector("#hub-real-equity-chart"),k=Ft(a,{currencySymbol:t.currencySymbol}),M=Ft(x,{currencySymbol:t.currencySymbol,live:!0,showHero:!1});let F=!1,I,G=!1,q;const B=t.renderOverview(n);function se(U){if(i.hidden=!!U.live,!U.live){if(k.setHistory(U.equityHistory,U.initialCash),U.history.length===0){o.innerHTML='<div class="empty">No trades yet.</div>';return}o.innerHTML="";for(const _ of U.history){const A=_.kind==="buy",S=vs("div",`row trade ${_.kind}`);S.innerHTML=`
        <div class="row-main">${It(hs(_.symbol))}
          <div><div class="row-title"><span class="pill ${A?"buy":"sell"}">${A?"BUY":"SELL"}</span> ${_.symbol}</div>
            <div class="row-sub">${_.note?_.note:A?"opened":"closed"}</div></div></div>
        <div class="row-side"><span class="row-title">${s(_.price)}</span>
          <span class="row-sub">${_.quantity.toLocaleString("en-US",{maximumFractionDigits:4})}</span>
          <span class="row-sub">${new Date(_.at).toLocaleString("en-GB",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</span></div>`,o.appendChild(S)}}}function ee(U){const _=U.live;if(m.hidden=!_,!!_){if(_.recentEvents.length===0){p.innerHTML='<div class="empty">No real trades yet.</div>';return}p.innerHTML="";for(const A of _.recentEvents){const S=A.event==="filled",D=vs("div",`row trade ${S?"buy":"sell"}`),P=A.symbol?It(hs(A.symbol)):"";D.innerHTML=`
        <div class="row-main">${P}<div><div class="row-title"><span class="pill ${S?"buy":"sell"}">${S?"FILLED":"REJECTED"}</span>${A.symbol?` ${$(A.symbol)}`:""}</div>
          <div class="row-sub">${$(A.detail)}</div></div></div>
        <div class="row-side"><span class="row-sub">${new Date(A.at).toLocaleString("en-GB",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</span></div>`,p.appendChild(D)}}}function ie(U){var L,R,H;const _=U.live;if(v.hidden=!_,!_)return;const A=_.positions.reduce((j,W)=>j+W.quantity*W.entryPrice,0),S=((L=_.equityHistory.at(-1))==null?void 0:L.equity)??_.cash+A,{major:D,minor:P}=ze(S);f.innerHTML=`<span class="hero-value-currency">${t.currencySymbol}</span><span class="hero-value-major">${D}</span><span class="hero-value-minor">.${P}</span>`;const g=(R=_.equityHistory[0])==null?void 0:R.equity;if(g!==void 0&&g>0){const j=(S-g)/g*100,W=j>=0;v.classList.toggle("up",W),v.classList.toggle("down",!W),y.hidden=!1,y.textContent=`${V(j).replace(/^[+-]/,"")} since tracking began`,y.className=`hero-change ${W?"up":"down"}`}else v.classList.remove("up","down"),y.hidden=!0;const E=(H=U.marketSnapshot.find(j=>j.symbol==="XBTEUR"))==null?void 0:H.price;if(b.hidden=!1,b.textContent=_.externalBtcQuantity>0?E?`Cash ${s(_.cash)} · BTC holding ${s(_.externalBtcQuantity*E)} (untracked)`:`Cash ${s(_.cash)} · BTC holding ${_.externalBtcQuantity} BTC (untracked, price unavailable)`:`Cash ${s(_.cash)}`,_.killSwitchEngaged){w.hidden=!1;const j=_.killSwitchReason?` — ${$(_.killSwitchReason)}`:"";w.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12"/><path d="M15 6v12"/></svg><span>Real-money trading paused — no new trades or exits can execute; open positions stay open, unmonitored, until resumed${j}</span>`}else w.hidden=!0;M.setHistory(_.equityHistory)}function De(U){var E,L;if(d.hidden=!!U.live,U.live){u.hidden=!0;return}const _=((E=U.equityHistory.at(-1))==null?void 0:E.equity)??U.cash,A=U.initialCash>0?(_-U.initialCash)/U.initialCash*100:0;c.textContent=V(A),c.className=`hero-value ${A>=0?"up":"down"}`,d.classList.toggle("up",A>=0),d.classList.toggle("down",A<0);const S=((L=U.marketSnapshot.find(R=>R.symbol==="XBTEUR"))==null?void 0:L.price)??0;if(t.showBenchmark&&U.benchmark&&S>0&&U.benchmark.btc>0&&U.benchmark.equity>0){const R=(_-U.benchmark.equity)/U.benchmark.equity*100,H=(S-U.benchmark.btc)/U.benchmark.btc*100;l.hidden=!1,l.textContent=`vs Bitcoin — agent ${V(R)} · BTC ${V(H)}${R>=H?" · leading":""}`}else l.hidden=!0;if(u.hidden=!!U.live,U.live)return;const D=U.readiness;if(!D){u.innerHTML='<div class="block-head"><h2>Real-money readiness</h2></div><div class="empty">Assessing the paper track record…</div>';return}const P=D.ready?'<span class="ready-badge go">READY</span>':'<span class="ready-badge no">NOT READY</span>',g=D.criteria.map(R=>{const H=R.ok?"ok":D.unmet.includes(R.key)?"no":"info";return`<li class="${H}"><svg class="crit-icon" viewBox="0 0 24 24" aria-hidden="true">${H==="ok"?'<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>':H==="no"?'<circle cx="12" cy="12" r="9"/><path d="M12 7.5v6"/><path d="M12 16.5h.01"/>':'<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5h.01"/>'}</svg><span>${R.detail}</span></li>`}).join("");u.innerHTML=`<div class="block-head"><h2>Real-money readiness</h2>${P}</div><ul class="readiness-list">${g}</ul>`}let be=!1;async function Se(){const U=await t.fetchState();if(!U){be||(o.innerHTML=`<div class="empty">Couldn't reach the cloud agent — retrying.</div>`);return}be=!0,t.liveSubtitle&&(T.textContent=U.live?t.liveSubtitle:t.subtitle),se(U),ee(U),De(U),ie(U)}e.addEventListener("click",U=>{const A=U.target.closest("[data-hub]");if(!A)return;const S=A.dataset.hub;e.querySelectorAll(".hub-tab").forEach(D=>{const P=D.dataset.hub===S;D.classList.toggle("active",P),D.setAttribute("aria-selected",String(P)),D.tabIndex=P?0:-1}),e.querySelectorAll("[data-hub-panel]").forEach(D=>{D.classList.toggle("active",D.dataset.hubPanel===S)}),S==="market"&&!F&&(I=t.renderMarket(r)??void 0,F=!0),S==="longterm"&&!G&&t.renderLongTerm&&h&&(q=t.renderLongTerm(h)??void 0,G=!0)});let ge=0;return Se(),ge=window.setInterval(()=>void Se(),ms),{pause:()=>{window.clearInterval(ge),B==null||B.pause(),I==null||I.pause(),q==null||q.pause()},resume:()=>{Se(),ge=window.setInterval(()=>void Se(),ms),B==null||B.resume(),I==null||I.resume(),q==null||q.resume()}}}const Ti=[{key:"default",label:"Default"},{key:"change",label:"Change"},{key:"volume",label:"Volume"},{key:"price",label:"Price"},{key:"name",label:"Name"}];function Ei(e,t){const s=t.trim().toLowerCase();return s===""?!0:e.label.toLowerCase().includes(s)||e.base.toLowerCase().includes(s)||e.symbol.toLowerCase().includes(s)}function Li(e,t){return t.trim()===""?[...e]:e.filter(s=>Ei(s,t))}function Ai(e,t){const s=[...e];switch(t){case"change":return s.sort((n,i)=>i.changePct-n.changePct);case"price":return s.sort((n,i)=>i.price-n.price);case"volume":return s.sort((n,i)=>i.quoteVolume-n.quoteVolume);case"name":return s.sort((n,i)=>n.label.localeCompare(i.label));case"default":default:return s}}const Pi=25e3;function $n(e){const t=e.some(s=>s.quoteVolume>0);return s=>!t||s.quoteVolume>=Pi}function Sn(e,t=1/0){const s=$n(e);return e.filter(n=>n.changePct>0&&s(n)).sort((n,i)=>i.changePct-n.changePct).slice(0,t)}function kn(e,t=1/0){const s=$n(e);return e.filter(n=>n.changePct<0&&s(n)).sort((n,i)=>n.changePct-i.changePct).slice(0,t)}const ys="markets-watchlist";class Ri{constructor(t){J(this,"symbols");this.store=t;const s=t.get(ys);this.symbols=new Set(Array.isArray(s)?s:[])}has(t){return this.symbols.has(t)}toggle(t){return this.symbols.has(t)?this.symbols.delete(t):this.symbols.add(t),this.persist(),this.symbols.has(t)}get size(){return this.symbols.size}filter(t){return t.filter(s=>this.symbols.has(s.symbol))}persist(){this.store.set(ys,[...this.symbols])}}const Mi={BTC:"XBT",DOGE:"XDG"};function Ci(e,t){const s=e.instruments.find(i=>i.symbol===t);return s?`${Mi[s.base.toUpperCase()]??s.base.toUpperCase()}/${s.quote.toUpperCase()}`:null}function qi(e,t,s,n={}){const i=n.pollMs??3e3;let a=!1,o=null,r=0;const d=(u,h)=>{!a&&Number.isFinite(u)&&u>0&&s({price:u,at:h})},c=async()=>{if(!a)try{const u=await e.source.getCandles(t,"1m",2,{priority:!0});if(u.ok&&u.value.length>0){const h=u.value[u.value.length-1];d(h.close,h.timestamp)}}catch{}};c(),r=window.setInterval(()=>void c(),i);const l=/kraken/i.test(e.source.name);if(e.kind==="public"&&l&&typeof WebSocket<"u"){const u=Ci(e,t);if(u)try{o=new WebSocket("wss://ws.kraken.com"),o.addEventListener("open",()=>{try{o==null||o.send(JSON.stringify({event:"subscribe",pair:[u],subscription:{name:"ticker"}}))}catch{}}),o.addEventListener("message",h=>{try{const m=JSON.parse(String(h.data));if(Array.isArray(m)&&m[2]==="ticker"){const p=m[1],v=p==null?void 0:p.c;if(Array.isArray(v)&&v.length>0){const f=Number(v[0]);d(f,Date.now())}}}catch{}}),o.addEventListener("error",()=>{})}catch{o=null}}return function(){if(a=!0,window.clearInterval(r),o){try{o.close()}catch{}o=null}}}const Di="https://api.coingecko.com/api/v3",Fi={BTC:"bitcoin",ETH:"ethereum",SOL:"solana",XRP:"ripple",ADA:"cardano",DOGE:"dogecoin",LTC:"litecoin",DOT:"polkadot",LINK:"chainlink",AVAX:"avalanche-2",TRX:"tron",ATOM:"cosmos",XLM:"stellar",BCH:"bitcoin-cash",UNI:"uniswap",AAVE:"aave",ETC:"ethereum-classic",FIL:"filecoin",NEAR:"near",ALGO:"algorand",INJ:"injective-protocol",ARB:"arbitrum",OP:"optimism",APT:"aptos",PAXG:"pax-gold"};async function Hi(e,t=(s,n)=>fetch(s,n)){const s=Fi[e.toUpperCase()];if(!s)return null;try{const n=await t(`${Di}/coins/markets?vs_currency=eur&ids=${s}`);if(!n.ok)return null;const a=(await n.json())[0];return!a||typeof a.market_cap!="number"?null:{marketCap:a.market_cap,marketCapRank:typeof a.market_cap_rank=="number"?a.market_cap_rank:null,maxSupply:typeof a.max_supply=="number"?a.max_supply:null,circulatingSupply:typeof a.circulating_supply=="number"?a.circulating_supply:null}}catch{return null}}class ft{constructor(t="ata:"){this.prefix=t}prefixed(t){return this.prefix+t}get(t){const s=window.localStorage.getItem(this.prefixed(t));if(s!==null)try{return JSON.parse(s)}catch{window.localStorage.removeItem(this.prefixed(t));return}}set(t,s){window.localStorage.setItem(this.prefixed(t),JSON.stringify(s))}remove(t){window.localStorage.removeItem(this.prefixed(t))}keys(){const t=[];for(let s=0;s<window.localStorage.length;s++){const n=window.localStorage.key(s);n!==null&&n.startsWith(this.prefix)&&t.push(n.slice(this.prefix.length))}return t}}function et(e){const t=Math.abs(e);return t>=1e12?`${(e/1e12).toFixed(2)}T`:t>=1e9?`${(e/1e9).toFixed(2)}B`:t>=1e6?`${(e/1e6).toFixed(2)}M`:t>=1e3?`${(e/1e3).toFixed(1)}K`:e.toFixed(0)}const Ii=2e4,St=6e4,Ui=60,Ye=50,Ni=5*6e4,Oi="var(--hot)",Bi="var(--cold)",Nt="/automatic-trading-ai/",ct=[{key:"popular",label:"Popular",apply:e=>e.slice(0,40)},{key:"all",label:"All",apply:e=>[...e]},{key:"gainers",label:"Gainers",apply:e=>Sn(e)},{key:"losers",label:"Losers",apply:e=>kn(e)},{key:"volume",label:"Volume",apply:e=>[...e].sort((t,s)=>s.quoteVolume-t.quoteVolume)}];let Ot=null;function fs(e){Ot=e}const bs=[{key:"1D",tf:"15m",limit:96,fx:e=>Bt(e)},{key:"1W",tf:"1h",limit:168,fx:e=>gs(e)},{key:"1M",tf:"4h",limit:180,fx:e=>gs(e)},{key:"1Y",tf:"1d",limit:365,fx:e=>Vi(e),long:!0},{key:"5Y",tf:"1w",limit:260,fx:e=>kt(e),long:!0},{key:"10Y",tf:"1w",limit:520,fx:e=>kt(e),long:!0},{key:"All",tf:"1w",limit:720,fx:e=>kt(e),long:!0}],_i=new Set(["1m","5m","15m","30m","1h","4h"]),Bt=e=>new Date(e).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}),gs=e=>new Date(e).toLocaleDateString("en-GB",{day:"2-digit",month:"2-digit"}),Vi=e=>new Date(e).toLocaleDateString("en-GB",{month:"short"}),kt=e=>String(new Date(e).getFullYear());function ji(e){return Array.from({length:e},()=>'<div class="skeleton-row" aria-hidden="true"><span class="skeleton-dot"></span><span class="market-row-id"><span class="skeleton-bar w-40"></span><span class="skeleton-bar w-60"></span></span><span class="market-row-num"><span class="skeleton-bar w-70"></span><span class="skeleton-bar w-50"></span></span></div>').join("")}const ws=70;function $s(e,t){const s=new Date(e);return _i.has(t)?s.toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):s.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})}const Gi=[{key:"chart",label:"Chart",icon:'<path d="M3 17l4-5 4 3 5-7 5 4"/>'},{key:"table",label:"Order book",icon:'<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 12h17M12 3.5v17"/>'},{key:"depth",label:"Depth",icon:'<path d="M3 20V9l5-5 4 4 4-4 5 5v11z"/>'},{key:"trades",label:"Trades",icon:'<path d="M4 6h16M4 12h16M4 18h10"/>'},{key:"trade",label:"Trade",icon:'<path d="M7 4l-4 4 4 4"/><path d="M3 8h13"/><path d="M17 20l4-4-4-4"/><path d="M21 16H8"/>'}];function Ss(e,t,s,n,i,a,o){const r=s>=0,d=Gi.map(l=>`<button class="view-tab ${l.key===n?"active":""}" role="tab" aria-selected="${l.key===n}" ${l.key===n?"":'tabindex="-1"'} data-view="${l.key}" aria-label="${l.label}"><svg viewBox="0 0 24 24" aria-hidden="true">${l.icon}</svg></button>`).join(""),c=a.map((l,u)=>`<button class="pair-menu-item ${u===o?"active":""}" data-idx="${u}" role="option" aria-selected="${u===o}">${Ce(l.base,Nt)}<span class="row-title">${$(l.label)}</span><span class="row-sub">${$(l.symbol)}</span></button>`).join("");return`
    <div class="detail-head">
      <div class="detail-head-left">
        <button class="icon-btn" id="mk-back" aria-label="Back to all markets">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
        </button>
        <div class="detail-coin">${Ce(e.base,Nt)}<div>
          <button class="detail-name-btn" id="mk-pair-toggle" aria-haspopup="listbox" aria-expanded="false">
            <span class="detail-name">${e.label}</span>
            <svg class="pair-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <div class="row-sub">${e.symbol} · EUR</div>
        </div></div>
      </div>
      <button class="star-btn ${i?"active":""}" id="mk-star" aria-pressed="${i}" aria-label="${i?"Remove":"Add"} ${$(e.label)} ${i?"from":"to"} watchlist"><svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></button>
      <div class="pair-menu" id="mk-pair-menu" role="listbox" hidden>${c}</div>
    </div>
    <div class="detail-price-row">
      <div class="row-title big" id="mk-price">${ue(`€${$e(t)}`)}</div>
      <div class="chg ${r?"up":"down"}" id="mk-change">${V(s)}</div>
    </div>
    <div class="detail-stats-row">
      <div class="dstat"><span class="dstat-label">24h High</span><span class="dstat-value">€${$e(e.high)}</span></div>
      <div class="dstat"><span class="dstat-label">24h Low</span><span class="dstat-value">€${$e(e.low)}</span></div>
      <div class="dstat"><span class="dstat-label">24h Volume</span><span class="dstat-value">€${et(e.quoteVolume)}</span></div>
    </div>
    <div class="view-tabs" id="mk-view-tabs" role="tablist">${d}</div>`}function Wi(e){return`
    <div class="order-form">
      <div class="of-toggle">
        <button class="of-btn buy active" data-side="buy" aria-pressed="true">Buy</button>
        <button class="of-btn sell" data-side="sell" aria-pressed="false">Sell</button>
      </div>
      <div class="of-field"><label>Amount</label><div class="of-input"><span>0</span><span class="of-unit">${$(e.base)}</span></div></div>
      <div class="of-field"><label>Price</label><div class="of-input"><span>€${$e(e.price)}</span></div></div>
      <p class="of-note" id="mk-of-note">This mirrors Revolut X's order form for reference, but there's no direct submit here — every real order already goes through the cloud agent's own safety checks (confidence gates, risk sizing, a Telegram confirmation prompt). Send <code>/buy ${$(e.symbol)}</code> to the Telegram bot to actually place one.</p>
    </div>`}function Xi(e,t){const s=e.querySelectorAll(".of-btn"),n=e.querySelector("#mk-of-note");s.length===0||!n||s.forEach(i=>{i.addEventListener("click",()=>{const a=i.dataset.side;s.forEach(o=>{o.classList.toggle("active",o===i),o.setAttribute("aria-pressed",String(o===i))}),n.innerHTML=`This mirrors Revolut X's order form for reference, but there's no direct submit here — every real order already goes through the cloud agent's own safety checks (confidence gates, risk sizing, a Telegram confirmation prompt). Send <code>/${a} ${$(t.symbol)}</code> to the Telegram bot to actually place one.`})})}function ks(e,t){const s=e[t-1],n=e[t+1];return`
    <div class="detail-nav">
      <button class="pager" id="mk-prev" ${t===0?"disabled":""}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
        <span>${s?$(s.base):"Prev"}</span>
      </button>
      <span class="pager-count">${t+1} / ${e.length}</span>
      <button class="pager" id="mk-next" ${t===e.length-1?"disabled":""}>
        <span>${n?$(n.base):"Next"}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
      </button>
    </div>`}const xs=`
    <div class="block"><div class="block-head"><h2>Closed orders</h2></div><div class="stack stack-card" id="mk-orders"><div class="empty">Loading…</div></div></div>
    <div class="block" id="mk-stats"></div>`;function zi(e,t){const s=t.kind==="buy";return`<div class="row trade ${t.kind}"><div class="row-main"><span class="pill ${s?"buy":"sell"}">${s?"BUY":"SELL"}</span><div><div class="row-title">${e.label}</div><div class="row-sub">${t.note?t.note:s?"opened":"closed"}</div></div></div><div class="row-side"><span class="row-title">€${$e(t.price)}</span><span class="row-sub">${t.quantity.toLocaleString("en-US",{maximumFractionDigits:4})}</span><span class="row-sub">${new Date(t.at).toLocaleString("en-GB",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</span></div></div>`}function Ki(e){const t='<div class="block-head"><h2>Stats</h2></div>';if(!e)return`${t}<div class="empty">Not available for this market.</div>`;const s=[`<div class="row"><span class="row-sub">Market cap</span><span class="row-title">€${et(e.marketCap)}</span></div>`,e.marketCapRank!==null?`<div class="row"><span class="row-sub">Market cap rank</span><span class="row-title">#${e.marketCapRank}</span></div>`:"",e.circulatingSupply!==null?`<div class="row"><span class="row-sub">Circulating supply</span><span class="row-title">${et(e.circulatingSupply)}</span></div>`:"",`<div class="row"><span class="row-sub">Max supply</span><span class="row-title">${e.maxSupply!==null?et(e.maxSupply):"No max"}</span></div>`];return t+s.join("")}function Yi(e){var h,m;if(e.bids.length===0&&e.asks.length===0)return'<div class="empty">No order book depth right now.</div>';const t=[...e.bids].sort((p,v)=>v.price-p.price),s=[...e.asks].sort((p,v)=>p.price-v.price);let n=0;const i=t.map(p=>n+=p.volume);let a=0;const o=s.map(p=>a+=p.volume),r=Math.max(n,a,1e-9),d=Math.max(t.length,s.length);let c='<div class="orderbook-table"><div class="orderbook-head"><span>Bid (EUR)</span><span>Ask (EUR)</span></div>';for(let p=0;p<d;p++){const v=t[p],f=s[p],y=v?(i[p]/r*100).toFixed(1):"0",b=f?(o[p]/r*100).toFixed(1):"0";c+=`<div class="orderbook-row"><span class="ob-bid" style="--bar:${y}%">${v?`${v.volume.toFixed(4)} @ €${$e(v.price)}`:""}</span><span class="ob-ask" style="--bar:${b}%">${f?`€${$e(f.price)} @ ${f.volume.toFixed(4)}`:""}</span></div>`}c+="</div>";const l=(h=t[0])==null?void 0:h.price,u=(m=s[0])==null?void 0:m.price;if(l!==void 0&&u!==void 0){const p=u-l,v=l>0?p/l*100:0;c+=`<div class="orderbook-spread"><span>Spread</span><span>€${O(p)} (${v.toFixed(2)}%)</span></div>`}return c}function Ji(e){var y,b;if(e.bids.length===0&&e.asks.length===0)return'<div class="empty">No order book depth right now.</div>';const t=320,s=160,n=[...e.bids].sort((w,T)=>T.price-w.price),i=[...e.asks].sort((w,T)=>w.price-T.price);let a=0;const o=n.map(w=>({price:w.price,cum:a+=w.volume}));let r=0;const d=i.map(w=>({price:w.price,cum:r+=w.volume})),c=Math.max(a,r,1e-9),l=t/2,u=o.map((w,T)=>`${T===0?"M":"L"} ${(l-T/Math.max(o.length-1,1)*l).toFixed(1)} ${(s-w.cum/c*s).toFixed(1)}`).join(" "),h=d.map((w,T)=>`${T===0?"M":"L"} ${(l+T/Math.max(d.length-1,1)*l).toFixed(1)} ${(s-w.cum/c*s).toFixed(1)}`).join(" "),m=(y=n[0])==null?void 0:y.price,p=(b=i[0])==null?void 0:b.price,v=m!==void 0&&p!==void 0?(m+p)/2:null,f=v!==null?`<div class="detail-stats-row depth-stats">
          <div class="dstat"><span class="dstat-label">Best bid</span><span class="dstat-value hot">€${$e(m)}</span></div>
          <div class="dstat"><span class="dstat-label">Mid</span><span class="dstat-value">€${$e(v)}</span></div>
          <div class="dstat"><span class="dstat-label">Best ask</span><span class="dstat-value cold">€${$e(p)}</span></div>
        </div>`:"";return`<svg class="orderbook-depth" viewBox="0 0 ${t} ${s}" preserveAspectRatio="none"><path d="${u} L ${l} ${s} Z" class="depth-bid"/><path d="${h} L ${l} ${s} Z" class="depth-ask"/><line x1="${l}" y1="0" x2="${l}" y2="${s}" class="depth-mid"/></svg>${f}`}function Qi(e){return e.length===0?'<div class="empty">No recent trades.</div>':`<div class="trade-tape-head"><span>Price</span><span>Amount</span><span>Time</span></div><div class="trade-tape">${e.slice(0,30).map(s=>`<div class="trade-tape-row ${s.side}"><span class="chg ${s.side==="buy"?"up":"down"}">€${O(s.price)}</span><span class="row-sub">${s.volume.toFixed(5)}</span><span class="row-sub">${Kt(s.time)}</span></div>`).join("")}</div>`}function xn(e,t){const s=Ot;Ot=null;const n=s?ct.findIndex(g=>g.key===s):-1,i=n>=0?n:0;e.innerHTML=`
    <div id="mk-list-view">
      <h2 class="view-title">Markets</h2>
      <p class="view-sub">Every EUR market on Kraken, live. Tap a coin for its chart.</p>
      <div class="mk-tabs" id="mk-tabs" role="tablist">${ct.map((g,E)=>`<button class="mk-tab${E===i?" active":""}" role="tab" aria-selected="${E===i}" ${E===i?"":'tabindex="-1"'} data-cat="${g.key}">${g.label}</button>`).join("")}<button class="mk-tab" role="tab" aria-selected="false" tabindex="-1" data-cat="watchlist"><svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Watchlist</button></div>
      <div class="mk-controls">
        <input id="mk-search" class="mk-search" type="search" inputmode="search"
          placeholder="Search 500+ markets…" aria-label="Search markets" autocomplete="off">
        <select id="mk-sort" class="mk-sort" aria-label="Sort markets">${Ti.map(g=>`<option value="${g.key}">${g.label}</option>`).join("")}</select>
      </div>
      <div class="mk-pull" id="mk-pull" aria-live="polite"></div>
      <div class="stack" id="mk-list">${ji(8)}</div>
      <p class="muted-line" id="mk-status"></p>
    </div>
    <div id="mk-detail-view" hidden></div>`;const a=e.querySelector("#mk-list-view"),o=e.querySelector("#mk-detail-view"),r=e.querySelector("#mk-list"),d=e.querySelector("#mk-status");o.addEventListener("keydown",g=>{if(g.key!=="Escape")return;const E=o.querySelector("#mk-pair-menu");if(!E||E.hidden)return;E.hidden=!0;const L=o.querySelector("#mk-pair-toggle");L==null||L.setAttribute("aria-expanded","false"),L==null||L.focus()}),document.addEventListener("click",g=>{const E=o.querySelector("#mk-pair-menu");if(!E||E.hidden)return;const L=o.querySelector("#mk-pair-toggle"),R=g.target;E.contains(R)||R===L||L!=null&&L.contains(R)||(E.hidden=!0,L==null||L.setAttribute("aria-expanded","false"))});let c=[],l=[],u=ct[i],h="",m="default",p=null,v=!1;const f=()=>p??(p=new Ri(new ft));let y=[],b=Ye,w=null;const T=new Map;let x=!0,k=0,M=0,F=null,I=null,G=0,q="1D",B="candle",se="chart";const ee=()=>{F&&(F(),F=null)};function ie(g,E){const L=g.changePct>=0,R=Date.now()-g.updatedAt>Ni,H=p!==null&&p.has(g.symbol),j=T.get(g.symbol),W=j===void 0||j===g.price?"":g.price>j?" flash-up":" flash-down";return T.set(g.symbol,g.price),`<span class="market-row-wrap"><button class="market-row tappable" data-row="${E}">`+Ce(g.base,Nt)+`<span class="market-row-id"><span class="row-title-line"><span class="row-title">${$(g.label)}</span></span><span class="row-sub"><span class="row-clock ${R?"stale":"fresh"}" aria-hidden="true"></span><span class="row-sub-text">${Kt(g.updatedAt)} · ${$(g.symbol)}</span>${da.has(g.base)?'<span class="tag-traded">TRADED</span>':""}</span></span><span class="market-row-vol"><span class="dstat-label">24h Vol</span><span>€${et(g.quoteVolume)}</span></span><span class="market-row-num"><span class="row-price${W}">${ue(`€${$e(g.price)}`)}</span><span class="chg ${L?"up":"down"}">${Ca(g.change,g.price)} (${V(g.changePct)})</span></span></button><button class="mk-star${H?" on":""}" data-star="${$(g.symbol)}" aria-pressed="${H}" aria-label="${H?"Remove":"Add"} ${$(g.label)} ${H?"from":"to"} watchlist"><svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></button></span>`}function De(){w==null||w.disconnect(),w=null;const g=r.querySelector("#mk-more");!g||typeof IntersectionObserver>"u"||(w=new IntersectionObserver(E=>{E.some(L=>L.isIntersecting)&&(b=Math.min(b+Ye,l.length),be())},{rootMargin:"400px"}),w.observe(g))}function be(){if(c.length===0){r.innerHTML='<div class="empty">Live market data is unavailable right now.</div>';return}const g=h.trim()!=="",E=v?f().filter(c):g?c:u.apply(c);if(l=Ai(Li(E,h),m),l.length===0){const j=h.trim()!==""?`No markets match “${$(h.trim())}”.`:v?"No starred markets yet. Tap ★ on any market to add it here.":`No markets in ${u.label} right now.`;r.innerHTML=`<div class="empty">${j}</div>`,d.textContent=`Live · ${c.length} markets · updated ${Bt(Date.now())}`;return}const L=Math.min(b,l.length),R=l.slice(0,L).map(ie).join(""),H=L<l.length?`<div id="mk-more" class="market-more">Loading more markets… (${L} of ${l.length})</div>`:`<div class="market-more muted-line">All ${l.length} ${l.length===1?"market":"markets"} shown</div>`;r.innerHTML=R+H,De(),d.textContent=`Live · ${l.length} of ${c.length} EUR markets · updated ${Bt(Date.now())} · change since 00:00 UTC`}let Se=!1;async function ge(){if(!Se){Se=!0;try{const g=await ln(t,Ui);if(g.length>0)c=g,x=!1;else if(x){r.innerHTML='<div class="empty">Live market data is unavailable right now.</div>';return}o.hidden&&be()}finally{Se=!1}}}function U(){const g=e.querySelector("#mk-pull");let E=null,L=0;a.addEventListener("touchstart",R=>{var H;E=window.scrollY<=0&&R.touches.length===1?((H=R.touches[0])==null?void 0:H.clientY)??null:null,L=0},{passive:!0}),a.addEventListener("touchmove",R=>{var H;if(E!==null){if(L=(((H=R.touches[0])==null?void 0:H.clientY)??E)-E,L<=0){g.textContent="";return}g.textContent=L>=ws?"Release to refresh":"Pull to refresh"}},{passive:!0}),a.addEventListener("touchend",()=>{const R=E!==null&&L>=ws;if(E=null,L=0,!R){g.textContent="";return}g.textContent="Refreshing…",ge().finally(()=>{g.textContent=""})})}U(),document.addEventListener("click",g=>{const E=o.querySelector("#mk-pair-menu"),L=o.querySelector("#mk-pair-toggle");if(!E||E.hidden)return;const R=g.target;E.contains(R)||R===L||L!=null&&L.contains(R)||(E.hidden=!0,L==null||L.setAttribute("aria-expanded","false"))}),document.addEventListener("keydown",g=>{var L;if(g.key!=="Escape")return;const E=o.querySelector("#mk-pair-menu");!E||E.hidden||(E.hidden=!0,(L=o.querySelector("#mk-pair-toggle"))==null||L.setAttribute("aria-expanded","false"))});function _(g,E={}){(!E.preserveRange||y.length===0)&&(y=l.length>0?[...l]:[...c]),I=g,G++;const L=G;window.clearInterval(k),a.hidden=!0,o.hidden=!1,E.preserveRange||window.scrollTo({top:0});let R=g,H=E.preserveRange?q:"1D",j=E.preserveRange?B:"candle",W=E.preserveRange?se:"chart";q=H,B=j,se=W;let Ee=0;const de=new Map,pe=Q=>{var Y,oe,me,Fe;(Y=o.querySelector("#mk-back"))==null||Y.addEventListener("click",A),(oe=o.querySelector("#mk-prev"))==null||oe.addEventListener("click",()=>{R>0&&(R--,H="1D",q=H,window.scrollTo({top:0}),he())}),(me=o.querySelector("#mk-next"))==null||me.addEventListener("click",()=>{R<y.length-1&&(R++,H="1D",q=H,window.scrollTo({top:0}),he())}),(Fe=o.querySelector("#mk-star"))==null||Fe.addEventListener("click",()=>{const ve=f().toggle(Q.symbol),z=o.querySelector("#mk-star");z==null||z.classList.toggle("active",ve),z==null||z.setAttribute("aria-pressed",String(ve)),z==null||z.setAttribute("aria-label",`${ve?"Remove":"Add"} ${Q.label} ${ve?"from":"to"} watchlist`),ve&&(z==null||z.classList.add("pop"),z==null||z.addEventListener("animationend",()=>z.classList.remove("pop"),{once:!0}))});const K=o.querySelector("#mk-pair-toggle"),Z=o.querySelector("#mk-pair-menu"),X=()=>{!Z||Z.hidden||(Z.hidden=!0,K==null||K.setAttribute("aria-expanded","false"))};K==null||K.addEventListener("click",()=>{Z&&(Z.hidden=!Z.hidden,K.setAttribute("aria-expanded",String(!Z.hidden)))}),Z==null||Z.addEventListener("click",ve=>{const z=ve.target.closest(".pair-menu-item");if(!z)return;const re=Number(z.dataset.idx);X(),!(!Number.isInteger(re)||re===R||re<0||re>=y.length)&&(R=re,H="1D",q=H,window.scrollTo({top:0}),he())}),o.querySelectorAll(".view-tab").forEach(ve=>{ve.addEventListener("click",()=>{const z=ve.dataset.view;if(z===W)return;W=z,se=z;const re=o.querySelector(".detail-chart, .detail-nonchart");re==null||re.classList.add("fade-out"),he().then(()=>{const ke=o.querySelector(".detail-chart, .detail-nonchart");ke&&(ke.classList.add("fade-in"),setTimeout(()=>ke.classList.remove("fade-in"),300))})})})},we=Q=>{const K=G;qe().then(Z=>{if(K!==G)return;const X=o.querySelector("#mk-orders");if(!X)return;const Y=((Z==null?void 0:Z.history)??[]).filter(oe=>oe.symbol===Q.symbol);X.innerHTML=Y.length===0?'<div class="empty">No closed orders yet for this market.</div>':Y.slice(0,10).map(oe=>zi(Q,oe)).join("")}),Hi(Q.base).then(Z=>{if(K!==G)return;const X=o.querySelector("#mk-stats");X&&(X.innerHTML=Ki(Z))})},Le=async(Q,K)=>{const Z=t.source,X=typeof Z.getOrderBook=="function"&&typeof Z.getRecentTrades=="function";let Y;if(W==="trade")Y=Wi(Q);else if(!X)Y='<div class="empty">Not available for this market data source.</div>';else if(W==="trades"){const oe=await Z.getRecentTrades(Q.symbol,30);if(K!==Ee||L!==G)return;Y=oe.ok?Qi(oe.value):'<div class="empty">Recent trades unavailable — retrying…</div>'}else{const oe=await Z.getOrderBook(Q.symbol,15);if(K!==Ee||L!==G)return;Y=oe.ok?W==="table"?Yi(oe.value):Ji(oe.value):'<div class="empty">Order book unavailable — retrying…</div>'}K!==Ee||L!==G||(o.innerHTML=Ss(Q,Q.price,Q.changePct,W,f().has(Q.symbol),y,R)+`<div class="detail-nonchart">${Y}</div>`+ks(y,R)+xs,pe(Q),W==="trade"&&Xi(o,Q),we(Q))},he=async(Q={})=>{var Z;const K=++Ee;ee();try{const X=y[R];if(W!=="chart"){await Le(X,K);return}const Y=bs.find(N=>N.key===H),oe=Y.long?"line":j,me=`${R}:${H}:${oe}`;let Fe,ve,z,re=null;if(oe==="candle"){let N=!Q.force&&de.has(me)?de.get(me):await Pa(t,X.symbol,Y.tf,Y.limit);if(N?de.set(me,N):de.has(me)&&(N=de.get(me)),ve=(N==null?void 0:N.price)??X.price,z=(N==null?void 0:N.changePct)??0,Fe=N?vn(N.candles,{formatX:Y.fx,formatY:le=>`€${O(le)}`}):'<div class="empty">No history for this range yet.</div>',N){const le=N.candles,ne=Yt(le);re=()=>Qt({geo:ne,symbol:X.symbol,range:Y,firstValue:le[0].close,valueAt:xe=>le[xe].close,tipHtml:xe=>{const ye=le[xe];return`<span class="pchart-tip-price">€${O(ye.close)}</span><span class="pchart-tip-ohlc">O €${O(ye.open)} · H €${O(ye.high)} · L €${O(ye.low)} · C €${O(ye.close)}</span><span class="pchart-tip-time">${$s(ye.timestamp,Y.tf)}</span>`}})}}else{let N=!Q.force&&de.has(me)?de.get(me):await Aa(t,X.symbol,Y.tf,Y.limit);N?de.set(me,N):de.has(me)&&(N=de.get(me)),ve=(N==null?void 0:N.price)??X.price,z=(N==null?void 0:N.changePct)??0;const le=z>=0;if(Fe=N?mn(N.points,{stroke:le?Oi:Bi,formatX:Y.fx,formatY:ne=>`€${O(ne)}`}):'<div class="empty">No history for this range yet.</div>',N){const ne=N.points,xe=at(ne);re=()=>Qt({geo:xe,symbol:X.symbol,range:Y,firstValue:ne[0].value,valueAt:ye=>ne[ye].value,tipHtml:ye=>{const je=ne[ye];return`<span class="pchart-tip-price">€${O(je.value)}</span><span class="pchart-tip-time">${$s(je.timestamp,Y.tf)}</span>`}})}}if(K!==Ee||L!==G)return;const ke=z>=0,Oe=bs.map(N=>`<button class="range-btn ${N.key===H?"active":""}" data-range="${N.key}">${N.key}</button>`).join("");o.innerHTML=Ss(X,ve,z,W,f().has(X.symbol),y,R)+`<div class="chart-controls">
          <div class="range-bar">${Oe}</div>
          <div class="chart-toggle">
            <button class="ctoggle-btn ${oe==="candle"?"active":""}" data-mode="candle" ${Y.long?"disabled":""}>Candles</button>
            <button class="ctoggle-btn ${oe==="line"?"active":""}" data-mode="line" ${Y.long?"disabled":""}>Line</button>
          </div>
        </div>
        <div class="detail-chart"><div class="pchart-wrap">${Fe}<div class="pchart-tip" hidden></div></div></div>`+ks(y,R)+xs,pe(X),we(X),o.querySelectorAll(".range-btn").forEach(N=>{N.addEventListener("click",()=>{const le=o.querySelector(".detail-chart");le&&le.classList.add("fade-out"),setTimeout(()=>{H=N.dataset.range,q=H,he().then(()=>{const ne=o.querySelector(".detail-chart");ne&&(ne.classList.add("fade-in"),setTimeout(()=>ne.classList.remove("fade-in"),300))})},200)})}),o.querySelectorAll(".ctoggle-btn").forEach(N=>{N.addEventListener("click",()=>{const le=o.querySelector(".detail-chart");le&&le.classList.add("fade-out"),setTimeout(()=>{const ne=N.dataset.mode;(ne==="candle"||ne==="line")&&(j=ne,B=ne),he().then(()=>{const xe=o.querySelector(".detail-chart");xe&&(xe.classList.add("fade-in"),setTimeout(()=>xe.classList.remove("fade-in"),300))})},200)})}),re&&re()}catch{L===G&&K===Ee&&!o.querySelector("svg.pchart")&&(o.innerHTML='<button class="tool-back" id="mk-eb">← All markets</button><div class="empty">Chart unavailable — retrying…</div>',(Z=o.querySelector("#mk-eb"))==null||Z.addEventListener("click",A))}},Qt=Q=>{const K=o.querySelector("svg.pchart"),Z=o.querySelector(".pchart-tip");if(!K||!Z)return;const X=Q.geo,Y=K.querySelector(".pchart-cross"),oe=K.querySelector(".pchart-cross-line"),me=K.querySelector(".pchart-cross-dot"),Fe=re=>{const ke=K.getBoundingClientRect();if(ke.width<=0)return;const Oe=X.indexAtFraction((re-ke.left)/ke.width),N=X.x(Oe),le=X.y(Q.valueAt(Oe));oe&&(oe.setAttribute("x1",N.toFixed(1)),oe.setAttribute("x2",N.toFixed(1))),me&&(me.setAttribute("cx",N.toFixed(1)),me.setAttribute("cy",le.toFixed(1))),Y==null||Y.classList.add("show"),Z.hidden=!1,Z.innerHTML=Q.tipHtml(Oe);const ne=o.querySelector(".pchart-wrap");ne&&yn(Z,ne,N/X.W,le/X.H)},ve=()=>{Y==null||Y.classList.remove("show"),Z.hidden=!0};K.addEventListener("pointermove",re=>Fe(re.clientX)),K.addEventListener("pointerdown",re=>Fe(re.clientX)),K.addEventListener("pointerleave",ve),K.addEventListener("pointercancel",ve);const z=Q.firstValue;F=qi(t,Q.symbol,re=>{const ke=re.price,Oe=o.querySelector("#mk-price");Oe&&(Oe.innerHTML=ue(`€${$e(ke)}`));const N=z>0?(ke-z)/z*100:0,le=o.querySelector("#mk-change");le&&(le.className=`chg ${N>=0?"up":"down"}`,le.textContent=`${V(N)} · ${Q.range.key}`);const ne=Math.max(X.padT,Math.min(X.H-X.padB,X.y(ke))),xe=K.querySelector(".pchart-now"),ye=K.querySelector(".pchart-now-line"),je=K.querySelector(".pchart-now-tag"),Zt=K.querySelector(".pchart-now-text");xe==null||xe.setAttribute("cy",ne.toFixed(1)),ye==null||ye.setAttribute("y1",ne.toFixed(1)),ye==null||ye.setAttribute("y2",ne.toFixed(1)),je==null||je.setAttribute("transform",`translate(${(X.W-X.padR+1).toFixed(1)}, ${ne.toFixed(1)})`),Zt&&(Zt.textContent=`€${O(ke)}`)})};he(),window.clearInterval(M),M=window.setInterval(()=>{const Q=o.querySelector(".pchart-tip");Q&&!Q.hidden||he({force:!0})},Ii)}function A(){I=null,G++,window.clearInterval(M),ee(),o.hidden=!0,a.hidden=!1,be(),k=window.setInterval(()=>void ge(),St)}r.addEventListener("click",g=>{var R;const E=(R=g.target)==null?void 0:R.closest("[data-row]");if(!E)return;const L=Number(E.dataset.row);Number.isInteger(L)&&L>=0&&L<l.length&&_(L)}),Ve(r),Ve(o),r.addEventListener("click",g=>{var H;const E=(H=g.target)==null?void 0:H.closest("[data-star]");if(!E)return;g.stopPropagation();const L=E.dataset.star,R=f().toggle(L);if(be(),R){const j=r.querySelector(`[data-star="${CSS.escape(L)}"]`);j==null||j.classList.add("pop"),j==null||j.addEventListener("animationend",()=>j.classList.remove("pop"),{once:!0})}});const S=e.querySelector("#mk-tabs"),D=()=>{S.classList.toggle("at-start",S.scrollLeft<=1),S.classList.toggle("at-end",S.scrollLeft+S.clientWidth>=S.scrollWidth-1)};D(),S.addEventListener("scroll",D,{passive:!0}),S.addEventListener("click",g=>{var H;const E=(H=g.target)==null?void 0:H.closest("[data-cat]");if(!E)return;const L=E.dataset.cat,R=ct.find(j=>j.key===L);if(!(L!=="watchlist"&&!R)&&!(L==="watchlist"?v:R===u&&!v)){v=L==="watchlist",R&&(u=R),b=Ye;for(const j of e.querySelectorAll(".mk-tab")){const W=j.dataset.cat===L;j.classList.toggle("active",W),j.setAttribute("aria-selected",String(W)),j.tabIndex=W?0:-1}be()}});let P=0;return e.querySelector("#mk-search").addEventListener("input",g=>{h=g.target.value,window.clearTimeout(P),P=window.setTimeout(()=>{b=Ye,be()},120)}),e.querySelector("#mk-sort").addEventListener("change",g=>{m=g.target.value,b=Ye,be()}),ge(),k=window.setInterval(()=>void ge(),St),{pause:()=>{window.clearInterval(k),window.clearInterval(M),w==null||w.disconnect(),w=null,ee()},resume:()=>{I!==null?_(I,{preserveRange:!0}):(ge(),k=window.setInterval(()=>void ge(),St))}}}const Zi=5,xt=15e3,eo=12e4,Ae=e=>`€${O(e)}`,Ts="var(--hot)",Es="var(--cold)";function te(e,t,s){const n=document.createElement(e);return t&&(n.className=t),s!==void 0&&(n.textContent=s),n}function dt(e,t){const s=e.instruments.find(n=>n.symbol===t);return((s==null?void 0:s.base)??t.replace(/EUR$|USD$/,"")).toUpperCase()}function _t(e,t,s,n,i,a,o="EUR"){const r=[{logoHtml:Ce(o),name:"Cash",sub:"Available balance",qty:null,price:null,value:e,allocationPct:n>0?e/n*100:0,pnl:null}];for(const d of t){const c=s[d.symbol]??d.entryPrice,l=d.quantity*c,u=d.entryPrice>0?(c-d.entryPrice)/d.entryPrice*100:0;r.push({logoHtml:Ce(i(d.symbol)),name:d.symbol,sub:`entry ${a(d.entryPrice)}`,qty:d.quantity.toLocaleString("en-US",{maximumFractionDigits:4}),price:a(c),value:l,allocationPct:n>0?l/n*100:0,pnl:{abs:(c-d.entryPrice)*d.quantity,pct:u}})}return r}function Vt(e,t){return`<table class="holdings-table">
    <thead><tr><th></th><th class="col-total">Total</th><th class="col-price">Price</th><th>Value</th><th class="col-alloc">Allocation</th><th>Unrealised P&L</th></tr></thead>
    <tbody>${e.map(n=>{const i=n.pnl?`<span class="chg ${n.pnl.abs>=0?"up":"down"}">${ue(t(n.pnl.abs))} (${V(n.pnl.pct)})</span>`:"—";return`<tr>
        <td class="holdings-id">${n.logoHtml}<div><div class="row-title">${n.name}</div><div class="row-sub">${n.sub}</div></div></td>
        <td class="col-total">${n.qty??"—"}</td>
        <td class="col-price">${n.price?ue(n.price):"—"}</td>
        <td>${ue(t(n.value))}</td>
        <td class="col-alloc">${n.allocationPct.toFixed(1)}%</td>
        <td>${i}</td>
      </tr>`}).join("")}</tbody>
  </table>`}async function to(e,t){const s={};return await Promise.all(t.map(async n=>{const i=await e.source.getCandles(n,"1h",2);i.ok&&i.value.length>0&&(s[n]=i.value[i.value.length-1].close)})),s}function so(e,t){e.innerHTML="";const s=te("section","hero hero-bare tappable");s.id="home-live-hero",s.dataset.hub="profit",s.hidden=!0,s.setAttribute("role","button"),s.tabIndex=0,s.innerHTML=`
    <div class="hero-label">Real money <span class="tag-live">REAL</span><span class="hero-more">profit ›</span></div>
    <div class="hero-value" id="hv-live-equity"><span class="skeleton-bar hero-value-skeleton"></span></div>
    <div class="hero-change" id="hv-live-change" hidden></div>
    <div class="hero-split"><span id="hv-live-cash"></span></div>
    <div class="kill-switch-banner" id="hv-kill-switch" hidden></div>
    <div class="hero-spark" id="hv-live-spark"></div>
  `;const n=te("section","block");n.id="home-live-positions-wrap",n.hidden=!0,n.innerHTML='<div class="block-head"><h2>Real open positions <span class="tag-live">REAL</span></h2></div>';const i=te("div","stack stack-card");i.id="home-live-positions",n.appendChild(i);const a=te("section","hero hero-bare tappable");a.id="home-sim-hero",a.dataset.nav="value",a.setAttribute("role","button"),a.tabIndex=0,a.innerHTML=`
    <div class="hero-label">Portfolio value <span class="tag-sim">SIMULATED</span><span class="hero-more">history ›</span></div>
    <div class="hero-value" id="hv-equity"><span class="skeleton-bar hero-value-skeleton"></span></div>
    <div class="hero-change" id="hv-change"></div>
    <div class="hero-split"><span id="hv-cash"></span><span id="hv-invested"></span></div>
    <div class="hero-bench" id="hv-bench" hidden></div>
    <div class="hero-spark" id="hv-spark"></div>
  `;const o=te("section","block readiness");o.id="home-readiness";const r=te("section","block");r.innerHTML='<div class="block-head"><h2>Markets</h2><button class="link-btn" data-nav="markets">See all</button></div>';const d=te("div","markets-strip");d.id="home-markets",d.innerHTML=ki(3),r.appendChild(d);const c=te("section","block");c.innerHTML=`
    <div class="block-head"><h2>Top movers</h2><button class="link-btn" id="movers-seeall" data-nav="markets">See all</button></div>
    <div class="mk-tabs movers-toggle" role="tablist">
      <button class="mk-tab active" role="tab" aria-selected="true" data-mover="gainers">Gainers</button>
      <button class="mk-tab" role="tab" aria-selected="false" tabindex="-1" data-mover="losers">Losers</button>
    </div>`;const l=te("div","stack stack-card");l.id="home-movers",l.innerHTML=Ie(4),c.appendChild(l);const u=te("section","block");u.id="home-positions-wrap",u.innerHTML='<div class="block-head"><h2>Open positions <span class="tag-sim">SIMULATED</span></h2></div>';const h=te("div","stack stack-card");h.id="home-positions",h.innerHTML=Ie(2),u.appendChild(h);const m=te("section","block");m.id="home-activity-wrap",m.innerHTML='<div class="block-head"><h2>Recent activity</h2><button class="link-btn" data-hub="history">See all</button></div>';const p=te("div","stack stack-card");p.id="home-activity",p.innerHTML=Ie(3),m.appendChild(p);const v=te("p","muted-line","Loading the cloud agent…");v.id="home-status";const f=te("div","home-main");f.append(s,n,a,u,o,m,v);const y=te("div","home-rail");y.append(r,c),e.classList.add("home-grid"),e.append(f,y),Ve(e);let b=null,w=[],T="gainers";const x=(A,S)=>{const D=e.querySelector(`#${A}`);D&&(D.textContent=S)};function k(){const A=(T==="gainers"?Sn:kn)(w,Zi);if(l.innerHTML="",A.length===0){l.appendChild(te("div","empty","No movers to show right now."));return}for(const S of A){const D=S.changePct>=0,P=te("div","row tappable");P.dataset.nav="markets",P.setAttribute("role","button"),P.tabIndex=0,P.innerHTML=`
        <div class="row-main">${Ce(S.base)}<div><div class="row-title">${S.label}</div><div class="row-sub">${S.base}</div></div></div>
        <div class="row-side"><span class="row-title">${ue(Ae(S.price))}</span><span class="chg ${D?"up":"down"}">${V(S.changePct)}</span></div>`,l.appendChild(P)}}function M(A){if(d.innerHTML="",A.length===0){d.appendChild(te("div","empty","Live market data unavailable right now."));return}for(const S of A){const D=S.changePct>=0,P=dt(t,S.symbol),g=te("div","market-card tappable");g.dataset.nav="markets",g.setAttribute("role","button"),g.tabIndex=0,g.innerHTML=`
        <div class="market-top"><div class="market-id">${Ce(P)}<span class="market-name">${S.label}</span></div></div>
        <div class="market-price-row">
          <span class="market-price">${ue(Ae(S.price))}</span>
          <span class="chg ${D?"up":"down"}">${V(S.changePct)}</span>
        </div>
        <div class="market-spark" style="color:${D?Ts:Es}">${pt(S.closes,{stroke:D?Ts:Es,fill:!0,width:150,height:44})}</div>`,d.appendChild(g)}}function F(A){if(h.innerHTML="",!b){h.appendChild(te("div","empty","No open positions — holding cash and waiting for a good setup."));return}const S=b.positions.reduce((P,g)=>P+g.quantity*(A[g.symbol]??g.entryPrice),0),D=b.cash+S;h.innerHTML=Vt(_t(b.cash,b.positions,A,D,P=>dt(t,P),Ae),Ae),b.positions.length===0&&h.appendChild(te("div","empty","Holding cash and waiting for a good setup."))}function I(A){var pe,we;const S=b==null?void 0:b.live;if(s.hidden=!S,n.hidden=!S,a.hidden=!!S,o.hidden=!!S,u.hidden=!!S,m.hidden=!!S,!S)return;const D=S.positions.reduce((Le,he)=>Le+he.quantity*(A[he.symbol]??he.entryPrice),0),P=((pe=S.equityHistory.at(-1))==null?void 0:pe.equity)??S.cash+D,{major:g,minor:E}=ze(P),L=s.querySelector("#hv-live-equity");L.innerHTML=`<span class="hero-value-currency">€</span><span class="hero-value-major">${g}</span><span class="hero-value-minor">.${E}</span>`;const R=s.querySelector("#hv-live-change"),H=(we=S.equityHistory[0])==null?void 0:we.equity;if(H!==void 0&&H>0){const Le=(P-H)/H*100,he=Le>=0;s.classList.toggle("up",he),s.classList.toggle("down",!he),document.body.dataset.sentiment=he?"up":"down",R.hidden=!1,R.textContent=`${V(Le).replace(/^[+-]/,"")} since tracking began`,R.className=`hero-change ${he?"up":"down"}`}else s.classList.remove("up","down"),R.hidden=!0;const j=s.querySelector("#hv-live-spark");j.innerHTML=S.equityHistory.length>=2?pt(S.equityHistory.map(Le=>Le.equity),{stroke:"var(--accent-text)",fill:!1,width:320,height:64}):"";const W=qt(t),Ee=S.externalBtcQuantity*(W?A[W]??0:0);s.querySelector("#hv-live-cash").textContent=S.externalBtcQuantity>0?`Cash ${Ae(S.cash)} · BTC holding ${Ae(Ee)} (untracked)`:`Cash ${Ae(S.cash)}`;const de=s.querySelector("#hv-kill-switch");if(S.killSwitchEngaged){de.hidden=!1;const Le=S.killSwitchReason?` — ${$(S.killSwitchReason)}`:"";de.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12"/><path d="M15 6v12"/></svg><span>Real-money trading paused — no new trades or exits can execute; open positions stay open, unmonitored, until resumed${Le}</span>`}else de.hidden=!0;i.innerHTML=Vt(_t(S.cash,S.positions,A,P,Le=>dt(t,Le),Ae),Ae),S.positions.length===0&&i.appendChild(te("div","empty","No real positions open — holding cash."))}function G(){const A=e.querySelector("#hv-spark");if(!A)return;if(!b||b.equityHistory.length<2){A.innerHTML="",a.classList.remove("up","down"),delete document.body.dataset.sentiment;return}const S=b.equityHistory.map(P=>P.equity),D=S[S.length-1]>=S[0];a.classList.toggle("up",D),a.classList.toggle("down",!D),document.body.dataset.sentiment=D?"up":"down",A.innerHTML=pt(S,{stroke:"var(--accent-text)",fill:!1,width:320,height:64})}function q(){const A=(b==null?void 0:b.readiness)??null;if(!A){o.innerHTML='<div class="block-head"><h2>Real-money readiness</h2></div><div class="empty">Assessing the paper track record…</div>';return}const S=A.ready?'<span class="ready-badge go">READY</span>':'<span class="ready-badge no">NOT READY</span>',D=A.criteria.map(P=>{const g=P.ok?"ok":A.unmet.includes(P.key)?"no":"info";return`<li class="${g}"><svg class="crit-icon" viewBox="0 0 24 24" aria-hidden="true">${g==="ok"?'<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>':g==="no"?'<circle cx="12" cy="12" r="9"/><path d="M12 7.5v6"/><path d="M12 16.5h.01"/>':'<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5h.01"/>'}</svg><span>${P.detail}</span></li>`}).join("");o.innerHTML=`<div class="block-head"><h2>Real-money readiness</h2>${S}</div><p class="readiness-note">Is the SIMULATED record strong enough to risk real money yet? A checklist, not a profit promise.</p><ul class="readiness-list">${D}</ul>`}function B(){if(p.innerHTML="",!b||b.history.length===0){p.appendChild(te("div","empty","No trades yet — the agent is waiting for a qualified opportunity."));return}for(const A of b.history.slice(0,5)){const S=A.kind==="buy",D=te("div",`row trade ${A.kind}`);D.innerHTML=`
        <div class="row-main">${It(dt(t,A.symbol))}
          <div><div class="row-title"><span class="pill ${S?"buy":"sell"}">${S?"BUY":"SELL"}</span> ${A.symbol}</div>
            <div class="row-sub">${A.quantity.toLocaleString("en-US",{maximumFractionDigits:4})} @ ${Ae(A.price)}</div></div></div>
        <div class="row-side"><span class="row-sub">${new Date(A.at).toLocaleDateString("en-GB")}</span></div>`,p.appendChild(D)}}async function se(){var de;if(!b)return;const A=b.positions.map(pe=>pe.symbol);for(const pe of((de=b.live)==null?void 0:de.positions)??[])A.push(pe.symbol);const S=qt(t);S&&A.push(S);const D=await to(t,A);I(D);const P=b.positions.reduce((pe,we)=>pe+we.quantity*(D[we.symbol]??we.entryPrice),0),g=b.cash+P,E=b.initialCash>0?(g-b.initialCash)/b.initialCash*100:0,{major:L,minor:R}=ze(g),H=e.querySelector("#hv-equity");H.innerHTML=`<span class="hero-value-currency">€</span><span class="hero-value-major">${L}</span><span class="hero-value-minor">.${R}</span>`;const j=e.querySelector("#hv-change");j.textContent=`${V(E).replace(/^[+-]/,"")} all time`,j.className=`hero-change ${E>=0?"up":"down"}`,x("hv-cash",`Cash ${Ae(b.cash)}`),x("hv-invested",`Invested ${Ae(P)}`);const W=e.querySelector("#hv-bench");if(S&&b.benchmark&&D[S]&&b.benchmark.btc>0&&b.benchmark.equity>0){const pe=(g-b.benchmark.equity)/b.benchmark.equity*100,we=(D[S]-b.benchmark.btc)/b.benchmark.btc*100;W.hidden=!1,W.textContent=`vs Bitcoin — agent ${V(pe)} · BTC ${V(we)}${pe>=we?" · leading":""}`}else W.hidden=!0;F(D);const Ee=new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});x("home-status",`Live · updated ${Ee}`)}async function ee(){const A=await qe();if(A)b=A,q(),B(),G(),await se();else if(!b){x("home-status","Couldn't reach the cloud agent — retrying automatically.");const S=e.querySelector("#hv-equity");S!=null&&S.querySelector(".hero-value-skeleton")&&(S.innerHTML='<span class="hero-value-major">—</span>'),h.innerHTML="",h.appendChild(te("div","empty","Waiting for the cloud agent…")),p.innerHTML="",p.appendChild(te("div","empty","Waiting for the cloud agent…"))}}async function ie(){M(await rn(t,6))}async function De(){w=await ln(t),k()}l.addEventListener("click",()=>fs(T)),c.querySelector(".movers-toggle").addEventListener("click",A=>{const S=A.target.closest("[data-mover]");if(!S)return;const D=S.dataset.mover;if(D!==T){T=D;for(const P of c.querySelectorAll(".mk-tab")){const g=P===S;P.classList.toggle("active",g),P.setAttribute("aria-selected",String(g)),P.tabIndex=g?0:-1}k()}}),e.querySelector("#movers-seeall").addEventListener("click",()=>{fs(T)});let be=0,Se=0,ge=0,U=0;const _=()=>{be=window.setInterval(()=>void se(),xt),Se=window.setInterval(()=>void ee(),eo),ge=window.setInterval(()=>void ie(),xt*4),U=window.setInterval(()=>void De(),xt*4)};return q(),ee(),ie(),De(),_(),{pause:()=>{window.clearInterval(be),window.clearInterval(Se),window.clearInterval(ge),window.clearInterval(U)},resume:()=>{ee(),ie(),De(),_()}}}function no(e,t){return wn(e,{title:"Crypto",subtitle:"The real cloud agent — SIMULATED money, matches the Telegram alerts.",liveSubtitle:"The real cloud agent — REAL money is live here. The simulated paper agent keeps running underneath but is no longer the primary account shown.",currencySymbol:"€",fetchState:qe,showBenchmark:!0,renderOverview:s=>so(s,t),renderMarket:s=>xn(s,t)})}const Ls=6e4,ut=e=>`$${O(e)}`;function ao(e){e.innerHTML=`
    <!-- hero-bare matches Home's balance treatment (homeView.ts): this is
         the identical dominant-balance-of-the-screen pattern, so it gets
         the same bare, un-boxed, giant-scale treatment. tappable + the
         "history ›" affordance also match Home's hero exactly — Home's own
         hero jumps to its Value view the same way, but here it jumps to
         this same hub's own History sub-tab (see the click handler below). -->
    <section class="hero hero-bare tappable" role="button" tabindex="0">
      <div class="hero-label">Portfolio value <span class="tag-sim">SIMULATED</span><span class="hero-more">history ›</span></div>
      <div class="hero-value" id="stocks-ov-equity">—</div>
      <div class="hero-change" id="stocks-ov-change"></div>
      <div class="hero-split"><span id="stocks-ov-cash"></span><span id="stocks-ov-invested"></span></div>
      <div class="hero-bench" id="stocks-ov-bench" hidden></div>
      <div class="hero-spark" id="stocks-ov-spark"></div>
    </section>
    <section class="block"><div class="block-head"><h2>Open positions <span class="tag-sim">SIMULATED</span></h2></div><div class="stack stack-card" id="stocks-ov-positions">${Ie(2)}</div></section>
    <p class="muted-line" id="stocks-ov-status">Loading…</p>`,Ve(e);const t=e.querySelector(".hero"),s=e.querySelector("#stocks-ov-equity"),n=e.querySelector("#stocks-ov-change"),i=e.querySelector("#stocks-ov-cash"),a=e.querySelector("#stocks-ov-invested"),o=e.querySelector("#stocks-ov-bench"),r=e.querySelector("#stocks-ov-spark"),d=e.querySelector("#stocks-ov-positions"),c=e.querySelector("#stocks-ov-status");let l=!1;t.addEventListener("click",()=>{var m,p;(p=(m=e.parentElement)==null?void 0:m.querySelector('.hub-tab[data-hub="history"]'))==null||p.click()});async function u(){var T,x;const m=await vt();if(!m){l||(c.textContent="Waiting for the stocks agent — set up ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY as GitHub Actions secrets to start it (see PROJECT_STATE.md).",d.innerHTML="",d.appendChild(Object.assign(document.createElement("div"),{className:"empty",textContent:"Waiting for the stocks agent…"})));return}l=!0;const p=((T=m.equityHistory.at(-1))==null?void 0:T.equity)??m.cash,v=m.initialCash>0?(p-m.initialCash)/m.initialCash*100:0,{major:f,minor:y}=ze(p);if(s.innerHTML=`<span class="hero-value-currency">$</span><span class="hero-value-major">${f}</span><span class="hero-value-minor">.${y}</span>`,n.textContent=`${V(v)} all time`,n.className=`hero-change ${v>=0?"up":"down"}`,i.textContent=`Cash ${ut(m.cash)}`,a.textContent=`Invested ${ut(p-m.cash)}`,m.benchmarkResult){const{label:k,portfolioPct:M,assetPct:F}=m.benchmarkResult,I=((x=/\(([^)]+)\)/.exec(k))==null?void 0:x[1])??k,G=k.replace(/\s*\([^)]*\)\s*$/,"").trim()||k;o.hidden=!1,o.textContent=`vs ${G} — agent ${V(M)} · ${I} ${V(F)}${M>=F?" · leading":""}`}else o.hidden=!0;const b=new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});if(c.textContent=`Live · updated ${b}`,m.equityHistory.length>=2){const k=m.equityHistory.map(F=>F.equity),M=k[k.length-1]>=k[0];t.classList.toggle("up",M),t.classList.toggle("down",!M),r.innerHTML=pt(k,{stroke:"var(--accent-text)",fill:!1,width:320,height:64})}else r.innerHTML="",t.classList.remove("up","down");const w={};for(const k of m.marketSnapshot)w[k.symbol]=k.price;d.innerHTML=Vt(_t(m.cash,m.positions,w,p,k=>k,ut,"USD"),ut),m.positions.length===0&&d.appendChild(Object.assign(document.createElement("div"),{className:"empty",textContent:"Holding cash and waiting for a good setup."}))}let h=0;return u(),h=window.setInterval(()=>void u(),Ls),{pause:()=>window.clearInterval(h),resume:()=>{u(),h=window.setInterval(()=>void u(),Ls)}}}const Tn=[{symbol:"AAPL",base:"AAPL",quote:"USD"},{symbol:"MSFT",base:"MSFT",quote:"USD"},{symbol:"GOOGL",base:"GOOGL",quote:"USD"},{symbol:"AMZN",base:"AMZN",quote:"USD"},{symbol:"NVDA",base:"NVDA",quote:"USD"},{symbol:"META",base:"META",quote:"USD"},{symbol:"TSLA",base:"TSLA",quote:"USD"},{symbol:"JPM",base:"JPM",quote:"USD"},{symbol:"V",base:"V",quote:"USD"},{symbol:"WMT",base:"WMT",quote:"USD"}],io=[...Tn,{symbol:"AVGO",base:"AVGO",quote:"USD"},{symbol:"ORCL",base:"ORCL",quote:"USD"},{symbol:"ADBE",base:"ADBE",quote:"USD"},{symbol:"CRM",base:"CRM",quote:"USD"},{symbol:"CSCO",base:"CSCO",quote:"USD"},{symbol:"INTC",base:"INTC",quote:"USD"},{symbol:"AMD",base:"AMD",quote:"USD"},{symbol:"QCOM",base:"QCOM",quote:"USD"},{symbol:"BAC",base:"BAC",quote:"USD"},{symbol:"WFC",base:"WFC",quote:"USD"},{symbol:"GS",base:"GS",quote:"USD"},{symbol:"MS",base:"MS",quote:"USD"},{symbol:"AXP",base:"AXP",quote:"USD"},{symbol:"UNH",base:"UNH",quote:"USD"},{symbol:"JNJ",base:"JNJ",quote:"USD"},{symbol:"PFE",base:"PFE",quote:"USD"},{symbol:"ABBV",base:"ABBV",quote:"USD"},{symbol:"MRK",base:"MRK",quote:"USD"},{symbol:"LLY",base:"LLY",quote:"USD"},{symbol:"HD",base:"HD",quote:"USD"},{symbol:"MCD",base:"MCD",quote:"USD"},{symbol:"NKE",base:"NKE",quote:"USD"},{symbol:"SBUX",base:"SBUX",quote:"USD"},{symbol:"PG",base:"PG",quote:"USD"},{symbol:"KO",base:"KO",quote:"USD"},{symbol:"PEP",base:"PEP",quote:"USD"},{symbol:"COST",base:"COST",quote:"USD"},{symbol:"TGT",base:"TGT",quote:"USD"},{symbol:"XOM",base:"XOM",quote:"USD"},{symbol:"CVX",base:"CVX",quote:"USD"},{symbol:"BA",base:"BA",quote:"USD"},{symbol:"CAT",base:"CAT",quote:"USD"},{symbol:"GE",base:"GE",quote:"USD"},{symbol:"HON",base:"HON",quote:"USD"},{symbol:"UPS",base:"UPS",quote:"USD"},{symbol:"DIS",base:"DIS",quote:"USD"},{symbol:"NFLX",base:"NFLX",quote:"USD"},{symbol:"CMCSA",base:"CMCSA",quote:"USD"},{symbol:"VZ",base:"VZ",quote:"USD"},{symbol:"TTWO",base:"TTWO",quote:"USD"},{symbol:"PYPL",base:"PYPL",quote:"USD"}],As=6e4,oo=5*6e4,ro=new Set(Tn.map(e=>e.symbol)),Ps=[{key:"popular",label:"Popular"},{key:"all",label:"All"},{key:"gainers",label:"Gainers"},{key:"losers",label:"Losers"}];function lo(e,t){const s=t.trim().toLowerCase();return s===""||e.symbol.toLowerCase().includes(s)}function co(e,t){switch(t){case"popular":return e.slice(0,40);case"gainers":return e.filter(s=>{var n;return(((n=s.snapshot)==null?void 0:n.changePct)??0)>0}).sort((s,n)=>{var i,a;return(((i=n.snapshot)==null?void 0:i.changePct)??0)-(((a=s.snapshot)==null?void 0:a.changePct)??0)});case"losers":return e.filter(s=>{var n;return(((n=s.snapshot)==null?void 0:n.changePct)??0)<0}).sort((s,n)=>{var i,a;return(((i=s.snapshot)==null?void 0:i.changePct)??0)-(((a=n.snapshot)==null?void 0:a.changePct)??0)});case"all":default:return[...e]}}function uo(e,t){const s=[...e];switch(t){case"price":return s.sort((n,i)=>{var a,o;return(((a=i.snapshot)==null?void 0:a.price)??-1/0)-(((o=n.snapshot)==null?void 0:o.price)??-1/0)});case"change":return s.sort((n,i)=>{var a,o;return(((a=i.snapshot)==null?void 0:a.changePct)??-1/0)-(((o=n.snapshot)==null?void 0:o.changePct)??-1/0)});case"name":return s.sort((n,i)=>n.symbol.localeCompare(i.symbol));case"default":default:return s}}function po(e,t){const s=e.snapshot,n=((s==null?void 0:s.changePct)??0)>=0,i=!s||Date.now()-s.updatedAt>oo,a=s?t.get(e.symbol):void 0,o=!s||a===void 0||a===s.price?"":s.price>a?" flash-up":" flash-down";return s&&t.set(e.symbol,s.price),'<div class="market-row-wrap"><div class="market-row">'+Ce(e.symbol)+`<span class="market-row-id"><span class="row-title">${$(e.symbol)}</span><span class="row-sub"><span class="row-clock ${i?"stale":"fresh"}" aria-hidden="true"></span><span class="row-sub-text">${s?Kt(s.updatedAt):"no data yet"}</span>${ro.has(e.symbol)?'<span class="tag-traded">TRADED</span>':""}</span></span><span class="market-row-num"><span class="row-price${o}">${s?ue(`$${$e(s.price)}`):"—"}</span>${s?`<span class="chg ${n?"up":"down"}">${V(s.changePct)}</span>`:""}</span></div></div>`}function ho(e){e.innerHTML=`
    <p class="view-sub">Every tracked US stock. Prices update once per agent cycle (market hours only), not live.</p>
    <div class="mk-tabs" id="sm-tabs" role="tablist">${Ps.map((v,f)=>`<button class="mk-tab${f===0?" active":""}" role="tab" aria-selected="${f===0}" ${f===0?"":'tabindex="-1"'} data-cat="${v.key}">${v.label}</button>`).join("")}</div>
    <div class="mk-controls">
      <input id="sm-search" class="mk-search" type="search" inputmode="search"
        placeholder="Search stocks…" aria-label="Search stocks" autocomplete="off">
      <select id="sm-sort" class="mk-sort" aria-label="Sort stocks">
        <option value="default">Default</option>
        <option value="name">Name</option>
        <option value="change">Change</option>
        <option value="price">Price</option>
      </select>
    </div>
    <div class="stack" id="stocks-market-list"><div class="empty">Loading…</div></div>
    <p class="muted-line" id="sm-status"></p>`,Ve(e);const t=e.querySelector("#sm-tabs"),s=e.querySelector("#sm-search"),n=e.querySelector("#sm-sort"),i=e.querySelector("#stocks-market-list"),a=e.querySelector("#sm-status"),o=io.map(v=>({symbol:v.symbol,snapshot:null})),r=new Map;let d="",c="default",l="popular",u=!1;function h(){var b;const v=o.filter(w=>lo(w,d)),f=co(v,l),y=uo(f,c);if(y.length===0){const w=d.trim(),T=w!==""?`No stocks match "${$(w)}".`:`No stocks in ${((b=Ps.find(x=>x.key===l))==null?void 0:b.label)??l} right now.`;i.innerHTML=`<div class="empty">${T}</div>`;return}i.innerHTML=y.map(w=>po(w,r)).join("")}async function m(){const v=await vt();if(!v){u||(a.textContent="Couldn't reach the cloud agent — retrying.");return}u=!0;const f=new Map((v.marketSnapshot??[]).map(w=>[w.symbol,w]));for(let w=0;w<o.length;w++){const T=o[w].symbol;o[w]={symbol:T,snapshot:f.get(T)??null}}h();const y=o.filter(w=>w.snapshot!==null).length,b=new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});a.textContent=`Live · ${y}/${o.length} stocks priced · updated ${b}`}t.addEventListener("click",v=>{const f=v.target.closest("[data-cat]");f&&(l=f.dataset.cat,t.querySelectorAll(".mk-tab").forEach(y=>{const b=y===f;y.classList.toggle("active",b),y.setAttribute("aria-selected",String(b)),y.tabIndex=b?0:-1}),h())}),s.addEventListener("input",()=>{d=s.value,h()}),n.addEventListener("change",()=>{c=n.value,h()});let p=0;return h(),m(),p=window.setInterval(()=>void m(),As),{pause:()=>window.clearInterval(p),resume:()=>{m(),p=window.setInterval(()=>void m(),As)}}}const Rs=6e4,mo="long-term",Ms=20;function vo(e){e.innerHTML=`
    <section class="block">
      <div class="block-head"><h2>Long-term investing</h2></div>
      <p class="view-sub">A separate simulated wallet that holds through a trend for weeks or months
        instead of the main strategy's tight stop-loss trading — same signal engine, daily bars, no fixed take-profit.</p>
    </section>
    <div class="stack stack-card" id="lt-waiting">${Ie(2)}</div>
    <div id="lt-content" hidden>
      <!-- hero-bare matches Home's balance treatment: same dominant-figure
           pattern for this sub-screen. -->
      <section class="hero hero-bare">
        <div class="hero-label">Long-term wallet <span class="tag-sim">SIMULATED</span></div>
        <div class="hero-value" id="lt-equity">—</div>
        <div class="hero-change" id="lt-change"></div>
        <div class="hero-split"><span id="lt-trades"></span><span id="lt-open"></span></div>
      </section>
      <section class="block"><div class="block-head"><h2>Track record</h2></div>
        <div class="stack" id="lt-stats"></div>
      </section>
      <p class="muted-line" id="lt-status">Loading…</p>
    </div>`;const t=e.querySelector("#lt-waiting"),s=e.querySelector("#lt-content"),n=e.querySelector(".hero"),i=e.querySelector("#lt-equity"),a=e.querySelector("#lt-change"),o=e.querySelector("#lt-trades"),r=e.querySelector("#lt-open"),d=e.querySelector("#lt-stats"),c=e.querySelector("#lt-status");let l=!1;function u(p){l||(s.hidden=!0,t.style.display="",t.hidden=!1,t.className="empty",t.textContent=p)}async function h(){const p=await vt();if(!p){u("Waiting for the stocks agent…");return}const v=p.shadowStandings.find(w=>w.key===mo);if(!v){u("Not started yet — runs alongside the main stocks agent, one cycle at a time.");return}l=!0,t.style.display="none",s.hidden=!1;const{major:f,minor:y}=ze(v.equity);if(i.innerHTML=`<span class="hero-value-currency">$</span><span class="hero-value-major">${f}</span><span class="hero-value-minor">.${y}</span>`,a.textContent=`${V(v.returnPct)} all time`,a.className=`hero-change ${v.returnPct>=0?"up":"down"}`,n.classList.toggle("up",v.returnPct>=0),n.classList.toggle("down",v.returnPct<0),o.textContent=`${v.trades} trades`,r.textContent=`${v.openPositions} open`,d.innerHTML="",v.trades<Ms)d.appendChild(Object.assign(document.createElement("div"),{className:"empty",textContent:`Still gathering data — ${v.trades}/${Ms} trades. Too early to trust the win rate.`}));else{const w=document.createElement("div");w.className="stat-row",w.innerHTML=`
        <div class="stat-tile"><div class="stat-tile-value">${v.winRatePct===null?"n/a":`${v.winRatePct.toFixed(1)}%`}</div><div class="stat-tile-label">Win rate</div></div>
        <div class="stat-tile"><div class="stat-tile-value">${v.profitFactor===null?"n/a":v.profitFactor.toFixed(2)}</div><div class="stat-tile-label">Profit factor</div></div>`,d.appendChild(w)}const b=new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});c.textContent=`Live · updated ${b}`}let m=0;return h(),m=window.setInterval(()=>void h(),Rs),{pause:()=>window.clearInterval(m),resume:()=>{h(),m=window.setInterval(()=>void h(),Rs)}}}function yo(e,t){return wn(e,{title:"Stocks",subtitle:"Separate simulated US-stocks agent — its own portfolio, in dollars.",currencySymbol:"$",fetchState:vt,showBenchmark:!1,renderOverview:s=>ao(s),renderMarket:s=>ho(s),renderLongTerm:s=>vo(s)})}const Cs=6e4;function fo(e,t){e.innerHTML=`
    <button class="tool-back" data-nav="crypto">← Home</button>
    <h2 class="view-title">Portfolio value</h2>
    <p class="view-sub">Simulated portfolio value over time.</p>
    <!-- A shimmering skeleton instead of bare "Loading…" text — the same
         first-paint treatment every other screen already uses, so this page
         (previously the one screen left with a plain loading message) no
         longer looks unfinished for the second it takes to fetch. -->
    <div id="pv-body">
      <div class="skeleton skeleton-title" style="width:40%"></div>
      <div class="skeleton skeleton-line" style="height:210px"></div>
    </div>`;const s=e.querySelector("#pv-body"),n=Ft(s);let i=!1;async function a(){const r=await qe();if(!r){i||(s.innerHTML=`<div class="empty">Couldn't reach the cloud agent — retrying.</div>`);return}i=!0,n.setHistory(r.equityHistory,r.initialCash)}let o=0;return a(),o=window.setInterval(()=>void a(),Cs),{pause:()=>window.clearInterval(o),resume:()=>{a(),o=window.setInterval(()=>void a(),Cs)}}}function bo(e){let t=-1/0,s=0;for(const n of e)if(t=Math.max(t,n.equity),t>0){const i=(t-n.equity)/t*100;s=Math.max(s,i)}return s}function go(e){const t=e.filter(i=>i.pnl>0).length,s=e.filter(i=>i.pnl<0).length,n=e.reduce((i,a)=>i+a.pnl,0);return{tradeCount:e.length,winCount:t,lossCount:s,winRatePct:e.length===0?null:t/e.length*100,totalPnl:n}}function it(e,t,s){if(e.length===0)throw new RangeError("cannot backtest an empty candle series");if(!(s.initialCash>0))throw new RangeError(`initialCash must be > 0, got ${s.initialCash}`);const n=s.feeRate??0;if(n<0||n>=1)throw new RangeError(`feeRate must be in [0, 1), got ${n}`);const i=s.spreadPct??0;if(i<0||i>=1)throw new RangeError(`spreadPct must be in [0, 1), got ${i}`);const a=s.slippagePct??0;if(a<0||a>=.5)throw new RangeError(`slippagePct must be in [0, 0.5), got ${a}`);const o=s.executionDelayCandles??0;if(!Number.isInteger(o)||o<0)throw new RangeError(`executionDelayCandles must be a non-negative integer, got ${o}`);const r=i/2+a,d=new Map;for(const y of t.generateOrders(e)){if(!Number.isInteger(y.index)||y.index<0||y.index>=e.length)throw new RangeError(`strategy '${t.name}' emitted invalid order index ${y.index}`);const b=Math.min(y.index+o,e.length-1),w=d.get(b)??[];w.push(y),d.set(b,w)}let c=s.initialCash,l=0,u=0,h=0,m=0;const p=[],v=[];for(let y=0;y<e.length;y++){const b=e[y],w=b.close;for(const T of d.get(y)??[])if(T.side==="buy"){const x=w*(1+r),k=Math.min(T.amountQuote??c,c);if(k<=0||x<=0)continue;const M=k*n,F=(k-M)/x;l===0&&(m=b.timestamp),u=(u*l+x*F)/(l+F),l+=F,c-=k,h+=M}else{const x=T.fractionOfPosition??1;if(x<=0||l===0)continue;const k=w*(1-r),M=l*Math.min(x,1),F=M*k,I=F*n;c+=F-I,h+=I,p.push({entryTimestamp:m,exitTimestamp:b.timestamp,entryPrice:u,exitPrice:k,quantity:M,pnl:(k-u)*M-I}),l-=M,l<1e-12&&(l=0,u=0)}v.push({timestamp:b.timestamp,equity:c+l*w})}const f=v[v.length-1].equity;return{strategyName:t.name,initialCash:s.initialCash,finalEquity:f,totalReturnPct:wo(s.initialCash,f),maxDrawdownPct:bo(v),feesPaid:h,equityCurve:v,closedTrades:p,stats:go(p)}}function wo(e,t){return(t-e)/e*100}function $o(e,t,s){return t.map(n=>it(e,n,s))}function So(){return{name:"Buy & Hold",generateOrders(e){return e.length<2?[]:[{index:0,side:"buy"},{index:e.length-1,side:"sell"}]}}}function ko(e){const{intervalCandles:t,amountPerPurchase:s}=e;if(!Number.isInteger(t)||t<1)throw new RangeError(`intervalCandles must be a positive integer, got ${t}`);if(!(s>0))throw new RangeError(`amountPerPurchase must be > 0, got ${s}`);return{name:`DCA (every ${t}, ${s}/buy)`,generateOrders(n){if(n.length<2)return[];const i=[];for(let a=0;a<n.length-1;a+=t)i.push({index:a,side:"buy",amountQuote:s});return i.push({index:n.length-1,side:"sell"}),i}}}function ot(e,t){Re(t,e.length);const s=new Array(e.length).fill(null);let n=0;for(let i=0;i<e.length;i++)n+=e[i],i>=t&&(n-=e[i-t]),i>=t-1&&(s[i]=n/t);return s}function Re(e,t){if(!Number.isInteger(e)||e<1)throw new RangeError(`period must be a positive integer, got ${e}`);if(t<0)throw new RangeError("input length cannot be negative")}function tt(e,t){Re(t,e.length);const s=new Array(e.length).fill(null);if(e.length<t)return s;const n=2/(t+1);let i=0;for(let o=0;o<t;o++)i+=e[o];let a=i/t;s[t-1]=a;for(let o=t;o<e.length;o++)a=e[o]*n+a*(1-n),s[o]=a;return s}function xo(e,t=14){Re(t,e.length);const s=new Array(e.length).fill(null);if(e.length<=t)return s;let n=0,i=0;for(let r=1;r<=t;r++){const d=e[r]-e[r-1];d>0?n+=d:i-=d}let a=n/t,o=i/t;s[t]=qs(a,o);for(let r=t+1;r<e.length;r++){const d=e[r]-e[r-1],c=d>0?d:0,l=d<0?-d:0;a=(a*(t-1)+c)/t,o=(o*(t-1)+l)/t,s[r]=qs(a,o)}return s}function qs(e,t){return t===0?e===0?50:100:100-100/(1+e/t)}function To(e,t=12,s=26,n=9){if(Re(t,e.length),Re(s,e.length),Re(n,e.length),t>=s)throw new RangeError(`fastPeriod (${t}) must be < slowPeriod (${s})`);const i=tt(e,t),a=tt(e,s),o=e.map((l,u)=>{const h=i[u],m=a[u];return h!=null&&m!==null&&m!==void 0?h-m:null}),r=o.findIndex(l=>l!==null),d=new Array(e.length).fill(null);if(r!==-1){const l=o.slice(r),u=tt(l,n);for(let h=0;h<u.length;h++)d[r+h]=u[h]??null}const c=o.map((l,u)=>{const h=d[u];return l!==null&&h!==null&&h!==void 0?l-h:null});return{macd:o,signal:d,histogram:c}}function Eo(e,t=20,s=2){if(Re(t,e.length),!(s>0))throw new RangeError(`multiplier must be > 0, got ${s}`);const n=ot(e,t),i=new Array(e.length).fill(null),a=new Array(e.length).fill(null),o=new Array(e.length).fill(null),r=new Array(e.length).fill(null);for(let d=t-1;d<e.length;d++){const c=n[d];if(c==null)continue;let l=0;for(let p=d-t+1;p<=d;p++){const v=e[p]-c;l+=v*v}const u=Math.sqrt(l/t),h=c+s*u,m=c-s*u;i[d]=h,a[d]=m,o[d]=c!==0?(h-m)/c:null,r[d]=h!==m?(e[d]-m)/(h-m):.5}return{middle:n,upper:i,lower:a,bandwidth:o,percentB:r}}function En(e){return e.map((t,s)=>{if(s===0)return t.high-t.low;const n=e[s-1].close;return Math.max(t.high-t.low,Math.abs(t.high-n),Math.abs(t.low-n))})}function Lo(e,t=14){Re(t,e.length);const s=new Array(e.length).fill(null);if(e.length<t)return s;const n=En(e);let i=0;for(let o=0;o<t;o++)i+=n[o];let a=i/t;s[t-1]=a;for(let o=t;o<e.length;o++)a=(a*(t-1)+n[o])/t,s[o]=a;return s}function Ao(e,t=14){Re(t,e.length);const s=e.length,n=new Array(s).fill(null),i=new Array(s).fill(null),a=new Array(s).fill(null);if(s<=t)return{plusDi:n,minusDi:i,adx:a};const o=En(e),r=new Array(s).fill(0),d=new Array(s).fill(0);for(let f=1;f<s;f++){const y=e[f].high-e[f-1].high,b=e[f-1].low-e[f].low;y>b&&y>0&&(r[f]=y),b>y&&b>0&&(d[f]=b)}let c=0,l=0,u=0;for(let f=1;f<=t;f++)c+=o[f],l+=r[f],u+=d[f];const h=new Array(s).fill(null);for(let f=t;f<s;f++){f>t&&(c=c-c/t+o[f],l=l-l/t+r[f],u=u-u/t+d[f]);const y=c===0?0:100*l/c,b=c===0?0:100*u/c;n[f]=y,i[f]=b;const w=y+b;h[f]=w===0?0:100*Math.abs(y-b)/w}const m=2*t-1;if(s<=m)return{plusDi:n,minusDi:i,adx:a};let p=0;for(let f=t;f<=m;f++)p+=h[f];let v=p/t;a[m]=v;for(let f=m+1;f<s;f++)v=(v*(t-1)+h[f])/t,a[f]=v;return{plusDi:n,minusDi:i,adx:a}}function Po(e,t=14,s=3){Re(t,e.length),Re(s,e.length);const n=e.length,i=new Array(n).fill(null);for(let r=t-1;r<n;r++){let d=-1/0,c=1/0;for(let u=r-t+1;u<=r;u++)d=Math.max(d,e[u].high),c=Math.min(c,e[u].low);const l=d-c;i[r]=l===0?50:100*(e[r].close-c)/l}const a=new Array(n).fill(null),o=i.findIndex(r=>r!==null);if(o!==-1){const r=i.slice(o),d=ot(r,s);for(let c=0;c<d.length;c++)a[o+c]=d[c]??null}return{k:i,d:a}}function Ro(e,t=20){return ot(e.map(s=>s.volume),t)}function Mo(e,t=20){Re(t,e.length);const s=Ro(e,t);return e.map((n,i)=>{const a=s[i];return a==null||a===0?null:n.volume/a})}function Te(e){for(let t=e.length-1;t>=0;t--){const s=e[t];if(s!=null)return s}return null}function jt(e={fastPeriod:10,slowPeriod:30}){const{fastPeriod:t,slowPeriod:s}=e;if(t>=s)throw new RangeError(`fastPeriod (${t}) must be < slowPeriod (${s})`);return{name:`Trend (SMA ${t}/${s})`,generateOrders(n){const i=n.map(c=>c.close),a=ot(i,t),o=ot(i,s),r=[];let d=!1;for(let c=1;c<n.length;c++){const l=a[c],u=o[c],h=a[c-1],m=o[c-1];if(l==null||u==null||h==null||m==null)continue;const p=h<=m&&l>u,v=h>=m&&l<u;p&&!d?(r.push({index:c,side:"buy"}),d=!0):v&&d&&(r.push({index:c,side:"sell"}),d=!1)}return d&&n.length>0&&r.push({index:n.length-1,side:"sell"}),r}}}function Co(e,t,s){if(!(e>0)||!(t>e))throw new RangeError(`invalid grid bounds: [${e}, ${t}]`);if(!Number.isInteger(s)||s<2)throw new RangeError(`levels must be an integer >= 2, got ${s}`);const n=(t-e)/(s-1);return Array.from({length:s},(i,a)=>e+a*n)}function qo(e){const{lowerBound:t,upperBound:s,levels:n,amountPerLevel:i}=e,a=Co(t,s,n);if(!(i>0))throw new RangeError(`amountPerLevel must be > 0, got ${i}`);return{name:`Grid (${n} levels ${t}-${s})`,generateOrders(o){if(o.length<2)return[];const r=new Array(a.length).fill(!1),d=[];let c=!1;for(let l=1;l<o.length;l++){const u=o[l-1].close,h=o[l].close;for(let m=0;m<a.length;m++){const p=a[m];!r[m]&&u>p&&h<=p&&(d.push({index:l,side:"buy",amountQuote:i}),r[m]=!0,c=!0)}for(let m=a.length-2;m>=0;m--){const p=a[m+1];if(r[m]&&u<p&&h>=p){const v=r.filter(Boolean).length;d.push({index:l,side:"sell",fractionOfPosition:1/v}),r[m]=!1}}}return c&&r.some(Boolean)&&d.push({index:o.length-1,side:"sell"}),d}}}const Do=["1h","4h","1d"],Ds=300;function Fo(e,t){e.innerHTML=`
    <h2 class="view-title">Backtesting Lab</h2>
    <p class="view-sub">
      Compare strategies over the same history, fees included, liquidation at the end.
      Past performance never guarantees future results.
    </p>
    <section class="block">
      <div class="block-head"><h2>Configure</h2></div>
      <div class="controls">
        <label class="control">Market
          <select id="bt-symbol">
            ${t.instruments.map(a=>`<option value="${$(a.symbol)}">${$(a.symbol)}</option>`).join("")}
          </select>
        </label>
        <label class="control">Timeframe
          <select id="bt-timeframe">
            ${Do.map(a=>`<option value="${a}" ${a==="1d"?"selected":""}>${a}</option>`).join("")}
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
    </section>
    <section class="block">
      <!-- Same fix as gridView.ts's identical header, same audit: a pure
           historical backtest with no SIMULATED tag, inconsistent with
           every account screen in the app. -->
      <div class="block-head"><h2>Results <span class="tag-sim">SIMULATED</span></h2></div>
      <div id="bt-results"><div class="empty">Configure a backtest above and press Run to compare strategies.</div></div>
    </section>
  `;const s=e.querySelector("#bt-run"),n=e.querySelector("#bt-status"),i=e.querySelector("#bt-results");s.addEventListener("click",async()=>{s.disabled=!0,i.innerHTML="";const a=e.querySelector("#bt-symbol").value,o=e.querySelector("#bt-timeframe").value,r=Number(e.querySelector("#bt-cash").value),d=Number(e.querySelector("#bt-fee").value)/100;n.innerHTML=`<span class="loading-inline"><span class="spinner sm"></span>Loading ${Ds} ${o} candles for ${$(a)}…</span>`;try{const c=await t.source.getCandles(a,o,Ds);if(!c.ok){n.innerHTML=`<span class="error-line">${$(c.error)}</span>`;return}const l=[];if(e.querySelector("#bt-hold").checked&&l.push(So()),e.querySelector("#bt-dca").checked&&l.push(ko({intervalCandles:Math.max(1,Math.floor(c.value.length/20)),amountPerPurchase:r/20})),e.querySelector("#bt-trend").checked&&l.push(jt({fastPeriod:10,slowPeriod:30})),l.length===0){n.innerHTML='<span class="error-line">Select at least one strategy.</span>';return}const u=$o(c.value,l,{initialCash:r,feeRate:d});n.textContent=`${a} · ${c.value.length} candles (${o}) · source: ${t.source.name}`,Ho(i,u)}catch(c){n.innerHTML=`<span class="error-line">Backtest failed: ${$(String(c))}</span>`}finally{s.disabled=!1}})}function Ho(e,t){const s=Math.max(...t.map(c=>c.totalReturnPct)),n=t.find(c=>c.totalReturnPct===s),i=t.reduce((c,l)=>c+l.totalReturnPct,0)/t.length,a=document.createElement("div");a.className="stat-row",a.innerHTML=`
    <div class="stat-tile"><div class="stat-tile-value ${s>=0?"up":"down"}">${$(n.strategyName)}</div><div class="stat-tile-label">Best strategy</div></div>
    <div class="stat-tile"><div class="stat-tile-value ${s>=0?"up":"down"}">${V(s)}</div><div class="stat-tile-label">Best return</div></div>
    <div class="stat-tile"><div class="stat-tile-value ${i>=0?"up":"down"}">${V(i)}</div><div class="stat-tile-label">Average return</div></div>
    <div class="stat-tile"><div class="stat-tile-value">${t.length}</div><div class="stat-tile-label">Strategies compared</div></div>
  `;const o=document.createElement("table");o.className="data-table",o.innerHTML=`
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
      ${t.map(c=>`
        <tr>
          <td>${$(c.strategyName)}${c.totalReturnPct===s?' <span class="badge badge-hot">BEST</span>':""}</td>
          <td>${ue(O(c.finalEquity))}</td>
          <td class="${fe(c.totalReturnPct)}">${V(c.totalReturnPct)}</td>
          <td>${c.maxDrawdownPct.toFixed(2)}%</td>
          <td>${c.stats.tradeCount}</td>
          <td>${c.stats.winRatePct===null?"—":`${c.stats.winRatePct.toFixed(0)}%`}</td>
          <td>${ue(O(c.feesPaid))}</td>
        </tr>`).join("")}
    </tbody>
  `;const r=document.createElement("div");r.className="table-scroll",r.appendChild(o);const d=document.createElement("div");d.className="table-scroll-fade",d.appendChild(r),e.innerHTML="",e.appendChild(a),e.appendChild(d),Io(d)}function Io(e){const t=e.querySelector(".table-scroll");if(!t)return;const s=()=>{e.classList.toggle("is-scrollable",t.scrollWidth>t.clientWidth+1),e.classList.toggle("is-scrolled-end",t.scrollLeft+t.clientWidth>=t.scrollWidth-1)};s(),t.addEventListener("scroll",s,{passive:!0})}const Uo=300;function No(e){if(e.length<2)return"";const t=e[0].equity,s=e[e.length-1].equity;return fn(e.map(n=>({timestamp:n.timestamp,value:n.equity})),{lineClass:s>=t?"equity-line-up":"equity-line-down",ariaLabel:`Simulated equity curve from ${O(t)} to ${O(s)}`})}function Oo(e,t){e.innerHTML=`
    <h2 class="view-title">Grid Simulation</h2>
    <p class="view-sub">
      Buys fixed amounts as price falls through grid levels and sells them as it
      recovers. Works in ranges; loses in sustained downtrends — the simulation
      shows both honestly.
    </p>
    <section class="block">
      <div class="block-head"><h2>Configure</h2></div>
      <div class="controls">
        <label class="control">Market
          <select id="grid-symbol">
            ${t.instruments.map(a=>`<option value="${$(a.symbol)}">${$(a.symbol)}</option>`).join("")}
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
    </section>
    <section class="block">
      <!-- Found in the 2026-09-06 readiness/kill-switch audit: unlike every
           account screen (Home, Crypto, Stocks, Portfolio), this tool's
           results carried no SIMULATED tag at all despite being a pure
           historical backtest with no live money behind it whatsoever. -->
      <div class="block-head"><h2>Results <span class="tag-sim">SIMULATED</span></h2></div>
      <div id="grid-results"><div class="empty">Configure a grid above and press Simulate to see results.</div></div>
    </section>
  `;const s=e.querySelector("#grid-run"),n=e.querySelector("#grid-status"),i=e.querySelector("#grid-results");s.addEventListener("click",async()=>{s.disabled=!0,i.innerHTML="";const a=e.querySelector("#grid-symbol").value,o=e.querySelector("#grid-timeframe").value,r=Number(e.querySelector("#grid-levels").value),d=Number(e.querySelector("#grid-amount").value),c=Number(e.querySelector("#grid-cash").value);n.innerHTML=`<span class="loading-inline"><span class="spinner sm"></span>Loading ${$(a)} history…</span>`;try{const l=await t.source.getCandles(a,o,Uo);if(!l.ok){n.innerHTML=`<span class="error-line">${$(l.error)}</span>`;return}if(l.value.length===0){n.innerHTML='<span class="error-line">No history available for this market yet.</span>';return}const u=l.value.map(y=>y.low),h=l.value.map(y=>y.high),m=Math.min(...u),p=Math.max(...h),v=qo({lowerBound:m,upperBound:p,levels:r,amountPerLevel:d}),f=it(l.value,v,{initialCash:c});n.textContent=`${a} · grid ${O(m)} – ${O(p)} · ${l.value.length} candles (${o}) · source: ${t.source.name}`,i.innerHTML=`
        <div class="stat-row">
          <div class="stat-tile"><div class="stat-tile-value ${fe(f.totalReturnPct)}">${ue(O(f.finalEquity))}</div>
            <div class="stat-tile-label">Final equity</div></div>
          <div class="stat-tile"><div class="stat-tile-value ${fe(f.totalReturnPct)}">${V(f.totalReturnPct)}</div>
            <div class="stat-tile-label">Return</div></div>
        </div>
        ${No(f.equityCurve)}
        <div class="stat-row">
          <div class="stat-tile"><div class="stat-tile-value">${f.maxDrawdownPct.toFixed(2)}%</div>
            <div class="stat-tile-label">Max drawdown</div></div>
          <div class="stat-tile"><div class="stat-tile-value">${f.stats.tradeCount}</div>
            <div class="stat-tile-label">Closed trades</div></div>
          <div class="stat-tile"><div class="stat-tile-value">${f.stats.winRatePct===null?"—":`${f.stats.winRatePct.toFixed(0)}%`}</div>
            <div class="stat-tile-label">Win rate</div></div>
        </div>
      `}catch(l){n.innerHTML=`<span class="error-line">Simulation failed: ${$(String(l))}</span>`}finally{s.disabled=!1}})}const Fs="paper-portfolio";class Jt{constructor(t,s=1e4){J(this,"state");if(this.store=t,!(s>0))throw new RangeError(`initialCash must be > 0, got ${s}`);const n=t.get(Fs);this.state=n??{cash:s,positions:{},trades:[],realizedPnl:0}}get cash(){return this.state.cash}get realizedPnl(){return this.state.realizedPnl}get trades(){return this.state.trades}positions(){return Object.entries(this.state.positions).map(([t,s])=>({symbol:t,quantity:s.quantity,avgCost:s.avgCost}))}buy(t,s,n,i){const a=Hs(t,s,n);if(a)return C(a);const o=s*n;if(o>this.state.cash+1e-9)return C(`insufficient cash: need ${o.toFixed(2)}, have ${this.state.cash.toFixed(2)}`);const r=this.state.positions[t]??{quantity:0,avgCost:0},d=r.quantity+s;this.state.positions[t]={quantity:d,avgCost:(r.avgCost*r.quantity+o)/d},this.state.cash-=o;const c={timestamp:i,symbol:t,side:"buy",quantity:s,price:n,realizedPnl:0};return this.state.trades.push(c),this.persist(),ce(c)}sell(t,s,n,i){const a=Hs(t,s,n);if(a)return C(a);const o=this.state.positions[t];if(!o||o.quantity+1e-12<s)return C(`insufficient position in ${t}: have ${(o==null?void 0:o.quantity)??0}, want to sell ${s}`);const r=(n-o.avgCost)*s,d=o.quantity-s;d<1e-12?delete this.state.positions[t]:this.state.positions[t]={quantity:d,avgCost:o.avgCost},this.state.cash+=s*n,this.state.realizedPnl+=r;const c={timestamp:i,symbol:t,side:"sell",quantity:s,price:n,realizedPnl:r};return this.state.trades.push(c),this.persist(),ce(c)}equity(t){let s=this.state.cash;for(const[n,i]of Object.entries(this.state.positions)){const a=t[n]??i.avgCost;s+=i.quantity*a}return s}unrealizedPnl(t){let s=0;for(const[n,i]of Object.entries(this.state.positions)){const a=t[n]??i.avgCost;s+=(a-i.avgCost)*i.quantity}return s}reset(t){if(!(t>0))throw new RangeError(`initialCash must be > 0, got ${t}`);this.state={cash:t,positions:{},trades:[],realizedPnl:0},this.persist()}persist(){this.store.set(Fs,this.state)}}function Hs(e,t,s){return e.trim()===""?"symbol must not be empty":!(t>0)||!Number.isFinite(t)?`quantity must be > 0, got ${t}`:!(s>0)||!Number.isFinite(s)?`price must be > 0, got ${s}`:null}const Is="daily-loss";function Bo(e){return new Date(e).toISOString().slice(0,10)}class Ln{constructor(t){this.store=t}stateFor(t){const s=this.store.get(Is),n=Bo(t);return s===void 0||s.day!==n?{day:n,loss:0}:s}record(t,s){if(!Number.isFinite(t)||t>=0)return;const n=this.stateFor(s);this.store.set(Is,{day:n.day,loss:n.loss+-t})}lossToday(t){return this.stateFor(t).loss}isPaused(t,s,n){if(!(s>0))return!1;const i=s*(n.dailyLossLimitPct/100);return i>0?this.lossToday(t)>=i:!1}}const An={maxRiskPerTradePct:1,maxPositionPct:20,maxTotalExposurePct:60,maxOpenPositions:5,maxExposurePerAssetPct:20,dailyLossLimitPct:3,minRewardRisk:1.5,maxRewardRisk:20,minStopDistancePct:.25};function _o(e){const t=e.limits??An,{accountEquity:s,entry:n,stopLoss:i,currentExposure:a}=e;if(!(s>0))return C(`accountEquity must be > 0, got ${s}`);if(!(e.riskPerTradePct>0))return C(`riskPerTradePct must be > 0, got ${e.riskPerTradePct}`);if(!(n>0))return C(`entry must be > 0, got ${n}`);if(!(i>0)||i>=n)return C(`stopLoss must be positive and below entry (entry ${n}, stop ${i})`);if(!(a>=0))return C(`currentExposure must be >= 0, got ${a}`);const o=[];let r=e.riskPerTradePct;r>t.maxRiskPerTradePct&&(r=t.maxRiskPerTradePct,o.push(`requested risk ${e.riskPerTradePct}% clamped to the ${t.maxRiskPerTradePct}% per-trade risk ceiling`));const d=n-i;let c=s*(r/100)/d,l=c*n;const u=s*(t.maxPositionPct/100);l>u&&(c=u/n,l=u,o.push(`size capped by the ${t.maxPositionPct}% single-position limit`));const h=s*(t.maxTotalExposurePct/100)-a;if(!e.ignoreTotalExposureCap&&l>h){if(h<=0)return C(`no exposure headroom: ${a.toFixed(2)} already deployed of the ${t.maxTotalExposurePct}% total-exposure limit`);c=h/n,l=h,o.push(`size capped by the ${t.maxTotalExposurePct}% total-exposure limit`)}const m=c*d;return ce({quantity:c,positionValue:l,maxLoss:m,riskPctUsed:m/s*100,constraintsApplied:o})}const Tt=e=>e.quantity*(e.currentPrice??e.entryPrice);function Pn(e,t,s={}){const n=s.limits??An,{entry:i,stopLoss:a,takeProfit:o}=e.levels,r=[],d=[],c=t.openPositions.reduce((ee,ie)=>ee+Tt(ie),0),l=t.equity>0?c/t.equity*100:0,u=()=>({approved:!1,asset:e.symbol,entry:i,stopLoss:a,takeProfit:o,positionSize:0,positionValue:0,riskAmount:0,riskPercentage:0,rewardRiskRatio:v,portfolioExposure:l,reasons:r,warnings:d});t.equity>0||r.push(`portfolio equity must be positive, got ${t.equity}`);const h=s.dailyLossSoFar??0,m=t.equity*(n.dailyLossLimitPct/100);h>=m&&m>0&&r.push(`daily loss limit reached: ${h.toFixed(2)} lost today of the ${m.toFixed(2)} (${n.dailyLossLimitPct}% of equity) allowance — no new trades until the next trading day`);const p=i>0?(i-a)/i*100:0;let v=0;!(a>0)||a>=i?r.push(`invalid stop: stop loss ${a} must be positive and below entry ${i}`):(v=(o-i)/(i-a),p<n.minStopDistancePct&&r.push(`stop too close to entry: ${p.toFixed(2)}% distance is below the ${n.minStopDistancePct}% minimum — it would be triggered by normal noise`),v<n.minRewardRisk?r.push(`reward/risk ${v.toFixed(2)} is below the required minimum of ${n.minRewardRisk}`):v>n.maxRewardRisk&&r.push(`unrealistic target: reward/risk ${v.toFixed(1)} exceeds the plausible maximum of ${n.maxRewardRisk}`)),o>i||r.push(`take profit ${o} must be above entry ${i} for a long position`);const f=s.ignorePortfolioCapacityCaps??!1;!f&&t.openPositions.length>=n.maxOpenPositions&&r.push(`maximum open positions reached (${t.openPositions.length}/${n.maxOpenPositions})`);const y=t.openPositions.filter(ee=>ee.symbol===e.symbol).reduce((ee,ie)=>ee+Tt(ie),0),w=t.equity*(n.maxExposurePerAssetPct/100)-y;!f&&y>0&&w<=0&&r.push(`${e.symbol} already uses ${(y/t.equity*100).toFixed(1)}% of equity — at or above the ${n.maxExposurePerAssetPct}% per-asset cap`);const T=n.correlationThreshold!==void 0&&n.maxCorrelatedExposurePct!==void 0&&s.correlationTo!==void 0,x=T?t.openPositions.filter(ee=>ee.symbol!==e.symbol&&s.correlationTo(ee.symbol)>=n.correlationThreshold).reduce((ee,ie)=>ee+Tt(ie),0):0,M=(T?t.equity*(n.maxCorrelatedExposurePct/100):0)-x;if(!f&&T&&x>0&&M<=0&&r.push(`${e.symbol}'s correlated cluster already uses ${(x/t.equity*100).toFixed(1)}% of equity — at or above the ${n.maxCorrelatedExposurePct}% correlated-cluster cap`),r.length>0)return u();const F=_o({accountEquity:t.equity,riskPerTradePct:s.riskPerTradePct??n.maxRiskPerTradePct,entry:i,stopLoss:a,currentExposure:c,limits:n,ignoreTotalExposureCap:f});if(!F.ok)return r.push(F.error),u();let{quantity:I,positionValue:G,maxLoss:q,riskPctUsed:B,constraintsApplied:se}=F.value;return!f&&G>w&&(I=w/i,G=w,q=I*(i-a),B=q/t.equity*100,se=[...se,`size capped by the ${n.maxExposurePerAssetPct}% per-asset cap`+(y>0?` (existing ${e.symbol} exposure)`:"")]),!f&&T&&x>0&&G>M&&(I=M/i,G=M,q=I*(i-a),B=q/t.equity*100,se=[...se,`size capped by the ${n.maxCorrelatedExposurePct}% correlated-cluster cap`]),I>0?(d.push(...se),r.push(`risking ${q.toFixed(2)} (${B.toFixed(2)}% of equity) for a ${v.toFixed(1)}:1 reward/risk — within every configured limit`),{approved:!0,asset:e.symbol,entry:i,stopLoss:a,takeProfit:o,positionSize:I,positionValue:G,riskAmount:q,riskPercentage:B,rewardRiskRatio:v,portfolioExposure:(c+G)/t.equity*100,reasons:r,warnings:d}):(r.push("position size rounds to zero under the current limits"),u())}const Rn={emaFastPeriod:20,emaSlowPeriod:50,rsiPeriod:14,adxPeriod:14,atrPeriod:14,stochasticKPeriod:14,stochasticDPeriod:3,volumePeriod:20,bollingerPeriod:20,minCandles:60,hotThreshold:30},Je={trend:30,rsi:20,macd:20,stochastic:15,volume:15},Et=25,Vo=.2,Qe=(e,t,s)=>Math.min(s,Math.max(t,e));function Mn(e,t,s,n=Rn){if(s.length<n.minCandles)return C(`${e}: need at least ${n.minCandles} candles for a reliable scan, got ${s.length}`);const i=s.map(k=>k.close),a=i[i.length-1],o=i[0],r=tt(i,n.emaFastPeriod),d=tt(i,n.emaSlowPeriod),c=xo(i,n.rsiPeriod),l=To(i),u=Ao(s,n.adxPeriod),h=Lo(s,n.atrPeriod),m=Po(s,n.stochasticKPeriod,n.stochasticDPeriod),p=Eo(i,n.bollingerPeriod),v=Mo(s,n.volumePeriod),f=Te(h),y={price:a,changePct:o!==0?(a-o)/o*100:0,rsi:Te(c),macdHistogram:Te(l.histogram),emaFast:Te(r),emaSlow:Te(d),adx:Te(u.adx),plusDi:Te(u.plusDi),minusDi:Te(u.minusDi),atrPct:f!==null&&a!==0?f/a*100:null,bollingerBandwidth:Te(p.bandwidth),percentB:Te(p.percentB),stochasticK:Te(m.k),stochasticD:Te(m.d),relativeVolume:Te(v)},b=[],w=[];if(y.emaFast!==null&&y.emaSlow!==null&&a!==0){const k=(y.emaFast-y.emaSlow)/a,M=Qe(k/.02,-1,1),F=y.adx===null?.5:Qe(y.adx/Et,0,1),I=M*F*Je.trend;b.push({label:`Trend (EMA ${n.emaFastPeriod}/${n.emaSlowPeriod} + ADX)`,detail:`EMA${n.emaFastPeriod} ${Lt(y.emaFast)} vs EMA${n.emaSlowPeriod} ${Lt(y.emaSlow)}, ADX ${y.adx===null?"n/a":y.adx.toFixed(1)}`,contribution:I})}if(y.rsi!==null){const k=(y.rsi-50)/50*Je.rsi;b.push({label:`Momentum (RSI ${n.rsiPeriod})`,detail:`RSI ${y.rsi.toFixed(1)}`,contribution:k}),y.rsi>=70&&w.push(`RSI ${y.rsi.toFixed(1)} is overbought (≥ 70)`),y.rsi<=30&&w.push(`RSI ${y.rsi.toFixed(1)} is oversold (≤ 30)`)}if(y.macdHistogram!==null&&f!==null&&f>0){const k=Qe(y.macdHistogram/f,-1,1),M=k*Je.macd;b.push({label:"MACD histogram",detail:`histogram ${Lt(y.macdHistogram)} (ATR-normalised ${k.toFixed(2)})`,contribution:M})}if(y.stochasticK!==null){const k=(y.stochasticK-50)/50*Je.stochastic;b.push({label:`Stochastic %K ${n.stochasticKPeriod}`,detail:`%K ${y.stochasticK.toFixed(1)}`,contribution:k})}if(y.relativeVolume!==null){const k=s[s.length-1],M=Math.sign(k.close-k.open),F=Qe(y.relativeVolume-1,-1,1),I=M*Math.max(F,0)*Je.volume;b.push({label:`Volume (vs ${n.volumePeriod}-bar average)`,detail:`relative volume ${y.relativeVolume.toFixed(2)}×`,contribution:I})}y.bollingerBandwidth!==null&&y.bollingerBandwidth>Vo&&w.push(`Bollinger bandwidth ${(y.bollingerBandwidth*100).toFixed(1)}% — unusually volatile`),y.adx!==null&&y.adx<Et&&w.push(`ADX ${y.adx.toFixed(1)} < ${Et} — weak/absent trend`);const T=Qe(b.reduce((k,M)=>k+M.contribution,0),-100,100),x=T>=n.hotThreshold?"hot":T<=-n.hotThreshold?"cold":"neutral";return ce({symbol:e,timeframe:t,candleCount:s.length,score:T,temperature:x,snapshot:y,components:b,warnings:w})}async function Cn(e,t,s,n=150,i=Rn){const a=[],o=[],r=await Promise.all(t.map(async d=>({symbol:d,candles:await e.getCandles(d,s,n)})));for(const{symbol:d,candles:c}of r){if(!c.ok){o.push({symbol:d,reason:c.error});continue}const l=Mn(d,s,c.value,i);l.ok?a.push(l.value):o.push({symbol:d,reason:l.error})}return a.sort((d,c)=>c.score-d.score),{timeframe:s,results:a,failures:o}}function Lt(e){const t=Math.abs(e);return t>=1e3?e.toFixed(0):t>=1?e.toFixed(2):e.toPrecision(3)}const jo={minScore:30,minAdx:20,maxRsiForLong:75,atrStopMultiple:2,atrTargetMultiple:4,minRiskReward:1.5,maxAtrPct:8,minConfidence:0},bt=90,At={scoreFactor:.6,trendMax:15,volumeMax:10},Us=20,Go=50,Gt=(e,t,s)=>Math.min(s,Math.max(t,e));function qn(e,t=jo){zo(t);const{snapshot:s}=e,n=[];e.score<0?n.push(`bearish evidence (score ${e.score.toFixed(0)}) — this platform is long-only and does not simulate short positions`):e.score<t.minScore&&n.push(`insufficient bullish evidence: score ${e.score.toFixed(0)} is below the required ${t.minScore}`),s.adx===null?n.push("trend strength unknown: ADX unavailable for this series"):s.adx<t.minAdx&&n.push(`weak trend: ADX ${s.adx.toFixed(1)} is below the required ${t.minAdx}`),s.rsi!==null&&s.rsi>t.maxRsiForLong&&n.push(`overextended: RSI ${s.rsi.toFixed(1)} exceeds the long entry ceiling of ${t.maxRsiForLong}`),s.atrPct===null?n.push("cannot size risk: ATR unavailable for this series"):s.atrPct>t.maxAtrPct&&n.push(`volatility too high: ATR ${s.atrPct.toFixed(1)}% of price exceeds the ${t.maxAtrPct}% limit`);const i=t.atrTargetMultiple/t.atrStopMultiple;i<t.minRiskReward&&n.push(`risk/reward ${i.toFixed(2)} is below the required ${t.minRiskReward}`);let a=null;if(s.atrPct!==null&&s.price>0){const c=s.atrPct/100*s.price,l=s.price,u=l-t.atrStopMultiple*c,h=l+t.atrTargetMultiple*c;u<=0?n.push("stop loss would be at or below zero — volatility too large for the price"):a={entry:l,stopLoss:u,takeProfit:h,riskReward:i}}if(n.length>0||a===null)return{kind:"rejected",symbol:e.symbol,timeframe:e.timeframe,reasons:n};const o=Wo(e),r=Gt(o.reduce((c,l)=>c+l.effect,0),0,bt);return r<t.minConfidence?{kind:"rejected",symbol:e.symbol,timeframe:e.timeframe,reasons:[`confidence ${r.toFixed(0)} is below the required ${t.minConfidence} (too little conviction — protecting capital)`]}:{kind:"opportunity",opportunity:{symbol:e.symbol,timeframe:e.timeframe,direction:"long",levels:a,confidence:r,confidenceComponents:o,explanation:Xo(e,a,r,t),warnings:[...e.warnings],basedOn:{score:e.score,candleCount:e.candleCount}}}}function Wo(e){const t=[],{snapshot:s}=e;if(t.push({label:"Scanner evidence",detail:`composite score ${e.score.toFixed(0)} of 100`,effect:e.score*At.scoreFactor}),s.adx!==null){const n=Gt((s.adx-Us)/(Go-Us),0,1);t.push({label:"Trend strength",detail:`ADX ${s.adx.toFixed(1)}`,effect:n*At.trendMax})}return s.relativeVolume!==null&&s.relativeVolume>1&&t.push({label:"Volume participation",detail:`${s.relativeVolume.toFixed(2)}× average volume`,effect:Gt(s.relativeVolume-1,0,1)*At.volumeMax}),e.warnings.length>0&&t.push({label:"Active warnings",detail:e.warnings.join("; "),effect:-8*e.warnings.length}),t}function Xo(e,t,s,n){const i=[...e.components].filter(o=>o.contribution>0).sort((o,r)=>r.contribution-o.contribution).slice(0,3).map(o=>`${o.label} (${o.detail})`),a=e.warnings.length>0?` Caution: ${e.warnings.join("; ")}.`:"";return`${e.symbol} on the ${e.timeframe} timeframe shows bullish technical evidence (score ${e.score.toFixed(0)}/100 over ${e.candleCount} candles), driven mainly by ${i.join(", ")}. Suggested plan: enter near ${Pt(t.entry)}, stop loss at ${Pt(t.stopLoss)} (${n.atrStopMultiple}× ATR below entry), take profit at ${Pt(t.takeProfit)} (${n.atrTargetMultiple}× ATR above), risk/reward ${t.riskReward.toFixed(1)}.`+a+` Confidence ${s.toFixed(0)}/${bt} reflects the strength of current evidence only — it is not a guarantee, and any position should be sized so its loss at the stop is acceptable.`}function Pt(e){const t=Math.abs(e);return t>=1e3?e.toFixed(0):t>=1?e.toFixed(2):e.toPrecision(4)}function zo(e){if(!(e.atrStopMultiple>0)||!(e.atrTargetMultiple>0))throw new RangeError("ATR multiples must be positive");if(!(e.minScore>=0))throw new RangeError("minScore must be >= 0");if(!(e.minConfidence>=0))throw new RangeError("minConfidence must be >= 0")}const Ko='<svg class="scan-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',Dn='<svg class="warn-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v6"/><path d="M12 16.5h.01"/></svg>',Yo=["15m","1h","4h","1d"],Ns=12,Jo=150;function Qo(){const e=new ft,t=new Jt(e);return{portfolio:{equity:t.equity({}),openPositions:t.positions().map(s=>({symbol:s.symbol,quantity:s.quantity,entryPrice:s.avgCost}))},dailyLossSoFar:new Ln(e).lossToday(Date.now())}}function Zo(e,t){e.innerHTML=`
    <h2 class="view-title">Market Scan</h2>
    <p class="view-sub">
      Scores each market from −100 (strong bearish evidence) to +100 (strong bullish
      evidence) using trend, momentum, MACD, stochastic and volume. Click a row for the
      full breakdown.
    </p>
    <div class="controls">
      <label class="control">Timeframe
        <select id="scan-timeframe">
          ${Yo.map(o=>`<option value="${o}" ${o==="1h"?"selected":""}>${o}</option>`).join("")}
        </select>
      </label>
      <button class="primary" id="scan-run">Run scan</button>
    </div>
    <div class="status-line" id="scan-status"></div>
    <div id="scan-results"><div class="empty">Run a scan to score markets from −100 to +100.</div></div>
    <p class="disclaimer">
      Scores measure current technical evidence only. They are not predictions and not
      financial advice.
    </p>
  `;const s=e.querySelector("#scan-run"),n=e.querySelector("#scan-timeframe"),i=e.querySelector("#scan-status"),a=e.querySelector("#scan-results");s.addEventListener("click",async()=>{s.disabled=!0;const o=n.value;i.textContent=`Scanning ${Math.min(t.instruments.length,Ns)} markets on ${o} · source: ${t.source.name}…`,a.innerHTML=Ie(4);try{const r=t.instruments.slice(0,Ns).map(c=>c.symbol),d=await Cn(t.source,r,o,Jo);i.textContent=`Scanned ${d.results.length} markets on ${o} · source: ${t.source.name}`,a.innerHTML="",er(a,d,Qo())}catch(r){i.textContent="",a.innerHTML=`<p class="error-line">Scan failed: ${$(String(r))}</p>`}finally{s.disabled=!1}})}function er(e,t,s){if(t.results.length===0){e.innerHTML='<p class="error-line">No markets could be scanned.</p>',Os(e,t);return}const n=document.createElement("table");n.className="data-table",n.innerHTML=`
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
  `;const i=document.createElement("tbody");for(const r of t.results){const d=document.createElement("tr");d.className="scan-row",d.setAttribute("aria-expanded","false"),d.tabIndex=0,d.setAttribute("role","button");const c=r.score>0?"up":r.score<0?"down":"",l=Math.min(50,Math.round(Math.abs(r.score)/2));d.innerHTML=`
      <td class="scan-market-cell">${$(r.symbol)}${Ko}</td>
      <td>${O(r.snapshot.price)}</td>
      <td class="${fe(r.snapshot.changePct)}">${V(r.snapshot.changePct)}</td>
      <td>${He(r.snapshot.rsi)}</td>
      <td>${He(r.snapshot.adx)}</td>
      <td>${r.snapshot.relativeVolume===null?"—":`${r.snapshot.relativeVolume.toFixed(2)}×`}</td>
      <td class="scan-score">
        <span class="${fe(r.score)}">${r.score.toFixed(0)}</span>
        <span class="score-bar"><span class="score-bar-fill ${c}" style="width:${l}%"></span></span>
      </td>
      <td>${sr(r)}</td>
    `;const u=nr(r,s);u.hidden=!0;const h=()=>{u.hidden=!u.hidden,d.classList.toggle("expanded",!u.hidden),d.setAttribute("aria-expanded",String(!u.hidden))};d.addEventListener("click",h),d.addEventListener("keydown",m=>{(m.key==="Enter"||m.key===" ")&&(m.preventDefault(),h())}),i.appendChild(d),i.appendChild(u)}n.appendChild(i);const a=document.createElement("div");a.className="table-scroll",a.appendChild(n);const o=document.createElement("div");o.className="table-scroll-fade",o.appendChild(a),e.appendChild(o),Os(e,t),tr(o)}function tr(e){const t=e.querySelector(".table-scroll");if(!t)return;const s=()=>{e.classList.toggle("is-scrollable",t.scrollWidth>t.clientWidth+1),e.classList.toggle("is-scrolled-end",t.scrollLeft+t.clientWidth>=t.scrollWidth-1)};s(),t.addEventListener("scroll",s,{passive:!0})}function sr(e){const t={hot:"HOT",cold:"COLD",neutral:"NEUTRAL"};return`<span class="badge badge-${e.temperature}">${t[e.temperature]}</span>`}function nr(e,t){const s=document.createElement("tr");s.className="scan-detail";const n=e.components.map(o=>{const r=Math.abs(o.contribution)<.05?0:o.contribution;return`
        <div class="scan-component">
          <div class="label">${$(o.label)}</div>
          <div class="detail">${$(o.detail)}</div>
          <div class="contribution ${fe(r)}">
            ${r>0?"+":""}${r.toFixed(1)} pts
          </div>
        </div>`}).join(""),i=e.warnings.length>0?`<ul class="scan-warnings">${e.warnings.map(o=>`<li>${Dn}${$(o)}</li>`).join("")}</ul>`:"",a=e.snapshot;return s.innerHTML=`
    <td colspan="8">
      <div class="scan-detail-grid">${n}</div>
      ${i}
      <p class="status-line scan-detail-stats">
        ATR ${He(a.atrPct,2)}% · Bollinger %B ${He(a.percentB,2)} ·
        bandwidth ${a.bollingerBandwidth===null?"—":(a.bollingerBandwidth*100).toFixed(1)+"%"} ·
        +DI ${He(a.plusDi)} / −DI ${He(a.minusDi)} ·
        Stoch %D ${He(a.stochasticD)} ·
        based on ${e.candleCount} candles (${e.timeframe})
      </p>
      ${ar(qn(e),t)}
    </td>
  `,s}function ar(e,t){if(e.kind==="rejected")return`
      <div class="signal-panel signal-rejected">
        <div class="signal-title">Signal Engine: no qualifying setup</div>
        ${e.reasons.length>0?`<ul>${e.reasons.map(i=>`<li>${$(i)}</li>`).join("")}</ul>`:""}
      </div>
    `;const s=e.opportunity;return`
    <div class="signal-panel signal-opportunity">
      <div class="signal-title">
        Signal Engine: LONG setup · confidence ${s.confidence.toFixed(0)}/${bt}
      </div>
      <div class="signal-levels">
        <span>Entry ≈ ${O(s.levels.entry)}</span>
        <span>Stop loss ${O(s.levels.stopLoss)}</span>
        <span>Take profit ${O(s.levels.takeProfit)}</span>
        <span>R/R ${s.levels.riskReward.toFixed(1)}</span>
      </div>
      <p class="signal-explanation">${$(s.explanation)}</p>
    </div>
    ${ir(e,t)}
  `}function ir(e,t){const s=Pn(e.opportunity,t.portfolio,{dailyLossSoFar:t.dailyLossSoFar}),n=`<ul>${s.reasons.map(a=>`<li>${$(a)}</li>`).join("")}</ul>`;if(!s.approved)return`
      <div class="risk-panel risk-refused">
        <div class="signal-title">Risk Engine: trade refused to protect the portfolio</div>
        ${n}
      </div>
    `;const i=s.warnings.length>0?`<ul class="scan-warnings">${s.warnings.map(a=>`<li>${Dn}${$(a)}</li>`).join("")}</ul>`:"";return`
    <div class="risk-panel risk-approved">
      <div class="signal-title">Risk Engine: approved for the current paper portfolio</div>
      <div class="signal-levels">
        <span>Size ${s.positionSize.toLocaleString("en-US",{maximumFractionDigits:6})} units</span>
        <span>Value ${O(s.positionValue)}</span>
        <span>Risk ${O(s.riskAmount)} (${s.riskPercentage.toFixed(2)}%)</span>
        <span>R/R ${s.rewardRiskRatio.toFixed(1)}</span>
        <span>Portfolio exposure after: ${s.portfolioExposure.toFixed(1)}%</span>
      </div>
      ${n}
      ${i}
    </div>
  `}function Os(e,t){if(t.failures.length===0)return;const s=document.createElement("div");s.className="scan-failures",s.innerHTML=`
    <strong>Not scanned (${t.failures.length}):</strong>
    ${t.failures.map(n=>`${$(n.symbol)} — ${$(n.reason)}`).join("; ")}
  `,e.appendChild(s)}const Bs="alerts",_s=200;class or{constructor(t,s,n){J(this,"state");if(this.store=t,this.channels=s,this.options=n,!(n.cooldownMs>0))throw new RangeError(`cooldownMs must be > 0, got ${n.cooldownMs}`);this.state=t.get(Bs)??{history:[],lastAlertAt:{}}}async notify(t,s){const n=`${t.symbol}:${t.timeframe}`,i=this.state.lastAlertAt[n];if(i!==void 0&&s-i<this.options.cooldownMs){const o=this.options.cooldownMs-(s-i);return{sent:!1,reason:`cooldown: ${t.symbol} was alerted ${Math.round((s-i)/6e4)}m ago (${Math.round(o/6e4)}m remaining)`}}const a={id:`${n}:${s}`,createdAt:s,symbol:t.symbol,timeframe:t.timeframe,confidence:t.confidence,title:`Qualified opportunity: ${t.symbol}`,message:`${t.symbol} (${t.timeframe}) qualified at confidence ${t.confidence.toFixed(0)} near ${t.price}. `+t.explanation};for(const o of this.channels)try{await o.deliver(a)}catch{}return this.state.lastAlertAt[n]=s,this.state.history.push(a),this.state.history.length>_s&&(this.state.history=this.state.history.slice(-_s)),this.persist(),{sent:!0}}history(){return this.state.history}persist(){this.store.set(Bs,this.state)}}const rr=8,lr=30,cr=(e,t,s)=>Math.min(s,Math.max(t,e));function dr(e,t){if(e.kind==="rejected")return e;const s=e.opportunity;if(t===null)return{kind:"opportunity",opportunity:{...s,warnings:[...s.warnings,"higher timeframe unavailable — this setup is unconfirmed by the larger trend"]}};if(t.temperature==="cold")return{kind:"rejected",symbol:s.symbol,timeframe:s.timeframe,reasons:[`higher timeframe (${t.timeframe}) shows bearish evidence (score ${t.score.toFixed(0)}) — a long against the larger trend is refused`]};if(t.score>=lr){const n=cr(s.confidence+rr,0,bt);return{kind:"opportunity",opportunity:{...s,confidence:n,confidenceComponents:[...s.confidenceComponents,{label:`Higher timeframe confirmation (${t.timeframe})`,detail:`score ${t.score.toFixed(0)} on the ${t.timeframe} chart`,effect:n-s.confidence}],explanation:s.explanation+` The larger ${t.timeframe} trend confirms this setup (score ${t.score.toFixed(0)}).`}}}return{kind:"opportunity",opportunity:{...s,warnings:[...s.warnings,`higher timeframe (${t.timeframe}) is neutral (score ${t.score.toFixed(0)}) — no confirmation from the larger trend`]}}}const ur={"5m":3e5,"15m":9e5,"30m":18e5,"1h":36e5,"4h":144e5,"1d":864e5};class pr{constructor(){J(this,"handle",null);J(this,"activeIntervalMs",null)}start(t,s){if(!(t>0))throw new RangeError(`intervalMs must be > 0, got ${t}`);this.stop(),this.activeIntervalMs=t,this.handle=setInterval(()=>{s()},t)}stop(){this.handle!==null&&clearInterval(this.handle),this.handle=null,this.activeIntervalMs=null}isRunning(){return this.handle!==null}intervalMs(){return this.activeIntervalMs}}const Rt=150;class hr{constructor(t){J(this,"clock");J(this,"interval",null);J(this,"lastScanAt",null);J(this,"lastResult",null);J(this,"previouslyQualified",new Set);J(this,"inFlightScan",null);this.options=t,this.clock=t.clock??(()=>Date.now())}start(t){this.interval=t,this.options.scheduler.start(ur[t],async()=>{await this.runScanOnce(this.clock())})}stop(){this.options.scheduler.stop(),this.interval=null}status(){const t=this.options.scheduler.isRunning(),s=this.options.scheduler.intervalMs();return{running:t,interval:t?this.interval:null,lastScanAt:this.lastScanAt,nextScanAt:t&&this.lastScanAt!==null&&s!==null?this.lastScanAt+s:null,lastResult:this.lastResult}}watchlistEntries(){return this.options.watchlist.entries()}opportunityHistory(){return this.options.log.entries()}alertHistory(){return this.options.alerts.history()}async higherTimeframeScan(t){const s=this.options.confirmationTimeframe;if(!s)return null;const n=await this.options.source.getCandles(t,s,Rt);if(!n.ok)return null;const i=Mn(t,s,n.value);return i.ok?i.value:null}async runScanOnce(t){if(this.inFlightScan)return this.inFlightScan;const s=this.runScanOnceExclusive(t);this.inFlightScan=s;try{return await s}finally{this.inFlightScan=null}}async runScanOnceExclusive(t){const{source:s,symbols:n,timeframe:i}=this.options,a=await Cn(s,n,i,Rt),o=this.options.getPortfolio(),r=this.options.getDailyLoss(),d=[],c=new Set;for(const u of a.results){let h=qn(u);if(h.kind==="opportunity"&&this.options.confirmationTimeframe&&(h=dr(h,await this.higherTimeframeScan(u.symbol))),h.kind==="rejected"){const y=u.temperature==="hot"?"watch":"none";d.push({symbol:u.symbol,outcome:y,reasons:h.reasons}),this.options.watchlist.recordScanOutcome(u.symbol,{timestamp:t,status:y});continue}const m=Pn(h.opportunity,o,{dailyLossSoFar:r});if(!m.approved){d.push({symbol:u.symbol,outcome:"watch",reasons:m.reasons}),this.options.watchlist.recordScanOutcome(u.symbol,{timestamp:t,status:"watch",confidence:h.opportunity.confidence});continue}const p=await s.getCandles(u.symbol,i,Rt),v=p.ok?this.options.validator(u.symbol,i,p.value):"not-run",f={symbol:u.symbol,timeframe:i,detectedAt:t,price:u.snapshot.price,confidence:h.opportunity.confidence,entry:m.entry,stopLoss:m.stopLoss,takeProfit:m.takeProfit,positionSize:m.positionSize,positionValue:m.positionValue,riskAmount:m.riskAmount,riskPct:m.riskPercentage,explanation:h.opportunity.explanation,validationVerdict:v,warnings:[...h.opportunity.warnings,...m.warnings]};c.add(u.symbol),d.push({symbol:u.symbol,outcome:"qualified",opportunity:f,reasons:m.reasons}),this.options.log.append({id:`${f.symbol}:${i}:${t}`,detectedAt:t,symbol:f.symbol,timeframe:i,price:f.price,confidence:f.confidence,entry:f.entry,stopLoss:f.stopLoss,takeProfit:f.takeProfit,positionSize:f.positionSize,riskPct:f.riskPct,explanation:f.explanation,validationVerdict:v,snapshot:{rsi:u.snapshot.rsi,adx:u.snapshot.adx,atrPct:u.snapshot.atrPct,relativeVolume:u.snapshot.relativeVolume},disappearedAt:null}),this.options.watchlist.recordScanOutcome(u.symbol,{timestamp:t,status:"qualified",confidence:f.confidence}),await this.options.alerts.notify({symbol:f.symbol,timeframe:i,confidence:f.confidence,price:f.price,explanation:f.explanation},t)}for(const u of this.previouslyQualified)c.has(u)||this.options.log.markDisappeared(u,i,t);this.previouslyQualified=c;const l={timestamp:t,timeframe:i,outcomes:d,failures:a.failures};return this.lastScanAt=t,this.lastResult=l,l}}const Vs="opportunity-log";class mr{constructor(t){J(this,"records");this.store=t,this.records=t.get(Vs)??[]}append(t){if(this.records.some(s=>s.id===t.id))throw new Error(`opportunity record '${t.id}' already exists — history is append-only`);this.records.push(t),this.persist()}markDisappeared(t,s,n){for(let i=this.records.length-1;i>=0;i--){const a=this.records[i];if(a.symbol===t&&a.timeframe===s)return a.disappearedAt!==null?!1:(this.records[i]={...a,disappearedAt:n},this.persist(),!0)}return!1}entries(){return this.records}persist(){this.store.set(Vs,this.records)}}const Mt=20,js=3,Gs=.5,Ws=90,vr=10;function Fn(e){const t=[];e.totalTestTrades<Mt&&t.push({kind:"small-sample",detail:`only ${e.totalTestTrades} out-of-sample trades (minimum ${Mt}) — results this small are dominated by luck, not edge`}),e.foldCount<js&&t.push({kind:"small-sample",detail:`only ${e.foldCount} walk-forward folds (minimum ${js}) — not enough distinct market periods`});const s=e.avgTrainReturnPct>0;if(s&&e.avgTestReturnPct<=0?t.push({kind:"curve-fitting",detail:`in-sample return ${e.avgTrainReturnPct.toFixed(1)}% became ${e.avgTestReturnPct.toFixed(1)}% on unseen data — the strategy fit the training history, not the market`}):s&&e.avgTestReturnPct<e.avgTrainReturnPct*Gs&&t.push({kind:"degradation",detail:`out-of-sample return ${e.avgTestReturnPct.toFixed(1)}% keeps less than ${(Gs*100).toFixed(0)}% of the in-sample ${e.avgTrainReturnPct.toFixed(1)}% — expect live results closer to the lower number`}),e.avgTrainSharpe!==null&&e.avgTestSharpe!==null&&e.avgTrainSharpe>1&&e.avgTestSharpe<=0&&t.push({kind:"curve-fitting",detail:`risk-adjusted quality collapsed: Sharpe ${e.avgTrainSharpe.toFixed(2)} in training vs ${e.avgTestSharpe.toFixed(2)} on unseen data`}),e.parameterSpread){const{chosenReturnPct:i,medianReturnPct:a}=e.parameterSpread;i-a>vr&&t.push({kind:"parameter-sensitivity",detail:`the chosen parameters returned ${i.toFixed(1)}% while the median candidate returned ${a.toFixed(1)}% — performance depends heavily on one lucky setting, a hallmark of curve fitting`})}e.avgTestWinRatePct!==null&&e.avgTestWinRatePct>Ws&&e.totalTestTrades>=Mt&&t.push({kind:"unrealistic-win-rate",detail:`${e.avgTestWinRatePct.toFixed(0)}% win rate is above the ${Ws}% plausibility ceiling — usually a sign of look-ahead bias, survivorship, or tiny targets hiding rare large losses`});const n=yr(t);return{flags:t,verdict:n,explanation:fr(n,t,e)}}function yr(e){if(e.some(s=>s.kind==="small-sample"))return"insufficient-data";if(e.some(s=>s.kind==="curve-fitting"))return"overfitted";const t=e.length;return t>=2||t===1?"caution":"robust"}function fr(e,t,s){const n=`Across ${s.foldCount} walk-forward folds the strategy averaged ${s.avgTrainReturnPct.toFixed(1)}% in training and ${s.avgTestReturnPct.toFixed(1)}% on unseen data over ${s.totalTestTrades} out-of-sample trades.`;switch(e){case"robust":return`${n} No robustness checks were triggered. This raises confidence that the edge is real, but past performance on any data never guarantees future results.`;case"caution":return`${n} ${t.length} check(s) were triggered — treat the in-sample numbers with scepticism and prefer the out-of-sample figures.`;case"overfitted":return`${n} The pattern matches curve fitting: performance found in training did not exist on unseen data. This configuration should not be trusted.`;case"insufficient-data":return`${n} There is not enough out-of-sample evidence to judge this strategy either way — more data or a longer test period is needed before drawing any conclusion.`}}const br=365*864e5;function gr(e){return br/mt[e]}function wr(e,t){if(e.length<2)return null;const s=[];for(let o=1;o<e.length;o++){const r=e[o-1].equity;if(r<=0)return null;s.push(e[o].equity/r-1)}const n=s.reduce((o,r)=>o+r,0)/s.length,i=s.reduce((o,r)=>o+(r-n)**2,0)/s.length,a=Math.sqrt(i);return a===0?null:n/a*Math.sqrt(t)}function $r(e){const t=e.filter(a=>a.pnl>0).reduce((a,o)=>a+o.pnl,0),s=-e.filter(a=>a.pnl<0).reduce((a,o)=>a+o.pnl,0),n=e.length>0?e.reduce((a,o)=>a+o.pnl,0)/e.length:null,i=e.length>0?e.reduce((a,o)=>a+(o.exitTimestamp-o.entryTimestamp),0)/e.length:null;return{profitFactor:e.length>0&&s>0?t/s:null,expectancy:n,avgTradePnl:n,avgHoldingTimeMs:i,grossProfit:t,grossLoss:s}}function Xs(e,t){const s=e.closedTrades,n=$r(s);return{totalReturnPct:e.totalReturnPct,maxDrawdownPct:e.maxDrawdownPct,tradeCount:s.length,winRatePct:e.stats.winRatePct,profitFactor:n.profitFactor,expectancy:n.expectancy,avgTradePnl:n.avgTradePnl,avgHoldingTimeMs:n.avgHoldingTimeMs,sharpe:wr(e.equityCurve,gr(t)),feesPaid:e.feesPaid}}function Hn(e,t){if(e.length===0)throw new RangeError("optimisation grid must not be empty");return{name:`Trend (walk-forward optimised, ${e.length} candidates)`,train(s){const n=e.map(a=>{const o=it(s,jt(a),t);return{params:`SMA ${a.fastPeriod}/${a.slowPeriod}`,returnPct:o.totalReturnPct,options:a}}),i=n.reduce((a,o)=>o.returnPct>a.returnPct?o:a);return{strategy:jt(i.options),diagnostics:{evaluated:n.map(({params:a,returnPct:o})=>({params:a,returnPct:o})),chosen:i.params}}}}}function In(e,t,s){var d;const{trainSize:n,testSize:i}=s;if(!Number.isInteger(n)||n<2)throw new RangeError(`trainSize must be an integer >= 2, got ${n}`);if(!Number.isInteger(i)||i<2)throw new RangeError(`testSize must be an integer >= 2, got ${i}`);if(e.length<n+i)throw new RangeError(`need at least ${n+i} candles for one fold, got ${e.length}`);const a=[],o=[];let r=1;for(let c=0;c+n+i<=e.length;c+=i){const l={start:c,end:c+n},u={start:l.end,end:l.end+i},h=e.slice(l.start,l.end),m=e.slice(u.start,u.end),p=t.train(h),v=it(h,p.strategy,s.backtest),f=it(m,p.strategy,s.backtest),y=s.backtest.initialCash,b=r*100/y;for(const w of f.equityCurve)o.push({timestamp:w.timestamp,equity:w.equity*b});r*=f.finalEquity/y,a.push({foldIndex:a.length,trainRange:l,testRange:u,chosenParams:(d=p.diagnostics)==null?void 0:d.chosen,diagnostics:p.diagnostics,train:Xs(v,s.timeframe),test:Xs(f,s.timeframe)})}return{strategyName:t.name,timeframe:s.timeframe,folds:a,aggregate:Sr(a),oosEquityCurve:o}}function Ze(e){return e.length===0?null:e.reduce((t,s)=>t+s,0)/e.length}function Sr(e){const t=Ze(e.map(n=>n.train.totalReturnPct))??0,s=Ze(e.map(n=>n.test.totalReturnPct))??0;return{avgTrainReturnPct:t,avgTestReturnPct:s,avgTrainSharpe:Ze(e.map(n=>n.train.sharpe).filter(n=>n!==null)),avgTestSharpe:Ze(e.map(n=>n.test.sharpe).filter(n=>n!==null)),avgTestWinRatePct:Ze(e.map(n=>n.test.winRatePct).filter(n=>n!==null)),degradationPct:t>0?(1-s/t)*100:null,totalTestTrades:e.reduce((n,i)=>n+i.test.tradeCount,0)}}const zs=75,Ks=25,kr=[{fastPeriod:5,slowPeriod:20},{fastPeriod:10,slowPeriod:30}];function xr(e){const t=new Map;return(s,n,i)=>{const a=`${s}:${n}`,o=t.get(a);if(o!==void 0)return o;let r;try{if(i.length<zs+Ks)r="not-run";else{const d=In(i,Hn(kr,e),{trainSize:zs,testSize:Ks,timeframe:n,backtest:e});r=Fn({avgTrainReturnPct:d.aggregate.avgTrainReturnPct,avgTestReturnPct:d.aggregate.avgTestReturnPct,avgTrainSharpe:d.aggregate.avgTrainSharpe,avgTestSharpe:d.aggregate.avgTestSharpe,totalTestTrades:d.aggregate.totalTestTrades,foldCount:d.folds.length,avgTestWinRatePct:d.aggregate.avgTestWinRatePct}).verdict}}catch{r="not-run"}return t.set(a,r),r}}const Ys="watchlist";class Tr{constructor(t){J(this,"bySymbol");this.store=t;const s=t.get(Ys)??[];this.bySymbol=new Map(s.map(n=>[n.symbol,n]))}addManual(t,s){this.bySymbol.has(t)||(this.bySymbol.set(t,{symbol:t,source:"manual",favorite:!1,addedAt:s,firstDetectedAt:null,lastScanAt:null,highestConfidence:null,currentStatus:"none"}),this.persist())}remove(t){this.bySymbol.delete(t)&&this.persist()}toggleFavorite(t){const s=this.bySymbol.get(t);s&&(this.bySymbol.set(t,{...s,favorite:!s.favorite}),this.persist())}recordScanOutcome(t,s){const n=this.bySymbol.get(t),i=s.status!=="none";if(!n&&!i)return;const a=n??{symbol:t,source:"auto",favorite:!1,addedAt:s.timestamp,firstDetectedAt:null,lastScanAt:null,highestConfidence:null,currentStatus:"none"};this.bySymbol.set(t,{...a,lastScanAt:s.timestamp,currentStatus:s.status,firstDetectedAt:a.firstDetectedAt??(i?s.timestamp:null),highestConfidence:s.confidence===void 0?a.highestConfidence:Math.max(a.highestConfidence??-1/0,s.confidence)}),this.persist()}entries(){return[...this.bySymbol.values()].sort((t,s)=>t.favorite!==s.favorite?t.favorite?-1:1:(s.highestConfidence??-1/0)-(t.highestConfidence??-1/0))}persist(){this.store.set(Ys,[...this.bySymbol.values()])}}function Er(e){return{name:"in-app",deliver:t=>e(t)}}function Lr(){return{name:"browser-notification",deliver:e=>{typeof Notification>"u"||Notification.permission==="granted"&&new Notification(e.title,{body:e.message.slice(0,180),tag:e.id})}}}async function Ar(){return typeof Notification>"u"?"unsupported":Notification.permission==="granted"?"granted":Notification.requestPermission()}const Pr=12,Rr=36e5,Mr={initialCash:1e4,feeRate:.001,spreadPct:.001,slippagePct:5e-4},Cr='<svg class="watch-fav-icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';function Un(e){return`verdict-text-${e}`}function qr(e,t){const s=new ft,n=new Tr(s),i=new mr(s),a=[],o=new or(s,[Er(p=>a.push(p)),Lr()],{cooldownMs:Rr}),r=new hr({source:t.source,symbols:t.instruments.slice(0,Pr).map(p=>p.symbol),timeframe:"1h",confirmationTimeframe:"4h",scheduler:new pr,watchlist:n,log:i,alerts:o,getPortfolio:()=>{const p=new Jt(s);return{equity:p.equity({}),openPositions:p.positions().map(v=>({symbol:v.symbol,quantity:v.quantity,entryPrice:v.avgCost}))}},getDailyLoss:()=>new Ln(s).lossToday(Date.now()),validator:xr(Mr)});e.innerHTML=`
    <h2 class="view-title">Monitoring</h2>
    <p class="view-sub">
      Continuous scheduled scans through the verified pipeline: scanner → signal engine →
      risk engine → validation. Analysis only — nothing is ever traded automatically.
    </p>
    <section class="block">
      <div class="controls">
        <label class="control">Interval
          <select id="mon-interval">
            ${["5m","15m","30m","1h","4h","1d"].map(p=>`<option value="${p}" ${p==="15m"?"selected":""}>${p}</option>`).join("")}
          </select>
        </label>
        <button class="primary" id="mon-start">Start monitoring</button>
        <button class="secondary" id="mon-stop">Stop</button>
        <button class="secondary" id="mon-scan-now">Scan now</button>
        <button class="secondary" id="mon-notify-perm">Enable browser notifications</button>
      </div>
      <div class="stat-row" id="mon-status"></div>
    </section>
    <section class="block">
      <div class="block-head"><h2>Current opportunities</h2></div>
      <div id="mon-opportunities"><div class="empty">No scan has run yet.</div></div>
    </section>
    <section class="block">
      <div class="block-head"><h2>Watchlist</h2></div>
      <div class="controls">
        <label class="control">Add symbol
          <select id="mon-watch-symbol">
            ${t.instruments.map(p=>`<option value="${$(p.symbol)}">${$(p.symbol)}</option>`).join("")}
          </select>
        </label>
        <button class="secondary" id="mon-watch-add">Add to watchlist</button>
      </div>
      <div id="mon-watchlist"></div>
    </section>
    <section class="block">
      <div class="block-head"><h2>Opportunity history</h2></div>
      <div id="mon-history"></div>
    </section>
    <section class="block">
      <div class="block-head"><h2>Alert history</h2></div>
      <div id="mon-alerts"></div>
    </section>
    <p class="disclaimer">
      Alerts flag technical evidence for review — they are not trade instructions and not
      financial advice.
    </p>
  `;const d=e.querySelector("#mon-status"),c=e.querySelector("#mon-start"),l=e.querySelector("#mon-stop"),u=e.querySelector("#mon-scan-now");function h(){const p=r.status(),v=p.running;c.disabled=v,l.disabled=!v;const f=p.lastScanAt!==null?new Date(p.lastScanAt).toLocaleString():"No scan yet",y=p.lastResult!==null?(()=>{const w=p.lastResult.outcomes.filter(k=>k.outcome==="qualified").length,T=p.lastResult.outcomes.filter(k=>k.outcome==="watch").length,x=p.lastResult.failures.length;return`<div class="stat-tile"><div class="stat-tile-value"><span class="${w>0?"up":""}">${w}</span> qualified / <span>${T}</span> watch / <span class="${x>0?"down":""}">${x}</span> failed</div><div class="stat-tile-label">Last scan outcome</div></div>`})():"",b=v&&p.nextScanAt!==null?`<div class="stat-tile"><div class="stat-tile-value">${new Date(p.nextScanAt).toLocaleString()}</div><div class="stat-tile-label">Next scan</div></div>`:"";d.innerHTML=`
      <div class="stat-tile"><div class="stat-tile-value ${v?"up":""}">${v?`RUNNING (every ${p.interval})`:"stopped"}</div><div class="stat-tile-label">Status</div></div>
      <div class="stat-tile"><div class="stat-tile-value">${f}</div><div class="stat-tile-label">Last scan</div></div>
      ${b}
      ${y}
    `}function m(){h(),Dr(e.querySelector("#mon-opportunities"),r),Fr(e.querySelector("#mon-watchlist"),r,n,m),Hr(e.querySelector("#mon-history"),r),Ir(e.querySelector("#mon-alerts"),r)}c.addEventListener("click",()=>{const p=e.querySelector("#mon-interval").value;r.start(p),h()}),l.addEventListener("click",()=>{r.stop(),h()}),u.addEventListener("click",()=>{u.disabled=!0,d.textContent="Scanning…",e.querySelector("#mon-opportunities").innerHTML='<div class="empty">Scanning…</div>',r.runScanOnce(Date.now()).then(m).finally(()=>{u.disabled=!1})}),e.querySelector("#mon-notify-perm").addEventListener("click",()=>{Ar().then(p=>{p==="granted"?window.toast.success("Browser notifications enabled."):p==="unsupported"?window.toast.info("This browser does not support notifications."):window.toast.warning("Notifications are blocked — enable them in your browser settings.")})}),e.querySelector("#mon-watch-add").addEventListener("click",()=>{const p=e.querySelector("#mon-watch-symbol").value;n.addManual(p,Date.now()),m()}),m()}function gt(e){const t=e.querySelector(".table-scroll");if(!t)return;const s=()=>{e.classList.toggle("is-scrollable",t.scrollWidth>t.clientWidth+1),e.classList.toggle("is-scrolled-end",t.scrollLeft+t.clientWidth>=t.scrollWidth-1)};s(),t.addEventListener("scroll",s,{passive:!0})}function Dr(e,t){const s=t.status().lastResult;if(!s){e.innerHTML='<div class="empty">No scan has run yet.</div>';return}const n=s.outcomes.filter(a=>a.outcome==="qualified"),i=s.outcomes.length===0&&s.failures.length>0;n.length===0?e.innerHTML=i?`<p class="error-line">Scan failed for all ${s.failures.length} monitored markets — check your connection and try "Scan now" again.</p>`:'<div class="empty">No qualified opportunities in the last scan — refusing weak setups is the system protecting capital.</div>':(e.innerHTML=`
    <div class="table-scroll-fade">
    <div class="table-scroll">
    <table class="data-table">
      <thead><tr>
        <th>Market</th><th>Price</th><th>Confidence</th><th>Entry</th><th>Stop</th>
        <th>Target</th><th>Size</th><th>Risk %</th><th>Validation</th>
      </tr></thead>
      <tbody>
        ${n.map(({opportunity:a})=>`<tr title="${$(a.explanation)}">
            <td>${$(a.symbol)}</td>
            <td>${O(a.price)}</td>
            <td class="${fe(a.confidence)}">${a.confidence.toFixed(0)}</td>
            <td>${O(a.entry)}</td>
            <td>${O(a.stopLoss)}</td>
            <td>${O(a.takeProfit)}</td>
            <td>${a.positionSize.toLocaleString("en-US",{maximumFractionDigits:6})}</td>
            <td>${a.riskPct.toFixed(2)}%</td>
            <td class="${Un(a.validationVerdict)}">${$(a.validationVerdict)}</td>
          </tr>`).join("")}
      </tbody>
    </table>
    </div>
    </div>
  `,gt(e.querySelector(".table-scroll-fade"))),s.failures.length>0&&!i&&e.insertAdjacentHTML("beforeend",`<div class="scan-failures"><strong>Not scanned (${s.failures.length}):</strong> ${s.failures.map(a=>`${$(a.symbol)} — ${$(a.reason)}`).join("; ")}</div>`)}function Fr(e,t,s,n){const i=t.watchlistEntries();if(i.length===0){e.innerHTML='<div class="empty">Watchlist is empty.</div>';return}e.innerHTML=`
    <div class="table-scroll-fade">
    <div class="table-scroll">
    <table class="data-table">
      <thead><tr>
        <th>Market</th><th>Source</th><th>Status</th><th>Best confidence</th>
        <th>First detected</th><th>Last scan</th><th></th>
      </tr></thead>
      <tbody>
        ${i.map(a=>{const o=a.currentStatus==="qualified"?"positive":a.currentStatus==="none"?"watch-status-none":"";return`<tr>
              <td>${a.favorite?Cr:""}${$(a.symbol)}</td>
              <td>${a.source}</td>
              <td class="${o}">${a.currentStatus}</td>
              <td class="${fe(a.highestConfidence)}">${a.highestConfidence===null?"—":a.highestConfidence.toFixed(0)}</td>
              <td>${a.firstDetectedAt===null?"—":new Date(a.firstDetectedAt).toLocaleString()}</td>
              <td>${a.lastScanAt===null?"—":new Date(a.lastScanAt).toLocaleString()}</td>
              <td>
                <button class="secondary table-action" data-fav="${$(a.symbol)}">${a.favorite?"Unfavourite":"Favourite"}</button>
                <button class="secondary table-action" data-del="${$(a.symbol)}">Remove</button>
              </td>
            </tr>`}).join("")}
      </tbody>
    </table>
    </div>
    </div>
  `,gt(e.querySelector(".table-scroll-fade")),e.querySelectorAll("[data-fav]").forEach(a=>a.addEventListener("click",()=>{s.toggleFavorite(a.dataset.fav),n()})),e.querySelectorAll("[data-del]").forEach(a=>a.addEventListener("click",()=>{s.remove(a.dataset.del),n()}))}function Hr(e,t){const s=[...t.opportunityHistory()].reverse().slice(0,25);if(s.length===0){e.innerHTML='<div class="empty">No opportunities recorded yet.</div>';return}e.innerHTML=`
    <div class="table-scroll-fade">
    <div class="table-scroll">
    <table class="data-table">
      <thead><tr>
        <th>Detected</th><th>Market</th><th>Confidence</th><th>Entry</th>
        <th>RSI</th><th>ADX</th><th>Validation</th><th>Status</th>
      </tr></thead>
      <tbody>
        ${s.map(n=>`<tr>
              <td>${new Date(n.detectedAt).toLocaleString()}</td>
              <td>${$(n.symbol)}</td>
              <td class="${fe(n.confidence)}">${n.confidence.toFixed(0)}</td>
              <td>${O(n.entry)}</td>
              <td>${He(n.snapshot.rsi)}</td>
              <td>${He(n.snapshot.adx)}</td>
              <td class="${Un(n.validationVerdict)}">${$(n.validationVerdict)}</td>
              <td class="${n.disappearedAt===null?"positive":""}">${n.disappearedAt===null?"active":`gone ${new Date(n.disappearedAt).toLocaleString()}`}</td>
            </tr>`).join("")}
      </tbody>
    </table>
    </div>
    </div>
  `,gt(e.querySelector(".table-scroll-fade"))}function Ir(e,t){const s=[...t.alertHistory()].reverse().slice(0,25);if(s.length===0){e.innerHTML='<div class="empty">No alerts yet.</div>';return}e.innerHTML=`
    <div class="table-scroll-fade">
    <div class="table-scroll">
    <table class="data-table">
      <thead><tr><th>Time</th><th>Market</th><th>Confidence</th><th>Message</th></tr></thead>
      <tbody>
        ${s.map(n=>`<tr>
              <td>${new Date(n.createdAt).toLocaleString()}</td>
              <td>${$(n.symbol)}</td>
              <td class="${fe(n.confidence)}">${n.confidence.toFixed(0)}</td>
              <td>${$(Ma(n.message,140))}</td>
            </tr>`).join("")}
      </tbody>
    </table>
    </div>
    </div>
  `,gt(e.querySelector(".table-scroll-fade"))}const st=1e4;function Nn(e,t){const s=e.instruments.find(n=>n.symbol===t);return((s==null?void 0:s.base)??t.replace(/EUR$|USD$/,"")).toUpperCase()}function Ue(e){return e<0?`-€${O(-e)}`:`€${O(e)}`}function nt(e){return Math.abs(e)<.005?"":e>0?"up":"down"}function Ur(e,t){const s=new Jt(new ft,st);e.innerHTML=`
    <h2 class="view-title">Paper Portfolio</h2>
    <p class="view-sub">Simulated trading with virtual money — practice without risk. Nothing here touches a real account.</p>

    <!-- hero-bare matches Home's balance treatment: this equity figure is
         THE dominant element of this screen (same as Home's balance is
         Home's), so it gets the same bare, un-boxed, giant-scale treatment
         rather than sitting in a bordered card like a secondary widget. -->
    <section class="hero hero-bare" id="pp-hero">
      <div class="hero-label">Equity <span class="tag-sim">SIMULATED</span></div>
      <div class="hero-value" id="pp-equity">—</div>
      <div class="hero-change" id="pp-change"></div>
      <div class="hero-split">
        <span id="pp-cash"></span>
        <span id="pp-realized"></span>
        <span id="pp-unrealized"></span>
      </div>
    </section>

    <section class="block">
      <div class="block-head"><h2>Trade</h2></div>
      <!-- Inputs and actions as two visually separate rows — cramming a
           select, a quantity field and three unrelated-weight buttons into
           one flex row (the original layout) is exactly the cramped,
           un-stepped-back density the reference never has. -->
      <div class="controls">
        <label class="control">Market
          <select id="pp-symbol">
            ${t.instruments.map(l=>`<option value="${$(l.symbol)}">${$(l.symbol)}</option>`).join("")}
          </select>
        </label>
        <label class="control">Quantity
          <input id="pp-quantity" type="number" value="0.1" min="0" step="any" />
        </label>
      </div>
      <!-- Buy/Sell get the reference's own semantic tint pair (green/red),
           not two identical black-on-white pills — Reset is deliberately a
           quieter, lower-emphasis action set apart from the two real trade
           actions. That intent was already the comment here, but all three
           sat in one plain flex row: at phone width "Buy at market"/"Sell at
           market" (~165px each) don't fit side by side, so .controls' own
           flex-wrap stacked all three full pills one below the other —
           confirmed via a real layout measurement, not just reading the
           CSS. .trade-actions makes Buy/Sell split the row evenly (an
           actual paired control, matching the reference), with Reset
           dropped to its own row beneath so it reads as the separate,
           quieter action the comment always intended. -->
      <div class="controls trade-actions">
        <button class="btn-buy" id="pp-buy">Buy at market</button>
        <button class="btn-sell" id="pp-sell">Sell at market</button>
      </div>
      <div class="controls">
        <button class="secondary" id="pp-reset">Reset portfolio</button>
      </div>
      <div class="status-line" id="pp-status"></div>
    </section>

    <section class="block">
      <div class="block-head"><h2>Positions</h2></div>
      <div class="stack stack-card" id="pp-positions">${Ie(2)}</div>
    </section>

    <section class="block">
      <div class="block-head"><h2>Trade journal</h2></div>
      <div class="stack stack-card" id="pp-trades">${Ie(3)}</div>
    </section>
  `,Ve(e);const n=e.querySelector("#pp-hero"),i=e.querySelector("#pp-status"),a=e.querySelector("#pp-buy"),o=e.querySelector("#pp-sell");async function r(l){const u=await t.source.getCandles(l,"1m",2);if(!u.ok||u.value.length===0){const h=await t.source.getCandles(l,"1h",2);return!h.ok||h.value.length===0?null:h.value[h.value.length-1].close}return u.value[u.value.length-1].close}async function d(){const l={};for(const u of s.positions()){const h=await r(u.symbol);h!==null&&(l[u.symbol]=h)}Nr(n,s,l),Or(e.querySelector("#pp-positions"),s,l,t),Br(e.querySelector("#pp-trades"),s,t)}async function c(l){a.disabled=!0,o.disabled=!0;try{const u=e.querySelector("#pp-symbol").value,h=Number(e.querySelector("#pp-quantity").value);i.textContent=`Fetching ${u} price…`;const m=await r(u);if(m===null){i.innerHTML=`<span class="error-line">No price available for ${$(u)}</span>`;return}const p=l==="buy"?s.buy(u,h,m,Date.now()):s.sell(u,h,m,Date.now());i.innerHTML=p.ok?`${l==="buy"?"Bought":"Sold"} ${h} ${$(u)} @ ${Ue(m)} · source: ${$(t.source.name)}`:`<span class="error-line">${$(p.error)}</span>`,await d()}finally{a.disabled=!1,o.disabled=!1}}a.addEventListener("click",()=>void c("buy")),o.addEventListener("click",()=>void c("sell")),e.querySelector("#pp-reset").addEventListener("click",()=>{window.confirm(`Reset the paper portfolio to ${Ue(st)} and clear the journal?`)&&(s.reset(st),i.textContent="Portfolio reset.",d())}),d()}function Nr(e,t,s){const n=t.equity(s),i=t.unrealizedPnl(s),a=(n-st)/st*100,{major:o,minor:r}=ze(n);e.querySelector("#pp-equity").innerHTML=`<span class="hero-value-currency">€</span><span class="hero-value-major">${o}</span><span class="hero-value-minor">.${r}</span>`;const d=e.querySelector("#pp-change");d.textContent=`${V(a)} all time`;const c=nt(a);d.className=`hero-change ${c}`,e.classList.toggle("up",c==="up"),e.classList.toggle("down",c==="down"),e.querySelector("#pp-cash").innerHTML=`Cash ${ue(Ue(t.cash))}`,e.querySelector("#pp-realized").innerHTML=`Realized <span class="chg ${nt(t.realizedPnl)}">${ue(Ue(t.realizedPnl))}</span>`,e.querySelector("#pp-unrealized").innerHTML=`Unrealized <span class="chg ${nt(i)}">${ue(Ue(i))}</span>`}function Or(e,t,s,n){const i=t.positions();if(i.length===0){e.innerHTML='<div class="empty">Holding cash and waiting for a good setup.</div>';return}e.innerHTML=i.map(a=>{const o=s[a.symbol],r=o===void 0?null:(o-a.avgCost)/a.avgCost*100;return`
        <div class="row">
          <div class="row-main">${Ce(Nn(n,a.symbol))}
            <div><div class="row-title">${$(a.symbol)}</div>
              <div class="row-sub">${a.quantity.toLocaleString("en-US",{maximumFractionDigits:8})} @ ${Ue(a.avgCost)}</div></div></div>
          <div class="row-side"><span class="row-title">${o===void 0?"—":ue(Ue(o))}</span>
            <span class="chg ${nt(r??0)}">${V(r)}</span></div>
        </div>`}).join("")}function Br(e,t,s){const n=[...t.trades].reverse().slice(0,50);if(n.length===0){e.innerHTML='<div class="empty">No trades yet.</div>';return}e.innerHTML=n.map(i=>{const o=i.side==="sell"?`<span class="chg ${nt(i.realizedPnl)}">${Ue(i.realizedPnl)}</span>`:"";return`
        <div class="row trade ${i.side}">
          <div class="row-main">${Ce(Nn(s,i.symbol))}
            <div><div class="row-title"><span class="pill ${i.side}">${i.side.toUpperCase()}</span> ${$(i.symbol)}</div>
              <div class="row-sub">${new Date(i.timestamp).toLocaleString("en-GB",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</div></div></div>
          <div class="row-side"><span class="row-title">${ue(Ue(i.price))}</span>
            <span class="row-sub">${i.quantity.toLocaleString("en-US",{maximumFractionDigits:8})}</span>
            ${o}</div>
        </div>`}).join("")}const _r='<svg class="warn-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v6"/><path d="M12 16.5h.01"/></svg>',Js=600,Qs=150,Zs=75,Vr=1e4,jr=[{fastPeriod:5,slowPeriod:20},{fastPeriod:10,slowPeriod:30},{fastPeriod:10,slowPeriod:50},{fastPeriod:20,slowPeriod:60}];function Gr(e,t){e.innerHTML=`
    <h2 class="view-title">Validation</h2>
    <p class="view-sub">
      Walk-forward analysis: strategy parameters are chosen on a rolling training window,
      then judged on the unseen candles that follow — with fees, spread, and slippage
      included. Out-of-sample numbers are the ones that matter.
    </p>
    <section class="block">
      <div class="block-head"><h2>Configure</h2></div>
      <div class="controls">
        <label class="control">Market
          <select id="val-symbol">
            ${t.instruments.map(a=>`<option value="${$(a.symbol)}">${$(a.symbol)}</option>`).join("")}
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
    </section>
    <div id="val-results"><div class="empty">Configure the walk-forward above and press Run to see results.</div></div>
    <p class="disclaimer">
      Validation measures how a strategy behaved on unseen historical data with realistic
      costs. It cannot predict the future and is not financial advice.
    </p>
  `;const s=e.querySelector("#val-run"),n=e.querySelector("#val-status"),i=e.querySelector("#val-results");s.addEventListener("click",async()=>{s.disabled=!0,i.innerHTML="";const a=e.querySelector("#val-symbol").value,o=e.querySelector("#val-timeframe").value,r=Number(e.querySelector("#val-fee").value)/100,d=Number(e.querySelector("#val-spread").value)/100,c=Number(e.querySelector("#val-slippage").value)/100;n.innerHTML=`<span class="loading-inline"><span class="spinner sm"></span>Loading ${Js} ${o} candles for ${$(a)}…</span>`;try{const l=await t.source.getCandles(a,o,Js);if(!l.ok){n.innerHTML=`<span class="error-line">${$(l.error)}</span>`;return}n.innerHTML=`<span class="loading-inline"><span class="spinner sm"></span>Running walk-forward on ${l.value.length} candles…</span>`;const u={initialCash:Vr,feeRate:r,spreadPct:d,slippagePct:c,executionDelayCandles:1},h=In(l.value,Hn(jr,u),{trainSize:Qs,testSize:Zs,timeframe:o,backtest:u}),m=Fn({avgTrainReturnPct:h.aggregate.avgTrainReturnPct,avgTestReturnPct:h.aggregate.avgTestReturnPct,avgTrainSharpe:h.aggregate.avgTrainSharpe,avgTestSharpe:h.aggregate.avgTestSharpe,totalTestTrades:h.aggregate.totalTestTrades,foldCount:h.folds.length,avgTestWinRatePct:h.aggregate.avgTestWinRatePct,parameterSpread:Wr(h)});n.innerHTML=`<div>${$(a)} · ${h.folds.length} folds (train ${Qs} / test ${Zs}) · source: ${$(t.source.name)}</div><div>costs: ${(r*100).toFixed(2)}% fee, ${(d*100).toFixed(2)}% spread, ${(c*100).toFixed(2)}% slippage, 1-candle delay</div>`,Xr(i,h,m)}catch(l){n.innerHTML=`<span class="error-line">Validation failed: ${$(String(l))}</span>`}finally{s.disabled=!1}})}function Wr(e){const t=e.folds.map(s=>{if(!s.diagnostics)return null;const n=s.diagnostics.evaluated.map(o=>o.returnPct).sort((o,r)=>o-r),i=n[Math.floor(n.length/2)],a=s.diagnostics.evaluated.find(o=>o.params===s.diagnostics.chosen);return a?{chosen:a.returnPct,median:i}:null}).filter(s=>s!==null);if(t.length!==0)return{chosenReturnPct:t.reduce((s,n)=>s+n.chosen,0)/t.length,medianReturnPct:t.reduce((s,n)=>s+n.median,0)/t.length}}function Xr(e,t,s){const n=t.aggregate,i=n.degradationPct===null||n.degradationPct===0?"":n.degradationPct>0?"negative":"positive";e.innerHTML=`
    <div class="verdict-panel verdict-${s.verdict}">
      <div class="signal-title">Verdict: ${Kr(s.verdict)}</div>
      <p>${$(s.explanation)}</p>
      ${s.flags.length>0?`<ul class="scan-warnings">${s.flags.map(a=>`<li>${_r}<strong>${a.kind}</strong>: ${$(a.detail)}</li>`).join("")}</ul>`:""}
    </div>

    <!-- Same fix as gridView.ts/backtestView.ts, same audit: a walk-forward
         backtest with no SIMULATED tag anywhere, inconsistent with every
         account screen in the app. -->
    <div class="block-head"><h2>Out-of-sample equity (all folds, costs included) <span class="tag-sim">SIMULATED</span></h2></div>
    ${Jr(t.oosEquityCurve)}

    <div class="block-head"><h2>Training vs unseen data</h2></div>
    <div class="stat-row">
      <div class="stat-tile"><div class="stat-tile-value ${fe(n.avgTrainReturnPct)}">${V(n.avgTrainReturnPct)}</div>
        <div class="stat-tile-label">Avg return (train)</div></div>
      <div class="stat-tile"><div class="stat-tile-value ${fe(n.avgTestReturnPct)}">${V(n.avgTestReturnPct)}</div>
        <div class="stat-tile-label">Avg return (unseen)</div></div>
      <div class="stat-tile"><div class="stat-tile-value ${i}">${n.degradationPct===null?"—":V(n.degradationPct,0)}</div>
        <div class="stat-tile-label">Degradation</div></div>
      <div class="stat-tile"><div class="stat-tile-value ${fe(n.avgTestSharpe)}">${n.avgTestSharpe===null?"—":n.avgTestSharpe.toFixed(2)}</div>
        <div class="stat-tile-label">Sharpe (unseen)</div></div>
      <div class="stat-tile"><div class="stat-tile-value">${n.avgTestWinRatePct===null?"—":V(n.avgTestWinRatePct,0)}</div>
        <div class="stat-tile-label">Win rate (unseen)</div></div>
      <div class="stat-tile"><div class="stat-tile-value">${n.totalTestTrades}</div>
        <div class="stat-tile-label">OOS trades</div></div>
    </div>

    <div class="block-head"><h2>Per-fold results (${$(t.strategyName)})</h2></div>
    <div class="table-scroll-fade">
    <div class="table-scroll">
    <table class="data-table">
      <thead>
        <tr>
          <th>Fold</th><th>Params</th><th>Train return</th><th>Unseen return</th>
          <th>Unseen trades</th><th>Win rate</th><th>Profit factor</th>
          <th>Expectancy</th><th>Max DD</th><th>Avg hold</th>
        </tr>
      </thead>
      <tbody>
        ${t.folds.map(a=>`<tr>
              <td>${a.foldIndex+1}</td>
              <td>${$(a.chosenParams??"—")}</td>
              <td class="${fe(a.train.totalReturnPct)}">${V(a.train.totalReturnPct)}</td>
              <td class="${fe(a.test.totalReturnPct)}">${V(a.test.totalReturnPct)}</td>
              <td>${a.test.tradeCount}</td>
              <td>${a.test.winRatePct===null?"—":V(a.test.winRatePct,0)}</td>
              <td class="${a.test.profitFactor===null?"":a.test.profitFactor>=1?"positive":"negative"}">${a.test.profitFactor===null?"—":a.test.profitFactor.toFixed(2)}</td>
              <td class="${fe(a.test.expectancy)}">${a.test.expectancy===null?"—":ue(O(a.test.expectancy))}</td>
              <td>${V(-a.test.maxDrawdownPct)}</td>
              <td>${Yr(a.test.avgHoldingTimeMs)}</td>
            </tr>`).join("")}
      </tbody>
    </table>
    </div>
    </div>
  `,zr(e.querySelector(".table-scroll-fade"))}function zr(e){const t=e.querySelector(".table-scroll");if(!t)return;const s=()=>{e.classList.toggle("is-scrollable",t.scrollWidth>t.clientWidth+1),e.classList.toggle("is-scrolled-end",t.scrollLeft+t.clientWidth>=t.scrollWidth-1)};s(),t.addEventListener("scroll",s,{passive:!0})}function Kr(e){return{robust:"ROBUST — no checks triggered",caution:"CAUTION — treat with scepticism",overfitted:"OVERFITTED — do not trust this configuration","insufficient-data":"INSUFFICIENT DATA — no conclusion possible"}[e]}function Yr(e){if(e===null)return"—";const t=e/36e5;return t<48?`${t.toFixed(1)}h`:`${(t/24).toFixed(1)}d`}function Jr(e){if(e.length<2)return'<p class="status-line">Not enough points for a curve.</p>';const t=e[e.length-1].equity;return`${fn(e.map(n=>({timestamp:n.timestamp,value:n.equity})),{lineClass:t>=100?"equity-line-up":"equity-line-down",ariaLabel:`Out-of-sample equity curve from ${e[0].equity.toFixed(1)} to ${t.toFixed(1)}`})}<p class="status-line">Start 100 → end ${t.toFixed(1)} (${V(t-100)})</p>`}const Qr={success:"✓",error:"✕",info:"ⓘ",warning:"⚠"};function rt(e,t="info",s={}){const n=document.getElementById("toast-container");if(!n)return;const i=`toast-${Date.now()}`,a=s.duration??5e3,o=s.icon??Qr[t],r=document.createElement("div");r.className=`toast ${t}`,r.id=i,r.setAttribute("role","alert"),r.innerHTML=`
    <span class="toast-icon">${o}</span>
    <span class="toast-message">${nl(e)}</span>
    <button class="toast-close" aria-label="Close" data-toast-id="${i}">×</button>
  `,n.appendChild(r);const d=r.querySelector(".toast-close");d&&d.addEventListener("click",()=>{r.remove()}),setTimeout(()=>{document.getElementById(i)&&r.remove()},a)}function Zr(e,t){rt(e,"success",{duration:t})}function el(e,t){rt(e,"error",{duration:t})}function tl(e,t){rt(e,"info",{duration:t})}function sl(e,t){rt(e,"warning",{duration:t})}function nl(e){const t={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"};return e.replace(/[&<>"']/g,s=>t[s]??s)}const al={overview:e=>Ba(e),trades:e=>Wa(e),"trade-detail":e=>za(e),strategies:e=>ei(e),system:e=>ti(e),reports:e=>ri(e),crypto:no,stocks:yo,value:fo,markets:xn},il=new Set(["trades","trade-detail","strategies","system","reports"]),ol={scan:Zo,backtest:Fo,validation:Gr,portfolio:Ur,grid:Oo,monitoring:qr,learn:null};function rl(e){const t=document.getElementById("data-source-banner");if(t)if(t.hidden=!1,e.kind==="revolut")t.classList.add("live"),t.textContent=`Connected to ${e.source.name} — live data, read-only.`;else if(e.kind==="public")t.classList.add("live"),t.textContent=`Live market data (${e.source.name.replace(" (read-only)","")}) — read-only.`;else{t.textContent="";const s=document.createElement("span");if(s.textContent="Live data unavailable — showing DEMO data, not real prices.",t.appendChild(s),e.diagnostics.length>0){const n=document.createElement("details");n.className="data-source-banner-details";const i=document.createElement("summary");i.textContent="Why?",n.appendChild(i);const a=document.createElement("div");a.className="data-source-banner-reasons",a.textContent=e.diagnostics.join(" · "),n.appendChild(a),t.appendChild(n)}}}async function ll(){zn(),window.toast={show:rt,success:Zr,error:el,info:tl,warning:sl},window.loading={show:wi,hide:$i,spinner:Si,empty:xi};const e=await Ea();rl(e);const t=new Set,s=new Set,n=new Map;let i=null;function a(l){var m,p;document.querySelectorAll(".view").forEach(v=>{v.classList.toggle("active",v.id===`view-${l}`)});const u=il.has(l)?"overview":l==="value"?"crypto":l;document.querySelectorAll(".nav-btn").forEach(v=>{const f=v.dataset.nav===u;v.classList.toggle("active",f),v.setAttribute("aria-selected",String(f)),v.tabIndex=f?0:-1}),i&&i!==l&&((m=n.get(i))==null||m.pause());const h=al[l];if(h){const v=document.getElementById(`view-${l}`);if(v)if(t.has(l))(p=n.get(l))==null||p.resume();else{const f=h(v,e);f&&n.set(l,f),t.add(l)}}i=l,l==="tools"&&r(),window.scrollTo({top:0})}let o=null;function r(){const l=document.getElementById("tools-menu"),u=document.getElementById("tool-detail");l&&(l.hidden=!1),u&&(u.hidden=!0)}function d(){var h;r();const l=document.getElementById("tools-menu");(h=(o?document.querySelector(`[data-tab="${o}"]`):null)??(l==null?void 0:l.querySelector("[data-tab]")))==null||h.focus()}function c(l){var p;const u=document.getElementById("tools-menu"),h=document.getElementById("tool-detail");u&&(u.hidden=!0),h&&(h.hidden=!1),document.querySelectorAll(".tab-panel").forEach(v=>{v.classList.toggle("active",v.id===`tab-${l}`)});const m=ol[l];if(m&&!s.has(l)){const v=document.getElementById(`tab-${l}`);v&&(m(v,e),s.add(l))}o=l,(p=h==null?void 0:h.querySelector("[data-tool-back]"))==null||p.focus(),window.scrollTo({top:0})}document.addEventListener("click",l=>{const u=l.target,h=u.closest("[data-nav]");if(h){a(h.dataset.nav);return}const m=u.closest("[data-tab]");if(m){c(m.dataset.tab);return}u.closest("[data-tool-back]")&&d()}),document.addEventListener("keydown",l=>{if(l.key!=="Enter"&&l.key!==" ")return;const u=l.target.closest('[role="button"]');u&&(l.preventDefault(),u.click())}),document.addEventListener("keydown",l=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(l.key))return;const u=l.target.closest('[role="tab"]');if(!u)return;const h=u.closest('[role="tablist"]');if(!h)return;const m=Array.from(h.querySelectorAll(':scope > [role="tab"]')),p=m.indexOf(u);if(p===-1)return;let v=p;l.key==="ArrowRight"?v=(p+1)%m.length:l.key==="ArrowLeft"?v=(p-1+m.length)%m.length:l.key==="Home"?v=0:l.key==="End"&&(v=m.length-1),l.preventDefault();const f=m[v];f.focus(),f.click()}),document.documentElement.setAttribute("data-theme","dark"),a("overview"),cl(e)}async function cl(e){const t=document.getElementById("topbar-btc");if(!t)return;const s=qt(e);if(!s)return;t.dataset.nav="markets",t.setAttribute("role","button"),t.tabIndex=0;async function n(){const i=await on(e,s,"Bitcoin");if(!i||!t)return;const a=i.changePct>=0;t.hidden=!1,t.innerHTML=`<span class="tb-label">BTC</span><span class="tb-price">€${O(i.price)}</span><span class="chg ${a?"up":"down"}">${V(i.changePct)}</span>`}await n(),window.setInterval(()=>void n(),2e4)}ll();
//# sourceMappingURL=index-NKjZV46O.js.map
