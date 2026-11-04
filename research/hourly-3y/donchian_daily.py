import json,glob,os,numpy as np
D=os.environ.get('PANEL_DIR','./research/big-rise-study/data')
coins={}
for f in sorted(glob.glob(D+'/cb_*.json')):
    a=json.load(open(f)); a.sort(key=lambda r:r[0])
    coins[os.path.basename(f)[3:-5]]=np.array(a,float)  # ts, low, high, open, close, vol
days=sorted({int(r[0]) for a in coins.values() for r in a})
idx={d:i for i,d in enumerate(days)}; T=len(days)
H=np.full((len(coins),T),np.nan);L=H.copy();C=H.copy()
names=list(coins)
for k,n in enumerate(names):
    for r in coins[n]:
        i=idx[int(r[0])]; L[k,i]=r[1];H[k,i]=r[2];C[k,i]=r[4]
d0=days[0]; import datetime
dt=lambda t: datetime.datetime.utcfromtimestamp(t).strftime('%Y-%m')
print('coins',len(names),'days',T,dt(days[0]),'->',dt(days[-1]))
def weights(lbs,exit_frac):
    """per coin exposure in [0,1]: fraction of lookbacks currently 'in'"""
    W=np.zeros((len(names),T))
    for k in range(len(names)):
        st=np.zeros(len(lbs))
        for t in range(1,T):
            if np.isnan(C[k,t]): W[k,t]=0; st[:]=0; continue
            for j,N in enumerate(lbs):
                lo=max(0,t-N); hh=np.nanmax(H[k,lo:t]) if t-lo>=N//2 and not np.all(np.isnan(H[k,lo:t])) else np.nan
                m=max(1,int(N*exit_frac)); ll=np.nanmin(L[k,max(0,t-m):t]) if not np.all(np.isnan(L[k,max(0,t-m):t])) else np.nan
                if st[j]==0 and not np.isnan(hh) and C[k,t]>hh: st[j]=1
                elif st[j]==1 and not np.isnan(ll) and C[k,t]<ll: st[j]=0
            W[k,t]=st.mean()
    return W
RET=np.full_like(C,np.nan); RET[:,1:]=C[:,1:]/C[:,:-1]-1
def port(W,cost):
    # signal at close t -> exposure applied to return t+1
    w=np.zeros_like(W); w[:,1:]=W[:,:-1]
    avail=~np.isnan(RET)
    r=np.where(avail,w*np.nan_to_num(RET),0)
    turn=np.zeros_like(W); turn[:,1:]=np.abs(w[:,1:]-w[:,:-1])
    r=r-turn*cost
    n=avail.sum(0); n[n==0]=1
    return r.sum(0)/n, (turn*avail).sum(0)/n   # equal capital per available coin, rest cash
def stats(x,lo,hi):
    s=x[lo:hi]; m=s.mean()*365; sd=s.std()*np.sqrt(365)
    eq=np.cumprod(1+s); dd=(eq/np.maximum.accumulate(eq)-1).min()
    return m,(m/sd if sd>0 else 0),dd,eq[-1]-1
ts=np.array(days)
split=int(np.searchsorted(ts, datetime.datetime(2023,1,1).timestamp()))
start=int(np.searchsorted(ts, datetime.datetime(2018,6,1).timestamp()))
bh=np.where(~np.isnan(RET),np.nan_to_num(RET),0).sum(0)/np.maximum((~np.isnan(RET)).sum(0),1)
btc=names.index('BTC') if 'BTC' in names else 0
btcr=np.nan_to_num(RET[btc])
def row(tag,x):
    a=stats(x,start,split);b=stats(x,split,T)
    return f"{tag:34s} | 2018-22: ann {a[0]*100:+5.0f}% Sh {a[1]:+.2f} DD {a[2]*100:+4.0f}% | 2023-26: ann {b[0]*100:+5.0f}% Sh {b[1]:+.2f} DD {b[2]*100:+4.0f}%"
print(row('equal-weight buy&hold (all coins)',bh)); print(row('BTC buy&hold',btcr))
rng=np.random.default_rng(1)
results={}
for lbs in ([20,50,100],[10,20,50],[50,100,200]):
  for ef in (0.5,0.25):
    W=weights(lbs,ef)
    for cost in (0.001,0.003):
        x,tn=port(W,cost); results[(tuple(lbs),ef,cost)]=(x,tn,W)
        print(row(f"donchian {lbs} exit {ef} cost {cost*100:.1f}%/side",x), f"| time-in-mkt {np.nanmean(W[:,start:])*100:.0f}% turnover/day {tn[start:].mean()*100:.1f}%")
# random-timing null for the chosen primary config (pre-registered: [20,50,100], exit 0.5, cost 0.2%/side)
for key in [((20,50,100),0.5,0.001),((20,50,100),0.5,0.003)]:
    x,tn,W=results[key]
    obs=stats(x,split,T)[1]; null=[]
    for _ in range(200):
        Wp=W.copy()
        for k in range(len(names)):
            sh=rng.integers(60,T-60); Wp[k]=np.roll(W[k],sh)
        xp,_=port(Wp,key[2]); null.append(stats(xp,split,T)[1])
    print('NULL (circular-shifted exposure, same turnover) key',key,'holdout Sharpe obs %.2f vs null mean %.2f p95 %.2f; p-value %.3f'%(obs,np.mean(null),np.percentile(null,95),(np.array(null)>=obs).mean()))
