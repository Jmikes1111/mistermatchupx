import {readFileSync,writeFileSync} from 'node:fs';
import {buildRatings,simulate,seededRandom,validateSnapshot,MODEL_VERSION} from '../js/model.js';
import {evaluate} from '../js/evaluation.js';
const data=validateSnapshot(JSON.parse(readFileSync(new URL('../data/snapshot.json',import.meta.url))));
const season=Number(process.argv[2] || data.metadata.season);
const predictions=[];
for(const game of data.games.filter(g=>g.season===season && g.availableAt<data.metadata.asOf)){
  // Midnight on game day is conservative: excludes all same-day and future games.
  const cutoff=game.date+'T00:00:00Z';
  const model=buildRatings(data,{asOf:cutoff,season,useStarters:false});
  if(model.observations<32)continue;
  const result=simulate(model,game.home,game.away,{homeA:!game.neutral,restA:game.homeRest,restB:game.awayRest},{random:seededRandom(predictions.length+1)});
  predictions.push({gameId:game.id,cutoff,probability:result.probabilityA,outcome:game.homeScore>game.awayScore?1:game.homeScore<game.awayScore?0:.5,predictedMargin:result.expected.a-result.expected.b,actualMargin:game.homeScore-game.awayScore,featureGames:model.observations});
}
const output={modelVersion:MODEL_VERSION,season,generatedAt:new Date().toISOString(),sourceSnapshot:data.metadata.modelBuiltAt,mode:'Retrospective walk-forward; corrected datasets are not archived pre-game vintages. No final-game QB IDs, market odds, or current depth charts used.',...evaluate(predictions),predictions};
const path=new URL(`../data/backtest-${season}.json`,import.meta.url);writeFileSync(path,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({season,games:output.games,accuracy:output.accuracy,brier:output.brier,logLoss:output.logLoss,ats:output.ats,mode:output.mode},null,2));
