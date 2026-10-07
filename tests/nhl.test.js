import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {buildModel,validateHistory,simulate,scoringEnvironment,exactProbabilities,DEFAULT_CONFIG,RECENCY,selfTest} from '../js/nhl/model.js';
import {randomSeed,probabilityMetrics,goalPmf} from '../js/shared/statistics.js';
const history=validateHistory(JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('../data/nhl/history.json.gz',import.meta.url))))),model=buildModel(history);
test('NHL all 32 current teams, no duplicate matchup, 10,000 resolved trials',()=>{
 assert.equal(Object.keys(model.teams).length,32);assert.equal(model.teams.UTA.name,'Utah Mammoth');assert.throws(()=>simulate(model,'CAR','CAR'));assert.throws(()=>simulate(model,'XXX','CAR'));
 const r=simulate(model,'CAR','NYR',{}, {random:randomSeed(99)});assert.equal(r.trials,10000);assert.equal(r.fullGameA+r.fullGameB,1);assert.ok(Math.abs(r.regulationA+r.regulationB+r.overtime-1)<1e-10);assert.ok(r.averageA>=0&&r.averageB>=0);assert.ok(r.fullGameA>=r.regulationA);assert.ok(r.fullGameB>=r.regulationB);
});
test('NHL 50-matchup broad self-test and deterministic seed',()=>{
 assert.equal(selfTest(model),50);assert.deepEqual(simulate(model,'TOR','BOS',{}, {random:randomSeed(1)}),simulate(model,'TOR','BOS',{}, {random:randomSeed(1)}));
});
test('home ice and neutral reversal have coherent direction',()=>{
 const neutral=scoringEnvironment(model,'CAR','NYR'),reverse=scoringEnvironment(model,'NYR','CAR'),home=scoringEnvironment(model,'CAR','NYR',{homeA:true});assert.equal(neutral.a,reverse.b);assert.equal(neutral.b,reverse.a);assert.ok(home.a>neutral.a&&home.b<neutral.b);assert.ok(exactProbabilities(home,model.config).fullGameA>exactProbabilities(neutral,model.config).fullGameA);
});
test('stronger separate goalie suppresses opposing scoring; small samples shrink',()=>{
 const copy=structuredClone(model),before=scoringEnvironment(copy,'CAR','NYR');copy.teams.NYR.goalie.gsax60+=.4;const after=scoringEnvironment(copy,'CAR','NYR');assert.ok(after.a<before.a);assert.equal(after.b,before.b);
 const fixture=structuredClone(history);fixture.goalieGames=[{id:'sample',name:'Fixture',team:'CAR',gameId:history.games.at(-1).id,date:'2026-10-01',availableAt:'2026-10-02T12:00:00Z',seconds:3600,xga:4,ga:0,shots:30}];
 const quality=buildModel(fixture).goalies.sample;assert.equal(quality.gsax60,4);assert.ok(quality.regressedGsax60<.5);
});
test('future team/goalie observations cannot change historical features or recent windows',()=>{
 const opts={season:2024,asOf:'2025-01-01T00:00:00Z'},before=buildModel(history,opts),copy=structuredClone(history);
 for(const g of copy.games.filter(g=>Date.parse(g.availableAt)>=Date.parse(opts.asOf)))for(const s of Object.values(g.sides))for(const m of Object.values(s)){m.xgf=999;m.xga=0;m.gf=50;}
 copy.goalieGames.push({id:'future',team:'CAR',gameId:'future',date:'2026-10-01',availableAt:'2026-10-02T12:00:00Z',seconds:3600,xga:999,ga:0});
 assert.deepEqual(buildModel(copy,opts),before);assert.throws(()=>buildModel(history,{asOf:'2029-01-01T00:00:00Z'}));
});
test('all six recency regimes work and wins alone do not change process strength',()=>{
 for(const recency of RECENCY){const m=buildModel(history,{config:{...DEFAULT_CONFIG,recency}});const e=scoringEnvironment(m,'TOR','BOS');assert.ok(Number.isFinite(e.a)&&e.a>0&&Number.isFinite(e.b)&&e.b>0);}
 const altered=structuredClone(history);for(const g of altered.games){[g.homeScore,g.awayScore]=[g.awayScore,g.homeScore];}
 const changed=buildModel(altered);assert.deepEqual(scoringEnvironment(changed,'TOR','BOS'),scoringEnvironment(model,'TOR','BOS'));
 const m=model.teams.CAR;assert.ok(m.windows.last5.games<=5&&m.windows.last10.games<=10&&m.windows.last20.games<=20);assert.equal(m.windows.season.games,m.games);
});
test('starter statuses need evidence; unknown assumptions are explicit',()=>{
 const expected=scoringEnvironment(model,'CAR','NYR');assert.equal(expected.goalieA.status,'unknown');assert.match(expected.goalieA.assumption,/no confirmed/i);
 assert.throws(()=>scoringEnvironment(model,'CAR','NYR',{goalieA:{status:'confirmed',id:'fake'}}));assert.throws(()=>scoringEnvironment(model,'CAR','NYR',{goalieA:{status:'projected',id:'fake',source:'test',observedAt:'2099-01-01T00:00:00Z'}}));
 const goalie=model.teams.CAR.goalie.candidates[0];if(goalie){const result=scoringEnvironment(model,'CAR','NYR',{goalieA:{status:'projected',id:goalie.id,source:'Hypothetical test only',observedAt:model.teams.CAR.goalie.sourceTimestamp}});assert.equal(result.goalieA.status,'projected');assert.equal(result.goalieA.candidates.length,1);}
});
test('missing goalie optional source is neutral prior without invented player',()=>{
 const copy=structuredClone(history);copy.goalieGames=[];const m=buildModel(copy);assert.deepEqual(m.teams.CAR.goalie.candidates,[]);assert.equal(m.teams.CAR.goalie.gsax60,0);assert.ok(Number.isFinite(scoringEnvironment(m,'CAR','NYR').a));
});
test('Poisson and NB probabilities valid; NB variance exceeds Poisson at same mean',()=>{
 for(const distribution of ['poisson','negative-binomial']){
  const config={...DEFAULT_CONFIG,distribution,dispersion:20};const r=exactProbabilities({a:3,b:3},config);assert.ok(Math.abs(r.fullGameA-.5)<1e-9);assert.ok(Math.abs(r.regulationA+r.regulationB+r.overtime-1)<1e-9);
  const values=goalPmf(3,distribution,20);assert.ok(Math.abs(values.reduce((a,b)=>a+b,0)-1)<1e-8);
 }
 const v=type=>goalPmf(3,type,20).reduce((s,p,k)=>s+p*(k-3)**2,0);assert.ok(v('negative-binomial')>v('poisson'));
});
test('probability metrics validate outcomes and calibration counts',()=>{
 const m=probabilityMetrics([{p:.8,y:1},{p:.2,y:0}]);assert.ok(Math.abs(m.brier-.04)<1e-9);assert.equal(m.accuracy,1);assert.equal(m.calibration.reduce((s,b)=>s+b.n,0),2);assert.throws(()=>probabilityMetrics([]));
});
test('snapshot coverage and provenance match actual history, not rebuild time',()=>{
 const snapshot=JSON.parse(fs.readFileSync(new URL('../data/nhl/snapshot.json',import.meta.url)));
 const provenance=JSON.parse(fs.readFileSync(new URL('../data/nhl/provenance.json',import.meta.url)));
 assert.equal(snapshot.metadata.dataThrough,history.games.map(g=>g.date).sort().at(-1));
 assert.deepEqual(snapshot.metadata.sourcesRetrieved,provenance.metadata.sourcesRetrieved);
 assert.equal(snapshot.metadata.modelBuiltAt,provenance.metadata.modelBuiltAt);
 const evaluation=JSON.parse(fs.readFileSync(new URL('../data/nhl/evaluation.json',import.meta.url)));
 const decisionPath=new URL('../data/nhl/draw-decision.json',import.meta.url);
 const expectedConfig=fs.existsSync(decisionPath)?(()=>{const d=JSON.parse(fs.readFileSync(decisionPath));return{...d.frozenTeamStrength,regulation:d.regulation,overtimeMode:d.overtimeMode};})():evaluation.selectedConfig;
 assert.deepEqual(snapshot.model.config,expectedConfig);
 assert.equal(selfTest(snapshot.model),50);
});
test('analytical reporting is stable while all Monte Carlo trials still resolve',()=>{
 const first=simulate(model,'CAR','NYR',{homeA:true},{random:randomSeed(5)}),second=simulate(model,'CAR','NYR',{homeA:true},{random:randomSeed(6)});
 assert.equal(first.fullGameA,second.fullGameA);assert.equal(first.regulationA,first.exact.regulationA);assert.equal(first.overtime,first.exact.overtime);
 assert.equal(first.averageA,second.averageA);assert.equal(first.monteCarlo.fullGameA+first.monteCarlo.fullGameB,1);
 assert.ok(Math.abs(first.monteCarlo.fullGameA-first.exact.fullGameA)<.025);
 assert.ok(Math.abs(first.monteCarlo.regulationA+first.monteCarlo.regulationB+first.monteCarlo.overtime-1)<1e-10);
 assert.equal(first.trials,10000);assert.notDeepEqual(first.monteCarlo,second.monteCarlo);
});
test('audited noise controls preserve process and separate goalie observations',()=>{
 const config={...DEFAULT_CONFIG,goalieRecentWeight:0,finishingWeight:0};const m=buildModel(history,{config});
 const goalie=Object.values(m.goalies).find(g=>g.seconds>36000);assert.ok(goalie);assert.ok(Math.abs(goalie.regressedGsax60-Math.max(-.65,Math.min(.65,goalie.gsax60*goalie.seconds/(goalie.seconds+36000))))<1e-10);
 const before=scoringEnvironment(m,'CAR','NYR'),copy=structuredClone(m);for(const t of ['CAR','NYR'])copy.teams[t].features['5on5'].finishing=100;
 assert.equal(before.componentsA.finishing,1);assert.deepEqual(scoringEnvironment(copy,'CAR','NYR'),before);
});
