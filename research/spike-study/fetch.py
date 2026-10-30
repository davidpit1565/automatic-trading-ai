import json,urllib.request,time,os,sys
def get(u):
    for i in range(4):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'research/1.0'}),timeout=25))
        except Exception as e:
            time.sleep(2+i*2)
    return None
ap=get('https://api.kraken.com/0/public/AssetPairs')['result']
pairs=sorted({v['altname'] for v in ap.values() if v.get('quote') in ('ZEUR','EUR') and v.get('status')=='online' and not v['altname'].startswith(('EUR','USD'))})
print('pairs',len(pairs),flush=True)
ok=0
for p in pairs:
    fn=f'data/{p}.json'
    if os.path.exists(fn): ok+=1; continue
    r=get(f'https://api.kraken.com/0/public/OHLC?pair={p}&interval=1440')
    if r and not r.get('error'):
        k=[x for x in r['result'] if x!='last'][0]
        json.dump(r['result'][k],open(fn,'w')); ok+=1
    time.sleep(0.5)
print('saved',ok,flush=True)
