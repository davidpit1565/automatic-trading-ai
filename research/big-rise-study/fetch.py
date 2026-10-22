import json,urllib.request,time,datetime as d,sys,os
BASES=['BTC','ETH','SOL','XRP','ADA','DOGE','LTC','DOT','LINK','AVAX','ATOM','XLM','BCH','ETC','AAVE','UNI','ALGO','NEAR','FIL','GRT','SAND','MANA','APE','CRV','SNX','COMP','MKR','SUSHI','1INCH','BAT','ENJ','CHZ']
def get(url):
    req=urllib.request.Request(url,headers={'User-Agent':'research/1.0'})
    return json.load(urllib.request.urlopen(req,timeout=25))
start=d.datetime(2018,1,1)
end=d.datetime(2026,10,22)
for b in BASES:
    fn=f'data/cb_{b}.json'
    if os.path.exists(fn): continue
    rows={}
    cur=start
    ok=True
    while cur<end:
        nxt=min(cur+d.timedelta(days=299),end)
        url=f'https://api.exchange.coinbase.com/products/{b}-EUR/candles?granularity=86400&start={cur.isoformat()}&end={nxt.isoformat()}'
        try:
            r=get(url)
        except Exception as e:
            ok=False; print(b,'ERR',str(e)[:80]); break
        for c in r: rows[c[0]]=c
        cur=nxt; time.sleep(0.25)
    if rows:
        json.dump(sorted(rows.values()),open(fn,'w')); print(b,len(rows),d.datetime.utcfromtimestamp(min(rows)).date())
    else: print(b,'none')
fg=get('https://api.alternative.me/fng/?limit=0&format=json')
json.dump(fg['data'],open('data/fng.json','w')); print('fng',len(fg['data']))
