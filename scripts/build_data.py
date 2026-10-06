#!/usr/bin/env python3
"""Download schema-checked nflverse sources and atomically build small Pages assets."""
import argparse, csv, gzip, hashlib, io, json, logging, math, os, tempfile, urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://github.com/nflverse/nflverse-data/releases/download/'
REFRESH = False
ALIASES = {'OAK':'LV','SD':'LAC','STL':'LA','LAR':'LA'}
def team(value): return ALIASES.get(value, value)
def number(value):
    try:
        x=float(value)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError): return None
def require(fields, expected, name):
    missing=set(expected)-set(fields)
    if missing: raise ValueError(f'{name}: missing required columns {sorted(missing)}')
def decode_source(content, required, name):
    decoded=gzip.decompress(content) if content[:2]==b'\x1f\x8b' else content
    reader=csv.DictReader(io.StringIO(decoded.decode('utf-8-sig')))
    require(reader.fieldnames or [], required, name)
    rows=list(reader)
    if not rows: raise ValueError(f'{name}: empty source')
    return rows, reader.fieldnames

def write_atomic(path, content):
    fd,tmp=tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as stream: stream.write(content)
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

def read_source(name, url, required, cache, report, optional=False):
    """Required means usable source data is mandatory, including validated cache.

    Refresh failure may use a schema-valid cache, with an explicit warning.
    Neither a failed response nor an invalid payload overwrites a good cache.
    """
    path=cache/name
    cached=None
    cache_error=None
    if path.exists():
        try:
            content=path.read_bytes()
            rows,columns=decode_source(content,required,name)
            timestamp_path=cache/(name+'.retrieval.json')
            retrieved_at=None
            basis='unknown'
            if timestamp_path.exists():
                try:
                    stamp=json.loads(timestamp_path.read_text())
                    if stamp['url']==url and stamp['sha256']==hashlib.sha256(content).hexdigest():
                        datetime.fromisoformat(stamp['retrievedAt'].replace('Z','+00:00'))
                        retrieved_at=stamp['retrievedAt'];basis='fetch_record'
                except (ValueError,KeyError,TypeError,OSError): pass
            cached=(content,rows,columns,retrieved_at,basis)
        except Exception as error:
            cache_error=str(error)
    def record(payload,status,cache_used,reason=None):
        content,rows,columns,retrieved_at,basis=payload
        report[name]={'url':url,'required':not optional,'status':status,'cacheUsed':cache_used,
                      'retrievedAt':retrieved_at,'retrievalTimestampBasis':basis,
                      'sha256':hashlib.sha256(content).hexdigest(),'columns':columns,'rows':len(rows)}
        if reason: report[name]['warning']=reason
        return rows
    if cached is not None and not REFRESH:
        return record(cached,'cached',True)
    try:
        with urllib.request.urlopen(url,timeout=90) as response: content=response.read()
        rows,columns=decode_source(content,required,name)
        retrieved_at=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
        write_atomic(path,content)
        stamp={'url':url,'sha256':hashlib.sha256(content).hexdigest(),'retrievedAt':retrieved_at}
        write_atomic(cache/(name+'.retrieval.json'),json.dumps(stamp).encode())
        return record((content,rows,columns,retrieved_at,'fetch_record'),'available',False)
    except Exception as error:
        reason=str(error)
        if cached is not None:
            logging.warning('%s source %s failed: %s; using validated cached data (%s).',
                            'Optional' if optional else 'Required',name,reason,cached[3] or 'retrieval time unknown')
            return record(cached,'cached',True,reason)
        report[name]={'url':url,'required':not optional,'status':'unavailable','cacheUsed':False,
                      'retrievedAt':None,'rows':0,'reason':reason}
        if cache_error: report[name]['cacheError']=cache_error
        if not optional:
            raise RuntimeError(f'Required source {name} unavailable; no valid cache: {reason}') from error
        logging.warning('Optional source %s unavailable: %s; no valid cache; omitting source.',name,reason)
        return []

