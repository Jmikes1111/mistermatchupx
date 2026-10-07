import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import zlib from 'node:zlib';
import {regulationDistribution,outcomeProbabilities,scoreSampler} from '../js/nhl/regulation.js';import {goalPmf,randomSeed} from '../js/shared/statistics.js';import {buildModel,scoringEnvironment,simulate} from '../js/nhl/model.js';
const decision=JSON.parse(fs.readFileSync(new URL('../data/nhl/draw-decision.json',import.meta.url))),config={...decision.frozenTeamStrength,regulation:decision.regulation,overtimeMode:decision.overtimeMode};
test('independent Poisson matrix equals exact PMF products and Skellam tie sum',()=>{
 const e={a:3,b:2.7},d=regulationDistribution(e,{regulation:{family:'poisson'}}),A=goalPmf(e.a),B=goalPmf(e.b);let draw=0;
 for(let i=0;i<A.length;i++){draw+=A[i]*B[i];for(let j=0;j<B.length;j++)assert.ok(Math.abs(d.matrix[i*d.size+j]-A[i]*B[j])<1e-12);}assert.ok(Math.abs(d.overtime-draw)<1e-12);
});
test('all score families are positive, normalized, symmetric and coherent',()=>{
 for(const spec of [{family:'poisson'},{family:'bivariate-poisson',sharedFraction:.3},{family:'negative-binomial',dispersion:20},{family:'shared-gamma',shape:20},{family:'dixon-coles',rho:-.08},{family:'draw-logit',coefficients:[.32,.05,-.05]}]){
  const d=regulationDistribution({a:3.4,b:2.5},{regulation:spec}),reverse=regulationDistribution({a:2.5,b:3.4},{regulation:spec});assert.ok(Math.abs(d.matrix.reduce((a,b)=>a+b)-1)<1e-12);assert.ok(d.matrix.every(p=>p>=0&&Number.isFinite(p)));assert.ok(Math.abs(d.regulationA+d.regulationB+d.overtime-1)<1e-12);assert.ok(Math.abs(d.regulationA-reverse.regulationB)<1e-12);
 }
});
test('bivariate means stay fixed and covariance equals shared component',()=>{
 const d=regulationDistribution({a:3,b:2},{regulation:{family:'bivariate-poisson',sharedFraction:.4}});assert.ok(Math.abs(d.meanA-3)<1e-10&&Math.abs(d.meanB-2)<1e-10);assert.ok(Math.abs(d.covariance-.8)<1e-9);
});
test('Dixon-Coles preserves normalization and means; invalid cells fail',()=>{
 const d=regulationDistribution({a:3,b:2},{regulation:{family:'dixon-coles',rho:-.1}});assert.ok(Math.abs(d.meanA-3)<1e-10&&Math.abs(d.meanB-2)<1e-10);assert.throws(()=>regulationDistribution({a:7,b:7},{regulation:{family:'dixon-coles',rho:1}}));
});
test('learned draw odds update coherent score mass, not a fixed percentage',()=>{
 const e={a:3,b:3},old=regulationDistribution(e,{regulation:{family:'poisson'}}),d=regulationDistribution(e,config);const odds=p=>p/(1-p);assert.ok(Math.abs(odds(d.overtime)/odds(old.overtime)-Math.exp(config.regulation.coefficients[0]))<1e-10);
 const p=outcomeProbabilities(e,config,d);assert.ok(Math.abs(p.fullGameA-.5)<1e-12);assert.ok(Math.abs(p.fullGameA-p.regulationA-p.overtime*p.overtimeConditionalA)<1e-12);
 const stronger=regulationDistribution({a:5,b:2},config),baseStrong=regulationDistribution({a:5,b:2},{regulation:{family:'poisson'}});assert.notEqual(d.overtime-old.overtime,stronger.overtime-baseStrong.overtime);
});
test('frozen scoring calibration does not change any team strength or goalie features',()=>{
 const h=JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('../data/nhl/history.json.gz',import.meta.url))));const base=buildModel(h,{config:decision.frozenTeamStrength}),m=buildModel(h,{config});assert.deepEqual(m.teams,base.teams);assert.deepEqual(m.league,base.league);assert.deepEqual(m.goalies,base.goalies);assert.deepEqual(scoringEnvironment(m,'CAR','NYR',{homeA:true}),scoringEnvironment(base,'CAR','NYR',{homeA:true}));
});
test('score sampler, analytical means and probabilities agree at 100k',()=>{
 const e={a:3.2,b:2.9},d=regulationDistribution(e,config),sample=scoreSampler(d),rng=randomSeed(40);let tie=0,sa=0,sb=0;for(let n=0;n<100000;n++){const [a,b]=sample(rng);assert.ok(a>=0&&b>=0&&Number.isInteger(a)&&Number.isInteger(b));tie+=a===b?1:0;sa+=a;sb+=b;}assert.ok(Math.abs(tie/100000-d.overtime)<.008);assert.ok(Math.abs(sa/100000-d.meanA)<.025&&Math.abs(sb/100000-d.meanB)<.025);
});
test('regulation and full-game events and calibrated score means remain distinct',()=>{
 const snapshot=JSON.parse(fs.readFileSync(new URL('../data/nhl/snapshot.json',import.meta.url))),r=simulate(snapshot.model,'CAR','NYR',{homeA:true},{random:randomSeed(18)});assert.equal(r.trials,10000);assert.ok(Math.abs(r.fullGameA-r.regulationA-r.overtime*r.exact.overtimeConditionalA)<1e-12);assert.ok(Math.abs(r.averageA-r.exact.regulationMeanA-r.overtime*r.exact.overtimeConditionalA)<1e-12);
});
test('bad goal inputs, model families and calibration parameters fail safely',()=>{
 assert.throws(()=>regulationDistribution({a:NaN,b:3},config));assert.throws(()=>regulationDistribution({a:3,b:3},{regulation:{family:'invented'}}));assert.throws(()=>regulationDistribution({a:3,b:3},{regulation:{family:'draw-logit',coefficients:[Infinity]}}));assert.throws(()=>regulationDistribution({a:3,b:3},{regulation:{family:'negative-binomial',dispersion:0}}));
});
