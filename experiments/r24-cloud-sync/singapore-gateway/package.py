"""Build the two-file SCF Web Function package, preserving Linux executable permissions."""
import hashlib
from pathlib import Path
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


def package(path):
    src = Path(__file__).resolve().parent
    with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
        for name, mode in [('scf_bootstrap', 0o100755), ('server.js', 0o100644)]:
            entry = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = mode << 16
            archive.writestr(entry, (src / name).read_bytes(), compress_type=ZIP_DEFLATED)
    with ZipFile(path) as archive:
        assert archive.testzip() is None
        assert archive.getinfo('scf_bootstrap').external_attr >> 16 == 0o100755
    print(f'{path.stat().st_size} bytes; bootstrap=0755; SHA-256={hashlib.sha256(path.read_bytes()).hexdigest()}')


if __name__ == '__main__':
    package(Path(sys.argv[1]))
