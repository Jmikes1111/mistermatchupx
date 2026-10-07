import fs from 'node:fs';
import zlib from 'node:zlib';
import {performance} from 'node:perf_hooks';
import {validateHistory,buildModel,scoringEnvironment,exactProbabilities,DEFAULT_CONFIG,RECENCY} from '../../js/nhl/model.js';
import {probabilityMetrics,goalPmf,clamp} from '../../js/shared/statistics.js';
if(fs.existsSync(new URL('../../data/nhl/draw-decision.json',import.meta.url))){
 console.log('NHL V1.1 draw model is frozen. Read draw-summary.json/draw-holdout.json; use the documented draw-model evaluation workflow. Holdout is not rerun and serving configuration is not overwritten.');
 process.exit(0);
}
const root=new URL('../../',import.meta.url),data=validateHistory(JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('data/nhl/history.json.gz',root)))));
const training=data.games.filter(g=>g.season===2023);
if(training.length<500)throw Error('Insufficient training data');
const scores=training.flatMap(g=>[g.regHome,g.regAway]);const mean=scores.reduce((a,b)=>a+b)/scores.length,variance=scores.reduce((a,b)=>a+(b-mean)**2,0)/(scores.length-1);
const dispersion=variance>mean?clamp(mean*mean/(variance-mean),2,200):200;
const homeFactor=clamp(Math.sqrt(training.reduce((s,g)=>s+g.regHome,0)/training.reduce((s,g)=>s+g.regAway,0)),1,1.12);
const homeBaseline=training.filter(g=>g.homeScore>g.awayScore).length/training.length;
const so=training.filter(g=>g.ending==='SO').length,extra=training.filter(g=>g.ending!=='REG').length;
const decisionPath=new URL('data/nhl/audit-decision.json',root);
const frozen=fs.existsSync(decisionPath)?JSON.parse(fs.readFileSync(decisionPath)):null;
const candidates=RECENCY.flatMap(recency=>['poisson','negative-binomial'].map(distribution=>({...DEFAULT_CONFIG,recency,distribution,dispersion,homeFactor,shootoutShare:so/extra})));
if(frozen)candidates.push(frozen.selectedConfig);
function rest(data,game,t){const earlier=data.games.filter(g=>g.date<game.date&&(g.home===t||g.away===t));const previous=earlier.at(-1);return previous?Math.round((Date.parse(game.date)-Date.parse(previous.date))/86400000):null;}
const baselineRows={};const results={};
for(const season of [2024,2025]){
 const targets=data.games.filter(g=>g.season===season);const rows=candidates.map(()=>[]),scoreLoss=candidates.map(()=>0);
 const baselines={coin:[],home:[],record:[],seasonXg:[],simpleXg:[]};
 let models=[],lastDay=null;const start=performance.now();
 for(const [index,g] of targets.entries()){
  if(g.date!==lastDay){
   const built=new Map();models=candidates.map(config=>{const key=config.recency+':'+(config.goalieRecentWeight??.3);if(!built.has(key))built.set(key,buildModel(data,{season,asOf:g.date+'T00:00:00Z',config}));return built.get(key);});lastDay=g.date;
  }
  const y=g.homeScore>g.awayScore?1:0;
  const base=models[0],A=base.teams[g.home],B=base.teams[g.away];
  const recordShare=t=>{const w=t.windows.season;return(w.wins+5)/(w.games+10);};
  const xgShare=t=>t.windows.season.xgShare??.5;
  baselines.coin.push({p:.5,y});baselines.home.push({p:g.neutral?.5:homeBaseline,y});
  baselines.record.push({p:clamp(.5+.5*(recordShare(A)-recordShare(B)),.05,.95),y});
  baselines.seasonXg.push({p:clamp(.5+.8*(xgShare(A)-xgShare(B)),.05,.95),y});
  const fa=A.features['5on5'],fb=B.features['5on5'];const simple={a:Math.sqrt(fa.xgf60*fb.xga60),b:Math.sqrt(fb.xgf60*fa.xga60)};
  baselines.simpleXg.push({p:exactProbabilities(simple,{distribution:'poisson',shootoutShare:so/extra}).fullGameA,y});
  const context={homeA:!g.neutral,restA:rest(data,g,g.home),restB:rest(data,g,g.away)};
  for(let i=0;i<candidates.length;i++){
   const config=candidates[i],model={...models[i],config};
   const expected=scoringEnvironment(model,g.home,g.away,context),prob=exactProbabilities(expected,config);
   rows[i].push({gameId:g.id,cutoff:g.date+'T00:00:00Z',p:prob.fullGameA,y,regulationA:prob.regulationA,regulationB:prob.regulationB,overtime:prob.overtime,expectedA:expected.a,expectedB:expected.b});
   const pmfA=goalPmf(expected.a,config.distribution,dispersion),pmfB=goalPmf(expected.b,config.distribution,dispersion);
   scoreLoss[i]-=Math.log(Math.max(1e-12,(pmfA[g.regHome]||0)*(pmfB[g.regAway]||0)));
  }
  if(index%300===0)console.log(`Evaluated season ${season}: ${index}/${targets.length}`);
 }
 results[season]=candidates.map((config,i)=>({config,...probabilityMetrics(rows[i]),regulationScoreLogLoss:scoreLoss[i]/targets.length,predictions:rows[i]}));
 baselineRows[season]=Object.fromEntries(Object.entries(baselines).map(([k,v])=>[k,probabilityMetrics(v)]));
 console.log(`Season ${season} evaluated in ${((performance.now()-start)/1000).toFixed(1)}s`);
}
// Select on validation 2024 only, then report untouched 2025. Never tune on holdout.
const selected=frozen?results[2024].find(e=>JSON.stringify(e.config)===JSON.stringify(frozen.selectedConfig)):[...results[2024]].sort((a,b)=>a.logLoss-b.logLoss||a.brier-b.brier)[0];
const config=selected.config;
const report={mode:data.metadata.evaluationMode,training:{season:2023,games:training.length,regulationMean:mean,regulationVariance:variance,negativeBinomialDispersion:dispersion,homeFactor,homeBaseline,shootoutShare:so/extra},validationSeason:2024,holdoutSeason:2025,selectedConfig:config,selectionRule:frozen?'Configuration frozen by documented temporal 2024 audit decision before holdout evaluation; see audit-decision.json. No holdout tuning.':'Lowest 2024 validation moneyline log loss; Brier tie-break. 2025 is holdout, no tuning.',baselines:baselineRows,results:Object.fromEntries(Object.entries(results).map(([year,entries])=>[year,entries.map(({predictions,...entry})=>entry)])),selectedPredictions:Object.fromEntries(Object.entries(results).map(([year,entries])=>[year,entries.find(e=>JSON.stringify(e.config)===JSON.stringify(config)).predictions])),sourceModelBuiltAt:data.metadata.modelBuiltAt,generatedAt:new Date().toISOString()};
fs.writeFileSync(new URL('data/nhl/evaluation.json',root),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(new URL('data/nhl/config.json',root),JSON.stringify(config,null,2)+'\n');
console.log(JSON.stringify({selected:config,holdout:report.results[2025].find(e=>JSON.stringify(e.config)===JSON.stringify(config)),baselines:baselineRows[2025]},null,2));
