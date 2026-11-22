"""Cycles materials. Colours are given as sRGB hex."""
import bpy


def lin(h, a=1.0):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in c) + (a,)


class Nodes:
    def __init__(self, name):
        self.m = bpy.data.materials.new(name)
        self.m.use_nodes = True
        self.t = self.m.node_tree
        self.t.nodes.clear()
        self.out = self.n('OutputMaterial')

    def n(self, kind, **kw):
        node = self.t.nodes.new('ShaderNode' + kind)
        for k, v in kw.items():
            if hasattr(node, k) and k not in node.inputs:
                setattr(node, k, v)
        return node

    def set(self, node, **kw):
        for k, v in kw.items():
            node.inputs[k.replace('_', ' ')].default_value = v
        return node

    def l(self, a, b):
        self.t.links.new(a, b)

    def math(self, op, a, b=None, clamp=False):
        k = self.n('Math'); k.operation = op; k.use_clamp = clamp
        for i, v in enumerate((a, b)):
            if v is None: continue
            if hasattr(v, 'is_output'): self.l(v, k.inputs[i])
            else: k.inputs[i].default_value = v
        return k.outputs[0]

    def mix(self, fac, a, b):
        k = self.n('MixShader')
        if hasattr(fac, 'is_output'): self.l(fac, k.inputs[0])
        else: k.inputs[0].default_value = fac
        self.l(a, k.inputs[1]); self.l(b, k.inputs[2])
        return k.outputs[0]

    def addsh(self, a, b):
        k = self.n('AddShader'); self.l(a, k.inputs[0]); self.l(b, k.inputs[1])
        return k.outputs[0]

    def done(self, s):
        self.l(s, self.out.inputs['Surface'])
        return self.m

    def emit(self, hexcol, strength):
        e = self.n('Emission')
        e.inputs['Color'].default_value = lin(hexcol)
        if hasattr(strength, 'is_output'): self.l(strength, e.inputs['Strength'])
        else: e.inputs['Strength'].default_value = strength
        return e.outputs[0]

    def transp(self, hexcol='ffffff'):
        e = self.n('BsdfTransparent'); e.inputs['Color'].default_value = lin(hexcol)
        return e.outputs[0]

    def facing(self, blend=0.5):
        lw = self.n('LayerWeight'); lw.inputs['Blend'].default_value = blend
        return lw.outputs['Facing']

    def fresnel(self, ior=1.45):
        f = self.n('Fresnel'); f.inputs['IOR'].default_value = ior
        return f.outputs[0]

    def schlick(self, ior=1.45):
        """Reflectance that is the same from both sides (no internal reflection)."""
        f0 = ((ior - 1) / (ior + 1)) ** 2
        return self.math('ADD', self.math('MULTIPLY', self.math('POWER', self.facing(.5), 5.0), 1 - f0), f0)

    def glossy(self, rough=0.02, hexcol='ffffff'):
        g = self.n('BsdfGlossy')
        g.inputs['Roughness'].default_value = rough
        g.inputs['Color'].default_value = lin(hexcol)
        return g.outputs[0]


def solid(name, hexcol, rough=.4, metallic=0., coat=0., spec=.5, emit=None, estr=0.):
    N = Nodes(name)
    b = N.n('BsdfPrincipled')
    b.inputs['Base Color'].default_value = lin(hexcol)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Coat Weight'].default_value = coat
    b.inputs['Coat Roughness'].default_value = .12
    b.inputs['Specular IOR Level'].default_value = spec
    if emit:
        b.inputs['Emission Color'].default_value = lin(emit)
        b.inputs['Emission Strength'].default_value = estr
    return N.done(b.outputs[0])


def emission(name, hexcol, strength):
    N = Nodes(name)
    return N.done(N.emit(hexcol, strength))


def glass(name, tint='ffffff', ior=1.3, rough=0.0, edge=None, edge_str=0., edge_pow=3.0):
    """Clear acrylic: refractive, lets light through, optional lit edges."""
    N = Nodes(name)
    g = N.n('BsdfGlass')
    g.inputs['Color'].default_value = lin(tint)
    g.inputs['IOR'].default_value = ior
    g.inputs['Roughness'].default_value = rough
    s = g.outputs[0]
    if edge:
        f = N.math('POWER', N.facing(.5), edge_pow)
        s = N.addsh(s, N.emit(edge, N.math('MULTIPLY', f, edge_str)))
    lp = N.n('LightPath')
    ray = N.math('MAXIMUM', lp.outputs['Is Shadow Ray'], lp.outputs['Is Diffuse Ray'])
    return N.done(N.mix(ray, s, N.transp(tint)))


