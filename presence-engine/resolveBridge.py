"""Read-only Resolve state. Project names are read only with explicit opt-in."""
import json
import sys
import os

sys.path.insert(0, "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules")
app = "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents"
sys.path.append(app + "/Resources/ResolvePython/lib/modules")
if os.path.exists(app + "/Libraries/Fusion/fusionscript.so"):
    os.environ.setdefault("RESOLVE_SCRIPT_LIB", app + "/Libraries/Fusion/fusionscript.so")
try:
    import DaVinciResolveScript
    resolve = DaVinciResolveScript.scriptapp("Resolve")
    if not resolve:
        raise RuntimeError("Unavailable")
    manager = resolve.GetProjectManager()
    project = manager.GetCurrentProject() if manager else None
    result = {"page": resolve.GetCurrentPage(), "rendering": bool(project and project.IsRenderingInProgress())}
    if "--include-name" in sys.argv and project:
        name = project.GetName()
        if isinstance(name, str) and 0 < len(name) <= 80:
            result["projectName"] = name
    print(json.dumps(result))
except Exception:
    print("null")
