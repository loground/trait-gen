import json,pathlib,csv,collections,hashlib
from PIL import Image,ImageDraw
out=pathlib.Path('outputs/hood_variety_666');root=pathlib.Path('/Users/nikitavoronin/Downloads/ye_arts/HOOD')
v=json.load(open(out/'verification.json')); combos=v['combos']
old=json.load(open(out/'original-combinations.json'));rows=list(csv.DictReader(open('/Users/nikitavoronin/Downloads/ye_arts/trait-collection-nft-drop (1)/metadata-file.csv')))
match=sum(all(r['attributes['+k+']']==c.get(k,'') for k in old[0]) for r,c in zip(rows,old));print('Original metadata matches:',match,'/666')
thumbs={}
for c in combos:
 for id in c:
  if id not in thumbs:
   im=Image.open(root/id.split('::')[1]).convert('RGBA');im=im.resize((240,240),Image.Resampling.LANCZOS);thumbs[id]=im
triple=[i for i,c in enumerate(combos) if sum(x.split('::')[0] in ['8 item','9 effects','10 gesture'] for x in c)==3]
rh=[i for i,c in enumerate(combos) if '3 body hands::3 body hands/RH.png' in c]
selected=list(dict.fromkeys(triple+rh[:8]+list(range(0,666,23))))[:48]
can=Image.new('RGB',(8*240,((len(selected)+7)//8)*265),'#eeeeee');dr=ImageDraw.Draw(can);hashes=set()
for i,c in enumerate(combos):
 im=Image.new('RGBA',(240,240))
 for id in c:im.alpha_composite(thumbs[id])
 hashes.add(hashlib.sha256(im.tobytes()).hexdigest())
 if i in selected:
  j=selected.index(i);x=(j%8)*240;y=(j//8)*265;can.paste(im,(x,y),im);dr.text((x+8,y+243),f'#{i+1}'+(' ALL THREE' if i in triple else '')+(' RH BODY' if i in rh else ''),fill='black')
can.save(out/'collection-check.jpg',quality=92)
print('Distinct rendered thumbnails:',len(hashes));print('RH bodies',len(rh));print('triple editions',[i+1 for i in triple])
