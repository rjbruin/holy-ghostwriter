# PyInstaller spec for bundling the Holy Ghostwriter Flask server.
# Run from the project root:
#   pyinstaller desktop/server.spec --distpath desktop/server-dist --workpath desktop/pyibuild --noconfirm
#
# The output in desktop/server-dist/server/ is then picked up by
# electron-builder as an extraResource and placed in the app's Resources/server/ directory.

block_cipher = None

import sys
from pathlib import Path

ROOT = Path(SPECPATH).resolve().parent  # project root (one level above desktop/)

a = Analysis(
    [str(ROOT / 'app.py')],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[
        (str(ROOT / 'templates'), 'templates'),
        (str(ROOT / 'static'), 'static'),
        (str(ROOT / 'schemas'), 'schemas'),
        (str(ROOT / 'services'), 'services'),
    ],
    hiddenimports=[
        'flask',
        'jinja2',
        'jinja2.ext',
        'markupsafe',
        'bleach',
        'requests',
        'docx',
        'markdown',
        'jsonschema',
        'jsonschema.validators',
        'jsonschema._legacy_keywords',
        'jsonschema._keywords',
        'jsonschema.exceptions',
        'jsonschema.protocols',
        'jsonschema._utils',
        'jsonschema._types',
        'services.storage',
        'services.openrouter',
        'services.export_docx',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,  # no console window; logs go to stdio=ignore in main.js
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='server',
)
