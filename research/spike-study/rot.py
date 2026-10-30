import json,glob,numpy as np,pandas as pd
O={};C={};E={}
for f in glob.glob('data/*.json'):
    p=f.split('/')[-1][:-5]
    a=np.array(json.load(open(f)),dtype=float)
    if len(a)<100: continue
    df=pd.DataFrame(a,columns=['t','o','h','l','c','vw','v','n']).iloc[:-1]
    idx=pd.to_datetime(df.t.astype(int),unit='s')
    O[p]=pd.Series(df.o.values,index=idx); C[p]=pd.Series(df.c.values,index=idx); E[p]=pd.Series((df.v*df.vw).values,index=idx)
O=pd.DataFrame(O).sort_index(); C=pd.DataFrame(C).sort_index(); E=pd.DataFrame(E).sort_index()
liq=E.rolling(20).median().shift(0)
btc=C['XBTEUR']; btc_ok=(btc>btc.rolling(50).mean())
print('days',len(C),C.index.min().date(),C.index.max().date(),'pairs',C.shape[1])
COST=0.003
def run(lb,topn,regime,phase,minliq=50_000):
    mom=C.pct_change(lb)
    dates=C.index[phase::7]
    rets=[];ds=[]
    for i,d in enumerate(dates[:-2]):
        d0=d; d1=C.index[C.index.get_loc(d0)+1] if C.index.get_loc(d0)+1<len(C) else None
        loc=C.index.get_loc(d0)
        if loc+8>=len(C): break
        if regime and not btc_ok.iloc[loc]: rets.append(0.0); ds.append(d0); continue
        m=mom.iloc[loc].where(liq.iloc[loc]>=minliq).dropna()
        m=m[(O.iloc[loc+1].reindex(m.index).notna())&(O.iloc[loc+8].reindex(m.index).notna())]
        if len(m)<topn: rets.append(0.0); ds.append(d0); continue
        pick=m.nlargest(topn).index
        r=(O.iloc[loc+8][pick]/O.iloc[loc+1][pick]-1).clip(lower=-0.9).mean()-2*COST
        rets.append(r); ds.append(d0)
    return pd.Series(rets,index=ds)
def stats(s):
    eq=(1+s).cumprod(); dd=(eq/eq.cummax()-1).min()
    return f'weeks={len(s)} mean={s.mean()*100:5.2f}%/wk win={100*(s>0).mean():4.1f}% total={(eq.iloc[-1]-1)*100:7.1f}% maxDD={dd*100:6.1f}%'
# benchmarks
wk=lambda ph:[btc]
print('BTC buy&hold over window:',round((btc.iloc[-1]/btc.iloc[0]-1)*100,1),'%   equal-weight liquid universe weekly (no costs):',end=' ')
ew=[]
for ph in range(7):
    idxs=C.index[ph::7]
    for k in range(len(idxs)-2):
        loc=C.index.get_loc(idxs[k])
        if loc+8>=len(C): break
        m=(liq.iloc[loc]>=50_000)
        r=(O.iloc[loc+8]/O.iloc[loc+1]-1)[m].clip(lower=-0.9).dropna()
        if len(r): ew.append(r.mean())
print(round(np.mean(ew)*100,2),'%/wk')
for lb in (7,14,30):
    for regime in (False,True):
        for topn in (3,5,10):
            res=[run(lb,topn,regime,ph) for ph in range(7)]
            mean=np.mean([r.mean() for r in res])*100; win=np.mean([(r>0).mean() for r in res])*100
            tot=np.mean([((1+r).prod()-1)*100 for r in res]); dd=np.mean([((1+r).cumprod()/(1+r).cumprod().cummax()-1).min()*100 for r in res])
            print(f'lookback {lb:2d}d  top{topn:2d}  BTC-regime={regime!s:5}  mean={mean:5.2f}%/wk  win={win:4.1f}%  total(avg of 7 phases)={tot:7.1f}%  maxDD={dd:6.1f}%')
