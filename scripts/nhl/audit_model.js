/** Reproducible diagnostic study. Never writes serving configuration or selects on holdout. */
import fs from 'node:fs';import zlib from 'node:zlib';
import {buildModel,scoringEnvironment,exactProbabilities,DEFAULT_CONFIG} from '../../js/nhl/model.js';
import {probabilityMetrics,clamp} from '../../js/shared/statistics.js';
fs.mkdirSync('/tmp/nhl-final-audit',{recursive:true});
const root=new URL('../../',import.meta.url),h=JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('data/nhl/history.json.gz',root))));
const old=JSON.parse(fs.readFileSync(new URL('data/nhl/evaluation.json',root))),config=JSON.parse(fs.readFileSync(new URL('data/nhl/audit-protocol.json',root))).originalConfig;
const output=process.argv[2]||'/tmp/nhl-final-audit/model-study.json';
const sum=(rs,k,w=()=>1)=>rs.reduce((s,r)=>s+(Number.isFinite(r[k])?r[k]*w(r):0),0);
function rates(rs,sit,w=()=>1){const xs=rs.map((g,i)=>({...g.sides[g.t]?.[sit],date:g.date,index:i})).filter(r=>r.seconds>0);const seconds=sum(xs,'seconds',w),exposure=xs.reduce((s,r)=>s+w(r),0);const rate=k=>seconds?sum(xs,k,w)*3600/seconds:null;return{observations:xs.length,adjustedXgf60:rate('adjustedXgf'),adjustedXga60:rate('adjustedXga'),xgf60:rate('xgf'),xga60:rate('xga'),finishing:sum(xs,'xgf',w)>0?sum(xs,'gf',w)/sum(xs,'xgf',w):null,secondsPerGame:exposure?seconds/exposure:null};}
const keys=['adjustedXgf60','adjustedXga60','xgf60','xga60','finishing','secondsPerGame'];
function mixed(season,recent,weight){const f={...season};for(const k of keys)if(Number.isFinite(recent[k]))f[k]=Number.isFinite(season[k])?(1-weight)*season[k]+weight*recent[k]:recent[k];return f;}
function recentForm(rs,sit,method,asOf){const s=rates(rs,sit);if(method==='season-only')return s;if(/^last-/.test(method))return rates(rs.slice(-Number(method.split('-')[1])),sit);if(method==='exponential-games')return rates(rs,sit,r=>.5**((rs.length-1-r.index)/10));if(method==='exponential-days')return rates(rs,sit,r=>.5**((Date.parse(asOf)-Date.parse(r.date))/86400000/30));if(method==='blended')return mixed(mixed(mixed(s,rates(rs.slice(-20),sit),.4),rates(rs.slice(-10),sit),.35),rates(rs.slice(-5),sit),.2);throw Error(method);}
const rowsByTeam=Object.fromEntries(Object.keys(h.teams).map(t=>[t,h.games.filter(g=>g.home===t||g.away===t).map(g=>({...g,t}))]));
const goalieById={};for(const r of h.goalieGames)(goalieById[r.id]??=[]).push(r);for(const rows of Object.values(goalieById))rows.sort((a,b)=>a.date.localeCompare(b.date));
function goalie(id,cutoff,season,mode,prior=36000){let rs=(goalieById[id]||[]).filter(r=>r.availableAt<cutoff);const all=rs;
 if(mode==='season')rs=rs.filter(r=>Number(r.gameId.slice(0,4))===season);
 if(mode==='last5')rs=rs.slice(-5);if(mode==='last10')rs=rs.slice(-10);
 const w=mode==='exponential'?r=>.5**((Date.parse(cutoff)-Date.parse(r.date))/86400000/60):()=>1;
 const seconds=sum(rs,'seconds',w),xga=sum(rs,'xga',w),ga=sum(rs,'ga',w),shots=sum(rs,'shots',w);
 let rate=seconds?(xga-ga)*3600/seconds:0;
 if(mode==='save-above-expected')rate=shots?(xga-ga)/shots*30:0;
 if(mode==='raw-gsax')rate=(xga-ga)/(rs.length||1); // Per-appearance scaling; no cumulative-total dimensional error.
 if(mode==='workload-rest'){const last=all.at(-1),rest=last?(Date.parse(cutoff)-Date.parse(last.date))/86400000:null;if(rest!==null&&rest<=1.1)rate-=.1;}
 return clamp(rate*seconds/(seconds+prior),-.65,.65);
}
function goalieModel(base,cutoff,season,mode,prior=36000){const teams={};for(const [t,team] of Object.entries(base.teams)){const candidates=team.goalie.candidates;let weighted=0;for(const g of candidates)weighted+=g.weight*goalie(g.id,cutoff,season,mode,prior);teams[t]={...team,goalie:{...team.goalie,gsax60:weighted}};}return{...base,teams};}
function recencyModel(base,method,cutoff,season,priorStrength=10){const teams={};for(const [t,team] of Object.entries(base.teams)){
 const rs=rowsByTeam[t].filter(g=>g.season===season&&g.availableAt<cutoff),previous=rowsByTeam[t].filter(g=>g.season===season-1&&g.availableAt<cutoff),features={};
 for(const sit of ['5on5','5on4','4on5']){const f=recentForm(rs,sit,method,cutoff),p=rates(previous,sit),league=base.league[sit];features[sit]={};for(const k of keys){const prior=Number.isFinite(p[k])?p[k]:Number.isFinite(league[k])?league[k]:k==='finishing'?1:k==='secondsPerGame'?(sit==='5on5'?2850:300):sit==='5on5'?2.5:6;features[sit][k]=Number.isFinite(f[k])?(f[k]*f.observations+prior*priorStrength)/(f.observations+priorStrength):prior;}}
 teams[t]={...team,features};}return{...base,teams};}
