import json,glob,numpy as np,pandas as pd,datetime as d
def load():
    fg=pd.DataFrame(json.load(open('data/fng.json')))
    fg['date']=pd.to_datetime(fg.timestamp.astype(int),unit='s').dt.normalize()
    fg=fg.set_index('date').value.astype(float).sort_index()
    fg=fg[~fg.index.duplicated()]
    frames={}
    for f in glob.glob('data/cb_*.json'):
        b=f.split('cb_')[1][:-5]
        a=np.array(json.load(open(f)),dtype=float)   # time, low, high, open, close, volume
        df=pd.DataFrame(a,columns=['t','low','high','open','close','vol'])
        df['date']=pd.to_datetime(df.t.astype(int),unit='s').dt.normalize()
        frames[b]=df.set_index('date').sort_index()
    return frames,fg
def rsi(c,n=14):
    dlt=c.diff(); g=dlt.clip(lower=0).ewm(alpha=1/n,adjust=False).mean(); l=(-dlt.clip(upper=0)).ewm(alpha=1/n,adjust=False).mean()
    return 100-100/(1+g/l.replace(0,np.nan))
def build(H=7,BIG=0.10):
    frames,fg=load()
    btc=frames['BTC']; bc=btc.close
    mk=pd.DataFrame({'btc_sma100':bc/bc.rolling(100).mean()-1,'btc_mom30':bc.pct_change(30)})
    fg7=fg.rolling(7).mean()
    out=[]
    for b,df in frames.items():
        c=df.close; h=df.high; l=df.low; v=df.vol
        x=pd.DataFrame(index=df.index)
        x['coin']=b
        x['mom7']=c.pct_change(7); x['mom30']=c.pct_change(30); x['mom90']=c.pct_change(90)
        x['dist_hi20']=c/h.rolling(20).max()-1
        x['dist_hi55']=c/h.rolling(55).max()-1
        x['dist_hi180']=c/h.rolling(180).max()-1
        tr=pd.concat([h-l,(h-c.shift()).abs(),(l-c.shift()).abs()],axis=1).max(axis=1)
        atrp=tr.rolling(14).mean()/c
        x['atr14']=atrp
        x['squeeze']=atrp/atrp.rolling(90).median()          # <1 = compressed volatility
        x['volsurge']=v.rolling(3).mean()/v.rolling(30).mean()
        x['rsi14']=rsi(c)
        x['rel_btc30']=c.pct_change(30)-bc.reindex(df.index).pct_change(30)
        x['range_pos20']=(c-l.rolling(20).min())/(h.rolling(20).max()-l.rolling(20).min())
        x['up_days10']=(c.diff()>0).rolling(10).sum()
        x=x.join(mk).join(fg7.rename('fg7')).join(fg.diff(7).rename('fg_chg7'))
        x['close']=c; x['fwd']=c.shift(-H)/c-1
        x['fwdmax']=h[::-1].rolling(H).max()[::-1].shift(-1)/c-1
        x['big']=(x.fwd>=BIG).astype(float); x.loc[x.fwd.isna(),'big']=np.nan
        out.append(x)
    return pd.concat(out).reset_index().rename(columns={'index':'date'})
if __name__=='__main__':
    P=build(); P.to_pickle('panel.pkl'); print(P.shape, P.date.min(), P.date.max()); print(P.groupby('coin').size().to_dict())
