/** Training fits; validation selection; no holdout access. */
import fs from 'node:fs';import {regulationDistribution,outcomeProbabilities} from '../../js/nhl/regulation.js';import {probabilityMetrics} from '../../js/shared/statistics.js';
const root=new URL('../../',import.meta.url),protocolPath=new URL('data/nhl/draw-decision.json',root);
if(fs.existsSync(protocolPath))throw Error('Draw model is already frozen. Refusing another selection pass.');
const data=JSON.parse(fs.readFileSync('/tmp/nhl-draw-v11/training-validation-features.json')),train=data.filter(r=>r.season===2023),validation=data.filter(r=>r.season===2024),strength=Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(new URL('data/nhl/config.json',root)))).filter(([key])=>!['regulation','overtimeMode'].includes(key)));
const sigmoid=x=>1/(1+Math.exp(-x));
function stats(rows,spec,mode='rate',predictions=false){const probabilities=[],draws=[];let scoreLoss=0,mean=0,tail=0;const details=[];for(const r of rows){const d=regulationDistribution(r,{regulation:spec}),p=outcomeProbabilities(r,{...strength,regulation:spec,overtimeMode:mode},d);probabilities.push({p:p.fullGameA,y:r.y});draws.push({p:p.overtime,y:r.draw});scoreLoss-=Math.log(Math.max(1e-15,d.matrix[r.regHome*d.size+r.regAway]));mean+=p.overtime;tail=Math.max(tail,d.omittedTail);if(predictions)details.push({...r,p:p.fullGameA,regulationA:p.regulationA,regulationB:p.regulationB,overtime:p.overtime,otA:p.overtimeConditionalA,meanA:d.meanA,meanB:d.meanB});}
 const winner=probabilityMetrics(probabilities),draw=probabilityMetrics(draws);return{games:rows.length,predictedTieRate:mean/rows.length,observedTieRate:rows.filter(r=>r.draw).length/rows.length,drawBrier:draw.brier,drawLogLoss:draw.logLoss,winnerBrier:winner.brier,winnerLogLoss:winner.logLoss,winnerAccuracy:winner.accuracy,regulationScoreLogLoss:scoreLoss/rows.length,maxOmittedTail:tail,...(predictions?{predictions:details}:{})};}
function solve(matrix,vector){const n=vector.length,a=matrix.map((r,i)=>[...r,vector[i]]);for(let k=0;k<n;k++){let pivot=k;for(let i=k+1;i<n;i++)if(Math.abs(a[i][k])>Math.abs(a[pivot][k]))pivot=i;[a[k],a[pivot]]=[a[pivot],a[k]];const d=a[k][k];if(Math.abs(d)<1e-12)throw Error('Singular draw fit');for(let j=k;j<=n;j++)a[k][j]/=d;for(let i=0;i<n;i++)if(i!==k){const f=a[i][k];for(let j=k;j<=n;j++)a[i][j]-=f*a[k][j];}}return a.map(r=>r[n]);}
function fitDraw(n){const observations=train.map(r=>{const p=regulationDistribution(r,{regulation:{family:'poisson'}}).overtime;return{x:[1,Math.abs(r.a-r.b)-.75,r.a+r.b-6].slice(0,n),offset:Math.log(p/(1-p)),y:r.draw};});const beta=Array(n).fill(0),ridge=5;for(let iter=0;iter<40;iter++){const gradient=Array(n).fill(0),hessian=Array.from({length:n},()=>Array(n).fill(0));for(const r of observations){const p=sigmoid(r.offset+r.x.reduce((s,x,i)=>s+x*beta[i],0));for(let i=0;i<n;i++){gradient[i]+=(r.y-p)*r.x[i];for(let j=0;j<n;j++)hessian[i][j]+=p*(1-p)*r.x[i]*r.x[j];}}for(let i=1;i<n;i++){gradient[i]-=ridge*beta[i];hessian[i][i]+=ridge;}const step=solve(hessian,gradient);for(let i=0;i<n;i++)beta[i]+=step[i];if(Math.max(...step.map(Math.abs))<1e-8)break;}return{family:'draw-logit',coefficients:beta,ridge};}
const grids={
 'independent-poisson':[{family:'poisson'}],
 'bivariate-poisson':[0,.1,.2,.3,.4,.5].map(sharedFraction=>({family:'bivariate-poisson',sharedFraction})),
 'dixon-coles':[-.12,-.08,-.04,-.02,0,.02].map(rho=>({family:'dixon-coles',rho})),
 'negative-binomial':[5,10,20,50,96.24052741370934,200].map(dispersion=>({family:'negative-binomial',dispersion})),
 'shared-gamma':[5,10,20,50,100,200].map(shape=>({family:'shared-gamma',shape})),
 'draw-logit-intercept':[fitDraw(1)],
 'draw-logit-inputs':[fitDraw(3)]};
