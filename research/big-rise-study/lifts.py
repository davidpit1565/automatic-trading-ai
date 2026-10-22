import numpy as np,pandas as pd
P=pd.read_pickle('panel.pkl').dropna(subset=['big'])
FEATS=['mom7','mom30','mom90','dist_hi20','dist_hi55','dist_hi180','atr14','squeeze','volsurge','rsi14','rel_btc30','range_pos20','up_days10','btc_sma100','btc_mom30','fg7','fg_chg7']
P=P.dropna(subset=FEATS)
cut=pd.Timestamp('2023-01-01')
tr=P[P.date<cut-pd.Timedelta(days=8)]; te=P[P.date>=cut]
print('train',len(tr),tr.date.min().date(),tr.date.max().date(),'base big',round(tr.big.mean(),4))
print('test ',len(te),te.date.min().date(),te.date.max().date(),'base big',round(te.big.mean(),4))
te=te.assign(month=te.date.dt.to_period('M'))
rng=np.random.default_rng(1)
def boot_ci(sub,base_all,B=400):
    months=sub.month.unique(); g={m:sub[sub.month==m].big.values for m in months}
    allm=te.month.unique(); ga={m:te[te.month==m].big.values for m in allm}
    res=[]
    for _ in range(B):
        ms=rng.choice(allm,len(allm))
        a=np.concatenate([ga[m] for m in ms]); s=np.concatenate([g[m] for m in ms if m in g]) if any(m in g for m in ms) else np.array([np.nan])
        res.append(s.mean()/a.mean())
    return np.nanpercentile(res,[5,95])
print(f'\n{"feature":12s} {"bucket":7s} {"train P":>8s} {"liftTr":>6s} | {"test P":>7s} {"liftTe":>6s} {"n_te":>6s}  test lift 90% CI')
rows=[]
for f in FEATS:
    q=tr[f].quantile([.2,.8]).values
    for name,mask_tr,mask_te in (('top20',tr[f]>=q[1],te[f]>=q[1]),('bot20',tr[f]<=q[0],te[f]<=q[0])):
        a=tr[mask_tr].big.mean(); b=te[mask_te].big.mean()
        lt=a/tr.big.mean(); le=b/te.big.mean()
        ci=boot_ci(te[mask_te],te.big.mean()) if mask_te.sum()>50 else (np.nan,np.nan)
        rows.append((f,name,a,lt,b,le,mask_te.sum(),ci))
        flag=' <== holds' if (lt>1.3 and le>1.3 and ci[0]>1.0) or (lt<0.77 and le<0.77 and ci[1]<1.0) else ''
        print(f'{f:12s} {name:7s} {a:8.3f} {lt:6.2f} | {b:7.3f} {le:6.2f} {mask_te.sum():6d}  [{ci[0]:.2f},{ci[1]:.2f}]{flag}')
