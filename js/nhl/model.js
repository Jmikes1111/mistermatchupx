import {clamp,randomSeed} from '../shared/statistics.js';
import {regulationDistribution,outcomeProbabilities,scoreSampler} from './regulation.js';
export const RECENCY=['season-heavy','last-20-heavy','last-10-heavy','last-5-heavy','exponential','blended'];
export const DEFAULT_CONFIG={recency:'season-heavy',distribution:'poisson',dispersion:20,homeFactor:1.035,regressionGames:10};
const sum=(rows,key,weight=()=>1)=>rows.reduce((s,r)=>s+(Number.isFinite(r[key])?r[key]*weight(r):0),0);
const ratio=(a,b)=>b>0?a/b:null;
const average=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
export function validateHistory(data){
 if(data.metadata?.sport!=='NHL'||Object.keys(data.teams||{}).length!==32||!Array.isArray(data.games))throw Error('Invalid NHL history');
 const ids=new Set();for(const g of data.games){if(ids.has(g.id)||!data.teams[g.home]||!data.teams[g.away]||g.home===g.away||!['REG','OT','SO'].includes(g.ending)||!Number.isFinite(Date.parse(g.availableAt)))throw Error('Invalid NHL game identity');ids.add(g.id);for(const t of [g.home,g.away])for(const sit of ['all','5on5']){const s=g.sides?.[t]?.[sit];if(!s||!['seconds','xgf','xga','gf','ga'].every(k=>Number.isFinite(s[k])&&s[k]>=0))throw Error('Invalid NHL metric');}if(g.ending!=='REG'&&g.regHome!==g.regAway)throw Error('Invalid regulation tie');}
 return data;
}
function form(rows,situation='5on5',weight=()=>1){
 const values=rows.map(g=>({...g.sides[g.t]?.[situation],date:g.date})).filter(s=>s.seconds>0);
 const seconds=sum(values,'seconds',weight),sf=sum(values,'sf',weight),sa=sum(values,'sa',weight),xgf=sum(values,'xgf',weight),xga=sum(values,'xga',weight),gf=sum(values,'gf',weight),ga=sum(values,'ga',weight);
 const rate=k=>ratio(sum(values,k,weight)*3600,seconds);
 return{games:rows.length,observations:values.length,seconds,xgf,xga,gf,ga,sf,sa,xgf60:rate('xgf'),xga60:rate('xga'),adjustedXgf60:rate('adjustedXgf'),adjustedXga60:rate('adjustedXga'),xgShare:ratio(xgf,xgf+xga),shotShare:ratio(sf,sf+sa),corsiShare:ratio(sum(values,'cf',weight),sum(values,'cf',weight)+sum(values,'ca',weight)),fenwickShare:ratio(sum(values,'ff',weight),sum(values,'ff',weight)+sum(values,'fa',weight)),chanceShare:ratio(sum(values,'mdf',weight)+sum(values,'hdf',weight),sum(values,'mdf',weight)+sum(values,'hdf',weight)+sum(values,'mda',weight)+sum(values,'hda',weight)),highDangerShare:ratio(sum(values,'hdf',weight),sum(values,'hdf',weight)+sum(values,'hda',weight)),highDangerFor:sum(values,'hdf',weight),shooting:ratio(gf,sf),expectedShooting:ratio(xgf,sf),goalDifferential:gf-ga,finishing:ratio(gf,xgf),secondsPerGame:ratio(seconds,values.reduce((n,v)=>n+weight(v),0))};
}
function blendFeatures(season,recent,weight){const result={...season};for(const key of ['xgf60','xga60','adjustedXgf60','adjustedXga60','finishing','secondsPerGame'])if(Number.isFinite(recent[key]))result[key]=Number.isFinite(season[key])?(1-weight)*season[key]+weight*recent[key]:recent[key];return result;}
function aggregate(rows,recency,sit,asOf){
 const season=form(rows,sit);if(recency==='exponential')return form(rows,sit,r=>Math.pow(.5,(Date.parse(asOf)-Date.parse(r.date))/86400000/30));
 const settings={'season-heavy':[20,.15],'last-20-heavy':[20,.75],'last-10-heavy':[10,.75],'last-5-heavy':[5,.75]};
 if(recency==='blended'){let v=blendFeatures(season,form(rows.slice(-20),sit),.4);v=blendFeatures(v,form(rows.slice(-10),sit),.35);return blendFeatures(v,form(rows.slice(-5),sit),.2);}
 const [window,weight]=settings[recency];return blendFeatures(season,form(rows.slice(-window),sit),weight);
}
function goalieQuality(rows,recentWeight=.3){
 const seconds=sum(rows,'seconds'),xga=sum(rows,'xga'),ga=sum(rows,'ga'),shots=sum(rows,'shots');
 const seasonRate=ratio((xga-ga)*3600,seconds)??0,recent=rows.slice(-10),rs=sum(recent,'seconds'),recentRate=ratio((sum(recent,'xga')-sum(recent,'ga'))*3600,rs)??0;
 const regressed=clamp(((1-recentWeight)*seasonRate+recentWeight*recentRate)*seconds/(seconds+36000),-.65,.65);
 return{games:rows.length,seconds,gsax:xga-ga,gsax60:ratio((xga-ga)*3600,seconds),recentGsax:sum(recent,'xga')-sum(recent,'ga'),savePercentage:shots>0?1-ga/shots:null,expectedSavePercentageProxy:shots>0?1-xga/shots:null,saveAboveExpected:shots>0?(xga-ga)/shots:null,xgaa:ratio(xga*3600,seconds),regressedGsax60:regressed,lastAppearance:rows.at(-1)?.date||null,highDanger:{shots:sum(rows,'hdShots'),goals:sum(rows,'hdGa'),xga:sum(rows,'hdXga')},mediumDanger:{shots:sum(rows,'mdShots'),goals:sum(rows,'mdGa')},lowDanger:{shots:sum(rows,'ldShots'),goals:sum(rows,'ldGa')}};
}
export function buildModel(data,{asOf=data.metadata.asOf,season=Math.max(...Object.keys(data.metadata.seasons).map(Number)),config=DEFAULT_CONFIG}={}){
 if(!Number.isFinite(Date.parse(asOf))||Date.parse(asOf)>Date.parse(data.metadata.asOf)||!RECENCY.includes(config.recency))throw Error('Invalid cutoff/recency');
 const eligible=data.games.filter(g=>Date.parse(g.availableAt)<Date.parse(asOf)&&g.season<=season&&g.season>=season-1);
 const byTeam=Object.fromEntries(Object.keys(data.teams).map(t=>[t,[]]));
 for(const g of eligible)for(const t of [g.home,g.away])byTeam[t].push({...g,t});
 for(const rows of Object.values(byTeam))rows.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 const all=Object.values(byTeam).flat(),league={};
 for(const sit of ['5on5','5on4','4on5','all'])league[sit]=form(all,sit);
 const goalieRows=(data.goalieGames||[]).filter(r=>Date.parse(r.availableAt)<Date.parse(asOf));
 const goalieByTeam={};for(const r of goalieRows)(goalieByTeam[r.team]??=[]).push(r);
 const byGoalie=new Map();for(const r of goalieRows){const rs=byGoalie.get(r.id)||[];rs.push(r);byGoalie.set(r.id,rs);}
 for(const rs of byGoalie.values())rs.sort((a,b)=>a.date.localeCompare(b.date));
 const goalies=Object.fromEntries([...byGoalie].map(([id,rs])=>[id,{id,name:rs.at(-1).name,...goalieQuality(rs,config.goalieRecentWeight??.3)}]));
 const teams={};
 for(const [t,rows] of Object.entries(byTeam)){
  const current=rows.filter(r=>r.season===season),prior=rows.filter(r=>r.season<season),windows={};
  for(const [label,count] of [['last5',5],['last10',10],['last20',20],['season',Infinity]]){
   const rs=count===Infinity?current:current.slice(-count);windows[label]=form(rs);windows[label].wins=rs.filter(r=>(r.home===t?r.homeScore>r.awayScore:r.awayScore>r.homeScore)).length;
   windows[label].powerPlay=form(rs,'5on4');windows[label].penaltyKill=form(rs,'4on5');
   const gameIds=new Set(rs.map(r=>r.id));const appearances=(goalieByTeam[t]||[]).filter(r=>gameIds.has(r.gameId));windows[label].goalieGsax=sum(appearances,'xga')-sum(appearances,'ga');windows[label].goalieObservations=appearances.length;
  }
  const features={};
  for(const sit of ['5on5','5on4','4on5']){
   const f=aggregate(current,config.recency,sit,asOf),p=form(prior,sit),leagueRate=league[sit];const n=f.observations;
   features[sit]={};for(const key of ['adjustedXgf60','adjustedXga60','xgf60','xga60','finishing','secondsPerGame']){
    const baseline=Number.isFinite(p[key])?p[key]:Number.isFinite(leagueRate[key])?leagueRate[key]:key==='finishing'?1:key==='secondsPerGame'?(sit==='5on5'?2850:300):sit==='5on5'?2.5:6;
    features[sit][key]=Number.isFinite(f[key])?(f[key]*n+baseline*config.regressionGames)/(n+config.regressionGames):baseline;
   }
  }
  const recentIds=new Set(rows.slice(-10).map(r=>r.id));const workload=new Map();
  for(const r of (goalieByTeam[t]||[]).filter(r=>recentIds.has(r.gameId)))workload.set(r.id,(workload.get(r.id)||0)+r.seconds);
  const total=[...workload.values()].reduce((a,b)=>a+b,0);
  const mixture=[...workload].map(([id,seconds])=>({...goalies[id],weight:seconds/total})).sort((a,b)=>b.weight-a.weight);
  teams[t]={name:data.teams[t],features,windows,games:current.length,priorGames:prior.length,goalie:{status:'unknown',assumption:'Probability-weighted recent workload; no confirmed starter or current roster assertion',source:'MoneyPuck observed game appearances',sourceTimestamp:rows.at(-1)?.availableAt||null,candidates:mixture,gsax60:mixture.reduce((a,b)=>a+b.weight*b.regressedGsax60,0)},lastGame:rows.at(-1)?.date||null};
 }
 return{teams,goalies,league,config:{...config},asOf,season,observations:eligible.length};
}
function selectGoalie(model,team,input){
 const expected=model.teams[team].goalie;if(!input||input.status==='unknown')return expected;
 if(!['projected','confirmed'].includes(input.status)||!input.source||!Number.isFinite(Date.parse(input.observedAt))||Date.parse(input.observedAt)>=Date.parse(model.asOf))throw Error('Starter status requires pre-cutoff source and timestamp');
 const available=expected.candidates.find(g=>g.id===input.id);if(!available)throw Error('Goalie has no eligible team-workload observations');
 return{status:input.status,assumption:input.status+' starter supplied by '+input.source,source:input.source,sourceTimestamp:input.observedAt,candidates:[{...available,weight:1}],gsax60:available.regressedGsax60};
}
export function scoringEnvironment(model,a,b,context={}){
 if(a===b||!model.teams[a]||!model.teams[b])throw Error('Select two different NHL teams');
 const A=model.teams[a],B=model.teams[b],ga=selectGoalie(model,a,context.goalieA),gb=selectGoalie(model,b,context.goalieB);
 const fallback=(x,f)=>Number.isFinite(x)&&x>0?x:f;
 function scoring(off,def,goalie){
  const ev=off.features['5on5'],opp=def.features['5on5'],pp=off.features['5on4'],pk=def.features['4on5'];
  const leagueEv=fallback(model.league['5on5'].adjustedXgf60,2.5),leaguePp=fallback(model.league['5on4'].xgf60,6);
  const minutes=clamp((ev.secondsPerGame+opp.secondsPerGame)/120,38,55);
  const even=ev.adjustedXgf60*opp.adjustedXga60/leagueEv*minutes/60;
  const ppMinutes=clamp((pp.secondsPerGame+pk.secondsPerGame)/120,2,8);
  const special=pp.xgf60*pk.xga60/leaguePp*ppMinutes/60;
  // Other manpower/empty-net residual is an explicit league prior, not another team rating.
  const all=model.league.all,lg5=model.league['5on5'],lgpp=model.league['5on4'];
  const residual=clamp((all.xgf-lg5.xgf-lgpp.xgf)/(all.observations||1),.05,.6);
  const observedFinishing=clamp((ev.finishing*off.windows.season.xgf+150)/(off.windows.season.xgf+150),.9,1.1);
  const finishing=1+(observedFinishing-1)*(model.config.finishingWeight??1);
  return{even,special,other:residual,finishing,goalieEffect:-goalie.gsax60};
 }
 const ca=scoring(A,B,gb),cb=scoring(B,A,ga);
 let expectedA=(ca.even+ca.special+ca.other)*ca.finishing+ca.goalieEffect,expectedB=(cb.even+cb.special+cb.other)*cb.finishing+cb.goalieEffect;
 if(context.homeA){expectedA*=model.config.homeFactor;expectedB/=model.config.homeFactor;}
 let restEffectA=null,restEffectB=null;
 if(Number.isFinite(context.restA)&&Number.isFinite(context.restB)){
  restEffectA=context.restA===1?.95:1;restEffectB=context.restB===1?.95:1;expectedA*=restEffectA;expectedB*=restEffectB;
 }
 return{a:clamp(expectedA,.3,7),b:clamp(expectedB,.3,7),componentsA:ca,componentsB:cb,goalieA:ga,goalieB:gb,context:{homeA:!!context.homeA,restA:context.restA??null,restB:context.restB??null,restEffectA,restEffectB,travel:null,injuries:null,lineups:null}};
}
export function exactProbabilities(expected,config){return outcomeProbabilities(expected,config);}
export function simulate(model,a,b,context={}, {trials=10000,random=Math.random}={}){
 if(!Number.isInteger(trials)||trials<1||trials>1000000)throw Error('Invalid trial count');
 const expected=scoringEnvironment(model,a,b,context),distribution=regulationDistribution(expected,model.config),prob=outcomeProbabilities(expected,model.config,distribution),sample=scoreSampler(distribution);let regA=0,regB=0,ot=0,winsA=0,winsB=0,totalA=0,totalB=0;
 for(let i=0;i<trials;i++){
  let [sa,sb]=sample(random);
  if(sa>sb){regA++;winsA++;}else if(sb>sa){regB++;winsB++;}else{ot++;if(random()<prob.overtimeConditionalA){winsA++;sa++;}else{winsB++;sb++;}}
  totalA+=sa;totalB+=sb;
 }
 // Serve analytical probabilities and means; retain actual 10,000-trial diagnostics.
 return{trials,fullGameA:prob.fullGameA,fullGameB:prob.fullGameB,regulationA:prob.regulationA,regulationB:prob.regulationB,overtime:prob.overtime,averageA:prob.regulationMeanA+prob.overtime*prob.overtimeConditionalA,averageB:prob.regulationMeanB+prob.overtime*(1-prob.overtimeConditionalA),monteCarlo:{fullGameA:winsA/trials,fullGameB:winsB/trials,regulationA:regA/trials,regulationB:regB/trials,overtime:ot/trials,averageA:totalA/trials,averageB:totalB/trials},expected,exact:prob};
}
export function explain(model,a,b,result){
 const winner=result.fullGameA>=.5?a:b,team=model.teams[winner],window=team.windows.last10,parts=[];
 if(window.xgShare!==null)parts.push(`${team.name} controlled ${(100*window.xgShare).toFixed(1)}% of 5v5 expected goals over its last ${window.games} observed current-season games`);
 if(window.highDangerShare!==null)parts.push(`${(100*window.highDangerShare).toFixed(1)}% of high-danger opportunities`);
 const goalie=winner===a?result.expected.goalieA:result.expected.goalieB;parts.push(`goalie status ${goalie.status}: ${goalie.assumption.toLowerCase()}`);
 if(result.expected.context.homeA)parts.push(`home ice applied to ${model.teams[a].name}`);
 if(result.expected.context.restA===1)parts.push(`${model.teams[a].name} on a schedule-derived back-to-back`);
 if(result.expected.context.restB===1)parts.push(`${model.teams[b].name} on a schedule-derived back-to-back`);
 return parts.join('. ')+'. Team creation/suppression, special teams and regressed goalie quality are modeled separately. xG includes shot quality; win/loss form is not a team-strength input. Injuries, travel and lineup availability are not supplied. Probabilities are experimental. '+(model.config.regulation?.family==='draw-logit'?'Regulation draws are calibrated on training data.':'No draw calibration is applied.')+' No separate full-game calibration is applied.';
}
export function selfTest(model){const codes=Object.keys(model.teams);for(let i=0;i<50;i++){const r=simulate(model,codes[i%32],codes[(i+1)%32],{homeA:i%2===0},{random:randomSeed(i+1)});if(!Number.isFinite(r.averageA)||Math.abs(r.fullGameA+r.fullGameB-1)>1e-9||Math.abs(r.regulationA+r.regulationB+r.overtime-1)>1e-9)throw Error('NHL engine self-test failure');}return 50;}