const recencies=['season-only','last-20','last-10','last-5','blended','exponential-games','exponential-days'];
const goalieModes=['season','multiseason','last5','last10','exponential','save-above-expected','raw-gsax','workload-rest'];
const signals=['xgf60','xga60','xgShare','shotShare','highDangerShare','goalDifferential','finishing','goalieGsax','specialTeams'];
const rows={};const details={};let base,lastDate,models={};
function append(season,name,row){(rows[season]??={})[name]??=[];rows[season][name].push(row);}
function changedExpected(baseExpected,ablation,model){const e=baseExpected;let a=e.a,b=e.b;
 const c=[e.componentsA,e.componentsB],rest=[e.context.restEffectA??1,e.context.restEffectB??1];
 const home=[e.context.homeA?model.config.homeFactor:1,e.context.homeA?1/model.config.homeFactor:1];
 const leaguePP=model.league['5on4'].xgf/(model.league['5on4'].observations||1);
 const values=c.map((v,i)=>{let pp=v.special,f=v.finishing,g=v.goalieEffect,ev=v.even,other=v.other;if(ablation==='no-special')pp=leaguePP;if(ablation==='no-finishing')f=1;if(ablation==='no-goalie')g=0;if(ablation==='half-goalie')g*=.5;if(ablation==='double-goalie')g*=2;if(ablation==='no-other')other=0;return clamp(((ev+pp+other)*f+g)*(ablation==='no-home'?1:home[i])*(ablation==='no-rest'?1:rest[i]),.3,7);});
 return{...e,a:values[0],b:values[1]};}
