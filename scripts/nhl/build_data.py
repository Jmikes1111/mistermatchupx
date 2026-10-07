#!/usr/bin/env python3
"""Normalize actual inspected MoneyPuck schemas + NHL game outcomes.
Raw sources stay in /tmp. No NFL outputs touched. Requires non-commercial flag.
"""
import argparse,csv,gzip,hashlib,io,json,logging,sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date,datetime,timedelta,timezone
from pathlib import Path
from moneypuck import MP,NHL,atomic,csv_rows,download,num
ROOT=Path(__file__).resolve().parents[2]
ALIASES={'ARI':'UTA','L.A':'LAK','N.J':'NJD','S.J':'SJS','T.B':'TBL'}
def code(s):return ALIASES.get(s,s)
# All source columns below were inspected in downloaded CSV headers before mapping.
SIDE_FIELDS={'seconds':'iceTime','xgf':'xGoalsFor','xga':'xGoalsAgainst','adjustedXgf':'scoreVenueAdjustedxGoalsFor','adjustedXga':'scoreVenueAdjustedxGoalsAgainst','gf':'goalsFor','ga':'goalsAgainst','sf':'shotsOnGoalFor','sa':'shotsOnGoalAgainst','cf':'shotAttemptsFor','ca':'shotAttemptsAgainst','ff':'unblockedShotAttemptsFor','fa':'unblockedShotAttemptsAgainst','hdf':'highDangerShotsFor','hda':'highDangerShotsAgainst','mdf':'mediumDangerShotsFor','mda':'mediumDangerShotsAgainst','ldf':'lowDangerShotsFor','lda':'lowDangerShotsAgainst'}
GOALIE_FIELDS={'seconds':'icetime','xga':'xGoals','ga':'goals','shots':'ongoal','hdShots':'highDangerShots','hdXga':'highDangerxGoals','hdGa':'highDangerGoals','mdShots':'mediumDangerShots','mdGa':'mediumDangerGoals','ldShots':'lowDangerShots','ldGa':'lowDangerGoals'}
def normalize_team(rows,seasons,as_of):
    games={}
    for r in rows:
        season=int(r['season']);day=datetime.strptime(r['gameDate'],'%Y%m%d').date()
        if season not in seasons or r['playoffGame']!='0' or day.isoformat()>=as_of[:10]:continue
        situation=r['situation']
        if situation not in ('all','5on5','5on4','4on5'):continue
        gid=str(r['gameId']);g=games.setdefault(gid,{'id':gid,'season':season,'date':day.isoformat(),'availableAt':(day+timedelta(days=1)).isoformat()+'T12:00:00Z','sides':{}})
        t=code(r['playerTeam']);opponent=code(r['opposingTeam'])
        if r['home_or_away']=='HOME':g.update(home=t,away=opponent)
        side=g['sides'].setdefault(t,{})
        if situation in side:raise ValueError(f'Duplicate game/team/situation {gid}/{t}/{situation}')
        values={key:num(r.get(column)) for key,column in SIDE_FIELDS.items()}
        if any(values[k] is None or values[k]<0 for k in ['seconds','xgf','xga','gf','ga']):raise ValueError(f'Invalid required team metric {gid}')
        side[situation]=values
    return games
