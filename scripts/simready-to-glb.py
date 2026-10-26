"""Offline OpenUSD composition -> compact, material-batched static glTF.

Requires the official usd-core build-time package, never used by the app.
No texture, physics, executable asset script or remote resolver is loaded.
"""
import array
import json
import math
import pathlib
import struct
import sys
from pxr import Usd, UsdGeom, UsdShade

source, destination = map(pathlib.Path, sys.argv[1:3])
stage = Usd.Stage.Open(str(source))
if not stage:
    raise RuntimeError("Cannot compose selected USD")
up = str(UsdGeom.GetStageUpAxis(stage))
unit = UsdGeom.GetStageMetersPerUnit(stage)
cache = UsdGeom.XformCache()
batches = {}
mesh_count = 0
triangle_count = 0

def axis(v):
    return (float(v[0]), float(v[2]), -float(v[1])) if up == 'Z' else tuple(float(x) for x in v)

def normal(v):
    length = math.sqrt(sum(x*x for x in v)) or 1
    return tuple(x/length for x in v)

def material_color(label):
    if 'pallet_a01' in str(source) or any(x in label for x in ('wood','plywood')):
        return (0.53, 0.34, 0.17, 1)
    elif any(x in label for x in ('rubber','black','belt','carbon')):
        return (0.035, 0.049, 0.05, 1)
    elif any(x in label for x in ('blue','green','painted')):
        return (0.23, 0.37, 0.32, 1)
    elif any(x in label for x in ('white','plastic')):
        return (0.76, 0.77, 0.71, 1)
    elif any(x in label for x in ('red','orange','yellow')):
        return (0.56, 0.24, 0.10, 1)
    else:
        return (0.47, 0.52, 0.51, 1)

for prim in Usd.PrimRange(stage.GetPseudoRoot(), Usd.TraverseInstanceProxies()):
    if not prim.IsA(UsdGeom.Mesh):
        continue
    imageable = UsdGeom.Imageable(prim)
    if imageable.ComputeVisibility() == UsdGeom.Tokens.invisible:
        continue
    mesh = UsdGeom.Mesh(prim)
    points = mesh.GetPointsAttr().Get()
    indices = mesh.GetFaceVertexIndicesAttr().Get()
    counts = mesh.GetFaceVertexCountsAttr().Get()
    if not points or not indices or not counts:
        continue
    matrix = cache.GetLocalToWorldTransform(prim)
    positions = [tuple(x*unit for x in axis(matrix.Transform(p))) for p in points]
    normals = mesh.GetNormalsAttr().Get()
    interpolation = mesh.GetNormalsInterpolation()
    normal_matrix = matrix.GetInverse().GetTranspose()
    transformed_normals = [normal(axis(normal_matrix.TransformDir(n))) for n in normals] if normals else None
    try:
        material = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()[0]
        label = str(material.GetPath()).lower()
    except Exception:
        label = str(prim.GetPath()).lower()
    default_label = label
    face_labels = {}
    for subset in UsdGeom.Subset.GetAllGeomSubsets(mesh):
        material = UsdShade.MaterialBindingAPI(subset.GetPrim()).ComputeBoundMaterial()[0]
        for face_index in subset.GetIndicesAttr().Get() or []:
            face_labels[face_index] = str(material.GetPath()).lower()
    offset = 0
    left = mesh.GetOrientationAttr().Get() == UsdGeom.Tokens.leftHanded
    for face_index, count in enumerate(counts):
        color = material_color(face_labels.get(face_index, default_label))
        batch = batches.setdefault(color, {'vertices': [], 'normals': [], 'indices': [], 'lookup': {}})
        face = list(range(offset, offset+count))
        for i in range(1, count-1):
            corners = [face[0], face[i], face[i+1]]
            if left:
                corners.reverse()
            p = [positions[indices[c]] for c in corners]
            a = tuple(p[1][i]-p[0][i] for i in range(3))
            b = tuple(p[2][i]-p[0][i] for i in range(3))
            fallback = normal((a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]))
            for corner, position in zip(corners, p):
                n = fallback
                if transformed_normals:
                    ni = corner if interpolation == 'faceVarying' else indices[corner] if interpolation in ('vertex','varying') else 0
                    if ni < len(transformed_normals):
                        n = transformed_normals[ni]
                key = tuple(round(x, 5) for x in position) + tuple(round(x, 4) for x in n)
                vertex = batch['lookup'].get(key)
                if vertex is None:
                    vertex = len(batch['vertices'])//3
                    batch['lookup'][key] = vertex
                    batch['vertices'].extend(position)
                    batch['normals'].extend(n)
                batch['indices'].append(vertex)
            triangle_count += 1
        offset += count
    mesh_count += 1

if not mesh_count or not batches:
    raise RuntimeError('No visible composed mesh geometry')
minimum = [min(min(b['vertices'][i::3]) for b in batches.values() if b['vertices']) for i in range(3)]
maximum = [max(max(b['vertices'][i::3]) for b in batches.values() if b['vertices']) for i in range(3)]
center = [(minimum[0]+maximum[0])/2, minimum[1], (minimum[2]+maximum[2])/2]
binary = bytearray()
views, accessors, materials, primitives = [], [], [], []

def buffer(values, typecode, component, kind, target, bounds=False):
    while len(binary)%4:
        binary.append(0)
    data = array.array(typecode, values)
    if sys.byteorder != 'little':
        data.byteswap()
    offset = len(binary)
    binary.extend(data.tobytes())
    view = len(views)
    views.append({'buffer':0,'byteOffset':offset,'byteLength':len(data)*data.itemsize,'target':target})
    width = 3 if kind == 'VEC3' else 1
    accessor = {'bufferView':view,'componentType':component,'count':len(values)//width,'type':kind}
    if bounds:
        accessor['min']=[min(values[i::3]) for i in range(3)]
        accessor['max']=[max(values[i::3]) for i in range(3)]
    accessors.append(accessor)
    return len(accessors)-1

for color,batch in batches.items():
    if not batch['indices']:
        continue
    positions=[x-center[i%3] for i,x in enumerate(batch['vertices'])]
    attributes={'POSITION':buffer(positions,'f',5126,'VEC3',34962,True),'NORMAL':buffer(batch['normals'],'f',5126,'VEC3',34962)}
    index=buffer(batch['indices'],'I',5125,'SCALAR',34963)
    materials.append({'name':'Adapted NVIDIA PBR','pbrMetallicRoughness':{'baseColorFactor':color,'metallicFactor':0.6 if color==(0.47,0.52,0.51,1) else 0.06,'roughnessFactor':0.48},'doubleSided':True})
    primitives.append({'attributes':attributes,'indices':index,'material':len(materials)-1})
document={'asset':{'version':'2.0','generator':'QueueLab offline OpenUSD preparation','copyright':'NVIDIA, CC-BY-4.0; adapted geometry composition and materials'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0,'name':source.parent.parent.name}],'meshes':[{'primitives':primitives}],'materials':materials,'buffers':[{'byteLength':len(binary)}],'bufferViews':views,'accessors':accessors}
text=json.dumps(document,separators=(',',':')).encode()
text += b' '*((-len(text))%4)
binary += b'\0'*((-len(binary))%4)
glb=struct.pack('<III',0x46546C67,2,12+8+len(text)+8+len(binary))+struct.pack('<II',len(text),0x4E4F534A)+text+struct.pack('<II',len(binary),0x004E4942)+binary
destination.write_bytes(glb)
print(json.dumps({'meshes':mesh_count,'triangles':triangle_count,'materialBatches':len(primitives),'originalDimensions':[maximum[i]-minimum[i] for i in range(3)]}))
