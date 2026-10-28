"""Reject external or escaping layer references before USD composition."""
import pathlib
import sys
from pxr import Sdf

root = pathlib.Path(sys.argv[1]).resolve()
for file in root.rglob('*'):
    if file.suffix.lower() not in ('.usd', '.usda', '.usdc'):
        continue
    layer = Sdf.Layer.FindOrOpen(str(file))
    if not layer:
        raise RuntimeError('Cannot inspect source layer')
    for dependency in (*layer.GetExternalReferences(), *layer.subLayerPaths):
        if not dependency:
            continue
        if ':' in dependency or pathlib.PurePosixPath(dependency).is_absolute():
            raise RuntimeError('External source dependency is not permitted')
        resolved = (file.parent / dependency).resolve()
        if not resolved.is_relative_to(root):
            raise RuntimeError('Source dependency escapes its asset root')
print('Local layer dependencies checked')