def build(args):
    records={};as_of=args.as_of;seasons=set(args.seasons)
    def fetch(url,optional=False):return download(url,args.cache,records,args.refresh,optional)
    standings_url=NHL+'standings/now';standings=json.loads(fetch(standings_url))
    teams={row['teamAbbrev']['default']:row['teamName']['default'] for row in standings['standings']}
    if len(teams)!=32:raise ValueError('Expected 32 current NHL teams; inspect new league schema/membership')
    url=MP+'careers/gameByGame/all_teams.csv';raw=fetch(url)
    rows=csv_rows(raw,['gameId','season','playerTeam','opposingTeam','gameDate','home_or_away','situation','playoffGame',*SIDE_FIELDS.values()],'MoneyPuck team history',records,url)
    games=normalize_team(rows,seasons,as_of);del rows,raw
    # Club-season schedules are legitimate public API JSON; no scraped pages.
    schedule_urls=[NHL+f'club-schedule-season/{t}/{year}{year+1}' for year in sorted(seasons) for t in teams if not (t=='UTA' and year<2024)]
    schedule_urls += [NHL+f'club-schedule-season/ARI/{year}{year+1}' for year in seasons if year<2024]
    def schedule(url):return url,json.loads(fetch(url))
    outcome={}
    with ThreadPoolExecutor(max_workers=2) as pool:
        for url,data in pool.map(schedule,schedule_urls):
            if not isinstance(data.get('games'),list):raise ValueError('NHL schedule schema changed')
            records[url]['jsonGameKeys']=sorted(data['games'][0]) if data['games'] else []
            for g in data['games']:
                gid=str(g['id'])
                if gid not in games or g['gameType']!=2 or g.get('gameState') not in ('OFF','FINAL'):continue
                end=g.get('gameOutcome',{}).get('lastPeriodType')
                if end not in ('REG','OT','SO'):continue
                home,away=code(g['homeTeam']['abbrev']),code(g['awayTeam']['abbrev'])
                hs,aws=g['homeTeam'].get('score'),g['awayTeam'].get('score')
                if hs is None or aws is None or hs==aws:raise ValueError('Invalid final NHL score')
                rh=hs-(1 if end!='REG' and hs>aws else 0);ra=aws-(1 if end!='REG' and aws>hs else 0)
                if end!='REG' and rh!=ra:raise ValueError('Extra-time game should be tied at regulation end')
                outcome[gid]={'home':home,'away':away,'homeScore':hs,'awayScore':aws,'regHome':rh,'regAway':ra,'ending':end,'neutral':g.get('neutralSite',False),'startTime':g['startTimeUTC']}
    normalized=[]
    for gid,g in games.items():
        if gid not in outcome:continue
        g.update(outcome[gid])
        if len(g['sides'])!=2 or any('5on5' not in side or 'all' not in side for side in g['sides'].values()):raise ValueError(f'Incomplete team game {gid}')
        # Exclude data for which the conservative assumed availability is later than cutoff.
        if g['availableAt']>=as_of:continue
        normalized.append(g)
    normalized.sort(key=lambda g:(g['date'],g['id']));by_id={g['id']:g for g in normalized}
    goalie_ids=set();players=[]
    for year in sorted(seasons):
        url=MP+f'seasonSummary/{year}/regular/goalies.csv';b=fetch(url,True)
        for r in csv_rows(b,['playerId','name','team','situation'],'goalie summary',records,url):goalie_ids.add(r['playerId'])
    # Full careers are directly downloadable per documented template. Select only needed seasons.
    def goalie(pid):
        url=MP+f'careers/gameByGame/regular/goalies/{pid}.csv'
        b=fetch(url,True)
        rows=csv_rows(b,['playerId','name','gameId','gameDate','playerTeam','situation',*GOALIE_FIELDS.values()],'goalie game history',records,url)
        return pid,rows
    goalie_games=[]
    with ThreadPoolExecutor(max_workers=2) as pool:
        for pid,rows in pool.map(goalie,sorted(goalie_ids)):
            for r in rows:
                gid=str(r['gameId'])
                if r['situation']!='all' or gid not in by_id:continue
                t=code(r['playerTeam']);values={k:num(r.get(v)) for k,v in GOALIE_FIELDS.items()}
                if values['seconds'] is None or values['seconds']<=0 or values['xga'] is None or values['ga'] is None:continue
                goalie_games.append({'id':pid,'name':r['name'],'team':t,'gameId':gid,'date':by_id[gid]['date'],'availableAt':by_id[gid]['availableAt'],**values})
    current=max(seasons)
    url=MP+f'seasonSummary/{current}/regular/skaters.csv';b=fetch(url,True)
    columns=['playerId','name','team','situation','icetime','I_F_xGoals','I_F_shotsOnGoal','I_F_goals','I_F_primaryAssists','I_F_secondaryAssists','I_F_points','I_F_shotAttempts','I_F_highDangerShots','onIce_xGoalsPercentage','offIce_xGoalsPercentage']
    for r in csv_rows(b,columns,'skater summary',records,url):
        if r['situation']!='all' or code(r['team']) not in teams:continue
        players.append({'id':r['playerId'],'name':r['name'],'team':code(r['team']),'position':r.get('position'),'season':current,'toi':num(r['icetime']),'xg':num(r['I_F_xGoals']),'shots':num(r['I_F_shotsOnGoal']),'goals':num(r['I_F_goals']),'assists':(num(r['I_F_primaryAssists']) or 0)+(num(r['I_F_secondaryAssists']) or 0),'points':num(r['I_F_points']),'attempts':num(r['I_F_shotAttempts']),'highDanger':num(r['I_F_highDangerShots']),'onIceXgShare':num(r['onIce_xGoalsPercentage']),'offIceXgShare':num(r['offIce_xGoalsPercentage']),'sourceRetrievedAt':records[url]['retrievedAt']})
    if not normalized:raise ValueError('No usable NHL observations; no replacement snapshot generated')
    coverage={str(y):sum(g['season']==y for g in normalized) for y in sorted(seasons)}
    stamps=[r['retrievedAt'] for r in records.values() if r.get('retrievedAt')]
    meta={'schemaVersion':1,'sport':'NHL','modelVersion':'1.0.0-experimental','asOf':as_of,'dataThrough':max(g['date'] for g in normalized),'seasons':coverage,'sourcesRetrieved':{'earliest':min(stamps),'latest':max(stamps)},'modelBuiltAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'usage':'Experimental non-commercial prototype; MoneyPuck attribution required. Commercial deployment requires appropriate rights review.','evaluationMode':'Retrospective: revised source files; availability is assumed next-day noon UTC, not verified publication time.'}
    history={'metadata':meta,'teams':teams,'games':normalized,'goalieGames':goalie_games}
    provenance={'metadata':meta,'documentation':'https://moneypuck.com/data.htm','sources':records,'notes':['Only documented downloadable data and public NHL API endpoints used.','No raw sources committed.','Season-summary skaters are display/future player-contract inputs only, never historical prediction features.','Historical ARI mapped to franchise successor UTA, labeled as franchise history rather than current roster observations.']}
    target=ROOT/'data/nhl';target.mkdir(parents=True,exist_ok=True)
    atomic(target/'history.json.gz',gzip.compress(json.dumps(history,separators=(',',':'),allow_nan=False).encode(),mtime=0))
    atomic(target/'players.json',(json.dumps({'metadata':meta,'players':players},separators=(',',':'),allow_nan=False)+'\n').encode())
    atomic(target/'provenance.json',(json.dumps(provenance,separators=(',',':'),allow_nan=False)+'\n').encode())
    print(json.dumps({'games':coverage,'goalieGames':len(goalie_games),'players':len(players),'dataThrough':meta['dataThrough']},indent=2))
def main():
    p=argparse.ArgumentParser();p.add_argument('--non-commercial',action='store_true');p.add_argument('--seasons',nargs='+',type=int,default=[2023,2024,2025,2026]);p.add_argument('--as-of',default=datetime.now(timezone.utc).isoformat().replace('+00:00','Z'));p.add_argument('--cache',type=Path,default=Path('/tmp/mistermatchup-nhl-cache'));p.add_argument('--refresh',action='store_true');a=p.parse_args()
    if not a.non_commercial:p.error('MoneyPuck use is non-commercial only; acknowledge with --non-commercial')
    d=datetime.fromisoformat(a.as_of.replace('Z','+00:00'))
    if d.tzinfo is None:p.error('Cutoff requires timezone')
    a.as_of=d.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ');build(a)
if __name__=='__main__':main()
