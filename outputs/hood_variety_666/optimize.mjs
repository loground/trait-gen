import fs from 'node:fs';
import vm from 'node:vm';
import {findCombinationViolation} from '../../src/ruleValidation.js';
const original=JSON.parse(fs.readFileSync('/Users/nikitavoronin/Downloads/ye_arts/trait-collection-nft-drop (1)/project-backup.json','utf8'));
const code=fs.readFileSync('src/App.jsx','utf8');
const ctx=new Function('findCombinationViolation', code.slice(code.indexOf('function buildUniqueRandomCombinations('),code.indexOf('async function loadImageFromFile('))+';return {getActiveCategories,buildUniqueRandomCombinations,makeCombinationKey}')(findCombinationViolation);
const backup=structuredClone(original);
for(const c of backup.source.categories){
 c.selectionMode='weighted'; c.noneWeight=0;
 for(const t of c.traits)t.weight=1;
 if(c.name==='2 pants')c.noneWeight=10/22;
 if(c.name==='3 body hands')for(const t of c.traits)t.weight=t.name==='RH'?100:0.01;
 if(c.name==='8 item'){c.noneWeight=70;for(const t of c.traits)t.weight=3;}
 if(c.name==='9 effects'){c.noneWeight=75;for(const t of c.traits)t.weight=25/9;}
 if(c.name==='10 gesture'){c.noneWeight=75;for(const t of c.traits)t.weight=25/7;}
}
const categories=backup.source.categories.map(c=>({...c,traits:c.traits.map(t=>({...t,category:c.name}))}));
const rules=backup.source;
const active=ctx.getActiveCategories(categories);
let best=null;
for(let i=0;i<1500;i++){
 const seed=`hood-variety-666-${i}`;
 const combos=ctx.buildUniqueRandomCombinations(active,666,seed,rules);
 const counts=new Map(categories.flatMap(c=>c.traits.map(t=>[t.id,0])));
 let invalid=false; const tiers=[0,0,0,0]; const optional=[0,0,0]; const masks=Array(8).fill(0);
 for(const combo of combos){
  const body=combo.find(t=>t.category==='3 body hands');const pants=combo.find(t=>t.category==='2 pants');
  if(pants.isNone&&body.name!=='RH'){invalid=true;break;}
  let mask=0;
  for(const t of combo)if(!t.isNone){counts.set(t.id,counts.get(t.id)+1); const j=['8 item','9 effects','10 gesture'].indexOf(t.category);if(j>=0){optional[j]++;mask|=1<<j;}}
  masks[mask]++;tiers[mask.toString(2).replaceAll('0','').length]++;
 }
 if(invalid||tiers[3]!==8||Math.min(...counts.values())<=8||optional.some((n,j)=>Math.abs(n-[200,167,167][j])>14))continue;
 let score=0;
 for(const c of categories){const ns=c.traits.map(t=>counts.get(t.id));const avg=ns.reduce((a,b)=>a+b,0)/ns.length;score+=ns.reduce((s,n)=>s+(n-avg)**2/avg,0);}
 // Reward varied pairings of visually prominent layers.
 for(const [a,b] of [[0,4],[3,4],[4,5],[5,7]]){const pairs=new Set(combos.map(c=>c[a].id+'|'+c[b].id));score+=(666-pairs.size)*0.12;}
 if(!best||score<best.score)best={seed,score,combos,tiers,optional,masks,counts:Object.fromEntries(counts)};
}
if(!best)throw Error('No qualifying seed');
backup.project.seed=best.seed;backup.savedAt=new Date().toISOString();
fs.writeFileSync('outputs/hood_variety_666/project-backup.json',JSON.stringify(backup,null,2)+'\n');
fs.writeFileSync('outputs/hood_variety_666/verification.json',JSON.stringify({...best,combos:best.combos.map(c=>c.filter(t=>!t.isNone).map(t=>t.id))},null,2));
console.log(JSON.stringify({seed:best.seed,score:best.score,tiers:best.tiers,optional:best.optional,masks:best.masks,minTrait:Math.min(...Object.values(best.counts)),unique:new Set(best.combos.map(ctx.makeCombinationKey)).size,traits:Object.keys(best.counts).length}));
