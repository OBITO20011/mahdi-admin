from pathlib import Path
from PIL import Image, ImageDraw
import random, io, json, sys, hashlib
assert len(sys.argv)==2, 'Pass an external evidence directory'
out=Path(sys.argv[1]).resolve()/'fixture-images'
assert not out.is_relative_to(Path(__file__).resolve().parents[2]), 'Keep generated media outside the repository'
out.mkdir(exist_ok=False)
r=random.Random(0x5eed300)
# Seeded texture + fictional package silhouette, actual decoded1200x1200 JPEG.
noise=bytes(r.randrange(256) for _ in range(1200*1200*3))
base=Image.frombytes('RGB',(1200,1200),noise)
files=[]
selected_quality=None
for i in range(300):
 im=base.copy();d=ImageDraw.Draw(im);d.rounded_rectangle((360,180,840,1050),radius=45,fill=(238,213-(i%30),159));d.rectangle((400,430,800,790),fill=(80+i%110,50,30));d.text((530,580),f'TEST {i:03}',fill='white',font_size=45)
 best=None
 for q in (range(22,57,2) if selected_quality is None else [selected_quality]):
  b=io.BytesIO();im.save(b,format='JPEG',quality=q,optimize=True);raw=b.getvalue()
  if best is None or abs(len(raw)-300_000)<abs(len(best)-300_000):best=raw; best_quality=q
 selected_quality=best_quality
 assert 270_000<=len(best)<=330_000
 (out/f'{i}.jpg').write_bytes(best);files.append({'file':f'{i}.jpg','sha256':hashlib.sha256(best).hexdigest(),'bytes':len(best),'width':1200,'height':1200})
(out/'manifest.json').write_text(json.dumps({'seed':'5eed300','images':files},indent=2))
print(json.dumps({'ok':True,'count':len(files),'minBytes':min(f['bytes'] for f in files),'maxBytes':max(f['bytes'] for f in files)}))
