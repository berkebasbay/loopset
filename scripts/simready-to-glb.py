"""Offline OpenUSD composition -> compact, material-batched static glTF.

Requires the official usd-core build-time package, never used by the app.
Only the lathe retains its three bounded local albedo atlases. No physics,
executable asset script or remote resolver is loaded.
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
lathe_textures = 'serviceTool_brake_lathe_a01' in source.parts and '--library' not in sys.argv
tile_triangles = {}

def axis(v):
    return (float(v[0]), float(v[2]), -float(v[1])) if up == 'Z' else tuple(float(x) for x in v)

def normal(v):
    length = math.sqrt(sum(x*x for x in v)) or 1
    return tuple(x/length for x in v)

def material_color(label):
    if 'pallet_a01' in str(source) or any(x in label for x in ('wood','plywood','cardboard','corrugated','brown','paper')):
        return (0.53, 0.34, 0.17, 1)
    elif any(x in label for x in ('rubber','black','belt','carbon')):
        return (0.035, 0.049, 0.05, 1)
    elif 'blue' in label:
        return (0.08, 0.25, 0.52, 1)
    elif 'green' in label:
        return (0.16, 0.32, 0.22, 1)
    elif any(x in label for x in ('white','plastic','concrete','plaster')):
        return (0.76, 0.77, 0.71, 1)
    elif 'yellow' in label:
        return (0.9, 0.63, 0.04, 1)
    elif 'orange' in label:
        return (0.72, 0.23, 0.035, 1)
    elif 'red' in label:
        return (0.6, 0.06, 0.04, 1)
    else:
        return (0.47, 0.52, 0.51, 1)

def material_family(label):
    if 'rubber' in label:
        return 'rubber', 0.0, 0.75
    if 'plastic' in label:
        return 'plastic', 0.0, 0.4
    if 'painted' in label:
        return 'painted metal', 0.05, 0.42
    return 'bare metal', 0.8, 0.3

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
    uv_values = None
    uv_interpolation = None
    if lathe_textures:
        uv_primvar = UsdGeom.PrimvarsAPI(prim).FindPrimvarWithInheritance('st')
        if not uv_primvar:
            raise RuntimeError(f'Lathe mesh has no source UVs: {prim.GetPath()}')
        uv_values = uv_primvar.ComputeFlattened()
        uv_interpolation = uv_primvar.GetInterpolation()

    def corner_uv(corner, face_index):
        index = corner if uv_interpolation == 'faceVarying' else indices[corner] if uv_interpolation in ('vertex', 'varying') else face_index if uv_interpolation == 'uniform' else 0
        return uv_values[index]

    face_labels = {}
    for subset in UsdGeom.Subset.GetAllGeomSubsets(mesh):
        material = UsdShade.MaterialBindingAPI(subset.GetPrim()).ComputeBoundMaterial()[0]
        for face_index in subset.GetIndicesAttr().Get() or []:
            face_labels[face_index] = str(material.GetPath()).lower()
    offset = 0
    left = mesh.GetOrientationAttr().Get() == UsdGeom.Tokens.leftHanded
    for face_index, count in enumerate(counts):
        face = list(range(offset, offset+count))
        label = face_labels.get(face_index, default_label)
        if lathe_textures:
            # A face's centroid selects the tile, so a UV exactly at 1.0 remains
            # on its face's tile rather than leaking to the neighbouring atlas.
            uv_corners = [corner_uv(corner, face_index) for corner in face]
            column = math.floor(sum(uv[0] for uv in uv_corners)/count)
            row = math.floor(sum(uv[1] for uv in uv_corners)/count)
            tile = 1001 + column + row*10
            if tile not in (1001, 1002, 1003):
                raise RuntimeError(f'Unexpected lathe UDIM tile {tile}')
            if any(uv[0] < column-1e-4 or uv[0] > column+1+1e-4 or uv[1] < row-1e-4 or uv[1] > row+1+1e-4 for uv in uv_corners):
                raise RuntimeError('A source lathe face crosses a UDIM boundary')
            family, metallic, roughness = material_family(label)
            key = (tile, family)
            batch = batches.setdefault(key, {'vertices': [], 'normals': [], 'indices': [], 'lookup': {}, 'uvs': [], 'tile': tile, 'family': family, 'metallic': metallic, 'roughness': roughness})
        else:
            color = material_color(label)
            batch = batches.setdefault(color, {'vertices': [], 'normals': [], 'indices': [], 'lookup': {}})
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
                if lathe_textures:
                    uv = corner_uv(corner, face_index)
                    # USD st is bottom-left; glTF image coordinates are top-left.
                    packed_uv = (round(max(0.0, min(1.0, uv[0]-column))*65535), round(max(0.0, min(1.0, 1-(uv[1]-row)))*65535))
                    key += packed_uv
                vertex = batch['lookup'].get(key)
                if vertex is None:
                    vertex = len(batch['vertices'])//3
                    batch['lookup'][key] = vertex
                    batch['vertices'].extend(position)
                    batch['normals'].extend(n)
                    if lathe_textures:
                        batch['uvs'].extend(packed_uv)
                batch['indices'].append(vertex)
            triangle_count += 1
            if lathe_textures:
                tile_triangles[tile] = tile_triangles.get(tile, 0)+1
        offset += count
    mesh_count += 1

if not mesh_count or not batches:
    raise RuntimeError('No visible composed mesh geometry')
if len(sys.argv) > 3 and sys.argv[3] == 'actor':
    # A source-derived LOD for tiny repeated work items, not new substitute art.
    all_positions = [x for batch in batches.values() for x in batch['vertices']]
    step = max(max(all_positions[i::3])-min(all_positions[i::3]) for i in range(3))/24
    reduced = {}
    for color,batch in batches.items():
        result={'vertices':[],'normals':[],'indices':[],'lookup':{}}
        remap={}
        for old in range(len(batch['vertices'])//3):
            position=tuple(round(batch['vertices'][old*3+i]/step)*step for i in range(3))
            n=normal(tuple(round(batch['normals'][old*3+i]*2)/2 for i in range(3)))
            key=position+n
            if key not in result['lookup']:
                result['lookup'][key]=len(result['vertices'])//3
                result['vertices'].extend(position);result['normals'].extend(n)
            remap[old]=result['lookup'][key]
        seen=set()
        for i in range(0,len(batch['indices']),3):
            triangle=tuple(remap[index] for index in batch['indices'][i:i+3])
            key=tuple(sorted(triangle))
            if len(set(triangle))==3 and key not in seen:
                result['indices'].extend(triangle);seen.add(key)
        if result['indices']:reduced[color]=result
    batches=reduced
    triangle_count=sum(len(batch['indices'])//3 for batch in batches.values())
minimum = [min(min(b['vertices'][i::3]) for b in batches.values() if b['vertices']) for i in range(3)]
maximum = [max(max(b['vertices'][i::3]) for b in batches.values() if b['vertices']) for i in range(3)]
center = [(minimum[0]+maximum[0])/2, minimum[1], (minimum[2]+maximum[2])/2]
binary = bytearray()
views, accessors, materials, primitives = [], [], [], []

def buffer(values, typecode, component, kind, target, bounds=False, normalized=False):
    while len(binary)%4:
        binary.append(0)
    data = array.array(typecode, values)
    if sys.byteorder != 'little':
        data.byteswap()
    offset = len(binary)
    binary.extend(data.tobytes())
    view = len(views)
    views.append({'buffer':0,'byteOffset':offset,'byteLength':len(data)*data.itemsize,'target':target})
    width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[kind]
    accessor = {'bufferView':view,'componentType':component,'count':len(values)//width,'type':kind}
    if normalized:
        accessor['normalized'] = True
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
    if lathe_textures:
        attributes['TEXCOORD_0'] = buffer(batch['uvs'], 'H', 5123, 'VEC2', 34962, normalized=True)
    index=buffer(batch['indices'],'I',5125,'SCALAR',34963)
    if lathe_textures:
        materials.append({'name': f"NVIDIA {batch['family']} · UDIM {batch['tile']}", 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'baseColorTexture': {'index': batch['tile']-1001}, 'metallicFactor': batch['metallic'], 'roughnessFactor': batch['roughness']}, 'doubleSided': True})
    else:
        materials.append({'name':'Adapted NVIDIA PBR','pbrMetallicRoughness':{'baseColorFactor':color,'metallicFactor':0.6 if color==(0.47,0.52,0.51,1) else 0.06,'roughnessFactor':0.48},'doubleSided':True})
    primitives.append({'attributes':attributes,'indices':index,'material':len(materials)-1})
document={'asset':{'version':'2.0','generator':'QueueLab offline OpenUSD preparation','copyright':'NVIDIA, CC-BY-4.0; adapted geometry composition and materials'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0,'name':source.parent.parent.name}],'meshes':[{'primitives':primitives}],'materials':materials,'buffers':[{'byteLength':len(binary)}],'bufferViews':views,'accessors':accessors}
if lathe_textures:
    document['images'] = [{'uri': f'lathe-albedo-{tile}.png'} for tile in (1001, 1002, 1003)]
    document['textures'] = [{'sampler': 0, 'source': index} for index in range(3)]
    document['samplers'] = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}]
text=json.dumps(document,separators=(',',':')).encode()
text += b' '*((-len(text))%4)
binary += b'\0'*((-len(binary))%4)
glb=struct.pack('<III',0x46546C67,2,12+8+len(text)+8+len(binary))+struct.pack('<II',len(text),0x4E4F534A)+text+struct.pack('<II',len(binary),0x004E4942)+binary
destination.write_bytes(glb)
statistics = {'meshes':mesh_count,'triangles':triangle_count,'materialBatches':len(primitives),'originalDimensions':[maximum[i]-minimum[i] for i in range(3)]}
if lathe_textures:
    statistics.update({'sourcedAlbedoTiles': sorted(tile_triangles), 'trianglesByUDIM': tile_triangles, 'uvEncoding': 'normalized unsigned-short VEC2'})
print(json.dumps(statistics))