def source_retrieval_summary(sources):
    stamps=[datetime.fromisoformat(v['retrievedAt'].replace('Z','+00:00')).astimezone(timezone.utc)
            for v in sources.values() if v.get('retrievedAt')]
    return {'earliest':min(stamps).isoformat().replace('+00:00','Z') if stamps else None,
            'latest':max(stamps).isoformat().replace('+00:00','Z') if stamps else None,
            'unknown':sorted(k for k,v in sources.items() if v['status']!='unavailable' and not v.get('retrievedAt')),
            'cached':sorted(k for k,v in sources.items() if v.get('cacheUsed')),
            'cacheUsageUnknown':sorted(k for k,v in sources.items() if v.get('cacheUsed') is None),
            'unavailable':sorted(k for k,v in sources.items() if v['status']=='unavailable')}

def available(day): return (date.fromisoformat(day)+timedelta(days=1)).isoformat()+'T12:00:00Z'
def build(season, as_of, cache):
    sources={}
    teams=json.loads((ROOT/'data/teams.json').read_text())
    schedules=read_source('schedule','https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv',['game_id','season','game_type','week','gameday','home_team','away_team','home_score','away_score','location','home_rest','away_rest'],cache,sources)
    games=[]
    for r in schedules:
        if int(r['season']) not in (season-1,season) or r['game_type']!='REG': continue
        if r['gameday']>=as_of[:10] or number(r['home_score']) is None or number(r['away_score']) is None: continue
        games.append({'id':r['game_id'],'season':int(r['season']),'week':int(r['week']),'date':r['gameday'],'availableAt':available(r['gameday']),'home':team(r['home_team']),'away':team(r['away_team']),'homeScore':number(r['home_score']),'awayScore':number(r['away_score']),'neutral':r['location']=='Neutral','homeRest':number(r['home_rest']),'awayRest':number(r['away_rest']),'stats':{}})
    by_id={g['id']:g for g in games}
    for year in (season-1,season):
        suffix=str(year)[-2:]
        weekly=read_source('weekly'+suffix,BASE+f'stats_team/stats_team_week_{year}.csv',['game_id','team','attempts','sacks_suffered','carries','passing_epa','rushing_epa','passing_yards','rushing_yards'],cache,sources,optional=True)
        for r in weekly:
            if r['game_id'] not in by_id: continue
            by_id[r['game_id']]['stats'][team(r['team'])]={'passingYards':number(r['passing_yards']),'rushingYards':number(r['rushing_yards']),'passEpa':number(r['passing_epa']),'rushEpa':number(r['rushing_epa'])}
        players=read_source('players'+suffix,BASE+f'stats_player/stats_player_week_{year}.csv',['game_id','team','player_id','player_display_name','position','attempts','sacks_suffered','passing_epa','targets','receiving_yards','carries','rushing_yards'],cache,sources,optional=True)
        for r in players:
            if r['game_id'] not in by_id: continue
            stats=by_id[r['game_id']]['stats'].setdefault(team(r['team']),{})
            attempts=number(r['attempts']) or 0
            if r['position']=='QB' and attempts>0:
                stats.setdefault('qbs',[]).append({'id':r['player_id'],'name':r['player_display_name'],'dropbacks':attempts+(number(r['sacks_suffered']) or 0),'epa':number(r['passing_epa'])})
            usage=(number(r['targets']) or 0)+(number(r['carries']) or 0)
            if r['position'] in ('RB','WR','TE') and usage>0:
                stats.setdefault('skill',[]).append({'id':r['player_id'],'name':r['player_display_name'],'position':r['position'],'usage':usage,'yards':(number(r['receiving_yards']) or 0)+(number(r['rushing_yards']) or 0)})
        pbp=read_source('pbp'+suffix,BASE+f'pbp/play_by_play_{year}.csv.gz',['game_id','posteam','defteam','play_type','qb_kneel','qb_spike','epa','success','yards_gained'],cache,sources,optional=True)
        aggregates=defaultdict(lambda:[0,0.,0.,0.])
        for r in pbp:
            if r['game_id'] not in by_id or r['play_type'] not in ('pass','run') or number(r['qb_kneel'])==1 or number(r['qb_spike'])==1 or number(r['epa']) is None: continue
            a=aggregates[(r['game_id'],team(r['posteam']))]
            a[0]+=1;a[1]+=number(r['epa']);a[2]+=number(r['success']) or 0;a[3]+=number(r['yards_gained']) or 0
        for (gid,t),(n,epa,success,yards) in aggregates.items():
            by_id[gid]['stats'].setdefault(t,{}).update({'plays':n,'epaPerPlay':epa/n,'successRate':success/n,'yardsPerPlay':yards/n})
    ngs=read_source('ngsgz',BASE+'nextgen_stats/ngs_passing.csv.gz',['season','season_type','week','team_abbr','player_gsis_id','attempts','completion_percentage_above_expectation'],cache,sources,optional=True)
    lookup={(g['season'],g['week'],t):g for g in games for t in (g['home'],g['away'])}
    for r in ngs:
        g=lookup.get((int(r['season']),int(r['week']),team(r['team_abbr'])))
        if not g or r['season_type']!='REG' or int(r['week'])==0: continue
        for qb in g['stats'].get(team(r['team_abbr']),{}).get('qbs',[]):
            if qb['id']==r['player_gsis_id']: qb['ngsCpoe']=number(r['completion_percentage_above_expectation'])
    roster=read_source('rosters'+str(season)[-2:],BASE+f'rosters/roster_{season}.csv',['team','gsis_id','full_name','position','status','week'],cache,sources,optional=True)
    roster_map={(team(r['team']),r['gsis_id']):r for r in sorted(roster,key=lambda r:int(r['week'] or 0))}
    depth=read_source('depth'+str(season)[-2:],BASE+f'depth_charts/depth_charts_{season}.csv',['dt','team','gsis_id','player_name','pos_abb','pos_rank'],cache,sources,optional=True)
    starters={}
    for r in depth:
        t=team(r['team'])
        if r['dt']>as_of or r['pos_abb']!='QB' or number(r['pos_rank'])!=1: continue
        if t in starters and r['dt']<=starters[t]['observedAt']: continue
        rr=roster_map.get((t,r['gsis_id']),{})
        starters[t]={'id':r['gsis_id'],'name':r['player_name'],'observedAt':r['dt'],'rosterStatus':rr.get('status'),'rosterWeek':number(rr.get('week'))}
    current=[g for g in games if g['season']==season and g['availableAt']<=as_of]
    if not current: raise ValueError(f'No completed {season} games before cutoff; keep previous snapshot intact.')
    metadata={'schemaVersion':2,'modelVersion':'2.0.0','modelBuiltAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'sourcesRetrieved':source_retrieval_summary(sources),'asOf':as_of,'season':season,'latestGameDate':max(g['date'] for g in current),'latestWeek':max(g['week'] for g in current),'currentGames':len(current),'notes':['Metrics are source observations, not PFF grades.','Injuries are unavailable; roster status does not establish game availability.','Source corrections are not archived vintages: historical evaluation is retrospective, not certified point-in-time.']}
    return {'metadata':metadata,'teams':teams,'games':games,'starters':starters}, {'metadata':metadata,'sources':sources,'licenseNote':'nflverse attribution; see upstream licenses and terms. No PFF grades are downloaded or redistributed.'}
def main():
    p=argparse.ArgumentParser();p.add_argument('--season',type=int,default=2026);p.add_argument('--as-of',default=datetime.now(timezone.utc).isoformat().replace('+00:00','Z'));p.add_argument('--refresh',action='store_true',help='Fetch sources again; recommended for scheduled updates');p.add_argument('--cache',type=Path,default=Path('/tmp/mistermatchup-cache'));a=p.parse_args()
    global REFRESH
    REFRESH=a.refresh
    cutoff=datetime.fromisoformat(a.as_of.replace('Z','+00:00'))
    if cutoff.tzinfo is None: p.error('--as-of requires a timezone')
    a.as_of=cutoff.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    a.cache.mkdir(parents=True,exist_ok=True)
    snapshot,provenance=build(a.season,a.as_of,a.cache)
    # Build and validate everything before replacing the last known good asset.
    for name,value in [('snapshot.json',snapshot),('provenance.json',provenance)]:
        content=json.dumps(value,separators=(',',':'),allow_nan=False)+'\n'
        fd,tmp=tempfile.mkstemp(dir=ROOT/'data');os.close(fd);Path(tmp).write_text(content);os.replace(tmp,ROOT/'data'/name)
    print(f"Built {len(snapshot['games'])} games; {snapshot['metadata']['currentGames']} in {a.season}")
if __name__=='__main__':main()
