import json,time,urllib.request,datetime,sys,os
OUT=os.environ.get('HIST_DIR','./research/hourly-3y/data')
COINS=['BTC','ETH','SOL','XRP','ADA','DOGE','LTC','DOT','LINK','AVAX']
end=datetime.datetime(2026,11,4,12,tzinfo=datetime.timezone.utc)
start=datetime.datetime(2023,11,1,tzinfo=datetime.timezone.utc)
step=datetime.timedelta(hours=300)
for c in COINS:
    rows={}; t=start
    while t<end:
        e=min(t+step,end)
        url=f"https://api.exchange.coinbase.com/products/{c}-EUR/candles?granularity=3600&start={t.strftime('%Y-%m-%dT%H:%M:%SZ')}&end={e.strftime('%Y-%m-%dT%H:%M:%SZ')}"
        for attempt in range(5):
            try:
                req=urllib.request.Request(url,headers={'User-Agent':'research-client'})
                data=json.load(urllib.request.urlopen(req,timeout=20)); break
            except Exception as ex:
                time.sleep(1+attempt); data=None
        if data:
            for r in data: rows[r[0]]=r
        t=e; time.sleep(0.12)
    arr=sorted(rows.values())
    json.dump(arr,open(f'{OUT}/{c}.json','w'))
    print(c,len(arr),flush=True)
print('DONE',flush=True)