const fits=[],candidates=[];
for(const [name,grid] of Object.entries(grids)){const models=grid.map(spec=>({spec,training:stats(train,spec)})).sort((a,b)=>a.training.regulationScoreLogLoss-b.training.regulationScoreLogLoss);fits.push({name,models});const best=models[0];candidates.push({name,...best,validation:stats(validation,best.spec)});console.log(name,JSON.stringify({spec:best.spec,training:best.training,validation:candidates.at(-1).validation}));}
// OT advantage is compared on actual extra-time games in validation, never the full-game holdout.
function overtimeMetrics(rows,mode){return probabilityMetrics(rows.filter(r=>r.draw).map(r=>({p:mode==='neutral'?.5:(1-strength.shootoutShare)*r.a/(r.a+r.b)+strength.shootoutShare*.5,y:r.y})));}
const ot={training:{rate:overtimeMetrics(train,'rate'),neutral:overtimeMetrics(train,'neutral')},validation:{rate:overtimeMetrics(validation,'rate'),neutral:overtimeMetrics(validation,'neutral')}};
const rateHelps=ot.validation.rate.logLoss<ot.validation.neutral.logLoss-.001&&ot.validation.rate.brier<ot.validation.neutral.brier-.0005;
const mode=rateHelps?'rate':'neutral';for(const c of candidates)c.validation=stats(validation,c.spec,mode);
const reference=candidates.find(c=>c.name==='independent-poisson');
// Choose on probability quality and score fit, not aggregate draw percentage. A guard bounds winner degradation.
const eligible=candidates.filter(c=>c.validation.winnerLogLoss<=reference.validation.winnerLogLoss+.005&&c.validation.regulationScoreLogLoss<=reference.validation.regulationScoreLogLoss+.01);
const selected=[...eligible].sort((a,b)=>a.validation.drawLogLoss-b.validation.drawLogLoss||a.validation.regulationScoreLogLoss-b.validation.regulationScoreLogLoss)[0];
const frozen={modelVersion:'1.1.0-experimental',frozenAt:new Date().toISOString(),frozenTeamStrength:strength,regulation:selected.spec,overtimeMode:mode,selectedFamily:selected.name,selectionRule:'Fit score parameters on 2023 training joint-score likelihood (draw-logit fits binary draw likelihood with offset and ridge 5). Select on 2024 validation draw log loss subject to winner-log-loss degradation <=0.005 and joint-score-log-loss degradation <=0.01 versus Poisson. OT rate advantage requires validation gains >0.001 log loss AND >0.0005 Brier; otherwise neutral.',holdoutPolicy:'Evaluate selected candidate on 2025 exactly once after this decision. Never tune from that outcome.',overtimeEvidence:ot};
fs.writeFileSync(protocolPath,JSON.stringify(frozen,null,2)+'\n');
const selectedValidation=stats(validation,selected.spec,mode,true),previousValidation=stats(validation,{family:'poisson'},'rate',true);
fs.writeFileSync('/tmp/nhl-draw-v11/selection.json',JSON.stringify({fits,candidates,frozen,selectedValidation,previousValidation})+'\n');console.log('FROZEN',JSON.stringify(frozen,null,2));
