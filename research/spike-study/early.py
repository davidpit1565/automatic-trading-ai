import json,glob,numpy as np,pandas as pd
COST=0.003; SLIP=0.003
rows=[]
for f in glob.glob('data/*.json'):
    p=f.split('/')[-1][:-5]
    a=np.array(json.load(open(f)),dtype=float)
    if len(a)<60: continue
    df=pd.DataFrame(a,columns=['t','o','h','l','c','vw','v','n']); df['d']=pd.to_datetime(df.t.astype(int),unit='s'); df=df.iloc[:-1]
    df['eur']=df.v*df.vw; df['liq20']=df.eur.rolling(20).median().shift(1); df['pair']=p
    for h in (0,1,3): df[f'c{h}']=df.c.shift(-h)
    df['ym']=df.d.dt.to_period('M')
    rows.append(df)
P=pd.concat(rows,ignore_index=True); P=P[(P.liq20>=10_000)&(P.eur>=30_000)]
print('coin-days',len(P))
rng=np.random.default_rng(5)
def run(th,stop=None):
    m=(P.h>=P.o*(1+th))
    S=P[m].copy()
    S['entry']=S.o*(1+th)*(1+SLIP)
    out={}
    for h in (0,1,3):
        ex=S[f'c{h}']*(1-SLIP)
        r=ex/S.entry-1-2*COST
        if stop is not None and h==0:
            # same-day stop: if low after trigger <= entry*(1-stop) assume stopped (pessimistic: any low <= stop level)
            hit=S.l<=S.entry*(1-stop)
            r=np.where(hit,-stop-2*COST,r)
        r=pd.Series(r,index=S.index).dropna()
        ymk=S.ym.loc[r.index]; g=r.groupby(ymk.values).apply(lambda x:x.values); keys=list(g.index)
        bs=[np.concatenate([g[keys[i]] for i in rng.integers(0,len(keys),len(keys))]).mean() for _ in range(300)]
        out[h]=(len(r),r.mean()*100,r.median()*100,100*(r>0).mean(),np.percentile(bs,5)*100,np.percentile(bs,95)*100)
    return out
for th in (0.05,0.10,0.15,0.20):
    o=run(th)
    print(f'\nstop-buy trigger +{int(th*100)}% from the day open  (entry slip+cost incl.)')
    for h,lab in ((0,'sell same-day close'),(1,'sell next close'),(3,'sell +3d close')):
        n,m,md,w,lo,hi=o[h]; print(f'  {lab:22s} n={n:5d} mean={m:6.2f}% med={md:6.2f}% win={w:4.1f}% 90%CI [{lo:5.2f},{hi:5.2f}]')
