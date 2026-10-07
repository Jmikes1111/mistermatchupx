/** No outcomes beyond training/validation are read into the candidate study. */
import fs from 'node:fs';import zlib from 'node:zlib';import {buildModel,scoringEnvironment,exactProbabilities} from '../../js/nhl/model.js';
const root=new URL('../../',import.meta.url),history=JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('data/nhl/history.json.gz',root)))),config=JSON.parse(fs.readFileSync(new URL('data/nhl/config.json',root)));
export const frozenStrength=Object.fromEntries(Object.entries(config).filter(([key])=>!['regulation','overtimeMode'].includes(key)));
export function features(seasons){
 const allowed=history.games.filter(g=>seasons.includes(g.season)),byTeam=Object.fromEntries(Object.keys(history.teams).map(t=>[t,history.games.filter(g=>g.home===t||g.away===t)])),result=[];let model,day;
 for(const [index,g] of allowed.entries()){
  const cutoff=g.date+'T00:00:00Z';if(day!==g.date){model=buildModel(history,{season:g.season,asOf:cutoff,config:frozenStrength});day=g.date;}
  const rest=t=>{const previous=byTeam[t].filter(x=>x.date<g.date).at(-1);return previous?(Date.parse(g.date)-Date.parse(previous.date))/86400000:null;};
  const expected=scoringEnvironment(model,g.home,g.away,{homeA:!g.neutral,restA:rest(g.home),restB:rest(g.away)});
  const pregame=exactProbabilities(expected,frozenStrength),allHome=g.sides[g.home].all,allAway=g.sides[g.away].all;
  result.push({gameId:g.id,season:g.season,date:g.date,cutoff,a:expected.a,b:expected.b,home:g.home,away:g.away,neutral:g.neutral,regHome:g.regHome,regAway:g.regAway,draw:g.regHome===g.regAway?1:0,y:g.homeScore>g.awayScore?1:0,favorite:Math.max(pregame.fullGameA,pregame.fullGameB),actualTotalXg:allHome.xgf+allAway.xgf,actualShots:allHome.sf+allAway.sf});
  if(index%400===0)console.log(`Pregame features ${seasons.join(',')}: ${index}/${allowed.length}`);
 }return result;
}
if(process.argv[1]===new URL(import.meta.url).pathname){fs.mkdirSync('/tmp/nhl-draw-v11',{recursive:true});fs.writeFileSync('/tmp/nhl-draw-v11/training-validation-features.json',JSON.stringify(features([2023,2024]))+'\n');}
