"""Native Blender watercolor washes and irregular ink hatching.

No image-to-image repainting: all marks remain attached to the 3D surfaces.
"""
import bpy


def apply_illustration(scene):
    count=0
    for mat in bpy.data.materials:
        if not mat.use_nodes or mat.get('illustration_v2'):continue
        nodes=mat.node_tree.nodes;links=mat.node_tree.links
        bsdf=next((n for n in nodes if n.type=='BSDF_PRINCIPLED'),None)
        if bsdf is None:continue
        name=mat.name.lower()
        if any(s in name for s in ('graphite','window recess','dark iron','glass')):continue
        original=bsdf.inputs['Base Color'].links[0].from_socket if bsdf.inputs['Base Color'].is_linked else None
        rgba=tuple(bsdf.inputs['Base Color'].default_value)
        if original is None:
            col=nodes.new('ShaderNodeRGB');col.outputs[0].default_value=rgba;original=col.outputs[0]

        def mathop(op,a,b=None,label=''):
            nd=nodes.new('ShaderNodeMath');nd.operation=op;nd.label=label
            for i,value in enumerate((a,b)):
                if value is None:continue
                if hasattr(value,'node'):links.new(value,nd.inputs[i])
                else:nd.inputs[i].default_value=value
            return nd.outputs[0]

        def noise(vector,scale,detail=2):
            nd=nodes.new('ShaderNodeTexNoise');nd.inputs['Scale'].default_value=scale
            nd.inputs['Detail'].default_value=detail;nd.inputs['Roughness'].default_value=.72
            links.new(vector,nd.inputs['Vector']);return nd

        def multiply_color(a,b):
            nd=nodes.new('ShaderNodeMixRGB');nd.blend_type='MULTIPLY';nd.inputs[0].default_value=1
            links.new(a,nd.inputs[1])
            if hasattr(b,'node'):links.new(b,nd.inputs[2])
            else:nd.inputs[2].default_value=(*b,1)
            return nd.outputs[0]

        geom=nodes.new('ShaderNodeNewGeometry');pos=geom.outputs['Position']
        coarse=noise(pos,.48,3);grain=noise(pos,28,2)
        wash=nodes.new('ShaderNodeValToRGB');wash.label='Uneven dry watercolor pigment'
        wash.color_ramp.elements[0].position=.18;wash.color_ramp.elements[0].color=(.86,.85,.81,1)
        wash.color_ramp.elements[1].position=.83;wash.color_ramp.elements[1].color=(1.08,1.06,1.01,1)
        links.new(coarse.outputs['Fac'],wash.inputs[0])
        pigment=multiply_color(original,wash.outputs[0])
        fine=mathop('MULTIPLY_ADD',grain.outputs['Fac'],.13)
        fine.node.inputs[2].default_value=.93
        pigment=multiply_color(pigment,fine)

        # Give tile/masonry joints the slight deviations of a ruled ink drawing.
        for brick in [n for n in nodes if n.type=='TEX_BRICK']:
            if not brick.inputs['Vector'].is_linked:continue
            uv=brick.inputs['Vector'].links[0].from_socket
            wobble=noise(uv,3.8,2)
            scale=nodes.new('ShaderNodeVectorMath');scale.operation='SCALE';scale.inputs[3].default_value=.055
            links.new(wobble.outputs['Color'],scale.inputs[0])
            add=nodes.new('ShaderNodeVectorMath');add.operation='ADD';links.new(uv,add.inputs[0]);links.new(scale.outputs[0],add.inputs[1]);links.new(add.outputs[0],brick.inputs['Vector'])
            brick.inputs['Mortar'].default_value=(.15,.14,.12,1)

        # Broken diagonal strokes. Surface orientation controls density,
        # so lit plaster stays mostly paper-white and shaded faces carry more ink.
        normaldot=nodes.new('ShaderNodeVectorMath');normaldot.operation='DOT_PRODUCT'
        links.new(geom.outputs['Normal'],normaldot.inputs[0]);normaldot.inputs[1].default_value=(.5,-.45,.75)
        facing=mathop('SUBTRACT',.58,normaldot.outputs['Value'])
        facing=mathop('MAXIMUM',facing,0)
        shading=facing
        shading=mathop('MINIMUM',shading,.88)

        def hatch(direction,frequency,threshold):
            dot=nodes.new('ShaderNodeVectorMath');dot.operation='DOT_PRODUCT'
            links.new(pos,dot.inputs[0]);dot.inputs[1].default_value=direction
            phase=mathop('MULTIPLY',dot.outputs['Value'],frequency)
            phase=mathop('ADD',phase,mathop('MULTIPLY',grain.outputs['Fac'],.6))
            stroke=mathop('GREATER_THAN',mathop('SINE',phase),threshold)
            broken=mathop('GREATER_THAN',noise(pos,2.3,1).outputs['Fac'],.32)
            return mathop('MULTIPLY',stroke,broken)

        primary=hatch((.72,.34,.86),28,.86)
        secondary=hatch((-.52,.71,.77),33,.92)
        secondary=mathop('MULTIPLY',secondary,mathop('GREATER_THAN',shading,.48))
        ink=mathop('MAXIMUM',primary,secondary)
        strength=.63
        if any(s in name for s in ('timber','wood','oak')):strength=.43
        if any(s in name for s in ('ground','earth','parchment')):
            shading=mathop('MULTIPLY',facing,0);strength=.25
        ink=mathop('MULTIPLY',ink,shading)
        ink=mathop('MULTIPLY',ink,strength)
        final=nodes.new('ShaderNodeMixRGB');final.blend_type='MIX'
        links.new(ink,final.inputs[0]);links.new(pigment,final.inputs[1]);final.inputs[2].default_value=(.11,.095,.075,1)
        links.new(final.outputs[0],bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value=1
        bsdf.inputs['Specular IOR Level'].default_value=.025
        mat['illustration_v2']=True;count+=1
    scene['illustration_material_count']=count
    return {'materials':count,'method':'surface-attached irregular pigment, warped ink joints, normal-weighted broken cross-hatching'}