function signal(team,name){const a=team.windows.last10,b=team.windows.season;let delta=0;
 if(name==='goalDifferential')delta=a.goalDifferential/(a.games||1)-b.goalDifferential/(b.games||1);
 else if(name==='goalieGsax')delta=a.goalieGsax/(a.goalieObservations||1)-b.goalieGsax/(b.goalieObservations||1);
 else if(name==='specialTeams')delta=(a.powerPlay.xgf60??0)-(b.powerPlay.xgf60??0)-((a.penaltyKill.xga60??0)-(b.penaltyKill.xga60??0));
 else if(name==='finishing')delta=(a.finishing??1)-(b.finishing??1);
 else delta=(a[name]??0)-(b[name]??0);
 return name==='xga60'?-delta:delta;
}
const logit=p=>Math.log(clamp(p,1e-6,1-1e-6)/(1-clamp(p,1e-6,1-1e-6))),sigmoid=x=>1/(1+Math.exp(-x));
for(const season of [2024]){ // Validation only: decisions are frozen before another period is evaluated.
 const targets=h.games.filter(g=>g.season===season);
 for(const [index,g] of targets.entries()){
  const cutoff=g.date+'T00:00:00Z';if(lastDate!==g.date){base=buildModel(h,{season,asOf:cutoff,config});models={};
   for(const recency of recencies)models['recency:'+recency]=recencyModel(base,recency,cutoff,season);
   for(const strength of [0,5,20,40])models['prior:'+strength]=recencyModel(base,'blended',cutoff,season,strength);
   for(const mode of goalieModes)models['goalie:'+mode]=goalieModel(base,cutoff,season,mode);
   for(const prior of [18000,72000,144000])models['goalie:prior'+prior]=goalieModel(base,cutoff,season,'multiseason',prior);
   const teams={};for(const [t,team] of Object.entries(base.teams))teams[t]={...team,features:{...team.features,'5on5':{...team.features['5on5'],adjustedXgf60:team.features['5on5'].xgf60,adjustedXga60:team.features['5on5'].xga60}}};models['no-score-adjustment']={...base,teams};
   const neutral={};for(const [t,team] of Object.entries(base.teams))neutral[t]={...team,features:{...team.features,'5on5':{...team.features['5on5'],adjustedXga60:base.league['5on5'].adjustedXga60},'4on5':{...team.features['4on5'],xga60:base.league['4on5'].xga60}}};models['no-opponent-suppression']={...base,teams:neutral};lastDate=g.date;
  }
  const earlier=t=>rowsByTeam[t].filter(x=>x.date<g.date).at(-1);const rest=t=>{const p=earlier(t);return p?(Date.parse(g.date)-Date.parse(p.date))/86400000:null;};
  const context={homeA:!g.neutral,restA:rest(g.home),restB:rest(g.away)};const expected=scoringEnvironment(base,g.home,g.away,context),prob=exactProbabilities(expected,config),y=g.homeScore>g.awayScore?1:0;const row={gameId:g.id,date:g.date,p:prob.fullGameA,y,home:g.home,away:g.away,games:Math.min(base.teams[g.home].games,base.teams[g.away].games),overtime:prob.overtime,actualOvertime:g.ending!=='REG'?1:0};
  append(season,'stock',row);
  for(const ablation of ['no-goalie','half-goalie','double-goalie','no-special','no-finishing','no-home','no-rest','no-other'])append(season,ablation,{...row,p:exactProbabilities(changedExpected(expected,ablation,base),config).fullGameA});
  for(const [name,model] of Object.entries(models)){const e=scoringEnvironment(model,g.home,g.away,context);append(season,name,{...row,p:exactProbabilities(e,config).fullGameA});}
  for(const shootoutShare of [0,.5,1])append(season,'OT:shootoutShare'+shootoutShare,{...row,p:exactProbabilities(expected,{...config,shootoutShare}).fullGameA});
  for(const name of signals)for(const coefficient of [-.5,.5])append(season,'signal:'+name+':'+coefficient,{...row,p:sigmoid(logit(row.p)+coefficient*(signal(base.teams[g.home],name)-signal(base.teams[g.away],name)))});
  // A legitimate process-only baseline: last10 xG share with season prior, no result form.
  const share=t=>{const w=t.windows.last10,s=t.windows.season;return((w.xgShare??.5)*w.games+(s.xgShare??.5)*10)/(w.games+10);};
  append(season,'baseline:recent-xg',{...row,p:clamp(.5+.8*(share(base.teams[g.home])-share(base.teams[g.away])),.05,.95)});
  if(index%300===0)console.log(`Validation study ${index}/${targets.length}`);
 }
}
const metrics={};for(const [season,variants] of Object.entries(rows)){metrics[season]={};for(const [name,rs] of Object.entries(variants))metrics[season][name]={...probabilityMetrics(rs),early:probabilityMetrics(rs.filter(r=>r.games<20)),established:probabilityMetrics(rs.filter(r=>r.games>=20))};}
// Temporal validation split for probability calibration; no 2025 outcomes fit these parameters.
const stock=rows[2024].stock,split=Math.floor(stock.length*2/3),fit=stock.slice(0,split),check=stock.slice(split);
function loss(rs,slope,intercept=0){return probabilityMetrics(rs.map(r=>({...r,p:sigmoid(slope*logit(r.p)+intercept)}))).logLoss;}
function fitSlope(rs){let best={slope:1,intercept:0,loss:loss(rs,1)};for(let slope=.4;slope<=1.40001;slope+=.025)for(let intercept=-.15;intercept<=.15001;intercept+=.025){const value=loss(rs,slope,intercept);if(value<best.loss)best={slope:Number(slope.toFixed(3)),intercept:Number(intercept.toFixed(3)),loss:value};}return best;}
const innerFit=fitSlope(fit),checkRaw=probabilityMetrics(check),checkCal=probabilityMetrics(check.map(r=>({...r,p:sigmoid(innerFit.slope*logit(r.p)+innerFit.intercept)}))),allFit=fitSlope(stock);
const decision={modelChanges:[],calibrationCandidate:innerFit,temporalCheck:{raw:checkRaw,calibrated:checkCal},allValidationFit:allFit,calibrationAdopt:checkCal.logLoss<checkRaw.logLoss-.001&&checkCal.brier<checkRaw.brier-.0005,rule:'Adopt calibration only if late-validation log loss improves >0.001 AND Brier >0.0005. Freeze fit on full validation before reading holdout.',selectedRecencyBaseline:Object.entries(metrics[2024]).filter(([k])=>k.startsWith('recency:')||k==='baseline:recent-xg').sort((a,b)=>a[1].logLoss-b[1].logLoss)[0][0]};
const report={protocol:'All studies fit/evaluate 2024 validation only. Original 2025 holdout previously reported, never used here to pick decisions. 2026 43-game sample reserved until decisions frozen; not an adequate independent full season.',generatedAt:new Date().toISOString(),config,metrics,decision,validationPredictions:rows[2024]};fs.writeFileSync(output,JSON.stringify(report)+'\n');console.log(JSON.stringify({decision,bestValidation:Object.entries(metrics[2024]).map(([name,m])=>({name,brier:m.brier,logLoss:m.logLoss})).sort((a,b)=>a.logLoss-b.logLoss).slice(0,12)},null,2));
