"""Replaceable MoneyPuck download adapter. No website/stat-page scraping.

Experimental non-commercial use only. Endpoints come from /data.htm.
"""
import csv, hashlib, io, json, logging, os, tempfile, time, threading, urllib.request, urllib.error
from datetime import datetime, timezone
from pathlib import Path
USER_AGENT='Mozilla/5.0 (compatible; MisterMatchup non-commercial research)'
MP='https://moneypuck.com/moneypuck/playerData/'
NHL='https://api-web.nhle.com/v1/'
MP_LOCK=threading.Lock()
MP_LAST_REQUEST=0.0
MP_RATE_LIMITED=False
def atomic(path, data):
    fd,tmp=tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as f:f.write(data)
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
def download(url, cache, records, refresh=False, optional=False):
    cache.mkdir(parents=True,exist_ok=True)
    key=hashlib.sha256(url.encode()).hexdigest();path=cache/key;stamp=cache/(key+'.json')
    if path.exists() and stamp.exists() and not refresh:
        b=path.read_bytes();record=json.loads(stamp.read_text())
        if hashlib.sha256(b).hexdigest()==record['sha256']:
            records[url]={**record,'cacheUsed':True};return b
    try:
        global MP_LAST_REQUEST,MP_RATE_LIMITED
        if url.startswith(MP):
            with MP_LOCK:
                if MP_RATE_LIMITED:raise RuntimeError('MoneyPuck returned 429 earlier in this run; requests stopped; retry later or use documented bulk archives')
                delay=2.1-(time.monotonic()-MP_LAST_REQUEST)
                if delay>0:time.sleep(delay)
                MP_LAST_REQUEST=time.monotonic()
        with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':USER_AGENT}),timeout=90) as response:b=response.read()
        if not b:raise ValueError('Empty download')
        record={'url':url,'retrievedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'status':'available','cacheUsed':False}
        atomic(path,b);atomic(stamp,json.dumps(record).encode());records[url]=record;return b
    except Exception as e:
        if isinstance(e,urllib.error.HTTPError) and e.code==429:
            MP_RATE_LIMITED=True
        records[url]={'url':url,'status':'unavailable','required':not optional,'reason':str(e),'retrievedAt':None}
        if not optional:raise RuntimeError(f'Required NHL source unavailable: {url}: {e}') from e
        logging.warning('Optional NHL source unavailable: %s: %s',url,e);return None
def csv_rows(data, required, name, records=None,url=None):
    if data is None:return []
    reader=csv.DictReader(io.StringIO(data.decode('utf-8-sig')))
    missing=set(required)-set(reader.fieldnames or [])
    if missing:raise ValueError(f'{name}: schema missing {sorted(missing)}')
    rows=list(reader)
    if records is not None and url:records[url].update({'columns':reader.fieldnames,'rows':len(rows)})
    return rows
def num(value):
    import math
    try:n=float(value);return n if math.isfinite(n) else None
    except (TypeError,ValueError):return None
