import numpy as np,pandas as pd,json,glob
from panel import load
P=pd.read_pickle('panel.pkl').dropna(subset=['big'])
FE=['mom30','rsi14','range_pos20','btc_mom30','mom7','btc_sma100','fg7']
P=P.dropna(subset=FE)
cut=pd.Timestamp('2023-01-01')
tr=P[P.date<cut-pd.Timedelta(days=8)]; te=P[P.date>=cut].copy()
q=lambda f,p: tr[f].quantile(p)
rule=lambda d:(d['mom30']>=q('mom30',.8))&(d['rsi14']>=q('rsi14',.8))&(d['range_pos20']>=q('range_pos20',.8))
print('train cutoffs mom30',round(q('mom30',.8),3),'rsi',round(q('rsi14',.8),1),'range',round(q('range_pos20',.8),2))
COST=0.004
# stop-aware 7d sim on daily lows
frames,_=load()
def sim(df,stop):
    out=[]
    for coin,g in df.groupby('coin'):
        f=frames[coin]; idx={d:i for i,d in enumerate(f.index)}
        lo=f.low.values; cl=f.close.values
        last=-10**9
        for d in g.sort_values('date').date:
            i=idx[d]
            if i-last<7 or i+7>=len(f): continue
            last=i; e=cl[i]
            r=None
            if stop is not None:
                lvl=e*(1-stop)
                for k in range(1,8):
                    if lo[i+k]<=lvl: r=lvl*(1-0.003)/e-1; break
            if r is None: r=cl[i+7]/e-1
            out.append((d,coin,r-COST))
    return pd.DataFrame(out,columns=['date','coin','net'])
base=sim(te[te.fwd.notna()],None)
print('\nBASELINE (non-overlap, every coin, test): n',len(base),'mean %.2f%% med %.2f%%'%(base.net.mean()*100,base.net.median()*100))
rng=np.random.default_rng(7)
def blockdiff(a,b,B=1000):
    a=a.assign(m=a.date.dt.to_period('M')); b=b.assign(m=b.date.dt.to_period('M'))
    ms=sorted(set(a.m)|set(b.m)); ga={m:a[a.m==m].net.values for m in ms}; gb={m:b[b.m==m].net.values for m in ms}
    res=[]
    for _ in range(B):
        pick=rng.choice(len(ms),len(ms))
        xa=np.concatenate([ga[ms[i]] for i in pick]); xb=np.concatenate([gb[ms[i]] for i in pick])
        if len(xa)==0 or len(xb)==0: continue
        res.append(xa.mean()-xb.mean())
    return np.percentile(res,[5,50,95])
for stop in (None,0.10,0.07):
    s=sim(te[rule(te)],stop)
    b=sim(te[te.fwd.notna()],stop)
    ci=blockdiff(s,b)
    srt=np.sort(s.net.values); trim=srt[:int(len(srt)*0.97)]
    print(f'\nRULE stop={stop}: n={len(s)} mean={s.net.mean()*100:.2f}% median={s.net.median()*100:.2f}% win={100*(s.net>0).mean():.1f}% | baseline same exit mean={b.net.mean()*100:.2f}% | edge 90%CI by month [{ci[0]*100:.2f},{ci[2]*100:.2f}]% | mean w/o top3%% winners={trim.mean()*100:.2f}%')
    print('   by year:',{y:(round(g.net.mean()*100,2),len(g)) for y,g in s.groupby(s.date.dt.year)})
    print('   baseline by year:',{y:round(g.net.mean()*100,2) for y,g in b.groupby(b.date.dt.year)})
