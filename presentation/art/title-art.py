# Draws presentation/assets/title-art-dark.svg (our own drawing, cover only) and refuses to write it if
# any label or block leaves the safe margin or touches another. Run: python3 presentation/art/title-art.py
W,H=780,800; M=48
INK="#f7f6f5"; ACC="#2200ff"
X=(0.866,0.5); Y=(-0.866,0.5)
mono='font-family="DejaVu Sans Mono, ui-monospace, monospace" letter-spacing="1"'
def P(c,a,b,z=0): return (c[0]+a*X[0]+b*Y[0], c[1]+a*X[1]+b*Y[1]-z)
def pts(*ps): return " ".join(f"{x:.1f},{y:.1f}" for x,y in ps)
boxes=[]; texts=[]
def block(c,h,s,label):
    t=[P(c,-s,-s,h),P(c,s,-s,h),P(c,s,s,h),P(c,-s,s,h)]
    b=[P(c,s,-s),P(c,s,s),P(c,-s,s)]
    allp=t+b; boxes.append((label,min(p[0] for p in allp),min(p[1] for p in allp),max(p[0] for p in allp),max(p[1] for p in allp)))
    return (f'<polygon points="{pts(t[3],t[2],b[1],b[2])}" fill="url(#hatch)" stroke="{INK}" stroke-width="2"/>'
            f'<polygon points="{pts(t[2],t[1],b[0],b[1])}" fill="#101010" stroke="{INK}" stroke-width="2"/>'
            f'<polygon points="{pts(*t)}" fill="#1b1b1b" stroke="{INK}" stroke-width="2"/>'), t
def text(x,y,s,size,op=1.0,anchor="start"):
    w=len(s)*size*0.66; x0={"start":x,"middle":x-w/2,"end":x-w}[anchor]
    texts.append((s,x0,y-size*0.8,x0+w,y+size*0.2))
    return f'<text x="{x:.0f}" y="{y:.0f}" text-anchor="{anchor}" fill="{INK}" fill-opacity="{op}" font-size="{size}" {mono}>{s}</text>'
out=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="Wireframe drawing: one shared platform core with three apps, refunds, KYC review and feature flags, plugging into it">',
f'''<defs>
<pattern id="minor" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="{INK}" stroke-opacity="0.05"/></pattern>
<pattern id="major" width="120" height="120" patternUnits="userSpaceOnUse"><rect width="120" height="120" fill="url(#minor)"/><path d="M120 0H0V120" fill="none" stroke="{INK}" stroke-opacity="0.1"/></pattern>
<pattern id="hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#0b0b0b"/><path d="M0 0V10" stroke="{INK}" stroke-opacity="0.35" stroke-width="1.5"/></pattern>
<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.07 0"/></filter>
</defs>''',
f'<rect width="{W}" height="{H}" fill="#121212"/><rect width="{W}" height="{H}" fill="url(#major)"/>',
f'<rect x="0.5" y="0.5" width="{W-1}" height="{H-1}" fill="none" stroke="{INK}" stroke-opacity="0.18"/>']
top=(390,450); core=(top[0],top[1]+90)
svg,_=block(core,90,120,"core"); out.append(svg)
out.append(f'<polygon points="{pts(P(top,-70,-70),P(top,70,-70),P(top,70,70),P(top,-70,70))}" fill="none" stroke="{INK}" stroke-opacity="0.4" stroke-width="1.5" stroke-dasharray="6 6"/>')
apps=[("A",P(top,-80,80),170),("B",top,290),("C",P(top,80,-80),170)]
for _,s,lift in apps:
    out.append(f'<polygon points="{pts(P(s,-22,-22),P(s,22,-22),P(s,22,22),P(s,-22,22))}" fill="#0b0b0b" stroke="{INK}" stroke-width="2"/>')
    out.append(f'<line x1="{s[0]:.1f}" y1="{s[1]:.1f}" x2="{s[0]:.1f}" y2="{s[1]-lift+34:.1f}" stroke="{INK}" stroke-opacity="0.6" stroke-width="1.5" stroke-dasharray="3 7"/>')
for name,s,lift in apps:
    svg,t=block((s[0],s[1]-lift),44,34,name); out.append(svg)
    out.append(text(t[3][0]-20,t[3][1]+8,name,22,1.0,"end"))   # callout letter beside the cube's left corner
out.append(text(M,72,"FIG. 01 · PLATFORM CORE",18,0.6))
out.append(text(M,692,"A REFUNDS · B KYC REVIEW · C FEATURE FLAGS",18,0.85))
out.append(text(M,718,"CORE: SIGN-IN · PERMISSIONS · AUDIT",18,0.6))
out.append(text(M,744,"APPROVALS · MASKING",18,0.6))
out.append(f'<rect width="{W}" height="{H}" filter="url(#grain)"/>')
L=44; w=4; h=w/2
for (x,y,dx,dy) in [(0,0,1,1),(W,0,-1,1),(0,H,1,-1),(W,H,-1,-1)]:
    out.append(f'<path d="M{x+dx*h} {y+dy*L}V{y+dy*h}H{x+dx*L}" fill="none" stroke="{ACC}" stroke-width="{w}"/>')
out.append('</svg>')
# Layout check: everything inside the safe margin, no text on a shape, no two shapes or texts touching.
GAP=8; bad=[]
items=[("shape:"+b[0],*b[1:]) for b in boxes if b[0]!="core"]+[("text:"+t[0],*t[1:]) for t in texts]
core_box=[b for b in boxes if b[0]=="core"][0]
for n,x0,y0,x1,y1 in items+[("shape:core",*core_box[1:])]:
    if x0<M-1 or y0<M or x1>W-M or y1>H-M: bad.append(f"{n} outside safe area ({x0:.0f},{y0:.0f},{x1:.0f},{y1:.0f})")
for i in range(len(items)):
    for j in range(i+1,len(items)):
        a=items[i]; b=items[j]
        if max(b[1]-a[3],a[1]-b[3],b[2]-a[4],a[2]-b[4])<GAP: bad.append(f"{a[0]} touches {b[0]}")
for t in items:
    if t[0].startswith("text:") and max(core_box[1]-t[3],t[1]-core_box[3],core_box[2]-t[4],t[2]-core_box[4])<GAP: bad.append(f"{t[0]} on the core")
print("\n".join(bad) or "art layout OK")
if bad: raise SystemExit(1)
from pathlib import Path
(Path(__file__).resolve().parent.parent / "assets" / "title-art-dark.svg").write_text("\n".join(out) + "\n")