def film(name, tint='ffffff', ior=1.35, edge=None, edge_str=0., edge_pow=3., body=0., gloss=1.0, rough=.02,
         shade=None, shade_pow=6., shade_amt=1.0):
    """Thin-walled clear plastic: no refraction, fresnel reflections.
    `edge` lights the silhouette; `shade` darkens it, as refraction would."""
    N = Nodes(name)
    fr = N.math('MULTIPLY', N.schlick(ior), gloss, True)
    t = N.n('BsdfTransparent')
    if shade:
        k = N.math('MULTIPLY', N.math('POWER', N.facing(.5), shade_pow), shade_amt, True)
        mx = N.n('MixRGB'); N.l(k, mx.inputs[0])
        mx.inputs[1].default_value = lin(tint); mx.inputs[2].default_value = lin(shade)
        N.l(mx.outputs[0], t.inputs['Color'])
    else:
        t.inputs['Color'].default_value = lin(tint)
    s = N.mix(fr, t.outputs[0], N.glossy(rough))
    if edge:
        f = N.math('POWER', N.facing(.5), edge_pow)
        s = N.addsh(s, N.emit(edge, N.math('ADD', N.math('MULTIPLY', f, edge_str), body)))
    lp = N.n('LightPath')
    return N.done(N.mix(lp.outputs['Is Shadow Ray'], s, N.transp(tint)))


def glow_core(name, hexcol, core, strength, rough=.3):
    """Dark translucent moulding with light showing through its middle."""
    N = Nodes(name)
    b = N.n('BsdfPrincipled'); b.inputs['Base Color'].default_value = lin(hexcol); b.inputs['Roughness'].default_value = rough
    b.inputs['Specular IOR Level'].default_value = .25
    inv = N.math('SUBTRACT', 1.0, N.facing(.5))
    f = N.math('MULTIPLY', N.math('POWER', inv, 6.0), strength)
    return N.done(N.addsh(b.outputs[0], N.emit(core, f)))


def liquid(name, tint, deep, bright, z0, z1, body=.30, edge=.55, floor=.8, strength=1.0, streak=.07):
    """Illuminated culture medium: tinted, with light gathering at the walls and base."""
    N = Nodes(name)
    g = N.n('NewGeometry')
    sep = N.n('SeparateXYZ'); N.l(g.outputs['Position'], sep.inputs[0])
    mr = N.n('MapRange'); N.l(sep.outputs['Z'], mr.inputs[0])
    mr.inputs[1].default_value = z0; mr.inputs[2].default_value = z1
    mr.inputs[3].default_value = 1.0; mr.inputs[4].default_value = 0.0
    low = N.math('POWER', mr.outputs[0], 5.5)
    fc = N.math('POWER', N.facing(.5), 2.6)
    a = N.math('ADD', body, N.math('ADD', N.math('MULTIPLY', fc, edge), N.math('MULTIPLY', low, floor)), True)
    # soft vertical streaks, as light catches the curved wall
    vm = N.n('VectorMath'); vm.operation = 'MULTIPLY'; N.l(g.outputs['Position'], vm.inputs[0]); vm.inputs[1].default_value = (95, 95, 2.0)
    nz = N.n('TexNoise'); N.l(vm.outputs[0], nz.inputs['Vector']); nz.inputs['Scale'].default_value = 1.0; nz.inputs['Detail'].default_value = 2.0
    st = N.n('MapRange'); N.l(nz.outputs['Fac'] if 'Fac' in nz.outputs else nz.outputs[0], st.inputs[0])
    st.inputs[1].default_value = .42; st.inputs[2].default_value = .72; st.inputs[3].default_value = 0; st.inputs[4].default_value = streak
    a = N.math('ADD', a, st.outputs[0], True)
    glow = N.math('ADD', fc, N.math('MULTIPLY', low, .9), True)
    cr = N.n('MixRGB'); N.l(glow, cr.inputs[0])
    cr.inputs[1].default_value = lin(deep); cr.inputs[2].default_value = lin(bright)
    em = N.n('Emission'); N.l(cr.outputs[0], em.inputs['Color']); em.inputs['Strength'].default_value = strength
    s = N.mix(a, N.transp(tint), em.outputs[0])
    s = N.mix(N.math('MULTIPLY', N.schlick(1.33), .25), s, N.glossy(.03))
    lp = N.n('LightPath')
    return N.done(N.mix(lp.outputs['Is Shadow Ray'], s, N.transp(tint)))


def bubble(name, hexcol, strength=1.6):
    N = Nodes(name)
    f = N.math('POWER', N.facing(.5), 3.0)
    s = N.mix(N.math('MULTIPLY', f, .98, True), N.transp(), N.emit(hexcol, strength))
    s = N.mix(N.math('MULTIPLY', N.schlick(1.3), .6), s, N.glossy(.02))
    lp = N.n('LightPath')
    return N.done(N.mix(lp.outputs['Is Shadow Ray'], s, N.transp()))


def two_tone(name, a, b, attr):
    """Material `a` except where vertex attribute `attr` is positive, then `b`.
    Each is (hex, roughness, metallic, coat)."""
    N = Nodes(name)
    out = []
    for hx, ro, me, co in (a, b):
        k = N.n('BsdfPrincipled'); k.inputs['Base Color'].default_value = lin(hx)
        k.inputs['Roughness'].default_value = ro; k.inputs['Metallic'].default_value = me
        k.inputs['Coat Weight'].default_value = co; k.inputs['Coat Roughness'].default_value = .12
        out.append(k.outputs[0])
    at = N.n('Attribute'); at.attribute_name = attr
    return N.done(N.mix(N.math('GREATER_THAN', at.outputs['Fac'], 0.0), *out))
