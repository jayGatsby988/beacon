"""Convert an OSM API extract to a compact, attributed, offline campus geometry pack."""
import json,sys,xml.etree.ElementTree as ET
from pathlib import Path
root=ET.parse(sys.argv[1]).getroot()
nodes={n.attrib['id']:[float(n.attrib['lon']),float(n.attrib['lat'])] for n in root.findall('node')}
features=[]
for w in root.findall('way'):
    tags={t.attrib['k']:t.attrib['v'] for t in w.findall('tag')}
    kind='building' if 'building' in tags else 'road' if 'highway' in tags else 'water' if tags.get('natural')=='water' or 'waterway' in tags else 'park' if tags.get('leisure') in ['park','garden','pitch'] else None
    if not kind:continue
    coords=[nodes[n.attrib['ref']] for n in w.findall('nd') if n.attrib['ref'] in nodes]
    if len(coords)<2:continue
    polygon=kind in ['building','park','water'] and len(coords)>3 and coords[0]==coords[-1]
    features.append({'type':'Feature','id':int(w.attrib['id']),'properties':{'kind':kind,'name':tags.get('name',''),'class':tags.get('highway','')},'geometry':{'type':'Polygon' if polygon else 'LineString','coordinates':[coords] if polygon else coords}})
pack={'type':'FeatureCollection','features':features}
out=Path(sys.argv[2]);out.write_text(json.dumps(pack,separators=(',',':')))
print(f'{len(features)} features; {out.stat().st_size} bytes')
