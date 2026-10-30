import json,glob,numpy as np,pandas as pd,sys
COST=float(sys.argv[1]) if len(sys.argv)>1 else 0.003
rows=[]
for f in glob.glob('data/*.json'):
    p=f.split('/')[-1][:-5]
    a=np.array(json.load(open(f)),dtype=float)   # time,o,h,l,c,vwap,vol,count
    if len(a)<60: continue
    df=pd.DataFrame(a,columns=['t','o','h','l','c','vw','v','n']); df['d']=pd.to_datetime(df.t.astype(int),unit='s')
    df=df.iloc[:-1]  # drop forming bar
    df['eur']=df.v*df.vw
    df['liq20']=df.eur.rolling(20).median().shift(1)
    df['ret']=df.c/df.c.shift(1)-1
    for h in (0,1,3,7):
        df[f'fwdC{h}']=df.c.shift(-h)/df.c-1                       # buy at event close, sell close t+h (h=0 n/a)
        df[f'fwdO{h}']=df.c.shift(-(h+1))/df.o.shift(-1)-1           # buy next open, sell close t+1+h
    df['rng_pos']=(df.c-df.l)/(df.h-df.l).replace(0,np.nan)
    df['pair']=p
    rows.append(df)
P=pd.concat(rows,ignore_index=True)
P=P[(P.liq20>=10_000)&(P.eur>=30_000)&P.ret.notna()]    # tradable-ish only
P['year']=P.d.dt.year; P['ym']=P.d.dt.to_period('M')
print('coin-days',len(P),'pairs',P.pair.nunique(),P.d.min().date(),P.d.max().date(),'cost/side',COST)
def summ(name,m,col):
    s=P[m&P[col].notna()][col]-2*COST
    if len(s)<15: print(f'{name:44s} n={len(s)}'); return
    ym=P[m&P[col].notna()].ym
    # month-block bootstrap of mean
    rng=np.random.default_rng(3); g=s.groupby(ym.values).apply(lambda x:x.values); keys=list(g.index)
    bs=[np.concatenate([g[keys[i]] for i in rng.integers(0,len(keys),len(keys))]).mean() for _ in range(400)]
    print(f'{name:44s} n={len(s):5d} mean={s.mean()*100:6.2f}% med={s.median()*100:6.2f}% win={100*(s>0).mean():4.1f}% 90%CI mean [{np.percentile(bs,5)*100:5.2f},{np.percentile(bs,95)*100:5.2f}]')
allm=P.ret.notna()
for col,lab in (('fwdC1','buy EVENT-DAY CLOSE, sell +1d'),('fwdC3','buy EVENT-DAY CLOSE, sell +3d'),('fwdC7','buy EVENT-DAY CLOSE, sell +7d'),('fwdO1','buy NEXT OPEN, sell +1d close'),('fwdO3','buy NEXT OPEN, sell +3d close')):
    print('\n==',lab)
    summ('baseline: all coin-days',allm,col)
    for th in (0.10,0.20,0.30):
        summ(f'day gain >= {int(th*100)}%',P.ret>=th,col)
    summ('day gain >= 20% AND closed in top 10% of range',(P.ret>=0.20)&(P.rng_pos>=0.9),col)
    summ('day gain >= 20% AND closed in bottom half',(P.ret>=0.20)&(P.rng_pos<0.5),col)
print('\n== by year (gain>=20%, buy event close, sell +3d)')
for y in sorted(P.year.unique()):
    summ(f'  {y}',(P.ret>=0.20)&(P.year==y),'fwdC3')
print('\nevents >=20%:',int(((P.ret>=0.20)).sum()),' >=30%:',int((P.ret>=0.30).sum()),' per month ~',round(((P.ret>=0.20)).sum()/P.ym.nunique(),1))
