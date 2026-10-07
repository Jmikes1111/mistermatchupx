import {simulate,explain,selfTest,scoringEnvironment} from './model.js';
const el=id=>document.getElementById(id);let model,data;
const percent=p=>(p*100).toFixed(1)+'%';const fmt=(x,d=2)=>Number.isFinite(x)?x.toFixed(d):'unavailable';
function context(){
 const result={homeA:el('homeTeam').checked};
 for(const [i,key] of [[1,'goalieA'],[2,'goalieB']]){
  const team=model.teams[el('team'+i).value],value=el('goalie'+i).value;
  if(value!=='unknown')result[key]={id:value,status:'projected',source:'Hypothetical scenario using MoneyPuck past appearances, not a starter report',observedAt:team.goalie.sourceTimestamp};
 }return result;
}
function refreshTeams(){
 el('results').classList.remove('show');el('formTables').replaceChildren();
 for(const i of [1,2]){
  const team=model.teams[el('team'+i).value],select=el('goalie'+i);select.replaceChildren(new Option('Unknown starter — workload-weighted expectation','unknown'));
  for(const goalie of team.goalie.candidates)select.add(new Option(goalie.name+' — hypothetical scenario',goalie.id));
  const heading=document.createElement('p');heading.textContent=team.name+' · 5v5 game-level form';el('formTables').append(heading);
  const table=document.createElement('table');const head=document.createElement('tr');
  for(const title of ['Window','Games','xGF/60','xGA/60','xG%','Shot%','HD%','Goal diff','Goalie GSAx']){const th=document.createElement('th');th.textContent=title;head.append(th);}table.append(head);
  for(const [key,label] of [['last5','Last 5'],['last10','Last 10'],['last20','Last 20'],['season','Season']]){
   const f=team.windows[key],row=document.createElement('tr');
   const values=[label,f.games,fmt(f.xgf60),fmt(f.xga60),f.xgShare===null?'unavailable':percent(f.xgShare),f.shotShare===null?'unavailable':percent(f.shotShare),f.highDangerShare===null?'unavailable':percent(f.highDangerShare),fmt(f.goalDifferential,0),f.goalieObservations?fmt(f.goalieGsax):'unavailable'];
   for(const value of values){const td=document.createElement('td');td.textContent=value;row.append(td);}table.append(row);
  }el('formTables').append(table);
 }
}
function run(){
 const a=el('team1').value,b=el('team2').value;if(a===b){alert('Please select two different teams.');return;}
 const controls=['team1','team2','homeTeam','goalie1','goalie2'];for(const id of controls)el(id).disabled=true;
 el('runButton').disabled=true;el('again').disabled=true;el('status').textContent='Running 10,000 NHL simulations…';
 setTimeout(()=>{
  try{
   const inputs=context(),r=simulate(model,a,b,inputs),winner=r.fullGameA>=.5?a:b;
   el('winner').textContent=model.teams[winner].name;el('confidence').textContent='FULL-GAME MODEL EDGE · '+percent(Math.max(r.fullGameA,r.fullGameB));
   for(const [i,t,p,score,expected] of [[1,a,r.fullGameA,r.averageA,r.exact.regulationMeanA],[2,b,r.fullGameB,r.averageB,r.exact.regulationMeanB]]){
    el('team'+i+'Result').textContent=model.teams[t].name;el('prob'+i).textContent=i===1?percent(p):(100-Number(percent(r.fullGameA).slice(0,-1))).toFixed(1)+'%';
    el('score'+i).textContent=`Projected final score: ${fmt(score,1)} · Expected regulation goals: ${fmt(expected,2)}`;
   }
   el('regulation').textContent=`Regulation: ${model.teams[a].name} ${percent(r.regulationA)}, ${model.teams[b].name} ${percent(r.regulationB)}. Tied after regulation / OT probability: ${percent(r.overtime)}. Displayed probabilities and score means are analytical; 10,000 trials validate the same scoring model. Every trial resolves to a full-game winner; an OT/shootout winner adds one goal.`;
   const base=scoringEnvironment(model,a,b,{homeA:inputs.homeA});
   el('goalieImpact').textContent=`Goalies: ${r.expected.goalieA.status} / ${r.expected.goalieB.status}. Scenario impact on opponent goal-rate input: ${fmt(r.expected.b-base.b)} / ${fmt(r.expected.a-base.a)}. No goalie is confirmed by this prototype.`;
   el('whyText').textContent=explain(model,a,b,r);el('results').classList.add('show');el('status').textContent='Simulation complete — 10,000 NHL games simulated.';el('results').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(error){el('status').textContent='NHL simulation failed: '+error.message;}
  finally{for(const id of controls)el(id).disabled=false;el('runButton').disabled=false;el('again').disabled=false;}
 },30);
}
async function initialize(){
 try{
  const response=await fetch(new URL('../../data/nhl/snapshot.json',import.meta.url),{cache:'no-cache'});if(!response.ok)throw Error('NHL snapshot unavailable');data=await response.json();model=data.model;
  if(data.metadata.sport!=='NHL'||Object.keys(model.teams).length!==32)throw Error('Invalid NHL snapshot');
  for(const [code,team] of Object.entries(model.teams).sort((a,b)=>a[1].name.localeCompare(b[1].name)))for(const id of ['team1','team2'])el(id).add(new Option(team.name,code));
  el('team1').value='CAR';el('team2').value='NYR';refreshTeams();
  const m=data.metadata;el('dataInfo').textContent=`Data through: ${m.dataThrough} · NHL V1.1 experimental · MoneyPuck-derived process data`;
  el('dataDetails').textContent=`Sources retrieved: ${new Date(m.sourcesRetrieved.earliest).toLocaleString()} – ${new Date(m.sourcesRetrieved.latest).toLocaleString()}. Model built: ${new Date(m.modelBuiltAt).toLocaleString()}. Seasons/games: ${Object.entries(m.seasons).map(([s,n])=>`${s}–${Number(s)+1}: ${n}`).join('; ')}. Recency ${model.config.recency}; ${model.config.regulation?.family??model.config.distribution} regulation scoring. ${m.evaluationMode}`;
  el('status').textContent=`NHL engine self-test: ${selfTest(model)}/50 passed. Ready.`;el('runButton').disabled=false;
  el('runButton').addEventListener('click',run);el('again').addEventListener('click',run);el('newMatchup').addEventListener('click',()=>{el('results').classList.remove('show');window.scrollTo({top:0,behavior:'smooth'});});
  for(const id of ['team1','team2'])el(id).addEventListener('change',refreshTeams);
  for(const id of ['homeTeam','goalie1','goalie2'])el(id).addEventListener('change',()=>el('results').classList.remove('show'));
 }catch(error){el('status').textContent='NHL model unavailable: '+error.message;el('dataInfo').textContent='No NHL substitute ratings generated.';}
}
initialize();
