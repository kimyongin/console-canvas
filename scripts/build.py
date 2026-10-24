#!/usr/bin/env python3
"""Build a double-clickable demo and a load-unpacked extension without npm."""
from pathlib import Path
import argparse,json,re,shutil,zipfile

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',type=Path,default=ROOT/'dist')
args=parser.parse_args()
OUT=args.output.resolve()
OUT.mkdir(parents=True,exist_ok=True)
(ROOT/'agent-guide.md').write_text((ROOT/'skills/console-canvas/SKILL.md').read_text())
sample=json.loads((ROOT/'sample.uiclone.json').read_text())
html=(ROOT/'editor.html').read_text()
html=html.replace('<link rel="stylesheet" href="editor.css">','<style>'+(ROOT/'editor.css').read_text()+'</style>')
html=html.replace('<script src="capture.js"></script><script type="module" src="editor.js"></script>','')
html=html.replace('href="editor.html"','href="preview.html"')
source=[]
for filename in ['capture.js','db.js','engine.js','export.js','editor-controller.js','snapshot-history.js','bridge-client.js','editor.js']:
    code=(ROOT/filename).read_text()
    code=re.sub(r'^import .*?;\s*$','',code,flags=re.M)
    code=re.sub(r'\bexport (?=(?:async )?(?:function|class|const))','',code)
    source.append(code)
bundle='(function(){\n'+ '\n'.join(source)+'\n})();'
bundle=re.sub(r'</script',lambda match:'<\\/script',bundle,flags=re.I)
data=json.dumps(sample,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
bootstrap='<script type="application/json" id="embedded-sample">'+data+'</script><script>window.CONSOLE_CANVAS_SAMPLE=JSON.parse(document.getElementById("embedded-sample").textContent);</script><script>'+bundle+'</script>'
html=html.replace('</body>',bootstrap+'</body>')
(ROOT/'preview.html').write_text(html)
(OUT/'Console Canvas.html').write_text(html)
files=['manifest.json','background.js','capture.js','db.js','engine.js','export.js','editor.js','editor.css','editor.html','README.md','preview.html','sample.uiclone.json','fixtures/console.html','fixtures/console.css','fixtures/console.js']
files+=['bridge-client.js','editor-controller.js','snapshot-history.js','agent-guide.md','mcp/server.py','mcp/bridge.py','mcp/skill_install.py','package.json','desktop/main.cjs','desktop/preload.cjs','desktop/shell-preload.cjs','desktop/shell.html','desktop/shell.css','desktop/shell.cjs']
files+=['mcp/app_update.py','desktop/updater.cjs']
archive=OUT/'console-canvas-extension.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as package:
    for filename in files:
        entry=zipfile.ZipInfo('console-canvas/'+filename,(2026,10,24,0,0,0))
        entry.compress_type=zipfile.ZIP_DEFLATED
        entry.external_attr=0o100644<<16
        package.writestr(entry,(ROOT/filename).read_bytes(),compresslevel=9)
skill=ROOT/'skills'/'console-canvas'
(skill/'assets').mkdir(parents=True,exist_ok=True)
shutil.copyfile(archive,skill/'assets'/'console-canvas-extension.zip')
skill_archive=OUT/'console-canvas-skill.zip'
with zipfile.ZipFile(skill_archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as package:
    for path in sorted(skill.rglob('*')):
        if not path.is_file() or '__pycache__' in path.parts:continue
        entry=zipfile.ZipInfo('console-canvas/'+path.relative_to(skill).as_posix(),(2026,10,24,0,0,0))
        entry.compress_type=zipfile.ZIP_DEFLATED
        entry.external_attr=0o100644<<16
        package.writestr(entry,path.read_bytes(),compresslevel=9)
print(json.dumps({'standalone':str(OUT/'Console Canvas.html'),'extension':str(archive),'skill':str(skill_archive),'files':len(files),'bytes':archive.stat().st_size},ensure_ascii=False))
