import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateSnapshot,buildRatings,expectedScores,simulate,seededRandom,selfTest,explain} from '../js/model.js';
import {evaluate} from '../js/evaluation.js';
import {licensedPffAdjustment} from '../js/adapters.js';
const data=JSON.parse(readFileSync(new URL('../data/snapshot.json',import.meta.url)));
const model=buildRatings(validateSnapshot(data));
test('32 teams and 50 meaningful 10,000-trial self-tests',()=>{assert.equal(Object.keys(model.ratings).length,32);assert.equal(selfTest(model),50);});
test('deterministic simulation produces finite nonnegative scores and complement probabilities',()=>{
 const options={random:seededRandom(42)};const r=simulate(model,'CIN','BAL',{},options);
 assert.deepEqual(r,simulate(model,'CIN','BAL',{}, {random:seededRandom(42)}));assert.equal(r.winsA+r.winsB,10000);assert.equal(r.probabilityA+r.probabilityB,1);assert.ok(r.averageA>=0 && r.averageB>=0);
});
test('neutral symmetry and home-field direction; no home benefit for Team 2',()=>{
 const ab=expectedScores(model,'BUF','KC'),ba=expectedScores(model,'KC','BUF');assert.equal(ab.a,ba.b);assert.equal(ab.b,ba.a);
 const home=expectedScores(model,'BUF','KC',{homeA:true});assert.ok(home.a>ab.a);assert.equal(home.b,ab.b);
 const text=explain(model,'BUF','KC',{probabilityA:.1,probabilityB:.9},{});assert.ok(!text.includes('home-field advantage'));
});
test('invalid team, duplicate team, trials, malformed snapshots rejected',()=>{
 assert.throws(()=>simulate(model,'CIN','CIN'));assert.throws(()=>simulate(model,'???','BAL'));assert.throws(()=>simulate(model,'CIN','BAL',{}, {trials:0}));
 const copy=structuredClone(data);copy.games[0].homeScore=NaN;assert.throws(()=>validateSnapshot(copy));
});
test('cutoff prevents future score, EPA, player and depth-chart leakage',()=>{
 const asOf='2026-09-20T00:00:00Z';const before=buildRatings(data,{asOf});const copy=structuredClone(data);
 for(const g of copy.games.filter(g=>g.availableAt>=asOf)){g.homeScore=100;g.awayScore=0;g.stats={CIN:{epaPerPlay:999,qbs:[{id:'fake',name:'Future',epa:999,dropbacks:1}]}};}
 copy.starters.CIN={id:'fake',name:'Future',observedAt:'2026-10-01T00:00:00Z'};
 assert.deepEqual(buildRatings(copy,{asOf}),before);assert.throws(()=>buildRatings(data,{asOf:'2027-01-01T00:00:00Z'}));
});
test('recent performance weighs more; missing stats remain safe with no invented player',()=>{
 const copy=structuredClone(data);for(const g of copy.games)g.stats={};copy.starters={};
 const r=buildRatings(copy);assert.equal(r.ratings.CIN.qb,null);assert.ok(Number.isFinite(r.ratings.CIN.offense));
 const eligible=copy.games.filter(g=>g.season===2026 && g.home==='CIN');assert.ok(eligible.length>=2);
 const early=structuredClone(copy),late=structuredClone(copy);early.games.find(g=>g.id===eligible[0].id).homeScore+=20;late.games.find(g=>g.id===eligible.at(-1).id).homeScore+=20;
 assert.ok(buildRatings(late).ratings.CIN.offense>buildRatings(early).ratings.CIN.offense);
});
test('rest and licensed adjustments are bounded and timestamp checked',()=>{
 const base=expectedScores(model,'CIN','BAL'),rest=expectedScores(model,'CIN','BAL',{restA:14,restB:7});assert.ok(rest.a>base.a);assert.ok(rest.a-base.a<=.600001);
 assert.throws(()=>licensedPffAdjustment({licensed:false}));
 const adjustment=licensedPffAdjustment({licensed:true,teamSide:'a',points:1,source:'test licensed provider',availableAt:'2026-09-01T00:00:00Z'});
 assert.equal(expectedScores(model,'CIN','BAL',{adjustments:[adjustment]}).a,base.a+1);
 assert.throws(()=>expectedScores(model,'CIN','BAL',{adjustments:[{...adjustment,availableAt:'2027-01-01T00:00:00Z'}]}));
});
test('metrics, ties, calibration and timestamped ATS behavior',()=>{
 const r=evaluate([{probability:.8,outcome:1},{probability:.2,outcome:0}]);assert.ok(Math.abs(r.brier-.04)<1e-9);assert.ok(Math.abs(r.logLoss+Math.log(.8))<1e-9);assert.equal(r.accuracy,1);assert.equal(r.calibration.reduce((s,b)=>s+b.count,0),2);assert.equal(r.ats.accuracy,null);
 assert.equal(evaluate([{probability:.5,outcome:.5}]).accuracy,null);assert.throws(()=>evaluate([]));
 const ats=evaluate([{probability:.6,outcome:1,predictedMargin:7,actualMargin:10,kickoff:'2026-09-01T20:00:00Z',market:{homeHandicap:-3,observedAt:'2026-09-01T10:00:00Z'}}]);assert.equal(ats.ats.wins,1);
});
test('source snapshot has real current-season observations and coherent joins',()=>{
 const current=data.games.filter(g=>g.season===data.metadata.season && Date.parse(g.availableAt)<Date.parse(data.metadata.asOf));
 assert.equal(current.length,data.metadata.currentGames);
 const participants=new Set();
 for(const g of current)for(const t of [g.home,g.away]){
  participants.add(t);assert.ok(g.stats[t].plays>0);assert.ok(Number.isFinite(g.stats[t].epaPerPlay));assert.ok(Array.isArray(g.stats[t].qbs));
  for(const qb of g.stats[t].qbs)assert.ok(qb.dropbacks>0 && Number.isFinite(qb.epa));
 }
 assert.equal(participants.size,32);
});
test('equivalent timezone cutoffs produce identical features',()=>{
 const utc=buildRatings(data,{asOf:'2026-09-20T00:00:00Z'}),offset=buildRatings(data,{asOf:'2026-09-19T20:00:00-04:00'});
 assert.deepEqual(utc.ratings,offset.ratings);
});
