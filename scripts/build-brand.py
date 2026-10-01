from PIL import Image
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from pathlib import Path
for name in ['Vazirmatn','Manrope']:
 f=TTFont(f'public/fonts/{name}.ttf');f.flavor='woff2';f.save(f'public/fonts/{name}.woff2')
im=Image.open('public/images/petavu-ecosystem.png');im.save('public/images/petavu-ecosystem.webp',quality=88,method=6)
mark='''<path d="M21 71V33c0-16 12-27 28-27h8c16 0 29 12 29 28S73 62 57 62H44v17c0 8-6 14-14 14h-9V71Z" fill="#E57446"/><path d="M44 29l10-8 7 9 10 2-7 9-1 9H49c-4 0-7-3-7-7V33l2-4Z" fill="#F7F4EC"/><circle cx="65" cy="36" r="2.2" fill="#283E32"/><path d="M10 65c-5 0-9 4-9 9s4 9 9 9h11V65H10Z" fill="#283E32"/>'''
Path('public/brand/petavu-mark.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-labelledby="title"><title id="title">نشان پِتاو: ارتباط و هویت پت</title>{mark}</svg>')
f=instantiateVariableFont(TTFont('public/fonts/Manrope.ttf'),{'wght':750},inplace=False);gs=f.getGlyphSet();cm=f.getBestCmap();h=f['hmtx'].metrics
paths=[];x=0
for c in 'PETAVU':
 g=cm[ord(c)];pen=SVGPathPen(gs);gs[g].draw(pen);paths.append(f'<g transform="translate({x},0)"><path d="{pen.getCommands()}"/></g>');x+=h[g][0]+55
svg=f'''<svg xmlns="http://www.w3.org/2000/svg" width="440" height="112" viewBox="0 0 440 112" role="img" aria-labelledby="title desc"><title id="title">PETAVU — پِتاو</title><desc id="desc">نشان و نوشتار برداری، با مفهوم اتصال و هویت حرفه‌ای حوزه پت.</desc><g transform="translate(12 8)">{mark}</g><g transform="translate(121 78) scale(0.036 -0.036)" fill="#283E32">{''.join(paths)}</g></svg>'''
Path('public/brand/petavu-logo.svg').write_text(svg);Path('assets/brand/petavu-logo.svg').write_text(svg)
print('Fonts, optimized illustration and vector logo generated.')
